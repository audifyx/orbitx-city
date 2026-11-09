# OrbitX City — the world

A real **Minecraft Java Edition 1.21.1** world, built by a deterministic
Python generator (fixed seed `1337`). Free, forever.

## Layout

World x/z from **-256 to +256**, ground top **y=64**, spawn **(0, 65, 0)**.

| District | Centre | What is there |
| --- | --- | --- |
| Spawn plaza | (0, 0) | 41×41 white/black/gold plaza, city map board, 4 gate arches, ORBITX mint sign |
| Terminal tower | (0, -160) | Tallest building (to y=119), black/white/gold, command hall, spiral stair to the roof deck |
| DEX hall | (160, 0) | Trading hall, green/white, swap counter, pair boards |
| Launchpad bay | (0, 160) | 3 obsidian launch pads, bonding-curve ramps, graduation gate, control hut |
| Social hub | (-160, 0) | Blue hall, post boards, 3 DM rooms |
| Scanner tower | (160, -160) | Striped watchtower (to y=104), OG-score board, bundle map, X-signal panels |
| Jobs / market | (-160, 160) | 8 market stalls + job stands, bounty board |
| Parks | (-160, -160), (160, 160) | Trees, gravel paths, lamps, benches, pond (SE) |

Roads: 7-wide avenues along the x=0 and z=0 axes (segmented so they never
cut through a district plot) plus a square ring road at |x|=64 / |z|=64.
The **taxi loop** is the ring-road rectangle, with 8 marked taxi stops
(N, NE, E, SE, S, SW, W, NW). A black/gold perimeter wall closes the city
at |x|=256 / |z|=256, with gates where the avenues meet it.

The machine-readable layout (district coordinates, road grid, taxi stops,
spawn) lives in [`layout.json`](layout.json) — the web menu map is built
to these same numbers.

## Generate

```bash
cd <repo root>
python -m venv world/generator/.venv
world/generator/.venv/bin/pip install -r world/generator/requirements.txt
python world/generator/generate.py
```

That writes:

- `world/out/orbitx-city/` — the world folder (`level.dat`, `region/`, `data/`)
- `world/layout.json`
- `web/public/orbitx-city-world.zip` — the downloadable world

Then it runs the read-back verification automatically. Generation takes
~4 seconds. Output is byte-deterministic: two runs produce identical
SHA-256 hashes for the zip, `level.dat`, and every region file.

## Install in Minecraft

1. Java Edition **1.21.1** (other 1.21.x versions may load it, 1.21.1 is the
   verified one).
2. Download `orbitx-city-world.zip` and unzip it.
3. Move the `OrbitX City` folder into your `saves/` folder
   (`%appdata%/.minecraft/saves` on Windows, `~/Library/Application Support/minecraft/saves`
   on macOS, `~/.minecraft/saves` on Linux).
4. Launch Minecraft, Singleplayer, open **OrbitX City**. You spawn in the
   plaza in Creative mode (fly with double-tap Space), peaceful, cheats on.

## How it is built

- `world/generator/generate.py` — entry point (build → write → zip → verify)
- `world/generator/city.py` — layout constants + every district/road/park builder
- `world/generator/mcworld.py` — world writer: per-section numpy block
  arrays, modern 1.21 chunk NBT (DataVersion 3955, `Status: full`,
  heightmaps, sign block entities), standard `.mca` region container,
  `level.dat`
- `world/generator/verify.py` — independent read-back checker
  (also runnable standalone: `verify.py [world-dir]`)

Library choice (tried in order, per `PLAN.md`): **amulet-core failed to
install** in this VM — its `amulet-leveldb` dependency has no wheel for
Python 3.12 and fails to build from source (C++20/CMake toolchain not
detected). **nbtlib 2.0.4** is the writer (real NBT read/write; the region
container and modern chunk format are built on top of it).
**anvil-parser 0.9.0** is installed but only handles the pre-1.18 chunk
format, so it is used for a cross-check only, not for writing.

## Verification (2026-11-09, this build)

Read-back (`verify.py`, runs inside every `generate.py` run) — **PASS**:

- `level.dat` parses: name `OrbitX City`, DataVersion 3955, spawn
  (0, 65, 0), GameType creative.
- 4 region files, **1089 chunks** (33×33, covering -256..+256), all
  `Status: minecraft:full`, all DataVersion 3955.
- **17/17 spot checks** pass (spawn, every district centre, ring road,
  avenue, perimeter wall).
- **56/56 signs read back**, 20/20 expected sign texts present
  (incl. the ORBITX mint address, `ORBITX 62/100` OG score, taxi stops),
  and every sign stands on a solid block (no floating signs).
- The packaged zip unzips to a valid world folder and passes the same
  verification.

Headless load test (real Mojang 1.21.1 server jar, Temurin JRE 21,
offline mode, in `/tmp` — not part of the repo) — **PASS**:

- Server loads the world, prints `Done (9.7s)!`, prepares the spawn area,
  saves all chunks on `stop`, exits 0.
- After the server re-saves the world, all **1089 chunks and all 56
  signs** are still there with identical text (mint sign and OG-score
  board confirmed) — the world round-trips through vanilla.
- Only log noise: the Yggdrasil key-fetcher SSL error (sandbox egress
  proxy blocks Mojang HTTPS; irrelevant in offline mode) — no chunk,
  lighting, or data errors.

Fixed along the way (caught by the server test, not by read-back):
`DataVersion` was first written as 4189, which 1.21.1 rejects as unknown
— the correct 1.21.1 value is **3955**, confirmed against a fresh world
generated by the real server.

## What is NOT verified

- No human has walked the city in a Minecraft client yet — interiors,
  stair climbs, and sight-lines are verified by block checks only.
- No multiplayer test (single-player world + headless server load only).
- Chunks outside -256..+256 will generate as default vanilla terrain if
  a player walks past the wall.
