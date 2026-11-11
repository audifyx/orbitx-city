# OrbitX City

## Playable browser city

Open `web/` with `npm run dev` from the repo root (or `npm run dev --prefix web`). Production is a Vercel project on this repo. See [DEPLOY.md](DEPLOY.md) for the click path and every env var.

You type a seed, press PLAY, and walk the sunset downtown. Desktop uses the keyboard and mouse. A phone uses an on-screen stick, drag-to-look on the right, and buttons. The camera captures the mouse only on desktop.

Demo credits labeled ORBITX are play money. With the city API running, the balance, purchases, burn total, billboard bookings, and guest profile live on the server. The client cannot set its own balance. With no database configured, the same demo wallet stays on this device and is labeled that way. Nothing here is a real token or a wallet.

What you can do:

- **Drive.** Hover-cars sit on the roads. Stand next to one and press Use (E) to get in or out. WASD, or the stick, drives. The camera follows behind the car.
- **Work.** Jobs (J) offers courier, taxi, city guide, mechanic, photographer, and promoter. The objective stays on the HUD. The server pays the fixed amount after the route has taken at least a few seconds.
- **Visit.** OrbitX Shop, Cafe Nova, and the Community Hall are real ground floors. Project District, on the west side, is a row of offices. Walk through the door, or press Use at the sign to step inside. The shop counter, cafe bar, hall stage, and office desks are in the rooms. Press Use at the shop counter to buy.
- **Shop.** The shop sells suits, hover-car colors, and hats. Each price shows how much of it is burned.
- **Advertise.** Ads (G), or the billboard desk on the main road, books plaza-east, plaza-west, hall-front, or district-row for 1, 7, or 30 days. The board changes right away on this computer.
- **People.** Everyone who opens the deployed site joins one public world. Movement is smoothed between updates. Cars, the player count, and the player list stay in sync. Chat can go to everyone or only to people nearby. The phone (P) has profiles, friend requests, a party invite, emotes (keys 1–4), and voice lobbies. If the API is down, other tabs in the same browser still see each other.
- **Voice.** Join Plaza, the Project District, a shop, or a custom room from the phone. A speaking player gets a cyan ring. Mute, deafen, push-to-talk (hold V), and a volume slider are in the phone. With LiveKit keys the server mints a token. Without them, browsers connect to each other through the same API.
- **Events.** The events board by the fountain lists what is coming up. Start fountain lights for a countdown and a short burst over the water.

Edit these files and refresh. A local server picks them up. Opening the html file directly uses the copy baked into the game, because browsers block that fetch.

- `web/public/config/projects.json` — office name and the line on the lobby wall. Up to four offices, in order.
- `web/public/config/billboards.json` — `id` (`plaza-east`, `plaza-west`, `hall-front`, `district-row`), `project`, `text`, optional `image`, `start`, `end`.
- `web/public/config/events.json` — `title`, `where`, `when`, `detail`.

Keys: WASD move, mouse look, Space jump, F fly, Shift down, Ctrl faster, E use or drive, B shop, J jobs, G ads, H events, C chat, P phone, N sunset/night/day, V push-to-talk, 1–4 emotes, M menu, Esc closes a panel.

Quality is Low, Medium, or High from the menu. Phones start on Low. High adds softer shadows and a light bloom on the neon.

## Minecraft world

OrbitX City as a real **Minecraft Java Edition world**, plus a web lobby to enter it from.

- **The world:** a Python generator builds a full Java Edition world — spawn plaza, Terminal tower, DEX trading hall, Launchpad bay, Social hub, Scanner tower, roads + taxi loops, parks, gates. Download it, load it in Minecraft, walk the city.
- **The lobby:** a web menu — pick a district, see the city map, check the jobs board, download the world.
- **The plan:** [`PLAN.md`](PLAN.md) — vision, parts, build order, what "done" looks like.

Free, forever. The world download is free. The city is free.

## Layout

```
world/   Python world generator (deterministic seed -> .mca region files -> world .zip)
web/     Vite + React lobby (Vercel: orbitx-city)
```

## Build order

1. Home (repo + Vercel) ✅
2. World generator
3. Game menu / lobby
4. Districts & buildings detail pass
5. City systems (taxi loops, jobs, maps)
6. Wiring — live price, buy/burn (user wallet only, user-signed) — AFTER the game

## Rules

- No PHP. React + TypeScript + Vite, Node serverless, Python generator.
- Contrast: never light-on-light or dark-on-dark. Black / white / gold / silver / blue.
- Safety: no custody, no auto-buy/burn, no wallet created for the user. Buy/burn is user-wallet-only, user-signed.
- Verify live before claiming live.
