"""OrbitX City layout + builders.

Fixed contract (the web menu map is built to these same numbers):
world x/z -256..+256, ground top y=64, spawn plaza 41x41 at (0,0),
spawn point (0, 65, 0). Districts are ~80x80 plots at the coordinates
below. Do not move districts without updating the web map too.
"""

from __future__ import annotations

import random

from mcworld import SEED, World

GROUND = 64
SPAWN = (0, 65, 0)
MINT = "13H4WJvGEg4xrrBwWn2vsQgz7xhmhxgNdw19i1QsxPX9"

DISTRICTS = {
    "terminal":   {"name": "Terminal",   "center": (0, -160),    "size": (80, 80),
                   "desc": "Command tower — the tallest building in the city"},
    "dex":        {"name": "DEX",        "center": (160, 0),     "size": (80, 80),
                   "desc": "Trading hall — swap floor and pair boards"},
    "launchpad":  {"name": "Launchpad",  "center": (0, 160),     "size": (80, 80),
                   "desc": "Launch bay — pads, bonding ramps, graduation gate"},
    "social":     {"name": "Social",     "center": (-160, 0),    "size": (80, 80),
                   "desc": "Social hub — plaza, post boards, DM rooms"},
    "scanner":    {"name": "Scanner",    "center": (160, -160),  "size": (80, 80),
                   "desc": "Watchtower — OG-score board, bundle map, X signals"},
    "jobs":       {"name": "Jobs / Market", "center": (-160, 160), "size": (80, 80),
                   "desc": "Market stalls and job stands"},
    "park_nw":    {"name": "Park NW",    "center": (-160, -160), "size": (80, 80),
                   "desc": "Park — trees, paths, lamps"},
    "park_se":    {"name": "Park SE",    "center": (160, 160),   "size": (80, 80),
                   "desc": "Park — trees, paths, lamps, pond"},
}

# Taxi loop: rectangular circuit on the inner ring road (|x|=64 / |z|=64).
TAXI_STOPS = [
    {"id": "taxi_n",  "pos": (0, -64),    "label": "LOOP - NORTH"},
    {"id": "taxi_ne", "pos": (64, -64),   "label": "LOOP - NORTH EAST"},
    {"id": "taxi_e",  "pos": (64, 0),     "label": "LOOP - EAST"},
    {"id": "taxi_se", "pos": (64, 64),    "label": "LOOP - SOUTH EAST"},
    {"id": "taxi_s",  "pos": (0, 64),     "label": "LOOP - SOUTH"},
    {"id": "taxi_sw", "pos": (-64, 64),   "label": "LOOP - SOUTH WEST"},
    {"id": "taxi_w",  "pos": (-64, 0),    "label": "LOOP - WEST"},
    {"id": "taxi_nw", "pos": (-64, -64),  "label": "LOOP - NORTH WEST"},
]

LAYOUT = {
    "seed": SEED,
    "version": "1.21.1",
    "bounds": {"x": [-256, 256], "z": [-256, 256]},
    "ground_y": GROUND,
    "spawn": {"x": SPAWN[0], "y": SPAWN[1], "z": SPAWN[2]},
    "plaza": {"center": [0, 0], "size": 41},
    "districts": {
        k: {"name": v["name"], "center": list(v["center"]),
            "size": list(v["size"]), "desc": v["desc"]}
        for k, v in DISTRICTS.items()
    },
    "roads": {
        "avenues": [{"axis": "x", "at": 0, "width": 7},
                    {"axis": "z", "at": 0, "width": 7}],
        "ring": {"half": 64, "width": 7},
    },
    "taxi_loop": {"shape": "rectangle", "half": 64,
                  "stops": [{"id": s["id"], "pos": list(s["pos"]),
                             "label": s["label"]} for s in TAXI_STOPS]},
    "mint": MINT,
    "site": "orbitx.world",
}


# ---------------------------------------------------------------- helpers
def walls(w: World, x0, z0, x1, z1, y0, y1, block, props=None):
    w.fill_box(x0, y0, z0, x0, y1, z1, block, props)
    w.fill_box(x1, y0, z0, x1, y1, z1, block, props)
    w.fill_box(x0, y0, z0, x1, y1, z0, block, props)
    w.fill_box(x0, y0, z1, x1, y1, z1, block, props)


def doorway(w: World, x, z, y0=65, y1=67, axis="x", width=1):
    """Carve a walkable opening. axis=x: opening spans x; axis=z: spans z."""
    if axis == "x":
        w.fill_box(x, y0, z, x + width - 1, y1, z, "minecraft:air")
    else:
        w.fill_box(x, y0, z, x, y1, z + width - 1, "minecraft:air")


