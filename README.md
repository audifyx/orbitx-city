# OrbitX City

## Playable browser city

Open `web/` with `npm run dev`, or open the built site (`web/dist/index.html`) through a small local server. The zip of that folder also runs the same way: `index.html` is at the root, next to `game.js` and `style.css`.

You type a seed, press PLAY, and walk the sunset downtown. Desktop uses the keyboard and mouse. A phone uses an on-screen stick, drag-to-look on the right, and buttons. The camera captures the mouse only on desktop.

Demo credits labeled ORBITX are play money stored in this browser. Buying a cosmetic or a billboard spends them and adds the burned part to a running total. Nothing here talks to a wallet, a token, or a chain.

What you can do:

- **Drive.** Hover-cars sit on the roads. Stand next to one and press Use (E) to get in or out. WASD, or the stick, drives. The camera follows behind the car.
- **Work.** Jobs (J) offers a courier run, a taxi fare, and a short city guide route. The objective stays on the HUD. Finishing one pays demo credits.
- **Visit.** OrbitX Shop, Cafe Nova, and the Community Hall have doors. Project District, on the west side, is a row of offices. Walk up to a sign and press Use to go inside. Press Use again at the door to leave.
- **Shop.** The shop sells suits, hover-car colors, and hats. Each price shows how much of it is burned.
- **Advertise.** Ads (G), or the billboard desk on the main road, books plaza-east, plaza-west, hall-front, or district-row for 1, 7, or 30 days. The board changes right away on this computer.
- **People.** Other players in another tab of the same browser show up as blocky people with names, and the chat box reaches them. Add `?server=ws://host:port` to use a relay instead. The relay just forwards JSON: `{ "t": "state", "state": { "id", "name", "x", "y", "z", "yaw", "color", "hat", "car", "skin" } }`, `{ "t": "chat", "id", "name", "text" }`, and `{ "t": "bye", "id" }`. No accounts and no secrets. Without that address, play stays inside one browser.
- **Events.** The events board by the fountain lists what is coming up. Start fountain lights for a countdown and a short burst over the water.

Edit these files and refresh. A local server picks them up. Opening the html file directly uses the copy baked into the game, because browsers block that fetch.

- `web/public/config/projects.json` — office name and the line on the lobby wall. Up to four offices, in order.
- `web/public/config/billboards.json` — `id` (`plaza-east`, `plaza-west`, `hall-front`, `district-row`), `project`, `text`, optional `image`, `start`, `end`.
- `web/public/config/events.json` — `title`, `where`, `when`, `detail`.

Keys: WASD move, mouse look, Space jump, F fly, Shift down, Ctrl faster, E use or drive, B shop, J jobs, G ads, H events, C chat, M menu, Esc closes a panel.

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
