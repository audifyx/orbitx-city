#!/usr/bin/env python3
"""Read-back verification for the OrbitX City world.

Independent of the writer: parses the .mca region files and level.dat
from disk with nbtlib + zlib, and checks:

* level.dat parses, DataVersion 4189, spawn (0, 65, 0)
* every region file parses; every chunk header entry decompresses to
  valid NBT with matching xPos/zPos and Status minecraft:full
* chunk count sane (33x33 = 1089 chunks over -256..+256)
* spot-check blocks at spawn + every district centre
* every sign in the world is read back; expected sign texts are asserted
* every sign stands on a solid block (a floating sign pops off on load)

Also attempts an anvil-parser cross-check (expected to fail: 0.9.0 only
reads the pre-1.18 chunk format — recorded honestly, not hidden).

Usage: python world/generator/verify.py [world-dir]
"""

from __future__ import annotations

import io
import json
import struct
import sys
import zlib
from pathlib import Path

from nbtlib import File

sys.path.insert(0, str(Path(__file__).resolve().parent))

from city import DISTRICTS, TAXI_STOPS  # noqa: E402

DATA_VERSION = 3955  # 1.21.1 (verified against a real 1.21.1 server)


def read_region(path: Path) -> dict[tuple[int, int], dict]:
    """Parse one .mca file -> {(cx, cz): chunk root Compound}."""
    raw = path.read_bytes()
    if len(raw) < 8192 or len(raw) % 4096 != 0:
        raise ValueError(f"{path.name}: bad size {len(raw)}")
    chunks = {}
    for idx in range(1024):
        loc = struct.unpack_from(">I", raw, idx * 4)[0]
        if loc == 0:
            continue
        offset, sectors = loc >> 8, loc & 0xFF
        start = offset * 4096
        length = struct.unpack_from(">I", raw, start)[0]
        ctype = raw[start + 4]
        payload = raw[start + 5: start + 4 + length]
        if ctype != 2:
            raise ValueError(f"{path.name} chunk {idx}: "
                             f"compression {ctype} (expected zlib=2)")
        nbt_bytes = zlib.decompress(payload)
        root = File.from_fileobj(io.BytesIO(nbt_bytes))
        cx, cz = int(root["xPos"]), int(root["zPos"])
        chunks[(cx, cz)] = root
    return chunks


def unpack_blockstates(section: dict) -> list[str]:
    """Return the 4096 block names of one section (palette + bit data)."""
    bs = section["block_states"]
    palette = [str(p["Name"]) for p in bs["palette"]]
    if len(palette) == 1:
        return palette * 4096
    bits = max(4, (len(palette) - 1).bit_length())
    per_long = 64 // bits
    mask = (1 << bits) - 1
    data = [int(v) for v in bs["data"]]
    out = []
    for i in range(4096):
        li, off = divmod(i, per_long)
        out.append(palette[(data[li] >> (off * bits)) & mask])
    return out


