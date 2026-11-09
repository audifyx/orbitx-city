#!/usr/bin/env python3
"""OrbitX City world generator — Part 1.

Run from the repo root:

    python world/generator/generate.py

Writes the world to world/out/orbitx-city/ (level.dat, region/, data/),
writes world/layout.json, packages web/public/orbitx-city-world.zip,
then runs the read-back verification (verify.py).

Deterministic: fixed seed 1337. Same input -> same blocks every run
(region timestamps are fixed at 0, so even the .mca bytes are stable).
"""

from __future__ import annotations

import json
import shutil
import sys
import time
import zipfile
from pathlib import Path

# Allow running from the repo root (python world/generator/generate.py).
sys.path.insert(0, str(Path(__file__).resolve().parent))

from city import LAYOUT, build_city  # noqa: E402
from mcworld import World  # noqa: E402
from verify import verify_world  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = REPO_ROOT / "world" / "out" / "orbitx-city"
LAYOUT_PATH = REPO_ROOT / "world" / "layout.json"
ZIP_PATH = REPO_ROOT / "web" / "public" / "orbitx-city-world.zip"
ZIP_TOP = "OrbitX City"


def package_zip(out_dir: Path, zip_path: Path) -> int:
    """Zip the world folder under a top-level 'OrbitX City' folder.

    Entry timestamps are fixed so the zip is byte-identical every run.
    """
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()
    files = sorted(p for p in out_dir.rglob("*") if p.is_file())
    fixed = (2026, 1, 1, 0, 0, 0)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr(zipfile.ZipInfo(f"{ZIP_TOP}/data/", date_time=fixed), "")
        for p in files:
            info = zipfile.ZipInfo(f"{ZIP_TOP}/{p.relative_to(out_dir)}",
                                   date_time=fixed)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    return len(files)


def main() -> int:
    t0 = time.time()
    print("OrbitX City generator — seed 1337, target Minecraft Java 1.21.1")
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    world = World()
    build_city(world)
    print(f"built city in {time.time() - t0:.1f}s: "
          f"{world.placed:,} blocks placed, {len(world.signs)} signs")

    stats = world.save_world(OUT_DIR)
    print(f"wrote world to {OUT_DIR}: {stats['chunks']} chunks, "
          f"{stats['regions']} region files, "
          f"{stats['non_air_cells']:,} non-air blocks, "
          f"{stats['sections']} sections")

    layout = dict(LAYOUT)
    layout["stats"] = {
        "chunks": stats["chunks"],
        "regions": stats["regions"],
        "signs": stats["signs"],
        "blocks_placed": stats["blocks_placed"],
        "terrain_cells": stats["terrain_cells"],
        "non_air_cells": stats["non_air_cells"],
    }
    LAYOUT_PATH.write_text(json.dumps(layout, indent=2) + "\n")
    print(f"wrote {LAYOUT_PATH}")

    n_files = package_zip(OUT_DIR, ZIP_PATH)
    print(f"packaged {ZIP_PATH} ({ZIP_PATH.stat().st_size:,} bytes, "
          f"{n_files} files)")

    ok = verify_world(OUT_DIR)
    print(f"total {time.time() - t0:.1f}s — "
          f"{'VERIFIED OK' if ok else 'VERIFICATION FAILED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
