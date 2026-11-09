"""OrbitX City — Minecraft Java Edition (1.21.x) world writer.

Builds chunks in the modern (1.21) Anvil format on top of nbtlib:

* Chunk root: DataVersion / xPos / zPos / Status=minecraft:full /
  Heightmaps / sections / block_entities (no legacy ``Level`` wrapper).
* Sections: Y -4..19 range, block_states palette + bit-packed data
  (vanilla ``BitStorage`` layout: values-per-long packing, no spanning),
  biomes palette (single ``minecraft:plains`` entry).
* Signs: ``minecraft:oak_sign`` block + ``minecraft:sign`` block entity
  with front/back text (1.21 format).
* Region files: standard .mca container (8 KiB header, zlib chunk payloads).
* level.dat: gzipped NBT via nbtlib.

Library choice (per PLAN.md, tried in order):
1. amulet-core — FAILED to install in this VM: its ``amulet-leveldb``
   dependency has no wheel for Python 3.12 and builds from source
   requiring a C++20/CMake toolchain that the build script does not
   detect (``RuntimeError: Could not find a C++ 20 compiler``).
2. nbtlib — INSTALLED (2.0.4) and round-trips NBT cleanly. Used here.
3. anvil-parser — installed (0.9.0) but writes the pre-1.18 chunk
   format (``Level`` wrapper, DataVersion 1976, y capped at 255), so it
   is NOT used to write; verify.py attempts it as a cross-check only.

All block storage is numpy uint16 arrays of global block ids, so the
17M-cell terrain fill is vectorised and the whole city builds in seconds.
"""

from __future__ import annotations

import io
import json
import struct
import time
import zlib
from collections import Counter
from pathlib import Path

import numpy as np
from nbtlib import (
    Byte,
    Compound,
    File,
    Float,
    Int,
    IntArray,
    List,
    Long,
    LongArray,
    String,
)

DATA_VERSION = 3955  # Minecraft Java Edition 1.21.1 (verified: a 1.21.1
# server stamps fresh worlds with 3955; 4189 belongs to a later 1.21.x)
SEED = 1337
MIN_Y = 0
MAX_Y = 255
# Chunk range that covers x/z -256..+256 (chunk -16 covers -256..-241,
# chunk +16 covers +256..+271).
CHUNK_MIN = -16
CHUNK_MAX = 16

AIR = "minecraft:air"


def _signed64(v: int) -> int:
    """Reinterpret an unsigned 64-bit value as a signed Java long."""
    v &= (1 << 64) - 1
    return v - (1 << 64) if v >= (1 << 63) else v


def pack_bitstorage(values, bits: int) -> list[int]:
    """Pack ints with vanilla BitStorage layout.

    Each 64-bit long holds ``64 // bits`` values; leftover bits in a long
    are unused and values never span longs. Returns signed longs.
    """
    values = np.asarray(values, dtype=np.uint64)
    per_long = 64 // bits
    n_longs = (len(values) + per_long - 1) // per_long
    padded = np.zeros(n_longs * per_long, dtype=np.uint64)
    padded[: len(values)] = values
    matrix = padded.reshape(n_longs, per_long)
    shifts = (np.arange(per_long, dtype=np.uint64) * bits).astype(np.uint64)
    packed = (matrix << shifts).sum(axis=1)
    return [_signed64(int(v)) for v in packed]


