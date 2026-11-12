// Clothes shop: buying clothes equips them, switching works, unequip
// goes back to the default, and the outfit survives reload — all stored
// in the existing `owned` string array as `worn:<slot>:<value>` markers
// (no new DB column). Run: node --test api/clothes.test.mjs
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
  const id = `clothes-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const session = await call("session", { id, name: "ClothesTest" });
  assert.equal(session.data.ok, true);
  const token = session.data.token;
  const joined = await call("universe-join", { server: 1 }, token);
  assert.equal(joined.data.ok, true);
  return { id, token };
}

test("buying a shirt equips it and the outfit survives reload", async () => {
  const { id, token } = await freshPlayer();
  const bought = await call("spend", { item: "clothes-tee-red", server: 1 }, token);
  assert.equal(bought.data.ok, true);
  // Clothes are City Sol only — no burn (buy+burn is ads/banners only).
  assert.equal(bought.data.me.burned, 0, "buying clothes burns nothing");
  assert.match(bought.data.message, /Spent 30 City Sol\./);
  assert.ok(!/Burned/.test(bought.data.message), "no Burned wording on a clothes buy");
  assert.ok(bought.data.me.owned.includes("clothes-tee-red"), "owned lists the shirt");
  assert.ok(bought.data.me.owned.includes("worn:shirt:tee-red"), "worn marker set on buy");
  assert.equal(bought.data.me.clothes.shirt, "tee-red");

  // Reload: a fresh `me` still wears the shirt.
  const me = await call("me", { server: 1 }, token);
  assert.equal(me.data.ok, true);
  assert.equal(me.data.me.clothes.shirt, "tee-red");
  assert.ok(me.data.me.owned.includes("worn:shirt:tee-red"));

  // The save row (not just the global player) carries the markers:
  // the sync `me` is publicPlayer(save).
  const save = store().saves.get(`${id}:1`);
  assert.ok(save.owned.includes("clothes-tee-red"));
  assert.ok(save.owned.includes("worn:shirt:tee-red"));
});

test("switching shirts replaces the worn marker, unequip clears it", async () => {
  const { token } = await freshPlayer();
  await call("spend", { item: "clothes-tee-red", server: 1 }, token);
  const gold = await call("spend", { item: "clothes-tee-gold", server: 1 }, token);
  assert.equal(gold.data.ok, true);
  assert.equal(gold.data.me.clothes.shirt, "tee-gold");
  assert.ok(!gold.data.me.owned.includes("worn:shirt:tee-red"), "old shirt marker gone");
  assert.ok(gold.data.me.owned.includes("clothes-tee-red"), "old shirt still owned");

  // Switch back without paying again (re-buy equips).
  const back = await call("spend", { item: "clothes-tee-red", server: 1 }, token);
  assert.equal(back.data.me.clothes.shirt, "tee-red");

  // Unequip the slot: back to the default look.
  const off = await call("clothes", { slot: "shirt", id: "", server: 1 }, token);
  assert.equal(off.data.ok, true);
  assert.equal(off.data.me.clothes.shirt, undefined);
  assert.ok(!off.data.me.owned.some((entry) => entry.startsWith("worn:shirt:")));
});

test("clothes op equips owned pieces and refuses unowned ones", async () => {
  const { token } = await freshPlayer();
  const refused = await call("clothes", { slot: "shoes", id: "clothes-sneakers-white", server: 1 }, token);
  assert.equal(refused.data.ok, false);

  await call("spend", { item: "clothes-sneakers-white", server: 1 }, token);
  const equipped = await call("clothes", { slot: "shoes", id: "clothes-sneakers-white", server: 1 }, token);
  assert.equal(equipped.data.ok, true);
  assert.equal(equipped.data.me.clothes.shoes, "sneakers-white");

  // Wrong slot, unknown slot, and unknown item are all refused.
  assert.equal((await call("clothes", { slot: "shirt", id: "clothes-sneakers-white", server: 1 }, token)).data.ok, false);
  assert.equal((await call("clothes", { slot: "cape", id: "clothes-sneakers-white", server: 1 }, token)).data.ok, false);
  assert.equal((await call("clothes", { slot: "shoes", id: "clothes-nope", server: 1 }, token)).data.ok, false);
});

test("outfit + shirt + pants + glasses stack in separate slots", async () => {
  const { token } = await freshPlayer();
  await call("spend", { item: "clothes-suit-black", server: 1 }, token);
  await call("spend", { item: "clothes-sunglasses", server: 1 }, token);
  const me = await call("me", { server: 1 }, token);
  assert.equal(me.data.me.clothes.outfit, "suit-black");
  assert.equal(me.data.me.clothes.glasses, "sunglasses");
  assert.equal(me.data.me.clothes.shirt, undefined, "outfit does not fake a shirt slot");
});
