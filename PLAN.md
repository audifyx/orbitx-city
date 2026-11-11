# OrbitX City — PLAN

**OrbitX City as a web-based playable voxel city — no download, no Minecraft client, open the lobby and walk the city in your browser.**

One line: every OrbitX platform is a district in a 3D city you play in the browser — walk the plaza, visit the Terminal tower, trade in the DEX hall, launch from the bay — with a web menu for entering the city, and real wallet connections wired in after the game is built.

Free, forever. The city is free. That never changes.

## Status (2026-11-09)

- **Live:** https://orbitx-city-audifyxbeta-4145s-projects.vercel.app/
- **Repo:** https://github.com/audifyx/orbitx-city
- **Part 0 (home) ✅ · Part 1 (world generator) ✅ · Part 2 (game menu) ✅** — Minecraft world + lobby live and verified.
- **PIVOT 2026-11-09 — web-based, no download (user decision):** the city becomes playable in the browser. Part 1+2 are being reworked below; Parts 3–5 follow the same order, wiring still last.
- **Next:** pivot — Part 1 export (`city.json`) + Part 2 playable 3D city → Part 3 (districts detail) → Part 4 (city systems) → Part 5 (wiring).
- **Known deploy notes:** Vercel has no GitHub account connected, so deploys go through the file-upload path (`upload_deploy.py`). React loads from esm.sh via import map for the same reason (keeps the deployed bundle small); Three.js loads the same way.

---

## The pivot (2026-11-09, user decision: "Do we need a download — just make it web based")

**Decision: NO download.** The city is web-based and playable in the browser. No Minecraft client needed, no world file to install.

What changes:
- **The Python generator STAYS** — it is the city-layout source of truth (districts, buildings, roads, taxi loop, all in `world/generator/city.py` + `world/layout.json`). It now also exports a compact `city.json` that the web renderer reads. The `.mca` world build stays working as a repo artifact (`web/public/orbitx-city-world.zip` remains in the repo), but it is **no longer the product and no longer the main flow**.
- **The download flow comes OUT of the lobby.** No download buttons, no "how to install the world" steps. The lobby's "Enter the City" loads the 3D city instead.
- **The product is the playable web city** (Part 2, reworked): a Three.js voxel renderer that loads `city.json`, first-person walk controls, district teleport from the menu, click a building to see what it is, day/night lighting.
- The Minecraft world is not deleted — it is a build artifact and a fallback. If the web city ever needs a ground-truth check, the generator still builds it.

---

## Vision

OrbitX is a terminal, a DEX, a launchpad, a social hub, and a scanner. OrbitX City makes that real as a place: you spawn in a plaza, and every platform is a building you can walk to. The Terminal is a tower. The DEX is a trading hall. The Launchpad is a launch bay. Social is a hub. The Scanner is a tower that watches the chain.

A player should be able to:
1. Open the lobby, see the city, pick a district.
2. Click **Enter the City** and walk the city in the browser — no download, no account, no wallet.
3. Walk the roads, follow the taxi loop, visit every building, take a job.
4. Later (wiring phase): connect their own wallet from the lobby and buy/burn ORBITX — signed by them, never by us.

---

## Parts

### Part 0 — Home (repo + Vercel) ✅ DONE
- Repo: `audifyx/orbitx-city` (public) — https://github.com/audifyx/orbitx-city
- Vercel: `orbitx-city` project, team `audifyxbeta-4145s` (same team as `orbitx`)
- Local checkout: `~/workspace/orbitx-city/`
- Layout: `world/` (Python generator) + `web/` (Vite + React lobby) + `PLAN.md`
- **Done looks like:** repo exists, Vercel project exists, this plan is committed.

### Part 1 — World generator (Python) ✅ DONE, now also the web-city source of truth
A deterministic generator (fixed seed 1337) that builds the city layout — and now exports it for the web.

What it builds (same city as before):
- **Spawn plaza** — the front door. Spawn point, city map board, signs, gates to every district.
- **Terminal tower** — black/white/gold, tallest building in the city, the command dashboard as a hall.
- **DEX building** — trading hall, swap floor, pair boards, live-price boards.
- **Launchpad** — launch bay with pads, bonding-curve ramps, graduation gate.
- **Social hub** — plaza + hall, post boards, DM rooms.
- **Scanner tower** — watchtower with the OG-score board, bundle map, X-signal panels.
- **Roads + taxi loops** — a road grid connecting every district, with a looped taxi route.
- **Parks, gates, walls, lamps, signs** — the city reads as a city, not a set of boxes. Every sign uses real OrbitX branding (black/white/gold).

Two outputs:
- **`.mca` world** (Java 1.21.1, via nbtlib) — still built, still verified by headless load test, but now a repo artifact, not the product. `web/public/orbitx-city-world.zip` stays in the repo.
- **`city.json` (NEW)** — compact export of the same layout for the web renderer: buildings as boxes (position, size, height, color/material, district), roads, taxi-loop ring + stops, parks, trees, lamps, signs (text), spawn point, wall. The web city reads this JSON, never the `.mca` files. One source of truth: `world/generator/city.py` — the export and the `.mca` build must agree on every coordinate.

