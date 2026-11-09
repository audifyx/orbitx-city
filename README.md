# OrbitX City

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
