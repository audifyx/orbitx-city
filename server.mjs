// Persistent API server for OrbitX City (Render free web service).
//
// Serves the SAME handlers Vercel serves (api/city.js GET/POST) over plain
// node:http — no framework, no new dependencies, no handler changes.
// Vercel keeps working untouched: this file only imports the handlers,
// it does not replace them. The other five api/*.js files are libraries
// imported by city.js, not HTTP endpoints — there is nothing else to map.
//
// Why a persistent server: Vercel bills per request and the City polls
// /api/city every 250ms, which burned the free tier and got the whole
// team paused (402 DEPLOYMENT_DISABLED). Render's free web service does
// not count requests, so the polling cannot pause the game again.
//
// Run:  node server.mjs            (PORT env, default 3000)
// Env:  PORT, HOST, API_CORS_ORIGINS (comma-separated extra origins)
//       plus every env var api/city.js reads (see render.yaml / docs).

import http from "node:http";
import { pathToFileURL } from "node:url";
import { GET, POST } from "./api/city.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

// CORS allow-list: the Cloudflare Pages game origin, localhost for dev,
// and anything in API_CORS_ORIGINS (comma-separated, e.g. a custom
// domain later). The game sends an Authorization header, so preflight
// must allow it. No credentials mode is used (Bearer header only).
const EXTRA_ORIGINS = (process.env.API_CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function allowedOrigin(origin) {
  if (!origin) return null;
  if (EXTRA_ORIGINS.includes(origin)) return origin;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  if (url.hostname === "pages.dev" || url.hostname.endsWith(".pages.dev")) return origin;
  return null;
}

function corsHeaders(req) {
  const origin = allowedOrigin(req.headers.origin);
  return origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
}

function sendJson(res, status, body, req) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

// The request handler (exported so tests can drive it without listening).
// Mirrors the adapter in web/vite.config.ts (cityApi plugin): Node req
// -> Web Request -> api GET/POST -> Web Response -> Node res.
export async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    const headers = corsHeaders(req);
    if (!headers["access-control-allow-origin"]) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(204, {
      ...headers,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
    });
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    // Render health check: cheap, no secrets, no DB touch.
    sendJson(res, 200, { ok: true, service: "orbitx-city-api" }, req);
    return;
  }

  if (url.pathname !== "/api/city") {
    sendJson(res, 404, { ok: false, message: "Not found." }, req);
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed." }, req);
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const request = new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
      method: req.method,
      headers: {
        authorization: req.headers.authorization || "",
        "content-type": "application/json",
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = req.method === "GET" ? await GET() : await POST(request);
    const payload = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...corsHeaders(req),
    });
    res.end(payload);
  } catch (err) {
    sendJson(res, 500, { ok: false, message: err instanceof Error ? err.message : "API error" }, req);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.listen(PORT, HOST, () => {
    console.log(`orbitx-city-api listening on ${HOST}:${PORT}`);
  });
}