def lamp(w: World, x, z):
    w.set_block(x, 65, z, "minecraft:oak_fence")
    w.set_block(x, 66, z, "minecraft:glowstone")


def sign_post(w: World, x, z, lines, rotation=0, base="minecraft:gold_block"):
    w.set_block(x, 65, z, base)
    w.sign(x, 66, z, lines, rotation=rotation)


def spiral_stairs(w: World, x0, z0, y_start, y_end, block="minecraft:quartz_block"):
    """Full-block spiral in a 3x3 column. Returns (x, z) of the top step."""
    per = [(0, 0), (1, 0), (2, 0), (2, 1), (2, 2), (1, 2), (0, 2), (0, 1)]
    y, i = y_start, 0
    top = (x0, z0)
    while y <= y_end:
        dx, dz = per[i % 8]
        w.set_block(x0 + dx, y, z0 + dz, block)
        top = (x0 + dx, z0 + dz)
        y += 1
        i += 1
    return top


def tree(w: World, x, z, h):
    for dy in range(h):
        w.set_block(x, 65 + dy, z, "minecraft:oak_log")
    for dy, r in ((h - 2, 2), (h - 1, 2), (h, 1)):
        for dx in range(-r, r + 1):
            for dz in range(-r, r + 1):
                if abs(dx) == r and abs(dz) == r and r == 2:
                    continue  # trim corners
                if dx == 0 and dz == 0 and dy < h:
                    continue
                w.set_block(x + dx, 65 + dy, z + dz, "minecraft:oak_leaves")
    w.set_block(x, 65 + h + 1, z, "minecraft:oak_leaves")


# ---------------------------------------------------------------- terrain
def build_terrain(w: World):
    for cx in range(-16, 17):
        for cz in range(-16, 17):
            x0, z0 = cx * 16, cz * 16
            x1, z1 = min(x0 + 15, 256), min(z0 + 15, 256)
            w.fill_terrain(x0, 0, z0, x1, 0, z1, "minecraft:bedrock")
            w.fill_terrain(x0, 1, z0, x1, 60, z1, "minecraft:stone")
            w.fill_terrain(x0, 61, z0, x1, 63, z1, "minecraft:dirt")
            w.fill_terrain(x0, 64, z0, x1, 64, z1, "minecraft:grass_block")


def plot_pavement(w: World, cx, cz, block, border):
    x0, z0, x1, z1 = cx - 40, cz - 40, cx + 40, cz + 40
    w.fill_box(x0, 64, z0, x1, 64, z1, block)
    w.fill_box(x0, 64, z0, x1, 64, z0, border)
    w.fill_box(x0, 64, z1, x1, 64, z1, border)
    w.fill_box(x0, 64, z0, x0, 64, z1, border)
    w.fill_box(x1, 64, z0, x1, 64, z1, border)


# ---------------------------------------------------------------- roads
def build_roads(w: World):
    # Avenues along x=0 and z=0, 7 wide: black, yellow centre line, white
    # edges. They run in segments so they never cut through a district
    # plot (plots start at |coord| 120) or a building.
    segments = [(-256, -201), (-119, -65), (-63, 63), (65, 119), (201, 256)]
    for a, b in segments:
        w.fill_box(-3, 64, a, 3, 64, b, "minecraft:black_concrete")
        w.fill_box(a, 64, -3, b, 64, 3, "minecraft:black_concrete")
        w.fill_box(0, 64, a, 0, 64, b, "minecraft:yellow_concrete")
        w.fill_box(a, 64, 0, b, 64, 0, "minecraft:yellow_concrete")
        for e in (-3, 3):
            w.fill_box(e, 64, a, e, 64, b, "minecraft:white_concrete")
            w.fill_box(a, 64, e, b, 64, e, "minecraft:white_concrete")
    # Ring road: square at |x|=64 / |z|=64, 7 wide, range -64..64.
    for s in (-64, 64):
        w.fill_box(-64, 64, s - 3, 64, 64, s + 3, "minecraft:black_concrete")
        w.fill_box(s - 3, 64, -64, s + 3, 64, 64, "minecraft:black_concrete")
        w.fill_box(-64, 64, s, 64, 64, s, "minecraft:yellow_concrete")
        w.fill_box(s, 64, -64, s, 64, 64, "minecraft:yellow_concrete")
        for e in (-3, 3):
            w.fill_box(-64, 64, s + e, 64, 64, s + e, "minecraft:white_concrete")
            w.fill_box(s + e, 64, -64, s + e, 64, 64, "minecraft:white_concrete")
    # Avenue lamps every 16 blocks, just off the road edge.
    for d in range(-240, 241, 16):
        lamp(w, 5, d)
        lamp(w, -5, d)
        lamp(w, d, 5)
        lamp(w, d, -5)
    # Taxi stops: gold pillar + sign, just OUTSIDE the ring road.
    for stop in TAXI_STOPS:
        sx, sz = stop["pos"]
        dx = 7 if sx > 0 else (-7 if sx < 0 else 0)
        dz = 7 if sz > 0 else (-7 if sz < 0 else 0)
        sign_post(w, sx + dx, sz + dz,
                  ["TAXI STOP", stop["label"], "LOOP AROUND", "THE CITY"])


