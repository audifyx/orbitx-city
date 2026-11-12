// Regression test for the "not enough City Sol" dual-ledger bug.
//
// The HUD showed the global players.balance while buy-car / buy-home /
// office claims / the shop checked the per-server player_saves balance,
// so a player with plenty of City Sol globally was told they could not
// afford a purchase. The fix makes the per-server save the one balance
// (the HUD reads it, purchases check it) and the global row its mirror.
//
// Numbers in this test are the live ones (2026-11-11): audifyx's global
// players.balance is 10,000,000 City Sol and a new player starts with
// 60,000 (START_BALANCE, set by the starter-60k change). A brand-new
// player is simulated by setting the global to 60,000 here, since the
// starter constant lives on its own branch until merge.
//
// Run: node --test api/sol-balance.test.mjs
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

// The in-memory store (memory tier): no Supabase / Neon / Redis in tests.
function store() {
  return globalThis.__orbitx;
}

test("audifyx: 10,000,000 global, 0 on the save — every purchase succeeds", async () => {
  const id = `audifyx-${Date.now()}`;
  const session = await call("session", { id, name: "audifyx" });
  assert.equal(session.data.ok, true);
  const token = session.data.token;

  // Reproduce audifyx's live state: the grant put 10,000,000 on the
  // global players row, but the per-server save is empty (0) and the
  // player has no home universe yet.
  const player = store().players.get(id);
  player.balance = 10_000_000;
  player.homeServer = null;
  // Mint the save for universe 1, then zero it to mirror the live save.
  const joined = await call("universe-join", { server: 1 }, token);
  assert.equal(joined.data.ok, true);
  const save = store().saves.get(`${id}:1`);
  assert.ok(save, "save minted on universe-join");
  save.balance = 0;

  // The HUD (`me`) now shows the reconciled save balance: 10,000,000.
  const me = await call("me", { server: 1 }, token);
  assert.equal(me.data.ok, true);
  assert.equal(me.data.me.balance, 10_000_000);

  // Every purchase path succeeds and deducts from the one balance.
  const spent = await call("spend", { item: "color-white", server: 1 }, token);
  assert.equal(spent.data.ok, true, spent.data.message);
  assert.equal(spent.data.me.balance, 10_000_000 - 20);

  const car = await call("buy-car", { id: "tesla-model-3", server: 1 }, token);
  assert.equal(car.data.ok, true, car.data.message);
  assert.equal(car.data.me.balance, 10_000_000 - 20 - 1600);

  const home = await call("buy-home", { home: "home-fl-04", server: 1 }, token);
  assert.equal(home.data.ok, true, home.data.message);
  assert.equal(home.data.me.balance, 10_000_000 - 20 - 1600 - 1250);

  const office = await call("office-claim", { suite: "office-f2-a", term_days: 1, project: "Test", server: 1 }, token);
  assert.equal(office.data.ok, true, office.data.message);
  assert.equal(office.data.me.balance, 10_000_000 - 20 - 1600 - 1250 - 100);

  // The digest (the 1-second HUD poll) and sync agree with the save.
  const expected = 10_000_000 - 20 - 1600 - 1250 - 100;
  const digest = await call("digest", { server: 1 }, token);
  assert.equal(digest.data.ok, true);
  assert.equal(digest.data.me.balance, expected);
  const sync = await call("sync", { server: 1, state: {} }, token);
  assert.equal(sync.data.ok, true);
  assert.equal(sync.data.me.balance, expected);

  // The global row is the mirror, not a second ledger.
  assert.equal(store().players.get(id).balance, expected);
});

test("new player: 60,000 global — first universe save starts at 60,000", async () => {
  const id = `newbie-${Date.now()}`;
  const session = await call("session", { id, name: "Newbie" });
  assert.equal(session.data.ok, true);
  const token = session.data.token;

  // Post-merge every new player starts at 60,000 (START_BALANCE).
  const player = store().players.get(id);
  player.balance = 60_000;
  player.homeServer = null;

  const joined = await call("universe-join", { server: 1 }, token);
  assert.equal(joined.data.ok, true);
  // The first universe inherits the player's wealth (60,000), it is not
  // reset to a lower amount.
  assert.equal(joined.data.me.balance, 60_000);

  const spent = await call("spend", { item: "color-white", server: 1 }, token);
  assert.equal(spent.data.ok, true, spent.data.message);
  assert.equal(spent.data.me.balance, 60_000 - 20);
});

test("property-buy (live.js buyLot): the lot deducts from the save and the global mirrors it", async () => {
  const id = `buyer-${Date.now()}`;
  const session = await call("session", { id, name: "Buyer" });
  assert.equal(session.data.ok, true);
  const token = session.data.token;

  // Same stranded-wealth setup as audifyx: 10,000,000 global, save 0.
  const player = store().players.get(id);
  player.balance = 10_000_000;
  player.homeServer = null;
  const joined = await call("universe-join", { server: 1 }, token);
  assert.equal(joined.data.ok, true);
  const save = store().saves.get(`${id}:1`);
  save.balance = 0;

  // The loft costs 120. Before the fix the save (0) said "not enough"
  // while the HUD showed 10,000,000.
  const bought = await call("property-buy", { id: "loft", server: 1 }, token);
  assert.equal(bought.data.ok, true, bought.data.message);
  assert.equal(bought.data.me.balance, 10_000_000 - 120);

  // The global row is the mirror, not a second ledger: both agree.
  assert.equal(store().saves.get(`${id}:1`).balance, 10_000_000 - 120);
  assert.equal(store().players.get(id).balance, 10_000_000 - 120);

  // The digest agrees too.
  const digest = await call("digest", { server: 1 }, token);
  assert.equal(digest.data.ok, true);
  assert.equal(digest.data.me.balance, 10_000_000 - 120);
});

test("second universe starts fresh at the starter amount — no duplication", async () => {
  // The starter amount is whatever a brand-new player holds.
  const freshId = `fresh-${Date.now()}`;
  const freshSession = await call("session", { id: freshId, name: "Fresh" });
  assert.equal(freshSession.data.ok, true);
  const freshToken = freshSession.data.token;
  const starter = store().players.get(freshId).balance;

  // A wealthy player (10,000,000 on universe 1) joins universe 2.
  const id = `rich-${Date.now()}`;
  const session = await call("session", { id, name: "Rich" });
  assert.equal(session.data.ok, true);
  const token = session.data.token;
  const player = store().players.get(id);
  player.balance = 10_000_000;
  player.homeServer = null;
  const joined1 = await call("universe-join", { server: 1 }, token);
  assert.equal(joined1.data.ok, true);
  assert.equal(joined1.data.me.balance, 10_000_000);

  const joined2 = await call("universe-join", { server: 2 }, token);
  assert.equal(joined2.data.ok, true);
  // A new universe is a fresh start at the starter amount — the
  // 10,000,000 is NOT copied here (that would mint money twice).
  assert.equal(joined2.data.me.balance, starter);
  assert.notEqual(joined2.data.me.balance, 10_000_000);

  // Universe 1's wealth is untouched by the new universe.
  const back = await call("me", { server: 1 }, token);
  assert.equal(back.data.me.balance, 10_000_000);
  void freshToken;
});
