# Deploy OrbitX City on Vercel

The site and the city API deploy from this GitHub repo. You do not run a second host for the default multiplayer. Players join one public world by posting to `/api/city` a few times a second. The game keeps moving smoothly between those updates.

Demo credits only. Do not put a real token, seed phrase, or private key in this project.

## 1. Put the repo on Vercel

1. Vercel dashboard → **Add New…** → **Project**.
2. Import `audifyx/orbitx-city`.
3. Leave **Framework Preset** as Other. This repo sets the build in `vercel.json`.
4. Root directory stays the repository root (the folder that contains `vercel.json` and `api/`).
5. Build command: `npm run build`. Output directory: `web/dist`. If the form already shows those, leave them.
6. Deploy once so the project exists. The city will run on server memory until you add a database. On Vercel that memory is not shared between instances, so add Upstash before you call it the public world.

## 2. Guest profiles and the economy (Neon or Upstash)

Create **one** of these. Both together is the setup this game expects: Neon keeps accounts and bookings, Upstash keeps the live player list.

### Neon Postgres (free tier)

1. Vercel project → **Storage** (or **Marketplace**) → **Neon** → create a database and connect it to this project.
2. Vercel adds `DATABASE_URL` (and often `POSTGRES_URL`). Accept the defaults. Do not copy the URL into git.

### Upstash Redis (free tier)

1. Vercel → **Marketplace** → **Upstash** → create a Redis database and connect it.
2. Vercel adds `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (older links use `KV_REST_API_URL` and `KV_REST_API_TOKEN`). The API accepts either pair.

Redeploy after the variables appear (**Deployments** → … → **Redeploy**).

What is stored: display name, suit, hat, car color, demo balance, burn total, purchases, billboard bookings, friend requests, and the live position used by the player list. There is no endpoint that lets the browser set a balance. Jobs pay a fixed amount and the server ignores anything faster than about four seconds.

## 3. Voice (LiveKit, optional)

Without these keys, voice still works for small groups: browsers exchange WebRTC through `/api/city`, with a public STUN server. For a bigger lobby, use LiveKit's free cloud.

1. Create a project at [https://cloud.livekit.io](https://cloud.livekit.io).
2. Copy the WebSocket URL, API key, and API secret.
3. Vercel → **Settings** → **Environment Variables**. Add:
   - `LIVEKIT_URL` (looks like `wss://your-project.livekit.cloud`)
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
4. Redeploy.

The API mints a short-lived token when a player joins a room. The secret stays on the server.

## 4. Env var list

| Name | Service | Required |
| --- | --- | --- |
| `DATABASE_URL` or `POSTGRES_URL` | Neon | One of Neon or Upstash for a shared world |
| `UPSTASH_REDIS_REST_URL` | Upstash | Recommended for the player list |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash | Pair with the URL |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash (older name) | Used if the UPSTASH_ pair is empty |
| `LIVEKIT_URL` | LiveKit | Optional voice SFU |
| `LIVEKIT_API_KEY` | LiveKit | Optional |
| `LIVEKIT_API_SECRET` | LiveKit | Optional |

`.env.example` lists the same names. Copy it to `.env.local` only on your machine. Never commit `.env` or `.env.local`.

## 5. What you should see

- `https://your-project.vercel.app` loads the city.
- `https://your-project.vercel.app/api/city` returns JSON with `"ok": true` and which services are connected.
- Two browsers show each other in the player list within a second, with a count on the HUD.
- The phone (P) lists voice rooms. Join one, and your name shows in that room. Talking shows a dot and a ring on the avatar.
- If the API is missing, the HUD says this device and other tabs in the same browser still see each other.

## Local check

From the repo root:

```bash
npm install
npm run dev --prefix web
```

`npm run dev` starts Vite and the same `/api/city` function in that process. Two browser windows on that address share one world with no keys. Add the variables to `.env.local` when you want to hit Neon, Upstash, or LiveKit from your machine.
