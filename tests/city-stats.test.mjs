import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

function req(op, body = {}, token = "") {
  return new Request("http://local/api/city", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token ? `Bearer ${token}` : "" },
    body: JSON.stringify({ op, ...body }),
  });
}

async function call(op, body, token) {
  const res = await POST(req(op, body, token));
  const data = await res.json();
  return { status: res.status, data };
}

async function signup(email) {
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  assert.equal(signed.data.ok, true, `signup failed for ${email}: ${JSON.stringify(signed.data)}`);
  return signed.data.token;
}

test("city-stats: audifyx@gmail.com gets the full stats page (200)", async () => {
  const token = await signup("audifyx@gmail.com");
  // session creates the player row (signup alone only makes the account).
  const session = await call("session", {}, token);
  assert.equal(session.data.ok, true);
  const res = await call("city-stats", {}, token);
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  const s = res.data.stats;
  assert.ok(s, "stats object missing");
  // Sections, mirroring the OrbitX Analytics + AdvancedAnalytics depth.
  for (const section of ["players", "economy", "world", "universes", "ads", "wallet", "launch"]) {
    assert.ok(s[section], `stats.${section} missing`);
  }
  // Players: the admin's own signup is counted (mock store, real count).
  assert.ok(s.players.total >= 1, `players.total should be >= 1, got ${s.players.total}`);
  assert.equal(s.players.dailyActive14.length, 14);
  assert.equal(s.universes.length, 5);
  assert.equal(s.world.homes.total, 150);
  assert.equal(s.world.offices.total, 125);
  assert.equal(s.launch.date, "2026-12-05");
  // No creation timestamp in mock mode -> new signups honestly unavailable.
  assert.equal(s.players.newToday, null);
  assert.ok(s.unavailable["players.new"], "players.new should be marked unavailable in mock mode");
  // Privacy: no email address anywhere in the stats payload.
  const blob = JSON.stringify(s);
  assert.ok(!blob.includes("@"), `stats payload must not contain an email address: ${blob.slice(0, 400)}`);
  assert.ok(!blob.includes("audifyx@gmail.com"));
});

test("city-stats: another signed-in email gets 403, never the data", async () => {
  const token = await signup(`other-${Date.now()}@example.com`);
  const res = await call("city-stats", {}, token);
  assert.equal(res.status, 403);
  assert.equal(res.data.ok, false);
  assert.equal(res.data.stats, undefined);
});

test("city-stats: not signed in gets 404 (the page does not exist)", async () => {
  const anon = await call("city-stats", {});
  assert.equal(anon.status, 404);
  assert.equal(anon.data.stats, undefined);
  const guest = await call("session", { name: "Guest Stats" });
  const guestRes = await call("city-stats", {}, guest.data.token);
  assert.equal(guestRes.status, 404);
  assert.equal(guestRes.data.stats, undefined);
});
