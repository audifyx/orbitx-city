// UNIFIED SHOP: one shop-buy op for every category (clothes / cars /
// homes / grocery / furniture), City Sol only, no burn — drives the
// real POST handler against the in-memory backend (no Supabase/Neon/
// Redis env set), so this never touches a live database.
//
// Every buy deducts the server-authoritative price, grants the item
// on the per-server save, and persists it (a later shop-catalog read
// on the same token sees the grant). Food bought through the shop
// lands in the pantry and eating it restores hunger.
//
// Run: node --test tests/shop.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Shopper") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  assert.equal(session.storage, "This server memory", "test must run on the memory backend, never live Supabase");
  return { token: session.token, id: session.me.id, balance: session.me.balance };
}

function saveFor(playerId, server = 1) {
  return globalThis.__orbitx.saves.get(`${playerId}:${server}`);
}

test("shop-catalog lists all five categories at server prices, nothing owned yet", async () => {
  const { token } = await guest("Catalog");
  const res = await call("shop-catalog", { server: 1 }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.shop.balance, 60000);
  assert.deepEqual(res.shop.vehicles, []);
  assert.deepEqual(res.shop.homes, []);
  assert.deepEqual(res.shop.furnitureOwned, []);
  // Clothes: the client catalog's tee is 30 in the server CATALOG.
  const tee = res.catalog.clothes.find((item) => item.id === "clothes-tee-red");
  assert.ok(tee, "clothes catalog has the red tee");
  assert.equal(tee.price, 30);
  // Cars: server price table, with the color list for the picker.
  const compact = res.catalog.cars.find((item) => item.id === "city-compact");
  assert.equal(compact.price, 220);
  assert.ok(compact.colors.includes("white"));
  // Homes: every home id has a server price.
  const home = res.catalog.homes.find((item) => item.id === "home-ny-01");
  assert.equal(home.price, 2300);
  assert.ok(res.catalog.homes.length >= 100, "homes catalog covers the 150-home city");
  // Grocery + furniture come with names (the client renders them).
  const sandwich = res.catalog.food.find((item) => item.id === "sandwich");
  assert.equal(sandwich.price, 30);
  assert.equal(sandwich.hunger, 25);
  const plant = res.catalog.furniture.find((item) => item.id === "plant");
  assert.equal(plant.price, 80);
});

test("shop-buy clothes: deducts, grants, equips (worn marker) — re-buy just equips", async () => {
  const { token, id } = await guest("Dresser");
  const res = await call("shop-buy", { category: "clothes", id: "clothes-tee-red", server: 1 }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.shop.balance, 60000 - 30);
  assert.ok(res.shop.owned.includes("clothes-tee-red"));
  assert.ok(res.shop.owned.includes("worn:shirt:tee-red"), "buying clothes equips them");
  assert.equal(saveFor(id, 1).balance, 60000 - 30);

  const again = await call("shop-buy", { category: "clothes", id: "clothes-tee-red", server: 1 }, token);
  assert.equal(again.ok, true, again.message);
  assert.match(again.message, /Already yours/);
  assert.equal(again.shop.balance, 60000 - 30, "re-buy charges nothing");
});

test("shop-buy car: deducts, parks it in the garage, makes it active", async () => {
  const { token, id } = await guest("Driver2");
  const res = await call("shop-buy", { category: "car", id: "city-compact", color: "white", server: 1 }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.shop.balance, 60000 - 220);
  assert.deepEqual(res.shop.vehicles, [{ id: "city-compact", color: "white" }]);
  assert.equal(res.shop.activeVehicle, "city-compact");
  assert.equal(saveFor(id, 1).vehicles[0].id, "city-compact");

  // The grant survives a fresh read — persistence, not a local echo.
  const catalog = await call("shop-catalog", { server: 1 }, token);
  assert.deepEqual(catalog.shop.vehicles, [{ id: "city-compact", color: "white" }]);
  assert.equal(catalog.shop.balance, 60000 - 220);
});

test("shop-buy food lands in the pantry; eating it restores hunger", async () => {
  const { token } = await guest("Eater");
  const bought = await call("shop-buy", { category: "food", id: "sandwich", qty: 2, server: 1 }, token);
  assert.equal(bought.ok, true, bought.message);
  assert.equal(bought.shop.balance, 60000 - 60);
  assert.equal(bought.shop.food.sandwich, 2);
  assert.equal(bought.food.pantry.sandwich, 2, "food reply carries the pantry");

  // Hunger starts full — drain it first, then eat: the bite must move it.
  const drained = await call("food-hunger", { server: 1, hunger: 50 }, token);
  assert.equal(drained.food.hunger, 50);
  const ate = await call("food-eat", { id: "sandwich", server: 1 }, token);
  assert.equal(ate.ok, true, ate.message);
  assert.equal(ate.food.hunger, 75, "a sandwich restores 25 hunger");
  assert.equal(ate.food.pantry.sandwich, 1, "one sandwich is gone from the pantry");
});

test("shop-buy home: deducts, grants the home on this server", async () => {
  const { token, id } = await guest("Homeowner");
  const res = await call("shop-buy", { category: "home", id: "home-ny-01", server: 1 }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.shop.balance, 60000 - 2300);
  assert.deepEqual(res.shop.homes, ["home-ny-01"]);
  assert.equal(saveFor(id, 1).homes.homes[0].homeId, "home-ny-01");

  const again = await call("shop-buy", { category: "home", id: "home-ny-01", server: 1 }, token);
  assert.equal(again.ok, false);
  assert.match(again.message, /already own/);
  assert.equal(again.shop, undefined, "a failed buy returns no snapshot");
});

test("shop-buy furniture: deducts and adds an owned copy to place at home", async () => {
  const { token, id } = await guest("Decorator");
  const res = await call("shop-buy", { category: "furniture", id: "plant", server: 1 }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.shop.balance, 60000 - 80);
  assert.deepEqual(res.shop.furnitureOwned, ["plant"]);
  assert.deepEqual(saveFor(id, 1).homes.furnitureOwned, ["plant"]);
});

test("shop-buy refuses unknown categories, unknown items, and empty wallets", async () => {
  const { token } = await guest("Broke");
  const badCategory = await call("shop-buy", { category: "yacht", id: "city-compact", server: 1 }, token);
  assert.equal(badCategory.ok, false);
  assert.match(badCategory.message, /Unknown shop category/);

  const badItem = await call("shop-buy", { category: "car", id: "not-a-car", server: 1 }, token);
  assert.equal(badItem.ok, false);
  assert.match(badItem.message, /not for sale/);

  // Drain the wallet to 0, then a 220 City Sol car must fail.
  // (No color passed — the server picks each vehicle's default.)
  await call("shop-buy", { category: "car", id: "tesla-roadster", server: 1 }, token); // 20000
  await call("shop-buy", { category: "car", id: "fly-jet", server: 1 }, token); // 25000
  const last = await call("shop-buy", { category: "car", id: "fly-heli", server: 1 }, token); // 15000
  assert.equal(last.ok, true, last.message);
  assert.equal(last.shop.balance, 0);
  const poor = await call("shop-buy", { category: "car", id: "city-compact", color: "white", server: 1 }, token);
  assert.equal(poor.ok, false);
  assert.match(poor.message, /Not enough City Sol/);
});

test("shop-buy needs a server, like every other per-server op", async () => {
  const { token } = await guest("Serverless");
  const res = await call("shop-buy", { category: "clothes", id: "clothes-tee-red" }, token);
  assert.equal(res.ok, false);
  assert.match(res.message, /server/i);
});
