# OrbitX City — move off Vercel: Cloudflare Pages (game) + Render (API)

## Why

Vercel paused the whole `audifyxbeta-4145s-projects` team (orbitx-city.vercel.app
AND orbitx.world both `402 DEPLOYMENT_DISABLED`) after the free-tier caps were
hit again in one day (CDN 113% of 1M requests, edge functions 570,676 vs ~550k).
Root cause: the City polls `/api/city` every 250ms (4 req/s per player) and
Vercel bills per request. This move kills the problem structurally:

- **Cloudflare Pages** serves the game files (free static hosting, no
  bandwidth cap) — the CDN-request cap disappears.
- **Render** runs the API as a persistent Node server (`server.mjs`, free
  web service, no per-request counting) — the polling cannot pause it.
- Oracle is OUT (user can't use it). Vercel Pro is OUT (needs a working
  card; Chime is frozen, and Pro would bill overages instead of pausing).

## What changed in this branch

- `server.mjs` (new) — plain `node:http` server, zero new dependencies.
  Imports `GET`/`POST` from `api/city.js` and serves `/api/city` (+ a
  secret-free `/health` for Render's health check). CORS allows the Pages
  origin (`*.pages.dev`), localhost, and `API_CORS_ORIGINS`. The 6 Vercel
  function files are UNTOUCHED — only `api/city.js` is an HTTP endpoint;
  the other five are libraries it imports, so there is nothing else to map.
  No Vercel-specific code exists anywhere in `api/` (verified: no
  `VERCEL`/`waitUntil`/`request.ip` usage), so the handlers run as-is.
- `web/src/game/net.ts` — new `apiBase()`/`apiUrl()` helper. The game
  calls the API at `VITE_API_URL` when set at build time, otherwise
  relative `/api/city` exactly as today. All 7 call sites
  (`App.tsx` x2, `auth.ts` x2, `multiverse.ts`, `runtime.ts`, `world.ts`)
  now use it. No other client calls go to `/api/*`.
- `render.yaml` (new) — Blueprint: free `orbitx-city-api` web service
  (`npm ci` + `node server.mjs`, health check `/health`) and a free
  `orbitx-city` static site as a fallback static host. No secret VALUES
  in the file — every secret is `sync: false` (set in the dashboard).
- `wrangler.toml` (new) — records the Pages project settings
  (`orbitx-city`, build `npm run build`, output `web/dist`). The Pages
  dashboard values are authoritative.
- `tests/render-server.test.mjs` (new) — route mapping + CORS tests.

## Env-var inventory (key names only — no values in this repo)

Values live in the Vercel project `orbitx-city` today. Plain values are
visible in the Vercel dashboard; sensitive ones are masked there and must
be revealed/copied by someone with dashboard access (the API returns them
empty, so they cannot be copied programmatically).

### Required on Render (to match production behaviour)

Verified against the code (2026-11-18): the API reads the SUPABASE_*
names FIRST and the STORAGE_* names as fallbacks, in both
`api/auth.js` (`supabasePublic()`) and `api/city.js` (`supabaseEnv()`):

- URL: `SUPABASE_URL` → `NEXT_PUBLIC_SUPABASE_URL` →
  `STORAGE_SUPABASE_URL` → `NEXT_PUBLIC_STORAGE_SUPABASE_URL`
- Anon: `SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` →
  `STORAGE_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_STORAGE_SUPABASE_ANON_KEY`
- Service role: `SUPABASE_SERVICE_ROLE_KEY` →
  `STORAGE_SUPABASE_SERVICE_ROLE_KEY` → `STORAGE_SUPABASE_SECRET_KEY`

**The gap, answered:** there is no plain `SUPABASE_*` in Vercel because
the values live under the `STORAGE_*` integration names and the code reads
those as fallbacks. On Render, set EITHER the `SUPABASE_*` names (copy the
values from their `STORAGE_*` counterparts — recommended, the documented
names) OR the `STORAGE_*` names themselves. The browser reads no env vars
at all (Vite only exposes `VITE_*`; the `STORAGE_*` hits in `web/src`
are localStorage keys, not env vars) — the anon key reaches the client
through `GET /api/city`.

| Key | Lives in Vercel as | Notes |
|---|---|---|
| `SUPABASE_URL` | `STORAGE_SUPABASE_URL` (integration) | Copy the STORAGE_* value into the SUPABASE_* name (code reads both) |
| `SUPABASE_ANON_KEY` | `STORAGE_SUPABASE_ANON_KEY` | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | `STORAGE_SUPABASE_SERVICE_ROLE_KEY` | Same |
| `LIVEKIT_URL` | `LIVEKIT_URL` | |
| `LIVEKIT_API_KEY` | `LIVEKIT_API_KEY` (sensitive) | |
| `LIVEKIT_API_SECRET` | `LIVEKIT_API_SECRET` (sensitive) | |
| `ORBITX_MINT` | `ORBITX_MINT` | |
| `SOLANA_NETWORK` | `SOLANA_NETWORK` | `mainnet-beta` |
| `WALLET_MASTER_KEY` | `WALLET_MASTER_KEY` (sensitive) | **BLOCKER — see below** |

### Dead weight — in Vercel, never read by the code (do NOT copy)

Verified by grep over `api/` and `web/src` (2026-11-18): the Vercel
Supabase integration injects these, but nothing reads them. The code
reads `DATABASE_URL || POSTGRES_URL` only (`api/city.js:1442`) — none of
the `STORAGE_POSTGRES_*` names — and never reads the publishable/JWT
keys.

`STORAGE_POSTGRES_DATABASE`, `STORAGE_POSTGRES_USER`,
`STORAGE_POSTGRES_PRISMA_URL`, `STORAGE_POSTGRES_PASSWORD`,
`STORAGE_POSTGRES_HOST`, `STORAGE_POSTGRES_URL_NON_POOLING`,
`STORAGE_POSTGRES_URL`, `STORAGE_SUPABASE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_STORAGE_SUPABASE_PUBLISHABLE_KEY`,
`STORAGE_SUPABASE_JWT_SECRET`.

### Optional on Render (unset on Vercel today; code has defaults)

`DATABASE_URL` / `POSTGRES_URL` (Neon — currently unused on Vercel; leave
unset to keep behaviour identical), `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` (Redis cache off on Vercel), `JUP_API_KEY`,
`SOLANA_RPC_URL`, `SOL_USD`, `ORBITX_USD`, `AD_ADMINS`, `AD_DENYLIST`,
`ARCADE_PAPER`, `ONCHAIN_TRANSFERS_ENABLED`, `ONCHAIN_SHOP_ENABLED`,
`ONCHAIN_DAILY_LAMPORTS`, `ORBITX_HOLDER_MIN`, `ORBITX_AUTH_SECRET`
(mock-mode signer only; production uses Supabase — set a fresh random
value on Render for hygiene), `API_CORS_ORIGINS` (extra allowed origins,
comma-separated; Pages + localhost are allowed by default).

### Build-time var for Pages (and for the Render static fallback)

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://orbitx-city-api.onrender.com` (no trailing slash; the actual Render URL once created) |

The browser needs nothing else: Supabase auth config (URL + anon key)
reaches the client through `GET /api/city` as today.

### ⚠️ BLOCKER: WALLET_MASTER_KEY

Its value exists ONLY in Vercel, as a masked sensitive var. It cannot be
recovered through the API. Someone with Vercel dashboard access must open
`orbitx-city` → Settings → Environment Variables → reveal
`WALLET_MASTER_KEY` → paste it into the Render dashboard. If the value
cannot be recovered, do NOT rotate it blindly: rotating it orphans every
already-sealed in-app wallet key (stored wallet keys become undecryptable).

## Deploy steps

### 1. Render (API) — no Cloudflare token needed, nothing blocked

1. Create a free Render account (email only, no card): https://render.com
2. Dashboard → New → Blueprint → connect GitHub repo `audifyx/orbitx-city`,
   branch `main`. Render reads `render.yaml` from the repo.
3. On the `orbitx-city-api` service, set every `sync: false` env var from
   the table above (copy values from the Vercel dashboard).
4. Deploy. Note the service URL (`https://orbitx-city-api.onrender.com`).
5. Verify: `curl https://<api>/health` → `{"ok":true,"service":"orbitx-city-api"}`
   and `curl https://<api>/api/city` → `{"ok":true,"name":"OrbitX City",...}`.
6. Keep-alive (free tier sleeps after 15 min idle; ~1 min wake-up):
   ping `/health` every 10 min (e.g. a cron on this VM). One always-awake
   service uses ~744 of the 750 free instance hours/month — it just fits.

### 2. Cloudflare Pages (game) — BLOCKED on the token, re-link first

**Status: the stored `custom.cloudflare` token is DEAD.** A direct call to
Cloudflare's token-verify endpoint returned `401 "Invalid API Token"` on
two network paths (verified 2026-11-18). `wrangler whoami` times out/fails
with it. Do NOT attempt a Pages deploy until it is re-linked.

**Re-link step (user):** re-submit a fresh Cloudflare API token via the
secure flow (the same secure card used to store `custom.cloudflare` the
first time). The token needs Pages + account permissions for the
`orbitx-city` project (an API token with "Cloudflare Pages: Edit" on the
account is enough for deploys).

**After re-link, deploy (either path):**

- Dashboard path (recommended — auto-deploys on every push to main):
  Workers & Pages → Create → Pages → Connect to Git → repo
  `audifyx/orbitx-city`, branch `main` → Framework preset None (or Vite)
  → Build command `npm run build` → Build output directory `web/dist`
  → Root directory: repo root → Environment variable (Production):
  `VITE_API_URL` = the Render API URL from step 1.
- Wrangler path (one-off, same pattern as
  `~/workspace/cloudflare-deploy/deploy.py`): the deploy script fetches the
  `custom.cloudflare` token via `dynamic_credentials` and hands it to
  Wrangler as `CLOUDFLARE_API_TOKEN` (the egress proxy swaps the surrogate
  for the real token; the raw token never touches disk/chat). Then:
  `wrangler pages project create orbitx-city`
  `VITE_API_URL=<Render API URL> npm run build`
  `wrangler pages deploy web/dist --project-name orbitx-city`
  (Wrangler binary: `~/workspace/cloudflare-deploy/node_modules/.bin/wrangler`.)

**Verify:** open `https://orbitx-city.pages.dev` → game loads → sign in
works (session op through the Render API) → `/api/city` traffic shows in
the Render logs, not Vercel's.

## Behaviour notes (pre-existing, unchanged by the move)

- Guest (not signed in) state is partly in-memory on the API server: it
  survives as long as the process lives and resets on restart — same as a
  Vercel cold start. Signed-in accounts persist in Supabase.
- The Render free service restarts/sleeps when idle; the first request
  after a sleep takes ~1 min (keep-alive ping in step 1.6 avoids it).
- Pushes to `main` auto-deploy Pages (if connected via GitHub) and
  redeploy the Render API (autoDeploy). Vercel stays as-is until the move
  is verified live — nothing in this branch touches the Vercel setup.
