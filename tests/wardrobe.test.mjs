// Wardrobe regression test (style theme, 2026-11-12).
//
// The wardrobe sells 33 items across three stores (thrift / streetwear /
// designer) for City Sol with NO burn, equips through eq:<kind>:<value>
// entries in the existing `owned` array (no new DB column), and saves
// named fits as fit:<name>|... entries in the same array.
//
// Run: node --test api/wardrobe.test.mjs
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

function store() {
  return globalThis.__orbitx;
}

async function freshPlayer() {
  const id = `wardrobe-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const session = await call("session", { id, name: "WardrobeTest" });
  assert.equal(session.data.ok, true);
  const joined = await call("universe-join", { server: 1 }, session.data.token);
  assert.equal(joined.data.ok, true);
  return { id, token: session.data.token };
}

test("buy from all three stores: exact price, zero burn, eq slot set", async () => {
  const { id, token } = await freshPlayer();
  const player = store().players.get(id);
  assert.equal(player.balance, 60000);
  assert.equal(player.burned, 0);

  // Thrift tee (15) -> streetwear hoodie (120) -> designer leather (450).
  const tee = await call("spend", { item: "outfit-tee", server: 1 }, token);
  assert.equal(tee.status, 200);
  assert.equal(tee.data.me.balance, 60000 - 15);
  assert.equal(tee.data.me.burned, 0, "wardrobe is a purchase, not a burn event");
  assert.equal(tee.data.me.wardrobe.outfit, "tee");

  const hoodie = await call("spend", { item: "outfit-hoodie", server: 1 }, token);
  assert.equal(hoodie.data.me.balance, 60000 - 15 - 120);
  assert.equal(hoodie.data.me.burned, 0);
  assert.equal(hoodie.data.me.wardrobe.outfit, "hoodie");

  const leather = await call("spend", { item: "outfit-leather", server: 1 }, token);
  assert.equal(leather.data.me.balance, 60000 - 15 - 120 - 450);
  assert.equal(leather.data.me.burned, 0);
  assert.equal(leather.data.me.wardrobe.outfit, "leather");

  // One eq entry per slot: three outfit buys leave exactly one eq:outfit.
  const eqOutfits = player.owned.filter((entry) => entry.startsWith("eq:outfit:"));
  assert.deepEqual(eqOutfits, ["eq:outfit:leather"]);
  for (const itemId of ["outfit-tee", "outfit-hoodie", "outfit-leather"]) {
    assert.ok(player.owned.includes(itemId), `${itemId} owned`);
  }

  // Shoes + chain + watch + glasses + hair each land in their own slot.
  await call("spend", { item: "shoes-gold", server: 1 }, token);
  await call("spend", { item: "chain-diamond", server: 1 }, token);
  await call("spend", { item: "watch-gold", server: 1 }, token);
  await call("spend", { item: "glasses-visor", server: 1 }, token);
  await call("spend", { item: "hair-mohawk", server: 1 }, token);
  const me = await call("me", { server: 1 }, token);
  assert.deepEqual(
    (({ outfit, shoes, chain, watch, glasses, hair }) => ({ outfit, shoes, chain, watch, glasses, hair }))(me.data.me.wardrobe),
    { outfit: "leather", shoes: "gold", chain: "diamond", watch: "gold", glasses: "visor", hair: "mohawk" },
  );
  assert.equal(me.data.me.balance, 60000 - 15 - 120 - 450 - 500 - 800 - 600 - 280 - 60);
  assert.equal(me.data.me.burned, 0);
});

test("re-equip an owned piece: free, and swaps the eq slot", async () => {
  const { id, token } = await freshPlayer();
  const player = store().players.get(id);
  await call("spend", { item: "outfit-tee", server: 1 }, token);
  await call("spend", { item: "outfit-silk", server: 1 }, token);
  const before = player.balance;
  const again = await call("spend", { item: "outfit-tee", server: 1 }, token);
  assert.equal(again.status, 200);
  assert.equal(player.balance, before, "re-equip costs nothing");
  assert.equal(again.data.me.wardrobe.outfit, "tee");
});

test("save / wear / delete a fit round-trips, and wear only owns pieces", async () => {
  const { id, token } = await freshPlayer();
  const player = store().players.get(id);

  // Nothing worn yet: saving a fit is refused.
  const empty = await call("save-fit", { name: "Empty" }, token);
  assert.equal(empty.status, 400);

  await call("spend", { item: "outfit-leather", server: 1 }, token);
  await call("spend", { item: "shoes-gold", server: 1 }, token);
  await call("spend", { item: "chain-gold", server: 1 }, token);
  const saved = await call("save-fit", { name: "Gold Night" }, token);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.me.wardrobe.fits.length, 1);
  assert.equal(saved.data.me.wardrobe.fits[0].name, "Gold Night");
  assert.equal(saved.data.me.wardrobe.fits[0].outfit, "leather");
  assert.equal(saved.data.me.wardrobe.fits[0].shoes, "gold");
  assert.equal(saved.data.me.wardrobe.fits[0].chain, "gold");

  // Change the look, then wear the fit back in one tap.
  await call("spend", { item: "outfit-tee", server: 1 }, token);
  assert.equal(store().players.get(id).owned.includes("eq:outfit:tee"), true);
  const worn = await call("wear-fit", { name: "Gold Night" }, token);
  assert.equal(worn.status, 200);
  assert.equal(worn.data.me.wardrobe.outfit, "leather");
  assert.equal(worn.data.me.wardrobe.shoes, "gold");
  assert.equal(worn.data.me.wardrobe.chain, "gold");

  // Saving the same name overwrites (still one fit, max 8 enforced).
  await call("save-fit", { name: "Gold Night" }, token);
  assert.equal(store().players.get(id).owned.filter((e) => e.startsWith("fit:")).length, 1);

  // A fit never grants an item the player does not own.
  player.owned.push("fit:Fake|outfit=suit|shoes=loafers");
  const fake = await call("wear-fit", { name: "Fake" }, token);
  assert.equal(fake.status, 400);
  assert.match(fake.data.message, /don't own/);

  const deleted = await call("delete-fit", { name: "Gold Night" }, token);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.me.wardrobe.fits.length, 1, "only the fake fit remains");
  const deletedAgain = await call("delete-fit", { name: "Gold Night" }, token);
  assert.equal(deletedAgain.status, 400);
});

test("eq:/fit: entries do not count as shop purchases for the buy mission", async () => {
  const { token } = await freshPlayer();
  // The buy mission step is server-side; this test pins the counting
  // rule at the owned-array level: a player with one real purchase and
  // several wardrobe state entries still counts as one purchase.
  await call("spend", { item: "outfit-tee", server: 1 }, token);
  await call("spend", { item: "shoes-trainers", server: 1 }, token);
  await call("save-fit", { name: "Thrift Day" }, token);
  const me = await call("me", { server: 1 }, token);
  const real = me.data.me.owned.filter((e) => !e.startsWith("eq:") && !e.startsWith("fit:"));
  assert.deepEqual(real.sort(), ["outfit-tee", "shoes-trainers"]);
});
