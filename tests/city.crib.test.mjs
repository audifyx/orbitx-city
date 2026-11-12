// CRIB (home life) — bills, sleep/energy, pets, upgrades, decor, working
// stuff. Drives the real POST handler against the in-memory backend (no
// Supabase/Neon/Redis env set), so this never touches a live database.
// Storage: everything lives inside the existing player_saves `homes`
// JSON column (per-home `crib` on the OwnedHome entry, player-level
// `crib` on the same JSON) — no new DB column.
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Cribber") {
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

test("crib: bills are due weekly, paying restores the lights", async () => {
  const { token, id, balance } = await guest();
  assert.equal(balance, 60000);
  const bought = await buyHome(token);
  // home-ny-01 is 2300; rent 2% = 46 + lights 20 = 66/week.
  assert.equal(bought.me.balance, 60000 - 2300);
  const status = await call("crib-status", { server: 1 }, token);
  assert.equal(status.ok, true);
  assert.equal(status.crib.energy, 100);
  assert.equal(status.crib.homes.length, 1);
  const bill = status.crib.homes[0].bills;
  assert.equal(bill.amount, 66);
  assert.equal(bill.overdue, false);
  assert.equal(bill.lightsOff, false);

  // Force the bill overdue: move dueAt into the past in the stored save.
  const raw = saveFor(id, 1);
  raw.homes.homes[0].crib.bills.dueAt = Date.now() - 1000;
  const overdue = await call("crib-status", { server: 1 }, token);
  assert.equal(overdue.crib.homes[0].bills.overdue, true);
  assert.equal(overdue.crib.homes[0].bills.lightsOff, true, "unpaid bills cut the lights");

  // Lights cannot be switched back on while the bill is overdue.
  const noLights = await call("crib-lights", { home: "home-ny-01", server: 1, on: true }, token);
  assert.equal(noLights.ok, false);

  // Pay: balance drops by the bill, lights come back, next due in a week.
  const before = overdue.me.balance;
  const paid = await call("crib-pay-bill", { home: "home-ny-01", server: 1 }, token);
  assert.equal(paid.ok, true, paid.message);
  assert.equal(paid.me.balance, before - 66);
  assert.equal(paid.crib.homes[0].bills.overdue, false);
  assert.equal(paid.crib.homes[0].bills.lightsOff, false);
  assert.ok(paid.crib.homes[0].bills.dueAt > Date.now() + 6 * 86400000, "next bill is ~a week out");

  // Stored where it belongs: inside the existing homes JSON, no new column.
  const stored = JSON.parse(JSON.stringify(saveFor(id, 1).homes));
  assert.equal(stored.homes[0].crib.bills.amount, 66);
  assert.equal(typeof stored.crib.energy, "number");
});

test("crib: sleep restores energy, eating restores some, sync clamps", async () => {
  const { token } = await guest("Sleeper");
  await buyHome(token);
  const tired = await call("crib-energy", { server: 1, energy: 12 }, token);
  assert.equal(tired.ok, true);
  assert.equal(tired.crib.energy, 12);
  const slept = await call("crib-sleep", { home: "home-ny-01", server: 1 }, token);
  assert.equal(slept.ok, true, slept.message);
  assert.equal(slept.crib.energy, 100);

  // Sleeping in a home you do not own fails.
  const stranger = await call("crib-sleep", { home: "home-ny-02", server: 1 }, token);
  assert.equal(stranger.ok, false);

  // Food: buy + eat from the fridge.
  const food = await call("crib-buy-food", { item: "pizza", qty: 2, server: 1 }, token);
  assert.equal(food.ok, true, food.message);
  assert.equal(food.crib.food.pizza, 2);
  assert.equal(food.me.balance, 60000 - 2300 - 24);
  const ate = await call("crib-eat", { item: "pizza", server: 1 }, token);
  assert.equal(ate.ok, true, ate.message);
  assert.equal(ate.crib.food.pizza, 1);
  // Energy was 100 (just slept), eating caps at 100.
  assert.equal(ate.crib.energy, 100);

  // Pet food is for the pet, not the player.
  await call("crib-buy-food", { item: "petfood", qty: 1, server: 1 }, token);
  const noEat = await call("crib-eat", { item: "petfood", server: 1 }, token);
  assert.equal(noEat.ok, false);

  // Sync clamps to 0-100.
  const clamped = await call("crib-energy", { server: 1, energy: 250 }, token);
  assert.equal(clamped.crib.energy, 100);
});

