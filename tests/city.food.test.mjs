// Grocery + hunger (OrbitX Grocery) — drives the real POST handler
// against the in-memory backend (no Supabase/Neon/Redis env set), so this
// never touches a live database. Food lives on the per-server save's
// `daily` JSON column (daily.food / daily.hunger) — no new DB column.
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

test("food-list: 22-item catalog, empty inventory, full hunger for a fresh save", async () => {
  const { token } = await guest();
  const list = await call("food-list", { server: 1 }, token);
  assert.equal(list.ok, true, list.message);
  assert.equal(list.catalog.length, 22, "snacks, drinks, meals, groceries + cooking ingredients");
  assert.deepEqual(list.food.pantry, {});
  assert.equal(list.food.hunger, 100);
  const ids = list.catalog.map((item) => item.id);
  for (const id of ["water", "chips", "soda", "burger", "pizza", "salad", "sandwich", "energy-drink", "fruit", "groceries-bag", "bread", "egg", "cheese"]) {
    assert.ok(ids.includes(id), `catalog must include ${id}`);
  }
  for (const item of list.catalog) {
    assert.ok(Number.isFinite(item.price) && item.price > 0, `${item.id} needs a price`);
    assert.ok(Number.isFinite(item.hunger) && item.hunger > 0, `${item.id} needs a hunger restore`);
  }
  // A read never mints a save.
  assert.equal(saveFor(list.me.id, 1), undefined, "food-list must not mint a save");
});

test("food-buy: deducts City Sol, stocks the inventory; food-eat restores hunger", async () => {
  const { token, id } = await guest("Hungry");
  const bought = await call("food-buy", { id: "burger", server: 1 }, token);
  assert.equal(bought.ok, true, bought.message);
  assert.equal(bought.me.balance, 60000 - 40, "burger is 40 City Sol");
  assert.deepEqual(bought.food.pantry, { burger: 1 });
  assert.equal(bought.food.hunger, 100);

  const two = await call("food-buy", { id: "chips", qty: 2, server: 1 }, token);
  assert.equal(two.ok, true, two.message);
  assert.equal(two.me.balance, 60000 - 40 - 20, "2 chips at 10 each");
  assert.deepEqual(two.food.pantry, { burger: 1, chips: 2 });

  // The inventory survives as JSON (what rowFromSave stores).
  const raw = saveFor(id, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(raw.daily.food)), { burger: 1, chips: 2 });
  assert.equal(raw.daily.hunger, 100);

  // Starve, then eat: hunger climbs by the item's restore, count drops.
  raw.daily.hunger = 50;
  const ate = await call("food-eat", { id: "burger", server: 1 }, token);
  assert.equal(ate.ok, true, ate.message);
  assert.equal(ate.food.hunger, 85, "burger restores 35");
  assert.deepEqual(ate.food.pantry, { chips: 2 });
  assert.equal(saveFor(id, 1).daily.hunger, 85);

  // Eating caps at 100.
  saveFor(id, 1).daily.hunger = 95;
  const capped = await call("food-eat", { id: "chips", server: 1 }, token);
  assert.equal(capped.ok, true, capped.message);
  assert.equal(capped.food.hunger, 100, "chips +10 caps at 100");
  assert.deepEqual(capped.food.pantry, { chips: 1 });

  // Eating what you do not own is refused; the server never lets hunger
  // fall through an eat.
  const none = await call("food-eat", { id: "pizza", server: 1 }, token);
  assert.equal(none.ok, false);
  assert.match(none.message, /no Pizza/);
  assert.equal(saveFor(id, 1).daily.hunger, 100);
});

test("food-buy: unknown items and broke players are refused", async () => {
  const { token, id } = await guest("Broke");
  const unknown = await call("food-buy", { id: "caviar", server: 1 }, token);
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /not on the shelf/);

  const badQty = await call("food-buy", { id: "water", qty: 0, server: 1 }, token);
  assert.equal(badQty.ok, false);

  // Drain BOTH ledgers (ensureSave reconciles a save below the global
  // row back up, so draining only the save is refilled on the next op).
  await call("food-buy", { id: "water", server: 1 }, token);
  saveFor(id, 1).balance = 0;
  globalThis.__orbitx.players.get(id).balance = 0;
  const broke = await call("food-buy", { id: "water", server: 1 }, token);
  assert.equal(broke.ok, false);
  assert.match(broke.message, /Not enough City Sol/);
  assert.deepEqual(saveFor(id, 1).daily.food, { water: 1 }, "the failed buy adds nothing");
});

test("food-hunger: the drain report only ever lowers hunger, and clamps", async () => {
  const { token, id } = await guest("Drainer");
  await call("food-buy", { id: "water", server: 1 }, token);
  const down = await call("food-hunger", { hunger: 97, server: 1 }, token);
  assert.equal(down.ok, true, down.message);
  assert.equal(down.food.hunger, 97);
  assert.equal(saveFor(id, 1).daily.hunger, 97);

  // A higher report (stale client / a tab that just ate) is ignored.
  const up = await call("food-hunger", { hunger: 100, server: 1 }, token);
  assert.equal(up.ok, true);
  assert.equal(up.food.hunger, 97, "hunger only falls through food-hunger");

  const clamped = await call("food-hunger", { hunger: -40, server: 1 }, token);
  assert.equal(clamped.ok, true);
  assert.equal(clamped.food.hunger, 0, "clamped to 0, never negative");
});

test("food survives the daily rollover and stays per-server", async () => {
  const { token, id } = await guest("Rollover");
  await call("food-buy", { id: "pizza", server: 1 }, token);
  saveFor(id, 1).daily.hunger = 42;

  // Fake yesterday: the next op runs ensureDaily's rollover, which resets
  // quests — food and hunger must ride across it.
  saveFor(id, 1).daily.day = "2000-01-01";
  const list = await call("food-list", { server: 1 }, token);
  assert.equal(list.ok, true, list.message);
  assert.deepEqual(list.food.pantry, { pizza: 1 }, "a new day must not wipe the food");
  assert.equal(list.food.hunger, 42, "a new day must not reset hunger");
  assert.equal(list.me.daily.claimed, false, "the daily quest blob itself still resets");

  // Server 2 is a different save: no food, full hunger.
  const other = await call("food-list", { server: 2 }, token);
  assert.equal(other.ok, true, other.message);
  assert.deepEqual(other.food.pantry, {});
  assert.equal(other.food.hunger, 100);
});
