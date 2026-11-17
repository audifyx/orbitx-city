// HOMES STYLE + THEMES — exterior / roof / yard restyles, one-tap themes,
// office themes. Drives the real POST handler against the in-memory backend
// (no Supabase/Neon/Redis env set), so this never touches a live database.
// All City Sol, all state in the existing player_saves `homes` JSON column
// (per-home `crib.style`) and the office_claims `theme` column — no new
// DB column.
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Styler") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  assert.equal(session.storage, "This server memory", "test must run on the memory backend, never live Supabase");
  return { token: session.token, id: session.me.id, balance: session.me.balance };
}

function saveFor(playerId, server = 1) {
  return globalThis.__orbitx.saves.get(`${playerId}:${server}`);
}

async function buyHome(token, home = "home-ny-01") {
  const bought = await call("buy-home", { home, server: 1 }, token);
  assert.equal(bought.ok, true, bought.message);
  return bought;
}

test("homes-style: exterior restyle deducts and persists, repeat rejected", async () => {
  const { token, id } = await guest();
  const bought = await buyHome(token);
  // home-ny-01 is 2300.
  assert.equal(bought.me.balance, 60000 - 2300);

  // Gold trim is 150 City Sol.
  const styled = await call("home-style", { home: "home-ny-01", server: 1, exterior: "gold" }, token);
  assert.equal(styled.ok, true, styled.message);
  assert.equal(styled.me.balance, 60000 - 2300 - 150);
  assert.equal(styled.crib.homes[0].style.exterior, "gold");
  assert.equal(styled.crib.homes[0].style.roof, "standard");
  assert.equal(styled.crib.homes[0].style.yard, "none");

  // Persists: crib-status reads the same style back.
  const status = await call("crib-status", { server: 1 }, token);
  assert.equal(status.crib.homes[0].style.exterior, "gold");

  // Same style again is a no-op, not a charge.
  const again = await call("home-style", { home: "home-ny-01", server: 1, exterior: "gold" }, token);
  assert.equal(again.ok, false);
  assert.equal(saveFor(id, 1).balance, 60000 - 2300 - 150, "no double charge");

  // Two changes in one call charge both: neon roof 150 + deck 200.
  const both = await call("home-style", { home: "home-ny-01", server: 1, roof: "neon", yard: "deck" }, token);
  assert.equal(both.ok, true, both.message);
  assert.equal(both.me.balance, 60000 - 2300 - 150 - 150 - 200);
  assert.equal(both.crib.homes[0].style.roof, "neon");
  assert.equal(both.crib.homes[0].style.yard, "deck");

  // Unknown style rejected, no charge.
  const unknown = await call("home-style", { home: "home-ny-01", server: 1, exterior: "plaid" }, token);
  assert.equal(unknown.ok, false);
  assert.equal(saveFor(id, 1).balance, 60000 - 2300 - 150 - 150 - 200);
});

test("homes-style: a home you do not own cannot be restyled", async () => {
  const { token } = await guest("Owner");
  await buyHome(token);
  const { token: otherToken } = await guest("Stranger");
  const styled = await call("home-style", { home: "home-ny-01", server: 1, exterior: "gold" }, otherToken);
  assert.equal(styled.ok, false, "non-owner must be rejected");
});

test("homes-theme: one tap sets inside + outside together, repeat rejected", async () => {
  const { token, id } = await guest();
  const bought = await buyHome(token);
  assert.equal(bought.me.balance, 60000 - 2300);

  // Beach theme is 250: cream walls, wood floor, warm light (the
  // classic inside), beach trim, standard roof, stone patio yard.
  const themed = await call("home-theme", { home: "home-ny-01", server: 1, theme: "beach" }, token);
  assert.equal(themed.ok, true, themed.message);
  assert.equal(themed.me.balance, 60000 - 2300 - 250);
  const crib = themed.crib.homes[0];
  assert.deepEqual(crib.decor, { wall: "cream", floor: "wood", light: "warm" });
  assert.deepEqual(crib.style, { exterior: "beach", roof: "standard", yard: "patio" });

  // Same theme again is a no-op.
  const again = await call("home-theme", { home: "home-ny-01", server: 1, theme: "beach" }, token);
  assert.equal(again.ok, false);
  assert.equal(saveFor(id, 1).balance, 60000 - 2300 - 250);

  // Unknown theme rejected.
  const unknown = await call("home-theme", { home: "home-ny-01", server: 1, theme: "plaid" }, token);
  assert.equal(unknown.ok, false);

  // A different theme replaces the first (neon nights, 350).
  const neon = await call("home-theme", { home: "home-ny-01", server: 1, theme: "neon" }, token);
  assert.equal(neon.ok, true, neon.message);
  assert.equal(neon.me.balance, 60000 - 2300 - 250 - 350);
  assert.deepEqual(neon.crib.homes[0].decor, { wall: "black", floor: "black", light: "cyan" });
  assert.deepEqual(neon.crib.homes[0].style, { exterior: "neon", roof: "neon", yard: "none" });
});

test("office-theme: owner themes a claimed suite, others cannot, theme reads back", async () => {
  const { token } = await guest("Founder");
  // Suite 2A, 7-day standard lease = 500 City Sol.
  const claimed = await call("office-claim", { suite: "office-f2-a", term_days: 7, project: "OrbitX", server: 1 }, token);
  assert.equal(claimed.ok, true, claimed.message);
  assert.equal(claimed.me.balance, 60000 - 500);

  // Unclaimed suite cannot be themed.
  const unclaimed = await call("office-theme", { suite: "office-f2-b", theme: "gold", server: 1 }, token);
  assert.equal(unclaimed.ok, false);

  // Gold theme is 200 City Sol.
  const themed = await call("office-theme", { suite: "office-f2-a", theme: "gold", server: 1 }, token);
  assert.equal(themed.ok, true, themed.message);
  assert.equal(themed.me.balance, 60000 - 500 - 200);
  const suite = themed.offices.find((s) => s.id === "office-f2-a");
  assert.equal(suite.claim.theme, "gold", "directory reads the theme back");

  // Same theme again is a no-op.
  const again = await call("office-theme", { suite: "office-f2-a", theme: "gold", server: 1 }, token);
  assert.equal(again.ok, false);

  // A non-owner cannot theme it.
  const { token: otherToken } = await guest("Rival");
  const rival = await call("office-theme", { suite: "office-f2-a", theme: "neon", server: 1 }, otherToken);
  assert.equal(rival.ok, false, "only the claim owner can theme");

  // Switching back to default is free and sticks.
  const back = await call("office-theme", { suite: "office-f2-a", theme: "default", server: 1 }, token);
  assert.equal(back.ok, true, back.message);
  assert.equal(back.me.balance, 60000 - 500 - 200);
  assert.equal(back.offices.find((s) => s.id === "office-f2-a").claim.theme, "default");
});
