# OrbitX City — PLAN

**OrbitX City as a real Minecraft Java Edition world, plus a web lobby to enter it from.**

One line: a full Minecraft city you can download and walk around in — every OrbitX platform as a district — with a web menu for entering the city, and real wallet connections wired in after the game is built.

Free, forever. The world download is free. The city is free. That never changes.

## Status (2026-11-09)

- **Live:** https://orbitx-city-audifyxbeta-4145s-projects.vercel.app/
- **Repo:** https://github.com/audifyx/orbitx-city
- **Part 0 (home) ✅ · Part 1 (world generator) ✅ · Part 2 (game menu) ✅** — world + lobby live and verified (see below).
- **Next:** Part 3 (districts detail pass) → Part 4 (city systems) → Part 5 (wiring).
- **Known deploy notes:** Vercel has no GitHub account connected, so deploys go through the file-upload path (`upload_deploy.py`); the world zip is served from GitHub Raw until the GitHub App is reconnected, then the download button switches back to `/orbitx-city-world.zip`. React loads from esm.sh via import map for the same reason (keeps the deployed bundle small).

---

## Vision

OrbitX is a terminal, a DEX, a launchpad, a social hub, and a scanner. OrbitX City makes that real as a place: you spawn in a plaza, and every platform is a building you can walk to. The Terminal is a tower. The DEX is a trading hall. The Launchpad is a launch bay. Social is a hub. The Scanner is a tower that watches the chain.

A player should be able to:
1. Open the lobby, see the city, pick a district.
2. Download the world, load it in Minecraft Java Edition, and spawn in the plaza.
3. Walk the roads, ride the taxi loops, visit every building, take a job.
4. Later (wiring phase): connect their own wallet from the lobby and buy/burn ORBITX — signed by them, never by us.

---

## Parts

### Part 0 — Home (repo + Vercel) ✅ DONE
- Repo: `audifyx/orbitx-city` (public) — https://github.com/audifyx/orbitx-city
- Vercel: `orbitx-city` project, team `audifyxbeta-4145s` (same team as `orbitx`)
- Local checkout: `~/workspace/orbitx-city/`
- Layout: `world/` (Python generator) + `web/` (Vite + React lobby) + `PLAN.md`
- **Done looks like:** repo exists, Vercel project exists, this plan is committed.

### Part 1 — World generator (Python)
A deterministic generator (fixed seed) that builds a real Java Edition world — region `.mca` files — and ships it as a downloadable `.zip` (world folder: `level.dat`, `region/`, `data/`).

What it builds:
- **Spawn plaza** — the front door. Spawn point, city map board, signs, portals/gates to every district.
- **Terminal tower** — black/white/gold, tallest building in the city, the command dashboard as a hall.
- **DEX building** — trading hall, swap floor, pair boards, live-price boards.
- **Launchpad** — launch bay with pads, bonding-curve ramps, graduation gate.
- **Social hub** — plaza + hall, post boards, DM rooms.
- **Scanner tower** — watchtower with the OG-score board, bundle map, X-signal panels.
- **Roads + taxi loops** — a road grid connecting every district, with a looped taxi route.
- **Parks, gates, walls, lamps, signs** — the city reads as a city, not a set of boxes. Every sign uses real OrbitX branding (black/white/gold).

Tech: Python + a real NBT/region library (amulet-core, nbtlib, or anvil-parser — whichever installs and works). No hand-made `.mca` bytes.

**Done looks like:** `python world/generator/generate.py` produces `web/public/orbitx-city-world.zip`; the zip unzips to a valid world folder (`level.dat` present, regions parse back cleanly); a headless load test passes if a server binary is available; every district above exists in the world with its signs readable.

### Part 2 — Game menu / lobby (web)
The city's main menu. This is part of the game, not an afterthought.

