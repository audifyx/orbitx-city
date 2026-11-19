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
import WebSocket from "ws";
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

// ---------------------------------------------------------------------------
// Phone-controller relay (WebSocket, path /relay).
//
// Pairs one game host (the PC running OrbitX City) with one phone
// controller in a room keyed by a 4-digit code shown on the PC screen.
// The phone opens /controller on the game site, types the code, and its
// stick / button state streams here; the server forwards pad -> host
// ("input") and host -> pad ("state", e.g. the current prompt) verbatim —
// it never interprets gameplay. Rooms live only while the host socket
// lives; nothing is stored.
//
// Protocol (JSON text frames):
//   host -> { t: "host" }                  server -> { t: "code", code }
//   pad  -> { t: "join", code }            server -> { t: "paired" } (both)
//   pad  -> { t: "input", ... }            forwarded to host
//   host -> { t: "state", ... }            forwarded to pad
//   host disconnects -> pad gets { t: "host-gone" } and is closed
//   pad disconnects  -> host gets { t: "pad-gone" }
// ---------------------------------------------------------------------------
const relayRooms = new Map(); // code -> { code, host, pad }

function relayMakeCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!relayRooms.has(code)) return code;
  }
  return null;
}

export function attachRelay(server) {
  const wss = new WebSocket.Server({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
    } catch {
      pathname = "";
    }
    if (pathname !== "/relay") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // Keepalive: free-tier proxies drop silent sockets; ping every 25s and
  // reap anything that missed the previous pong.
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.relayAlive === false) {
        try { ws.terminate(); } catch { /* already gone */ }
        continue;
      }
      ws.relayAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 25000);
  pingTimer.unref?.();
  wss.on("close", () => clearInterval(pingTimer));

  wss.on("connection", (ws) => {
    ws.relayAlive = true;
    ws.on("pong", () => { ws.relayAlive = true; });
    let room = null;
    let role = null;
    let windowStart = Date.now();
    let windowCount = 0;

    const send = (sock, obj) => {
      if (sock && sock.readyState === WebSocket.OPEN) {
        try { sock.send(JSON.stringify(obj)); } catch { /* ignore */ }
      }
    };

    ws.on("message", (data) => {
      // Flood guard: pad input runs at ~30/s; 480 per 2s is generous.
      const now = Date.now();
      if (now - windowStart > 2000) { windowStart = now; windowCount = 0; }
      if (++windowCount > 480) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg.t !== "string") return;

      if (msg.t === "host" && !role) {
        const code = relayMakeCode();
        if (!code) { send(ws, { t: "error", message: "No controller rooms available right now." }); return; }
        role = "host";
        room = { code, host: ws, pad: null };
        relayRooms.set(code, room);
        send(ws, { t: "code", code });
        return;
      }
      if (msg.t === "join" && !role) {
        const target = relayRooms.get(String(msg.code || "").trim());
        if (!target) { send(ws, { t: "error", message: "That code is not live — check the code on the PC screen." }); return; }
        role = "pad";
        room = target;
        if (target.pad && target.pad !== ws) {
          // One pad per room: a fresh join replaces the old pad.
          try { target.pad.close(); } catch { /* ignore */ }
        }
        target.pad = ws;
        send(ws, { t: "paired" });
        send(target.host, { t: "paired" });
        return;
      }
      if (!room) return;
      // Forwarding only, and only the direction each role may speak.
      if (role === "pad" && msg.t === "input") send(room.host, msg);
      else if (role === "host" && msg.t === "state") send(room.pad, msg);
    });

    const cleanup = () => {
      if (!room) return;
      if (role === "host") {
        send(room.pad, { t: "host-gone" });
        if (room.pad) { try { room.pad.close(); } catch { /* ignore */ } }
        relayRooms.delete(room.code);
      } else if (role === "pad") {
        if (room.pad === ws) room.pad = null;
        send(room.host, { t: "pad-gone" });
      }
      room = null;
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  return wss;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  attachRelay(server);
  server.listen(PORT, HOST, () => {
    console.log(`orbitx-city-api listening on ${HOST}:${PORT}`);
  });
}