test("crib: pets — buy, feed from the food bag, one pet only", async () => {
  const { token } = await guest("PetOwner");
  await buyHome(token);
  const noFood = await call("crib-feed-pet", { server: 1 }, token);
  assert.equal(noFood.ok, false, "no pet yet");

  const dog = await call("crib-buy-pet", { kind: "dog", server: 1 }, token);
  assert.equal(dog.ok, true, dog.message);
  assert.equal(dog.crib.pet.kind, "dog");
  assert.equal(dog.crib.pet.happy, true, "a new pet starts fed");
  assert.equal(dog.me.balance, 60000 - 2300 - 500);

  const second = await call("crib-buy-pet", { kind: "cat", server: 1 }, token);
  assert.equal(second.ok, false, "one pet at a time");

  const unfed = await call("crib-feed-pet", { server: 1 }, token);
  assert.equal(unfed.ok, false, "nothing to feed it with yet");

  await call("crib-buy-food", { item: "petfood", qty: 1, server: 1 }, token);
  const fed = await call("crib-feed-pet", { server: 1 }, token);
  assert.equal(fed.ok, true, fed.message);
  assert.equal(fed.crib.pet.happy, true);
  assert.equal(fed.crib.food.petfood || 0, 0, "feeding eats one pet food");
});

test("crib: upgrades climb apartment -> house -> mansion -> penthouse", async () => {
  const { token } = await guest("Upgrader");
  await buyHome(token);
  const toHouse = await call("crib-upgrade", { home: "home-ny-01", server: 1 }, token);
  assert.equal(toHouse.ok, true, toHouse.message);
  assert.equal(toHouse.crib.homes[0].tier, 1);
  assert.equal(toHouse.crib.homes[0].tierName, "House");
  assert.equal(toHouse.me.balance, 60000 - 2300 - 1500);
  const toMansion = await call("crib-upgrade", { home: "home-ny-01", server: 1 }, token);
  assert.equal(toMansion.ok, true);
  assert.equal(toMansion.crib.homes[0].tier, 2);
  const toPenthouse = await call("crib-upgrade", { home: "home-ny-01", server: 1 }, token);
  assert.equal(toPenthouse.ok, true);
  assert.equal(toPenthouse.crib.homes[0].tier, 3);
  assert.equal(toPenthouse.crib.homes[0].tierName, "Penthouse");
  const top = await call("crib-upgrade", { home: "home-ny-01", server: 1 }, token);
  assert.equal(top.ok, false, "penthouse is the top tier");
  assert.equal(top.message, "Already a penthouse — the top tier.");
});

test("crib: walls + floors + lighting are bought per change and apply", async () => {
  const { token } = await guest("Decorator");
  await buyHome(token);
  const same = await call("crib-decor", { home: "home-ny-01", server: 1, wall: "cream" }, token);
  assert.equal(same.ok, false, "already cream");

  const painted = await call("crib-decor", { home: "home-ny-01", server: 1, wall: "gold", floor: "marble", light: "gold" }, token);
  assert.equal(painted.ok, true, painted.message);
  assert.equal(painted.crib.homes[0].decor.wall, "gold");
  assert.equal(painted.crib.homes[0].decor.floor, "marble");
  assert.equal(painted.crib.homes[0].decor.light, "gold");
  assert.equal(painted.me.balance, 60000 - 2300 - 80 - 150 - 70, "wall 80 + floor 150 + light 70");

  const unknown = await call("crib-decor", { home: "home-ny-01", server: 1, wall: "plaid" }, token);
  assert.equal(unknown.ok, false);
  const stranger = await call("crib-decor", { home: "home-ny-02", server: 1, wall: "gold" }, token);
  assert.equal(stranger.ok, false);
});

test("crib: TV toggles, lights toggle, crib rides on me", async () => {
  const { token } = await guest("Switcher");
  await buyHome(token);
  const tvOn = await call("crib-tv", { home: "home-ny-01", server: 1, on: true }, token);
  assert.equal(tvOn.ok, true, tvOn.message);
  assert.equal(tvOn.crib.homes[0].tvOn, true);
  assert.equal(tvOn.me.crib.homes[0].tvOn, true, "crib rides on every me");

  const lightsOff = await call("crib-lights", { home: "home-ny-01", server: 1, on: false }, token);
  assert.equal(lightsOff.ok, true);
  assert.equal(lightsOff.crib.homes[0].lightsOn, false);
  const lightsOn = await call("crib-lights", { home: "home-ny-01", server: 1, on: true }, token);
  assert.equal(lightsOn.ok, true);
  assert.equal(lightsOn.crib.homes[0].lightsOn, true);
  assert.equal(lightsOn.me.balance, 60000 - 2300, "toggles are free");
});