- **Landing + menu:** enter the city, pick a district (Terminal / DEX / Launchpad / Social / Scanner / Jobs), see what each district is before you go.
- **City map:** a top-down map of the world (rendered from the generator's layout) with district markers.
- **World download:** one button, the real `.zip`, free.
- **Jobs board:** the city's jobs (taxi driver, scanner, trader) with what they pay in the city economy.
- **How to play:** Java Edition version, how to install the world, spawn instructions.

The menu is also in-world: the spawn plaza has a sign board + gates to every district, so the menu and the world agree with each other.

**Done looks like:** the Vercel site renders the full menu; every district is clickable and shows its description + map location; the download button serves the real world zip; the page reads as a game lobby, not a landing page.

### Part 3 — Districts & buildings (detail pass)
The world from Part 1, finished properly: interiors for the main buildings (Terminal hall, DEX floor, Launchpad bay, Social hall, Scanner room), district theming per building (gold for Terminal, blue for Social, green for DEX), street names, wayfinding signs, and a night-lighting pass so the city looks right after dark.

**Done looks like:** every main building has a furnished interior you can walk through; every district is themed; signs point the way between districts; the city looks finished in daylight and at night.

### Part 4 — City systems
The systems that make it a city, not a museum:
- **Taxi loops:** a looped road route with taxi stops; a player can follow the loop around the whole city.
- **Jobs:** taxi driver, scanner operator, trader — each with a post/stand in the world and a payout in the city economy.
- **City map in-world:** map boards at the plaza and at every district gate.
- **Day life:** parks, market stalls, lamps, gates that close the loop.

**Done looks like:** the taxi loop is a complete circuit with stops; each job has a stand and a payout; map boards exist in-world at the plaza and gates.

### Part 5 — Wiring (AFTER the game)
Only once Parts 1–4 are done. Live connections, wired into the lobby:
- **Live ORBITX price / mcap** on the lobby (DexScreener public API — no keys).
- **Live city stats** (downloads, visits).
- **Buy / burn panel:** the player connects their OWN Solana wallet in-browser. Buy = Jupiter quote, player signs the swap themselves. Burn = send ORBITX to the Solana burn address, player signs it themselves.
- **Rules (hard):** no server-side keys, no custody, no auto-buy/burn, no server-held funds, no wallet created for the user, every transaction user-signed, one at a time.

**Done looks like:** price shows live; a connected wallet can buy and burn with its own signature; nothing about the flow touches a server key.

---

## Build order

1. **Part 0** — home ✅
2. **Part 1** — world generator (the city itself)
3. **Part 2** — game menu / lobby (enter the city)
4. **Part 3** — districts & buildings detail pass
5. **Part 4** — city systems (taxi loops, jobs, maps)
6. **Part 5** — wiring (live price, buy/burn)

No part starts before the one before it is done. Wiring never jumps the queue.

---

## Rules (standing, forever)

- **OrbitX is free, forever.** The world, the city, the menu — free. Never charge.
- **Contrast:** never light-on-light or dark-on-dark. White bg = black text, black bg = white text. Palette: black / white / gold / silver / blue. No rainbow.
- **No PHP anywhere.** React + TypeScript + Vite frontend, Node serverless, Python for the generator.
- **Safety:** never create a wallet to hold the user's crypto, never deploy a live token, never auto-buy/burn with real funds, never give trading theses as financial advice. Buy/burn is user-wallet-only, user-signed.
- **Verify live before claiming live.** A deploy is not done until the live URL is checked serving it: page renders, world zip downloads and unzips to a valid world folder, menu works.
- **Separate project.** This repo is its own thing. Never touch `og-scan` or the brag video dirs.

---

## Open questions (for the user, when they want them)

- Java Edition version target (1.21.x assumed — confirm if different).
- City name on the spawn sign (OrbitX City assumed).
- Which job pays what (city economy numbers — placeholder until set).
- Wiring phase: Jupiter vs direct AMM for the buy route (decided in Part 5).