Tech: Python + nbtlib for the `.mca` build; plain JSON for the export. No hand-made `.mca` bytes.

**Done looks like:** `python world/generator/generate.py` still produces a valid world (level.dat + regions parse, headless load test passes); `python world/generator/export_web.py` produces `web/public/city.json` that loads, is small enough to fetch fast, and matches the `.mca` city coordinate-for-coordinate (same districts, same footprints, same heights).

### Part 2 — Game menu / lobby + playable web city (IN PROGRESS — the pivot)
The city's main menu AND the city itself, in the browser.

- **Landing + menu:** enter the city, pick a district (Terminal / DEX / Launchpad / Social / Scanner / Jobs), see what each district is before you go.
- **Playable 3D city:** Three.js voxel renderer reading `city.json`. First-person walk (WASD + mouse look with pointer lock on desktop; touch joystick + drag-look on phone). Teleport to any district from the menu. Click a building/district to see what it is. Day/night lighting so the city reads after dark. The menu and the 3D city agree: same layout, same coordinates, same districts.
- **City map:** a top-down map of the city (from the generator's layout) with district markers — clicking a marker teleports the player there.
- **Jobs board:** the city's jobs (taxi driver, scanner, trader) with what they pay in the city economy.
- **How to play:** the controls — WASD to walk, mouse to look, click to enter, teleport from the menu. No download, no Minecraft, no install.

**Done looks like:** the Vercel site renders the menu; **Enter the City** loads the 3D city in the browser; the canvas actually renders buildings, roads, and the plaza (verified by screenshot, not by code alone); the player can walk with WASD + mouse, teleport to every district from the menu, and click a building for its info; day/night lighting works; the page reads as a game, not a landing page. No download button anywhere in the main flow.

### Part 3 — Districts & buildings (detail pass)
The web city from Part 2, finished properly: furnished interiors you can walk into (Terminal hall, DEX floor, Launchpad bay, Social hall, Scanner room), district theming per building (gold for Terminal, blue for Social, green for DEX), street names, wayfinding signs (rendered as in-world text), and the night-lighting pass so the city looks right after dark.

**Done looks like:** every main building has a furnished interior you can walk through; every district is themed; signs point the way between districts; the city looks finished in daylight and at night.

### Part 4 — City systems
The systems that make it a city, not a museum:
- **Taxi loops:** a looped road route with taxi stops; a player can ride/follow the loop around the whole city.
- **Jobs:** taxi driver, scanner operator, trader — each with a post/stand in the city and a payout in the city economy.
- **City map in-world:** map boards at the plaza and at every district gate.
- **Day life:** parks, market stalls, lamps, gates that close the loop.

**Done looks like:** the taxi loop is a complete circuit with stops you can ride; each job has a stand and a payout; map boards exist at the plaza and gates.

### Part 5 — Wiring (AFTER the game)
Only once Parts 1–4 are done. Live connections, wired into the lobby:
- **Live ORBITX price / mcap** on the lobby (DexScreener public API — no keys).
- **Live city stats** (visits).
- **Buy / burn panel:** the player connects their OWN Solana wallet in-browser. Buy = Jupiter quote, player signs the swap themselves. Burn = send ORBITX to the Solana burn address, player signs it themselves.
- **Rules (hard):** no server-side keys, no custody, no auto-buy/burn, no server-held funds, no wallet created for the user, every transaction user-signed, one at a time.

**Done looks like:** price shows live; a connected wallet can buy and burn with its own signature; nothing about the flow touches a server key.

---

## Build order

1. **Part 0** — home ✅
2. **Part 1** — world generator (the city itself) ✅ + `city.json` export (pivot)
3. **Part 2** — game menu / lobby + playable web city (pivot — in progress)
4. **Part 3** — districts & buildings detail pass
5. **Part 4** — city systems (taxi loops, jobs, maps)
6. **Part 5** — wiring (live price, buy/burn)

No part starts before the one before it is done. Wiring never jumps the queue.

---

## Rules (standing, forever)

- **OrbitX is free, forever.** The city, the menu, the game — free. Never charge.
- **Contrast:** never light-on-light or dark-on-dark. White bg = black text, black bg = white text. Palette: black / white / gold / silver / blue. No rainbow.
- **No PHP anywhere.** React + TypeScript + Vite frontend, Node serverless, Python for the generator.
- **Safety:** never create a wallet to hold the user's crypto, never deploy a live token, never auto-buy/burn with real funds, never give trading theses as financial advice. Buy/burn is user-wallet-only, user-signed.
- **Verify live before claiming live.** A deploy is not done until the live URL is checked serving it: the menu renders, the 3D city actually renders (screenshot review — buildings, roads, plaza visible, not a black/empty canvas), walking + teleport work.
- **Separate project.** This repo is its own thing. Never touch `og-scan` or the brag video dirs.

---

## Open questions (for the user, when they want them)

- City name on the spawn sign (OrbitX City assumed).
- Which job pays what (city economy numbers — placeholder until set).
- Wiring phase: Jupiter vs direct AMM for the buy route (decided in Part 5).
