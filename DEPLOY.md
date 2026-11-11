# Deploy OrbitX City on Vercel

The site and the city API deploy from this GitHub repo. You do not run a second host for the default multiplayer. Players join one public world by posting to `/api/city` a few times a second. The game keeps moving smoothly between those updates.

Demo credits are separate from the in-app Solana wallet. Do not put `WALLET_MASTER_KEY` or a player's private key in git.

Vercel rebuilds when the connected branch moves. Supabase is the shared world. Neon and Upstash remain optional fallbacks.

## Supabase

1. Vercel project → **Storage** or **Marketplace** → **Supabase** → create or connect a project.
2. Accept `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are accepted too. Do not copy the service role into git or into a `VITE_` name. The anon key is public. The service role is the only key that can change a balance or read a wallet secret.
3. Supabase dashboard → **SQL Editor** → paste `supabase/schema.sql` → **Run**. If this project already had the older schema, also run `supabase/migrations/20261111140000_auth_and_wallets.sql`. Both files are safe to run again.
4. Authentication → Providers. Turn on **Email** (password and magic link), **Google**, **Discord**, and **Twitter** (that is X). Add redirect URLs for the Vercel domain and for local play: `https://your-project.vercel.app` and `http://localhost:5173`. The site origin is what the browser sends as `redirectTo`.
5. Redeploy. A push to the connected branch does that on its own.

`https://your-project.vercel.app/api/city` should say `"supabase": true`. After the SQL has run, play once and the same URL's world reports `Supabase`. If `supabaseError` is set, the SQL has not been applied yet. Until then the game keeps the world in that one server's memory.

The browser may subscribe to presence and chat with the anon key. It cannot write a balance.

## 1. Put the repo on Vercel

1. Vercel dashboard → **Add New…** → **Project**.
2. Import `audifyx/orbitx-city`.
3. Leave **Framework Preset** as Other. This repo sets the build in `vercel.json`.
4. Root directory stays the repository root (the folder that contains `vercel.json` and `api/`).
5. Build command: `npm run build`. Output directory: `web/dist`. If the form already shows those, leave them.
6. Deploy once so the project exists. Connect Supabase before you call it the public world. Production follows the Git branch you select here.

## 2. Guest profiles and the economy (Neon or Upstash)

Skip this if Supabase is connected. Use it only as a stand-in.

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
| `SUPABASE_URL` | Supabase | The shared world |
| `SUPABASE_ANON_KEY` | Supabase | Public read of presence and chat |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Server only. Never expose it |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Accepted if the integration uses these names |
| `DATABASE_URL` or `POSTGRES_URL` | Neon | Only if you are not using Supabase |
| `UPSTASH_REDIS_REST_URL` | Upstash | Recommended for the player list |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash | Pair with the URL |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash (older name) | Used if the UPSTASH_ pair is empty |
| `LIVEKIT_URL` | LiveKit | Optional voice SFU |
| `LIVEKIT_API_KEY` | LiveKit | Optional |
| `LIVEKIT_API_SECRET` | LiveKit | Optional |
| `WALLET_MASTER_KEY` | Wallets | 32 bytes, base64. `openssl rand -base64 32`. Server only. Never stored in the database |
| `SOLANA_NETWORK` | Solana | `devnet` unless you set `mainnet-beta` |
| `SOLANA_RPC_URL` | Solana | Optional. Overrides the public RPC. Default is `https://api.devnet.solana.com` |
| `ORBITX_MINT` | Solana | Optional. SPL mint for the holder check. Empty means no token balance and no holder badge |
| `ORBITX_HOLDER_MIN` | Solana | Optional. Minimum $ORBITX for the holder badge. Defaults to 1 |
| `ONCHAIN_SHOP_ENABLED` | Solana | Leave `false`. The shop does not spend on-chain tokens |
| `ONCHAIN_TRANSFERS_ENABLED` | Solana | Leave unset. Mainnet sends are refused until this is `true` |
| `ONCHAIN_DAILY_LAMPORTS` | Solana | Optional daily send cap. Defaults to 1 SOL |

`.env.example` lists the same names. Copy it to `.env.local` only on your machine. Never commit `.env` or `.env.local`.

## 5. What you should see

- `https://your-project.vercel.app` loads the city.
- `https://your-project.vercel.app/api/city` returns JSON with `"ok": true` and which services are connected.
- Two browsers show each other in the player list within a second, with a count on the HUD.
- The phone (P) lists voice rooms. Join one, and your name shows in that room. Talking shows a dot and a ring on the avatar.
- If the API is missing, the HUD says this device and other tabs in the same browser still see each other.

## 6. Login

The home menu asks for an account before character select. Email and password, a magic link, Google, Discord, and X all go through Supabase Auth when the URL and anon key are set. Without those keys the same screen uses an in-process login so a local machine can still be tested. That local login does not survive an API restart.

Play as guest keeps the city on this browser. Signing up afterwards moves demo credits, the character, property, and bookings onto the new account when that account is still empty.

The HUD and the phone show the username and avatar. Log out is in the phone.

Every mutating API call checks the Supabase JWT (or the local HMAC token) on that request. Heartbeats (`sync`, `digest`, `me`, `board`) may reuse a user lookup for 5 seconds. A token that looks like a login but fails verification is rejected. It is not treated as a guest.

## 7. In-app wallet

There is no Phantom, Solflare, or wallet-adapter connect, and no sign-in with an external wallet.

Each account gets a Solana keypair the first time that account opens a session. Guests do not. The secret is encrypted with AES-256-GCM: a random data key wraps the 64-byte secret, and `WALLET_MASTER_KEY` wraps the data key. The master key stays in the environment. `wallet_secrets` and `wallet_audit` have row level security on and no grants for `anon` or `authenticated`. The service role is the only reader. If the master key is missing, the account still plays and the wallet panel says to set it.

The profile wallet panel shows the address, the network (devnet unless `SOLANA_NETWORK=mainnet-beta`), the SOL balance, the $ORBITX balance when `ORBITX_MINT` is set, recent sends, and a receive QR code. If the RPC fails, the panel says so and does not invent a balance. If the mint is empty, the holder badge stays off.

Sending is a review sheet, then Confirm. The server checks the login, the address, the amount (more than 0 and at most 1 SOL), a per-user hourly limit, the daily cap, and an idempotency key. A repeated confirm of a send that already went out is not broadcast again. Signing happens on the server. The browser never sees the key during a send. Mainnet broadcasts are refused unless `ONCHAIN_TRANSFERS_ENABLED=true`.

Export is the only path that returns a secret. It asks for the password or a fresh email code on that same request, shows a warning, and writes an audit row. It is limited to 3 exports an hour. The download is the base58 secret and a Phantom-compatible JSON array. There is no import.

`ONCHAIN_SHOP_ENABLED` defaults to false. Shop, apartment, and arcade purchases stay on demo credits even when the flag is present. Do not wire a real buy-and-burn to mainnet in this build.

Run the SQL in section 3 before you rely on persistence. Until `wallet_secrets` exists, a created key lives only in that server process and disappears on restart.

## 8. Not built — real buy and burn

A later milestone can add a real $ORBITX buy-and-burn. This build does not. Demo credits are the only thing the shop can burn, and that burn is a number on the player's profile.

## Local check

From the repo root:

```bash
npm install
npm run dev --prefix web
```

`npm run dev` starts Vite and the same `/api/city` function in that process. Two browser windows on that address share one world with no keys. Add the variables to `.env.local` when you want to hit Neon, Upstash, or LiveKit from your machine.