# ---------------------------------------------------------------- plaza
def build_plaza(w: World):
    w.fill_box(-20, 64, -20, 20, 64, 20, "minecraft:white_concrete")
    w.fill_box(-20, 64, -20, 20, 64, -20, "minecraft:black_concrete")
    w.fill_box(-20, 64, 20, 20, 64, 20, "minecraft:black_concrete")
    w.fill_box(-20, 64, -20, -20, 64, 20, "minecraft:black_concrete")
    w.fill_box(20, 64, -20, 20, 64, 20, "minecraft:black_concrete")
    for cx, cz in ((-20, -20), (20, -20), (-20, 20), (20, 20)):
        w.fill_box(cx - 1, 64, cz - 1, cx + 1, 64, cz + 1, "minecraft:gold_block")
    w.fill_box(-1, 64, -1, 1, 64, 1, "minecraft:gold_block")
    # City map board: black wall + three sign posts on the north side.
    w.fill_box(-6, 65, -18, 6, 68, -18, "minecraft:black_concrete")
    w.fill_box(-6, 69, -18, 6, 69, -18, "minecraft:gold_block")
    sign_post(w, -4, -17, ["ORBITX CITY", "WELCOME", "SPAWN PLAZA", "orbitx.world"])
    sign_post(w, 0, -17, ["TERMINAL - N", "DEX - E", "LAUNCHPAD - S", "SOCIAL - W"])
    sign_post(w, 4, -17, ["SCANNER - NE", "JOBS - SW", "PARKS NW + SE", "FREE FOREVER"])
    # ORBITX mint sign (public mint address, split across the 4 lines).
    sign_post(w, 8, 8, ["ORBITX MINT", MINT[:16], MINT[16:32], MINT[32:]])
    # Gate arches on the four plaza edges + direction signs.
    for (gx, gz, label, sub) in (
        (0, -20, "TO TERMINAL", "NORTH - 140m"),
        (20, 0, "TO DEX", "EAST - 140m"),
        (0, 20, "TO LAUNCHPAD", "SOUTH - 140m"),
        (-20, 0, "TO SOCIAL", "WEST - 140m"),
    ):
        if gz != 0:  # north/south gate: pillars east-west of the gap
            w.fill_box(gx - 3, 65, gz, gx - 3, 68, gz, "minecraft:black_concrete")
            w.fill_box(gx + 3, 65, gz, gx + 3, 68, gz, "minecraft:black_concrete")
            w.fill_box(gx - 3, 69, gz, gx + 3, 69, gz, "minecraft:gold_block")
        else:
            w.fill_box(gx, 65, gz - 3, gx, 68, gz - 3, "minecraft:black_concrete")
            w.fill_box(gx, 65, gz + 3, gx, 68, gz + 3, "minecraft:black_concrete")
            w.fill_box(gx, 69, gz - 3, gx, 69, gz + 3, "minecraft:gold_block")
        # Direction sign standing on the gold lintel above the gate.
        w.sign(gx, 70, gz, [label, sub, "WALK OR TAXI", ""], rotation=0)
    for lx, lz in ((-18, -18), (18, -18), (-18, 18), (18, 18)):
        lamp(w, lx, lz)


