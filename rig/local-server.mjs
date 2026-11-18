// Local rig server: serves web/dist AND routes POST /api/city to the
// REAL api/city.js handler against its in-memory backend (the same
// backend the node --test suite uses — "This server memory", never
// live Supabase). This lets the game boot with shape-correct API
// responses and makes a real end-to-end buy -> inventory possible.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POST } from "../api/city.js";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/dist");
const PORT = Number(process.env.RIG_PORT || 8946);

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "POST" && url.pathname === "/api/city") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    let op = "?";
    try { op = JSON.parse(body).op || "?"; } catch {}
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (v) headers[k] = Array.isArray(v) ? v.join(", ") : v;
    try {
      const out = await POST(new Request(`http://127.0.0.1:${PORT}/api/city`, { method: "POST", headers, body }));
      const text = await out.text();
      try { fs.appendFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "api-8946.log"), `${new Date().toISOString()} op=${op} status=${out.status} ${text.slice(0, 160)}\n`); } catch {}
      res.writeHead(out.status, { "content-type": out.headers.get("content-type") || "application/json" });
      res.end(text);
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: String(e && e.message || e) }));
    }
    return;
  }
  // Any other /api/* path: JSON, never the SPA HTML (the client parses
  // API responses as JSON — an HTML 404 breaks the flow).
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "unknown api route" }));
    return;
  }
  // Static: dist files, SPA fallback to index.html.
  let p = path.join(DIST, decodeURIComponent(url.pathname));
  if (!p.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  try {
    if (fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  } catch { p = path.join(DIST, "index.html"); }
  try {
    const data = fs.readFileSync(p);
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`rig server on http://127.0.0.1:${PORT}/ (dist + real /api/city)`);
});