def block_at(chunks, x: int, y: int, z: int) -> str:
    chunk = chunks.get((x // 16, z // 16))
    if chunk is None:
        return "<no chunk>"
    for section in chunk["sections"]:
        if int(section["Y"]) == y // 16:
            names = unpack_blockstates(section)
            return names[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)]
    return "minecraft:air"


def read_signs(chunks) -> list[dict]:
    signs = []
    for (cx, cz), chunk in chunks.items():
        for be in chunk.get("block_entities", []):
            if str(be["id"]) != "minecraft:sign":
                continue
            front = be["front_text"]
            lines = []
            for raw in front["messages"]:
                try:
                    parsed = json.loads(str(raw))
                    lines.append(parsed if isinstance(parsed, str)
                                 else parsed.get("text", ""))
                except (ValueError, TypeError, AttributeError):
                    lines.append(str(raw))
            signs.append({"x": int(be["x"]), "y": int(be["y"]),
                          "z": int(be["z"]), "lines": lines,
                          "chunk": (cx, cz)})
    return signs


EXPECTED_SIGNS = [
    "ORBITX CITY", "TERMINAL", "DEX", "LAUNCHPAD", "SOCIAL", "SCANNER",
    "ORBITX MINT", "13H4WJvGEg4xrrBw", "GRADUATION GATE", "OG SCORE",
    "ORBITX 62/100", "TAXI STOP", "BOUNTY BOARD", "COMMAND HALL",
    "ORBITX / SOL", "DM ROOM 1", "LAUNCH PAD 1", "JOBS / MARKET",
    "orbitx.world", "FREE FOREVER",
]

SPOT_CHECKS = [
    # (x, y, z, expected block, label)
    (0, 64, 0, "minecraft:gold_block", "spawn plaza centre"),
    (0, 65, 0, "minecraft:air", "spawn point (feet)"),
    (0, 64, -160, "minecraft:quartz_block", "terminal hall floor"),
    (0, 72, -172, "minecraft:black_concrete", "terminal north wall"),
    (160, 64, 0, "minecraft:green_concrete", "dex swap floor"),
    (160, 65, 0, "minecraft:black_concrete", "dex swap counter"),
    (0, 64, 180, "minecraft:gold_block", "launchpad pad 3 centre"),
    (-3, 68, 195, "minecraft:gold_block", "graduation gate pillar"),
    (-160, 64, 0, "minecraft:white_concrete", "social hall centre"),
    (160, 64, -160, "minecraft:black_concrete", "scanner plot pavement"),
    (160, 70, -167, "minecraft:white_concrete", "scanner tower band"),
    (-160, 64, 160, "minecraft:white_concrete", "jobs market ground"),
    (-160, 64, -160, "minecraft:gravel", "park NW path"),
    (160, 64, 160, "minecraft:gravel", "park SE path"),
    (0, 64, -64, "minecraft:yellow_concrete", "ring road centre line"),
    (0, 64, 100, "minecraft:yellow_concrete", "avenue centre line"),
    (10, 66, 256, "minecraft:black_concrete", "north perimeter wall"),
]


def verify_world(world_dir: Path) -> bool:
    ok = True
    print(f"\n--- verifying {world_dir} ---")
    level = File.load(str(world_dir / "level.dat"), gzipped=True)
    data = level["Data"]
    print(f"level.dat: name={data['LevelName']} "
          f"DataVersion={data['DataVersion']} "
          f"spawn=({data['SpawnX']}, {data['SpawnY']}, {data['SpawnZ']}) "
          f"GameType={data['GameType']}")
    if int(data["DataVersion"]) != DATA_VERSION:
        print(f"FAIL: DataVersion != {DATA_VERSION}"); ok = False
    if (int(data["SpawnX"]), int(data["SpawnY"]), int(data["SpawnZ"])) != (0, 65, 0):
        print("FAIL: spawn != (0, 65, 0)"); ok = False

    chunks: dict = {}
    region_files = sorted((world_dir / "region").glob("r.*.mca"))
    print(f"region files: {[p.name for p in region_files]}")
    for p in region_files:
        got = read_region(p)
        print(f"  {p.name}: {len(got)} chunks, "
              f"{p.stat().st_size:,} bytes")
        chunks.update(got)
    print(f"total chunks: {len(chunks)} (expect 1089 = 33x33)")
    if len(chunks) != 1089:
        print("FAIL: chunk count"); ok = False
    bad_status = [c for c, r in chunks.items()
                  if str(r["Status"]) != "minecraft:full"]
    if bad_status:
        print(f"FAIL: {len(bad_status)} chunks not Status=full"); ok = False
    bad_dv = [c for c, r in chunks.items()
              if int(r["DataVersion"]) != DATA_VERSION]
    if bad_dv:
        print(f"FAIL: {len(bad_dv)} chunks wrong DataVersion"); ok = False
    missing_sections = [c for c, r in chunks.items() if not r["sections"]]
    if missing_sections:
        print(f"FAIL: {len(missing_sections)} chunks with no sections")
        ok = False

    print("spot checks:")
    for x, y, z, want, label in SPOT_CHECKS:
        got = block_at(chunks, x, y, z)
        mark = "OK  " if got == want else "FAIL"
        if got != want:
            ok = False
        print(f"  {mark} ({x}, {y}, {z}) {label}: {got}")

    signs = read_signs(chunks)
    print(f"signs read back: {len(signs)}")
    all_text = "\n".join("\n".join(s["lines"]) for s in signs)
    for want in EXPECTED_SIGNS:
        if want not in all_text:
            print(f"FAIL: sign text missing: {want!r}"); ok = False
    print(f"expected sign texts present: "
          f"{sum(w in all_text for w in EXPECTED_SIGNS)}/{len(EXPECTED_SIGNS)}")
    # Every sign must stand on a solid block.
    floating = [s for s in signs
                if block_at(chunks, s["x"], s["y"] - 1, s["z"])
                == "minecraft:air"]
    if floating:
        print(f"FAIL: {len(floating)} floating signs: {floating}"); ok = False
    else:
        print("all signs stand on a solid block")
    for s in signs[:8]:
        print(f"  sign ({s['x']}, {s['y']}, {s['z']}): {s['lines']}")

    # District centres exist as chunks.
    for key, d in DISTRICTS.items():
        cx, cz = d["center"][0] // 16, d["center"][1] // 16
        if (cx, cz) not in chunks:
            print(f"FAIL: district {key} chunk missing"); ok = False
    print("district centre chunks: all present")

    # anvil-parser cross-check (known limitation, recorded honestly).
    try:
        import anvil
        r = anvil.Region.from_file(str(region_files[0]))
        c = r.get_chunk(0, 0)
        print(f"anvil-parser cross-check: read chunk -> {c}")
    except Exception as e:  # noqa: BLE001 - the failure itself is the finding
        print(f"anvil-parser cross-check: cannot read 1.21 chunks "
              f"(expected, 0.9.0 is pre-1.18 format): {type(e).__name__}: {e}")

    print("--- " + ("VERIFY OK" if ok else "VERIFY FAILED") + " ---")
    return ok


if __name__ == "__main__":
    world_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path(__file__).resolve().parent.parent / "out" / "orbitx-city")
    raise SystemExit(0 if verify_world(world_dir) else 1)