# ---------------------------------------------------------------- terminal
def build_terminal(w: World):
    plot_pavement(w, 0, -160, "minecraft:black_concrete", "minecraft:white_concrete")
    x0, z0, x1, z1 = -12, -172, 12, -148
    # Shell: black walls y65..118, white bands, gold base + crown.
    walls(w, x0, z0, x1, z1, 65, 118, "minecraft:black_concrete")
    for y in (65, 118):
        w.fill_box(x0, y, z0, x1, y, z0, "minecraft:gold_block")
        w.fill_box(x0, y, z1, x1, y, z1, "minecraft:gold_block")
        w.fill_box(x0, y, z0, x0, y, z1, "minecraft:gold_block")
        w.fill_box(x1, y, z0, x1, y, z1, "minecraft:gold_block")
    for y in (75, 85, 95, 105):
        w.fill_box(x0, y, z0, x1, y, z0, "minecraft:white_concrete")
        w.fill_box(x0, y, z1, x1, y, z1, "minecraft:white_concrete")
        w.fill_box(x0, y, z0, x0, y, z1, "minecraft:white_concrete")
        w.fill_box(x1, y, z0, x1, y, z1, "minecraft:white_concrete")
    # Glass window bands on all four faces.
    for y in (68, 78, 88, 98, 108):
        for yy in (y, y + 1, y + 2):
            w.fill_box(x0, yy, z0 + 1, x0, yy, z1 - 1, "minecraft:glass")
            w.fill_box(x1, yy, z0 + 1, x1, yy, z1 - 1, "minecraft:glass")
            w.fill_box(x0 + 1, yy, z0, x1 - 1, yy, z0, "minecraft:glass")
            w.fill_box(x0 + 1, yy, z1, x1 - 1, yy, z1, "minecraft:glass")
    # Roof deck + hatch railing.
    w.fill_box(x0, 119, z0, x1, 119, z1, "minecraft:white_concrete")
    w.fill_box(x0, 119, z0, x1, 119, z0, "minecraft:gold_block")
    w.fill_box(x0, 119, z1, x1, 119, z1, "minecraft:gold_block")
    w.fill_box(x0, 119, z0, x0, 119, z1, "minecraft:gold_block")
    w.fill_box(x1, 119, z0, x1, 119, z1, "minecraft:gold_block")
    # Entrance: south face, 3 wide.
    doorway(w, -1, z1, axis="x", width=3)
    # Interior: quartz floor, glowstone ceiling lights, command desks.
    w.fill_box(x0 + 1, 64, z0 + 1, x1 - 1, 64, z1 - 1, "minecraft:quartz_block")
    for lx, lz in ((-10, -170), (10, -170), (-10, -150), (10, -150), (0, -160)):
        w.set_block(lx, 77, lz, "minecraft:glowstone")
    for dx in (-6, 0, 6):
        w.fill_box(dx - 1, 65, -156, dx + 1, 65, -155, "minecraft:black_concrete")
        w.fill_box(dx - 1, 66, -156, dx + 1, 66, -155, "minecraft:gold_block")
    # Signs stand on the gold counter tops (y66).
    w.sign(-6, 67, -155, ["COMMAND HALL", "BUY ORBITX", "SELL ORBITX", "orbitx.world"], rotation=0)
    w.sign(0, 67, -155, ["TERMINAL", "DASHBOARD", "LIVE PRICES", "FREE FOREVER"], rotation=0)
    w.sign(6, 67, -155, ["ORBITX CITY", "TERMINAL TOWER", "TALLEST IN", "THE CITY"], rotation=0)
    # Spiral stair (NE corner) to the roof deck.
    top = spiral_stairs(w, 9, -171, 65, 118)
    w.fill_box(top[0], 119, top[1], top[0], 119, top[1], "minecraft:air")
    w.fill_box(top[0] - 1, 120, top[1] - 1, top[0] + 1, 120, top[1] + 1,
               "minecraft:gold_block")
    w.fill_box(top[0], 120, top[1], top[0], 120, top[1], "minecraft:air")
    # District sign at the plot entrance (avenue side).
    sign_post(w, 4, -119, ["TERMINAL", "TALLEST TOWER", "COMMAND HALL", "ENTER ->"], rotation=0)