class World:
    """A 512x512-block city world held as per-section numpy arrays."""

    def __init__(self):
        # (name, props-tuple) -> gid; gid 0 is always air.
        self._registry: dict[tuple[str, tuple], int] = {(AIR, ()): 0}
        self._names: list[str] = [AIR]
        self._props: list[tuple] = [()]
        # (cx, cz, sy) -> uint16 array of 4096 gids, index (ly*16+lz)*16+lx.
        self._sections: dict[tuple[int, int, int], np.ndarray] = {}
        self.signs: list[dict] = []
        self.placed = 0          # non-air block assignments by builders
        self.terrain_cells = 0   # non-air cells laid down by terrain pass
        self.block_counts: Counter = Counter()

    # -- block registry -------------------------------------------------
    def gid(self, name: str, props: dict | None = None) -> int:
        key = (name, tuple(sorted((props or {}).items())))
        gid = self._registry.get(key)
        if gid is None:
            gid = len(self._names)
            self._registry[key] = gid
            self._names.append(name)
            self._props.append(key[1])
        return gid

    # -- sections -------------------------------------------------------
    def _section(self, cx: int, cz: int, sy: int) -> np.ndarray:
        key = (cx, cz, sy)
        arr = self._sections.get(key)
        if arr is None:
            arr = np.zeros(4096, dtype=np.uint16)
            self._sections[key] = arr
        return arr

    @staticmethod
    def _idx(lx: int, ly: int, lz: int) -> int:
        return (ly * 16 + lz) * 16 + lx

    # -- placement ------------------------------------------------------
    def set_block(self, x: int, y: int, z: int, name: str, props: dict | None = None):
        if not (-256 <= x <= 256 and -256 <= z <= 256 and MIN_Y <= y <= MAX_Y):
            raise ValueError(f"block out of bounds: ({x}, {y}, {z})")
        gid = self.gid(name, props)
        arr = self._section(x // 16, z // 16, y // 16)
        arr[self._idx(x & 15, y & 15, z & 15)] = gid
        if name != AIR:
            self.placed += 1
            self.block_counts[name] += 1

    def fill_box(self, x0, y0, z0, x1, y1, z1, name, props=None):
        """Fill an inclusive box (any order of corners). Vectorised."""
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        z0, z1 = min(z0, z1), max(z0, z1)
        gid = self.gid(name, props)
        for sy in range(y0 // 16, y1 // 16 + 1):
            ly0 = max(y0 - sy * 16, 0)
            ly1 = min(y1 - sy * 16, 15)
            for cz in range(z0 // 16, z1 // 16 + 1):
                lz0 = max(z0 - cz * 16, 0)
                lz1 = min(z1 - cz * 16, 15)
                for cx in range(x0 // 16, x1 // 16 + 1):
                    lx0 = max(x0 - cx * 16, 0)
                    lx1 = min(x1 - cx * 16, 15)
                    arr = self._section(cx, cz, sy).reshape(16, 16, 16)
                    arr[ly0 : ly1 + 1, lz0 : lz1 + 1, lx0 : lx1 + 1] = gid
        if name != AIR:
            n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1)
            self.placed += n
            self.block_counts[name] += n

    def fill_terrain(self, x0, y0, z0, x1, y1, z1, name):
        """Terrain fill: same as fill_box but not counted as placed."""
        before = self.placed
        self.fill_box(x0, y0, z0, x1, y1, z1, name)
        n = self.placed - before
        self.placed = before
        self.terrain_cells += n
        self.block_counts[name] -= n

    def sign(self, x, y, z, lines, rotation=0, color="black"):
        """Standing oak sign with 1.21 block-entity text."""
        lines = (list(lines) + ["", "", "", ""])[:4]
        self.set_block(x, y, z, "minecraft:oak_sign",
                       {"rotation": str(rotation % 16)})
        text = {
            "messages": [json.dumps({"text": ln}, ensure_ascii=False)
                         for ln in lines],
            "color": color,
            "has_glowing_text": 0,
        }
        self.signs.append({"x": x, "y": y, "z": z, "text": text})

    def get_block(self, x, y, z) -> str:
        arr = self._sections.get((x // 16, z // 16, y // 16))
        if arr is None:
            return AIR
        return self._names[int(arr[self._idx(x & 15, y & 15, z & 15)])]

    # -- serialisation --------------------------------------------------
    def _heightmaps(self, cx: int, cz: int) -> tuple[list[int], list[int]]:
        """WORLD_SURFACE and MOTION_BLOCKING (9-bit, values-per-long)."""
        leaves = self.gid("minecraft:oak_leaves")
        solid = np.zeros((144, 16, 16), dtype=bool)
        motion = np.zeros((144, 16, 16), dtype=bool)
        for sy in range(0, 9):  # y 0..143
            arr = self._sections.get((cx, cz, sy))
            if arr is None:
                continue
            cube = arr.reshape(16, 16, 16)  # [ly, lz, lx]
            solid[sy * 16 : (sy + 1) * 16] = cube != 0
            motion[sy * 16 : (sy + 1) * 16] = (cube != 0) & (cube != leaves)
        heights = np.zeros(256, dtype=np.uint64)
        motion_h = np.zeros(256, dtype=np.uint64)
        for lz in range(16):
            for lx in range(16):
                col = solid[:, lz, lx]
                if col.any():
                    heights[lz * 16 + lx] = int(np.nonzero(col)[0].max()) + 1
                colm = motion[:, lz, lx]
                if colm.any():
                    motion_h[lz * 16 + lx] = int(np.nonzero(colm)[0].max()) + 1
        return (pack_bitstorage(heights, 9), pack_bitstorage(motion_h, 9))

    def _section_nbt(self, cx: int, cz: int, sy: int) -> Compound | None:
        arr = self._sections.get((cx, cz, sy))
        if arr is None:
            return None
        uniq, remap = np.unique(arr, return_inverse=True)
        if len(uniq) == 1 and self._names[int(uniq[0])] == AIR:
            return None
        palette = []
        for gid in uniq:
            entry = Compound({"Name": String(self._names[int(gid)])})
            props = self._props[int(gid)]
            if props:
                entry["Properties"] = Compound(
                    {k: String(v) for k, v in props})
            palette.append(entry)
        block_states = Compound({"palette": List(palette)})
        if len(palette) > 1:
            bits = max(4, (len(palette) - 1).bit_length())
            block_states["data"] = LongArray(
                pack_bitstorage(remap.astype(np.uint64), bits))
        return Compound({
            "Y": Byte(sy),
            "block_states": block_states,
            "biomes": Compound({"palette": List([String("minecraft:plains")])}),
        })

    def chunk_nbt(self, cx: int, cz: int) -> bytes:
        sections = []
        for sy in range(0, 16):
            sec = self._section_nbt(cx, cz, sy)
            if sec is not None:
                sections.append(sec)
        surface, motion = self._heightmaps(cx, cz)
        block_entities = []
        for s in self.signs:
            if s["x"] // 16 == cx and s["z"] // 16 == cz:
                t = s["text"]
                front = Compound({
                    "messages": List([String(m) for m in t["messages"]]),
                    "color": String(t["color"]),
                    "has_glowing_text": Byte(0),
                })
                block_entities.append(Compound({
                    "id": String("minecraft:sign"),
                    "x": Int(s["x"]), "y": Int(s["y"]), "z": Int(s["z"]),
                    "is_waxed": Byte(0),
                    "front_text": front,
                    "back_text": front,
                }))
        root = Compound({
            "DataVersion": Int(DATA_VERSION),
            "xPos": Int(cx),
            "yPos": Int(-4),
            "zPos": Int(cz),
            "Status": String("minecraft:full"),
            "LastUpdate": Long(0),
            "InhabitedTime": Long(0),
            "Heightmaps": Compound({
                "WORLD_SURFACE": LongArray(surface),
                "MOTION_BLOCKING": LongArray(motion),
            }),
            "sections": List(sections),
        })
        if block_entities:
            root["block_entities"] = List(block_entities)
        buf = io.BytesIO()
        File(root).write(buf)
        return buf.getvalue()

    # -- region / level.dat / disk --------------------------------------
    @staticmethod
    def write_region(path: Path, chunks: dict[tuple[int, int], bytes]):
        """Write one .mca file (8 KiB header + zlib chunk payloads)."""
        header = bytearray(8192)
        body = bytearray()
        sector = 2  # sectors 0-1 are the header
        for (cx, cz) in sorted(chunks):
            payload = b"\x02" + zlib.compress(chunks[(cx, cz)], level=6)
            length = len(payload)
            n_sectors = (4 + length + 4095) // 4096
            # header index is local chunk coords within the region
            rx, rz = cx % 32, cz % 32
            idx = rz * 32 + rx
            struct.pack_into(">I", header, idx * 4, (sector << 8) | n_sectors)
            struct.pack_into(">I", header, 4096 + idx * 4, 0)  # fixed ts
            blob = struct.pack(">I", length) + payload
            blob += b"\x00" * (n_sectors * 4096 - len(blob))
            body += blob
            sector += n_sectors
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            f.write(header)
            f.write(body)

    def write_level_dat(self, path: Path, level_name: str = "OrbitX City"):
        data = Compound({
            "DataVersion": Int(DATA_VERSION),
            "version": Int(19133),
            "Version": Compound({
                "Name": String("1.21.1"),
                "Id": Int(DATA_VERSION),
                "Series": String("main"),
                "Snapshot": Byte(0),
            }),
            "LevelName": String(level_name),
            "initialized": Byte(1),
            "GameType": Int(1),  # creative: fly around and tour the city
            "SpawnX": Int(0),
            "SpawnY": Int(65),
            "SpawnZ": Int(0),
            "SpawnAngle": Float(0.0),
            "Time": Long(6000),      # morning
            "DayTime": Long(6000),
            "Difficulty": Byte(0),   # peaceful
            "DifficultyLocked": Byte(0),
            "allowCommands": Byte(1),
            "RandomSeed": Long(SEED),
            "hardcore": Byte(0),
            "raining": Byte(0),
            "thundering": Byte(0),
            # End dragon state (vanilla default; the server logs an ERROR
            # if this key is missing, even though it loads fine without it).
            "DragonFight": Compound({
                "NeedsStateScanning": Byte(1),
                "Gateways": IntArray([2, 1, 10, 14, 15, 17, 9, 8, 4, 3,
                                      16, 7, 13, 19, 12, 18, 0, 5, 6, 11]),
                "DragonKilled": Byte(0),
                "PreviouslyKilled": Byte(0),
            }),
            "CustomBossEvents": Compound({}),
            "DataPacks": Compound({
                "Enabled": List([String("vanilla")]),
                "Disabled": List([String("bundle"), String("trade_rebalance")]),
            }),
            "GameRules": Compound({
                "doDaylightCycle": String("true"),
                "doMobSpawning": String("false"),
                "doWeatherCycle": String("false"),
                "keepInventory": String("true"),
            }),
            "WorldGenSettings": Compound({
                "seed": Long(SEED),
                "generate_features": Byte(1),
                "bonus_chest": Byte(0),
                "dimensions": Compound({
                    "minecraft:overworld": Compound({
                        "type": String("minecraft:overworld"),
                        "generator": Compound({
                            "type": String("minecraft:noise"),
                            "settings": String("minecraft:overworld"),
                            "seed": Long(SEED),
                            "biome_source": Compound({
                                "type": String("minecraft:multi_noise"),
                                "preset": String("minecraft:overworld"),
                            }),
                        }),
                    }),
                    "minecraft:the_nether": Compound({
                        "type": String("minecraft:the_nether"),
                        "generator": Compound({
                            "type": String("minecraft:noise"),
                            "settings": String("minecraft:nether"),
                            "seed": Long(SEED),
                            "biome_source": Compound({
                                "type": String("minecraft:multi_noise"),
                                "preset": String("minecraft:nether"),
                            }),
                        }),
                    }),
                    "minecraft:the_end": Compound({
                        "type": String("minecraft:the_end"),
                        "generator": Compound({
                            "type": String("minecraft:noise"),
                            "settings": String("minecraft:end"),
                            "seed": Long(SEED),
                            "biome_source": Compound({
                                "type": String("minecraft:the_end"),
                                "preset": String("minecraft:end"),
                            }),
                        }),
                    }),
                }),
            }),
        })
        path.parent.mkdir(parents=True, exist_ok=True)
        # Deterministic gzip (mtime=0): nbtlib's save() stamps wall time.
        import gzip
        buf = io.BytesIO()
        File(Compound({"Data": data})).write(buf)
        path.write_bytes(gzip.compress(buf.getvalue(), compresslevel=6,
                                       mtime=0))

    def save_world(self, out_dir: Path) -> dict:
        """Write level.dat + region/*.mca + data/ ; return stats."""
        region_dir = out_dir / "region"
        region_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "data").mkdir(parents=True, exist_ok=True)
        # group chunks by region
        regions: dict[tuple[int, int], dict] = {}
        chunk_count = 0
        for cx in range(CHUNK_MIN, CHUNK_MAX + 1):
            for cz in range(CHUNK_MIN, CHUNK_MAX + 1):
                rx, rz = cx // 32, cz // 32
                regions.setdefault((rx, rz), {})[(cx, cz)] = \
                    self.chunk_nbt(cx, cz)
                chunk_count += 1
        region_files = []
        for (rx, rz), chunks in sorted(regions.items()):
            p = region_dir / f"r.{rx}.{rz}.mca"
            self.write_region(p, chunks)
            region_files.append(str(p))
        self.write_level_dat(out_dir / "level.dat")
        non_air = 0
        for arr in self._sections.values():
            non_air += int((arr != 0).sum())
        return {
            "chunks": chunk_count,
            "regions": len(region_files),
            "region_files": region_files,
            "signs": len(self.signs),
            "blocks_placed": self.placed,
            "terrain_cells": self.terrain_cells,
            "non_air_cells": non_air,
            "sections": len(self._sections),
        }
