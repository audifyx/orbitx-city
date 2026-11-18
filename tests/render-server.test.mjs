// Render API server wrapper: route mapping + CORS, no secrets needed.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { handleRequest } from "../server.mjs";

async function withServer(fn) {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("render server: /health is cheap and secret-free", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.service, "orbitx-city-api");
  });
});

test("render server: GET /api/city reaches the real handler", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/city`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.name, "OrbitX City");
  });
});

test("render server: POST /api/city reaches the dispatcher (401, not 500)", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/city`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "__smoke__" }),
    });
    // No token: the dispatcher answers "Sign in first." — that proves the
    // route is wired; a wiring failure would be 404/500.
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.ok, false);
  });
});

test("render server: unknown /api/* paths are 404 JSON", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/ads`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.ok, false);
  });
});

test("render server: CORS allows Pages origins, blocks others", async () => {
  await withServer(async (base) => {
    const allowed = await fetch(`${base}/health`, {
      method: "OPTIONS",
      headers: { origin: "https://orbitx-city.pages.dev" },
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://orbitx-city.pages.dev");

    const blocked = await fetch(`${base}/health`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(blocked.status, 403);
  });
});