# ---------------------------------------------------------------- dex
def build_dex(w: World):
    plot_pavement(w, 160, 0, "minecraft:white_concrete", "minecraft:green_concrete")
    x0, z0, x1, z1 = 145, -10, 175, 10
    walls(w, x0, z0, x1, z1, 65, 76, "minecraft:white_concrete")
    for y in (65, 76):
        w.fill_box(x0, y, z0, x1, y, z0, "minecraft:green_concrete")
        w.fill_box(x0, y, z1, x1, y, z1, "minecraft:green_concrete")
        w.fill_box(x0, y, z0, x0, y, z1, "minecraft:green_concrete")
        w.fill_box(x1, y, z0, x1, y, z1, "minecraft:green_concrete")
    for yy in (70, 71, 72):
        w.fill_box(x0, yy, z0 + 1, x0, yy, z1 - 1, "minecraft:glass")
        w.fill_box(x1, yy, z0 + 1, x1, yy, z1 - 1, "minecraft:glass")
        w.fill_box(x0 + 1, yy, z0, x1 - 1, yy, z0, "minecraft:glass")
        w.fill_box(x0 + 1, yy, z1, x1 - 1, yy, z1, "minecraft:glass")
    w.fill_box(x0, 77, z0, x1, 77, z1, "minecraft:green_concrete")
    w.fill_box(x0, 77, z0, x1, 77, z0, "minecraft:gold_block")
    w.fill_box(x0, 77, z1, x1, 77, z1, "minecraft:gold_block")
    doorway(w, x0, -1, axis="z", width=3)  # west face, toward the plaza
    # Interior: swap floor.
    w.fill_box(x0 + 1, 64, z0 + 1, x1 - 1, 64, z1 - 1, "minecraft:white_concrete")
    w.fill_box(158, 64, -2, 162, 64, 2, "minecraft:green_concrete")
    w.fill_box(158, 65, -2, 162, 65, 2, "minecraft:black_concrete")
    w.fill_box(158, 66, -2, 162, 66, -2, "minecraft:gold_block")
    w.fill_box(158, 66, 2, 162, 66, 2, "minecraft:gold_block")
    w.fill_box(158, 66, -2, 158, 66, 2, "minecraft:gold_block")
    w.fill_box(162, 66, -2, 162, 66, 2, "minecraft:gold_block")
    for lx, lz in ((148, -8), (172, -8), (148, 8), (172, 8), (160, 0)):
        w.set_block(lx, 75, lz, "minecraft:glowstone")
    for dz in (-6, -3, 0, 3, 6):
        w.set_block(146, 65, dz, "minecraft:green_carpet")
        w.set_block(174, 65, dz, "minecraft:green_carpet")
    for dx in (150, 156, 162, 168):
        w.fill_box(dx, 65, 8, dx + 1, 65, 9, "minecraft:black_concrete")
        w.fill_box(dx, 66, 8, dx + 1, 66, 9, "minecraft:gold_block")
    # Pair boards: a black ledge along the north wall, signs on top of it.
    w.fill_box(148, 66, -8, 172, 66, -8, "minecraft:black_concrete")
    w.sign(150, 67, -8, ["ORBITX / SOL", "PUMP / SOL", "BONK / SOL", "JUP / SOL"], rotation=0)
    w.sign(156, 67, -8, ["DEX", "SWAP FLOOR", "LIVE PRICES", "TRADE HERE"], rotation=0)
    w.sign(162, 67, -8, ["PAIR BOARDS", "TOP PAIRS", "UPDATED LIVE", "orbitx.world"], rotation=0)
    w.sign(168, 67, -8, ["SWAP", "BUY THE DIP", "SELL THE TOP", "DYOR"], rotation=0)
    sign_post(w, 143, 4, ["DEX", "TRADING HALL", "SWAP FLOOR", "ENTER ->"], rotation=0)


# ---------------------------------------------------------------- launchpad
def build_launchpad(w: World):
    plot_pavement(w, 0, 160, "minecraft:white_concrete", "minecraft:gold_block")
    # Three launch pads: obsidian squares with a gold ring.
    for i, (px, pz) in enumerate(((-20, 160), (20, 160), (0, 180)), start=1):
        w.fill_box(px - 4, 64, pz - 4, px + 4, 64, pz + 4, "minecraft:obsidian")
        w.fill_box(px - 4, 64, pz - 4, px + 4, 64, pz - 4, "minecraft:gold_block")
        w.fill_box(px - 4, 64, pz + 4, px + 4, 64, pz + 4, "minecraft:gold_block")
        w.fill_box(px - 4, 64, pz - 4, px - 4, 64, pz + 4, "minecraft:gold_block")
        w.fill_box(px + 4, 64, pz - 4, px + 4, 64, pz + 4, "minecraft:gold_block")
        w.fill_box(px - 1, 64, pz - 1, px + 1, 64, pz + 1, "minecraft:gold_block")
        sign_post(w, px + 6, pz, [f"LAUNCH PAD {i}", "BONDING CURVE", "READY TO", "LAUNCH"])
    # Bonding-curve ramps: two quartz stair ramps rising to the south.
    for rx in (-4, 2):
        for step in range(8):
            w.fill_box(rx, 65 + step, 135 + step, rx + 1, 65 + step, 135 + step,
                       "minecraft:quartz_block")
    # Graduation gate at the south edge.
    w.fill_box(-3, 65, 195, -3, 72, 195, "minecraft:gold_block")
    w.fill_box(3, 65, 195, 3, 72, 195, "minecraft:gold_block")
    w.fill_box(-3, 73, 195, 3, 73, 195, "minecraft:gold_block")
    # Sign stands on the gold lintel (y73).
    w.sign(0, 74, 195, ["GRADUATION GATE", "100% LP BURNED", "NOBODY CAN", "PULL IT"], rotation=0)
    # Control hut.
    walls(w, 25, 138, 31, 142, 65, 68, "minecraft:white_concrete")
    w.fill_box(25, 69, 138, 31, 69, 142, "minecraft:black_concrete")
    doorway(w, 27, 142, axis="x", width=2)
    w.set_block(28, 65, 140, "minecraft:oak_planks")
    w.sign(28, 66, 140, ["LAUNCHPAD", "BONDING CURVE", "MIGRATE = LOCKED", "orbitx.world"], rotation=0)
    sign_post(w, -4, 119, ["LAUNCHPAD", "LAUNCH BAY", "PADS + RAMPS", "ENTER ->"], rotation=0)


# ---------------------------------------------------------------- social
def build_social(w: World):
    plot_pavement(w, -160, 0, "minecraft:light_blue_concrete", "minecraft:white_concrete")
    x0, z0, x1, z1 = -172, -9, -148, 9
    walls(w, x0, z0, x1, z1, 65, 74, "minecraft:blue_concrete")
    for y in (65, 74):
        w.fill_box(x0, y, z0, x1, y, z0, "minecraft:white_concrete")
        w.fill_box(x0, y, z1, x1, y, z1, "minecraft:white_concrete")
        w.fill_box(x0, y, z0, x0, y, z1, "minecraft:white_concrete")
        w.fill_box(x1, y, z0, x1, y, z1, "minecraft:white_concrete")
    for yy in (69, 70, 71):
        w.fill_box(x0, yy, z0 + 1, x0, yy, z1 - 1, "minecraft:glass")
        w.fill_box(x1, yy, z0 + 1, x1, yy, z1 - 1, "minecraft:glass")
        w.fill_box(x0 + 1, yy, z0, x1 - 1, yy, z0, "minecraft:glass")
        w.fill_box(x0 + 1, yy, z1, x1 - 1, yy, z1, "minecraft:glass")
    w.fill_box(x0, 75, z0, x1, 75, z1, "minecraft:blue_concrete")
    doorway(w, x1, -1, axis="z", width=3)  # east face, toward the plaza
    # Interior: post boards, DM rooms, tables.
    w.fill_box(x0 + 1, 64, z0 + 1, x1 - 1, 64, z1 - 1, "minecraft:light_blue_concrete")
    w.fill_box(-162, 64, -2, -158, 64, 2, "minecraft:white_concrete")
    for lx, lz in ((-170, -7), (-150, -7), (-170, 7), (-150, 7), (-160, 0)):
        w.set_block(lx, 73, lz, "minecraft:glowstone")
    # DM rooms: partitions along the south wall; signs on top of each one.
    for i, rx in enumerate((-166, -160, -154)):
        w.fill_box(rx, 65, 3, rx, 68, 8, "minecraft:white_concrete")
        w.sign(rx, 69, 5, [f"DM ROOM {i + 1}", "PRIVATE CHAT", "NO SPAM", "BE KIND"], rotation=0)
    for tx in (-168, -162):
        w.fill_box(tx, 65, -6, tx + 1, 65, -5, "minecraft:oak_planks")
        w.set_block(tx, 65, -4, "minecraft:oak_stairs", {"facing": "south"})
        w.set_block(tx + 1, 65, -4, "minecraft:oak_stairs", {"facing": "south"})
    # Post boards: a white ledge along the north wall, signs on top of it.
    w.fill_box(-171, 66, -8, -149, 66, -8, "minecraft:white_concrete")
    w.sign(-170, 67, -8, ["GM ORBITX", "WAGMI", "POST OF THE DAY", "SOCIAL HUB"], rotation=0)
    w.sign(-164, 67, -8, ["SOCIAL", "POST BOARDS", "DM ROOMS", "orbitx.world"], rotation=0)
    w.sign(-158, 67, -8, ["PULSE FEED", "TRENDING NOW", "FOLLOW", "@orbitx_wrld"], rotation=0)
    w.sign(-152, 67, -8, ["MAKE FRIENDS", "TALK SHOP", "SHARE ALPHA", "FREE FOREVER"], rotation=0)
    sign_post(w, -143, -4, ["SOCIAL", "PLAZA + HALL", "POST BOARDS", "ENTER ->"], rotation=0)


# ---------------------------------------------------------------- scanner
def build_scanner(w: World):
    plot_pavement(w, 160, -160, "minecraft:black_concrete", "minecraft:white_concrete")
    x0, z0, x1, z1 = 153, -167, 167, -153
    # Striped tower: black/white bands, gold crown, glass scanner room.
    bands = [(65, 69, "minecraft:black_concrete"),
             (70, 74, "minecraft:white_concrete"),
             (75, 79, "minecraft:black_concrete"),
             (80, 84, "minecraft:white_concrete"),
             (85, 89, "minecraft:black_concrete"),
             (90, 94, "minecraft:white_concrete"),
             (95, 99, "minecraft:black_concrete")]
    for y0, y1, block in bands:
        walls(w, x0, z0, x1, z1, y0, y1, block)
    walls(w, x0, z0, x1, z1, 100, 103, "minecraft:glass")
    w.fill_box(x0, 104, z0, x1, 104, z1, "minecraft:white_concrete")
    w.fill_box(x0, 104, z0, x1, 104, z0, "minecraft:gold_block")
    w.fill_box(x0, 104, z1, x1, 104, z1, "minecraft:gold_block")
    w.fill_box(x0, 104, z0, x0, 104, z1, "minecraft:gold_block")
    w.fill_box(x1, 104, z0, x1, 104, z1, "minecraft:gold_block")
    w.fill_box(x0 + 1, 100, z0 + 1, x1 - 1, 100, z1 - 1, "minecraft:white_concrete")
    doorway(w, 159, z1, axis="x", width=3)  # south face
    for lx, lz in ((155, -165), (165, -165), (155, -155), (165, -155)):
        w.set_block(lx, 103, lz, "minecraft:glowstone")
    # OG-score board: sign posts in front of the south face.
    sign_post(w, 156, -150, ["OG SCORE", "ORBITX 62/100", "BUNDLE: LOW", "RISK: LOW"])
    sign_post(w, 160, -150, ["SCANNER", "WATCHING", "THE CHAIN", "24 / 7"])
    sign_post(w, 164, -150, ["X SIGNALS", "LIVE", "HONEYPOT: NO", "orbitx.world"])
    # Interior: spiral stair to the glass room + scanner room signs.
    top = spiral_stairs(w, 164, -166, 65, 99)
    w.fill_box(top[0], 100, top[1], top[0], 100, top[1], "minecraft:air")
    # Sign ledge along the south inner wall; sign stands on it.
    w.fill_box(154, 66, -155, 166, 66, -155, "minecraft:black_concrete")
    w.sign(160, 67, -155, ["SCANNER TOWER", "OG-SCORE BOARD", "BUNDLE MAP", "X-SIGNAL PANELS"], rotation=0)
    sign_post(w, 156, -119, ["SCANNER", "WATCHTOWER", "OG-SCORE BOARD", "ENTER ->"], rotation=0)


# ---------------------------------------------------------------- jobs
def build_jobs(w: World):
    plot_pavement(w, -160, 160, "minecraft:white_concrete", "minecraft:green_concrete")
    stalls = [
        (-180, 145, "TAXI DRIVER", "50 ORBITX / DAY"),
        (-167, 145, "SCANNER OP", "75 ORBITX / DAY"),
        (-154, 145, "TRADER", "100 ORBITX / DAY"),
        (-141, 145, "BOUNTY BOARD", "SEE JOBS"),
        (-180, 175, "MARKET STALL", "FRESH PUMPS"),
        (-167, 175, "MARKET STALL", "GOLD + GEMS"),
        (-154, 175, "MARKET STALL", "MAPS + FOOD"),
        (-141, 175, "JOB STAND", "ASK INSIDE"),
    ]
    for sx, sz, job, pay in stalls:
        for px, pz in ((sx - 2, sz - 2), (sx + 2, sz - 2),
                       (sx - 2, sz + 2), (sx + 2, sz + 2)):
            w.set_block(px, 65, pz, "minecraft:oak_fence")
            w.set_block(px, 66, pz, "minecraft:oak_fence")
        w.fill_box(sx - 2, 68, sz - 2, sx + 2, 68, sz + 2, "minecraft:white_wool")
        w.set_block(sx, 69, sz, "minecraft:gold_block")
        w.fill_box(sx - 1, 65, sz + 1, sx + 1, 65, sz + 1, "minecraft:oak_planks")
        # Sign stands on the oak counter (y65).
        w.sign(sx, 66, sz + 1, [job, pay, "JOBS / MARKET", "orbitx.world"], rotation=0)
    # Bounty board wall near the centre of the market; sign on top of it.
    w.fill_box(-164, 65, 158, -156, 68, 158, "minecraft:black_concrete")
    w.sign(-162, 69, 158, ["BOUNTY BOARD", "TAXI - 50 / DAY", "SCAN - 75 / DAY", "TRADE - 100 / DAY"], rotation=0)
    sign_post(w, -140, 156, ["JOBS / MARKET", "STALLS + STANDS", "GET TO WORK", "ENTER ->"], rotation=0)


# ---------------------------------------------------------------- parks
def build_park(w: World, cx, cz, pond=False):
    rng = random.Random(SEED + cx * 7 + cz * 13)
    # Gravel cross paths.
    w.fill_box(cx - 1, 64, cz - 40, cx + 1, 64, cz + 40, "minecraft:gravel")
    w.fill_box(cx - 40, 64, cz - 1, cx + 40, 64, cz + 1, "minecraft:gravel")
    # Trees at deterministic spots, clear of the paths.
    spots = []
    while len(spots) < 10:
        tx = cx + rng.randint(-36, 36)
        tz = cz + rng.randint(-36, 36)
        if abs(tx - cx) <= 3 or abs(tz - cz) <= 3:
            continue
        if any(abs(tx - sx) < 7 and abs(tz - sz) < 7 for sx, sz in spots):
            continue
        spots.append((tx, tz))
    for tx, tz in spots:
        tree(w, tx, tz, rng.randint(4, 6))
    # Lamps at the path ends + benches.
    for lx, lz in ((cx - 30, cz), (cx + 30, cz), (cx, cz - 30), (cx, cz + 30)):
        lamp(w, lx + 2, lz)
    for bx, bz in ((cx - 6, cz + 6), (cx + 6, cz - 6)):
        w.set_block(bx, 65, bz, "minecraft:oak_stairs", {"facing": "north"})
        w.set_block(bx + 1, 65, bz, "minecraft:oak_stairs", {"facing": "north"})
        w.set_block(bx, 65, bz + 1, "minecraft:oak_planks")
    if pond:
        w.fill_box(cx + 12, 64, cz + 13, cx + 18, 64, cz + 17, "minecraft:water")
        w.fill_box(cx + 11, 64, cz + 12, cx + 19, 64, cz + 12, "minecraft:sand")
        w.fill_box(cx + 11, 64, cz + 18, cx + 19, 64, cz + 18, "minecraft:sand")
        w.fill_box(cx + 11, 64, cz + 12, cx + 11, 64, cz + 18, "minecraft:sand")
        w.fill_box(cx + 19, 64, cz + 12, cx + 19, 64, cz + 18, "minecraft:sand")
    sign_post(w, cx + 4, cz + 38, ["PARK", "TREES + LAMPS", "TAKE A BREAK", "orbitx.world"])


# ---------------------------------------------------------------- wall
def build_wall(w: World):
    for s in (-256, 256):
        w.fill_box(-256, 65, s, 256, 67, s, "minecraft:black_concrete")
        w.fill_box(s, 65, -256, s, 67, 256, "minecraft:black_concrete")
        w.fill_box(-256, 68, s, 256, 68, s, "minecraft:gold_block")
        w.fill_box(s, 68, -256, s, 68, 256, "minecraft:gold_block")
    # Gates where the avenues meet the wall.
    for gx, gz, axis in ((0, -256, "x"), (0, 256, "x"),
                         (-256, 0, "z"), (256, 0, "z")):
        if axis == "x":
            w.fill_box(gx - 3, 65, gz, gx + 3, 67, gz, "minecraft:air")
            w.fill_box(gx - 3, 68, gz, gx + 3, 69, gz, "minecraft:gold_block")
        else:
            w.fill_box(gx, 65, gz - 3, gx, 67, gz + 3, "minecraft:air")
            w.fill_box(gx, 68, gz - 3, gx, 69, gz + 3, "minecraft:gold_block")


# ---------------------------------------------------------------- build all
def build_city(w: World):
    build_terrain(w)
    build_roads(w)
    build_plaza(w)
    build_terminal(w)
    build_dex(w)
    build_launchpad(w)
    build_social(w)
    build_scanner(w)
    build_jobs(w)
    build_park(w, -160, -160)
    build_park(w, 160, 160, pond=True)
    build_wall(w)
