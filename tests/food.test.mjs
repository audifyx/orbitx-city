// Regression test for FOOD: cooking, restaurants, gym, hunger (City Sol only).
//
// Storage: UNIFIED with the grocery piece — hunger + pantry live on the
// per-server save's `daily` blob (daily.hunger / daily.food, incl. the
// cooking ingredients the grocery store sells); stamina / cooked meals /
// Satisfied live in the existing `missions` JSON column under the
// reserved key "__food" — no new DB column. A cooked meal restores FAR
// more hunger than a raw snack (burger +40 vs bread +10). Hunger drains
// only on the client (1 per 150s of active play, food-hunger) — the
// server never drains it; stamina builds +2 per workout (5 City Sol,
// 30s cooldown) and decays 1 per 12h idle. Well fed you run fast
// (hunger >= 70: x1.10), starving you crawl (hunger 0: x0.70).
//
// Run: node --test api/food.test.mjs
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

async function newPlayer() {
  const id = `food-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const session = await call("session", { id, name: "FoodTester" });
  assert.equal(session.data.ok, true);
  const joined = await call("universe-join", { server: 1 }, session.data.token);
  assert.equal(joined.data.ok, true);
  return { id, token: session.data.token };
}

function foodSave(id) {
  const save = store().saves.get(`${id}:1`);
  assert.ok(save, "save minted on universe-join");
  return save;
}

function setFood(id, patch) {
  const save = foodSave(id);
  if (!save.missions || typeof save.missions !== "object") save.missions = {};
  save.missions.__food = { ...(save.missions.__food || {}), ...patch };
  return save;
}

// Hunger + pantry live on the save's daily blob (the unified model).
function setDaily(id, patch) {
  const save = foodSave(id);
  if (!save.daily || typeof save.daily !== "object") save.daily = {};
  Object.assign(save.daily, patch);
  return save;
}

test("food-status: a new player starts full, unfit, with a move-in pantry", async () => {
  const { id, token } = await newPlayer();
  const res = await call("food-status", { server: 1 }, token);
  assert.equal(res.data.ok, true);
  const food = res.data.food;
  assert.equal(food.hunger, 100);
  assert.equal(food.stamina, 20);
  assert.equal(food.pantry.bread, 2);
  assert.equal(food.pantry.patty, 2);
  assert.equal(food.fed, false);
  // Well fed (100) + a little stamina (20): 1.10 * 1.02 = 1.122.
  assert.equal(food.speedMult, 1.122);
  assert.equal(food.carryCap, 6);
  // The same food rides on every `me` (publicPlayer), so the HUD can read it.
  assert.equal(res.data.me.food.hunger, 100);
});

test("food-eat: a raw snack is +10, a cooked meal is +40 — cooking matters", async () => {
  const { id, token } = await newPlayer();
  setDaily(id, { hunger: 40, food: { bread: 1 } });
  const snack = await call("food-eat", { server: 1, item: "bread" }, token);
  assert.equal(snack.data.ok, true);
  assert.equal(snack.data.food.hunger, 50);
  assert.equal(snack.data.food.pantry.bread, undefined);
  // An empty pantry refuses.
  const empty = await call("food-eat", { server: 1, item: "bread" }, token);
  assert.equal(empty.data.ok, false);
  // A cooked burger (needs a home + ingredients — see the cook test) is +40.
  setDaily(id, { hunger: 40 });
  setFood(id, { meals: { "city-burger": 1 } });
  const meal = await call("food-eat", { server: 1, item: "city-burger" }, token);
  assert.equal(meal.data.ok, true);
  assert.equal(meal.data.food.hunger, 80);
  assert.equal(meal.data.food.meals.burger, undefined);
});

test("food-cook: needs a home, consumes groceries, respects the carry cap", async () => {
  const { id, token } = await newPlayer();
  // No home yet: the kitchen is in your own home.
  const homeless = await call("food-cook", { server: 1, recipe: "city-burger" }, token);
  assert.equal(homeless.data.ok, false);
  assert.match(homeless.data.message, /home/);
  // Buy the cheapest home, then cook.
  const bought = await call("buy-home", { server: 1, home: "home-ny-08" }, token);
  assert.equal(bought.data.ok, true);
  const cooked = await call("food-cook", { server: 1, recipe: "city-burger" }, token);
  assert.equal(cooked.data.ok, true);
  assert.equal(cooked.data.food.meals["city-burger"], 1);
  assert.equal(cooked.data.food.pantry.bread, 1);
  assert.equal(cooked.data.food.pantry.patty, 1);
  // Missing ingredient refuses and names it.
  setDaily(id, { food: { bread: 1 } });
  const missing = await call("food-cook", { server: 1, recipe: "city-burger" }, token);
  assert.equal(missing.data.ok, false);
  assert.match(missing.data.message, /Beef Patty/);
  // Carry cap: stamina 20 -> 6 meals max; a full bag refuses the 7th.
  setDaily(id, { food: { potato: 9 } });
  setFood(id, { meals: { fries: 6 } });
  const full = await call("food-cook", { server: 1, recipe: "fries" }, token);
  assert.equal(full.data.ok, false);
  assert.match(full.data.message, /arms are full/);
});

test("food-order: a restaurant meal costs City Sol, restores hunger, satisfies", async () => {
  const { id, token } = await newPlayer();
  setDaily(id, { hunger: 30 });
  const before = foodSave(id).balance;
  const res = await call("food-order", { server: 1, restaurant: "diner", item: "diner-burger" }, token);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.food.hunger, 65);
  assert.equal(res.data.food.fed, true);
  assert.equal(foodSave(id).balance, before - 12);
  assert.equal(res.data.me.balance, before - 12);
  // Unknown restaurant / item / broke all refuse.
  assert.equal((await call("food-order", { server: 1, restaurant: "nope", item: "diner-burger" }, token)).data.ok, false);
  assert.equal((await call("food-order", { server: 1, restaurant: "diner", item: "nope" }, token)).data.ok, false);
  foodSave(id).balance = 0;
  // Zero the global row too — ensureSave reconciles the save UP from it.
  store().players.get(id).balance = 0;
  assert.equal((await call("food-order", { server: 1, restaurant: "diner", item: "diner-burger" }, token)).data.ok, false);
});

test("food-workout: +2 stamina for 5 City Sol, 30s cooldown between sets", async () => {
  const { id, token } = await newPlayer();
  const before = foodSave(id).balance;
  const first = await call("food-workout", { server: 1, workout: "treadmill" }, token);
  assert.equal(first.data.ok, true);
  assert.equal(first.data.food.stamina, 22);
  assert.equal(foodSave(id).balance, before - 5);
  // Second set inside the cooldown refuses.
  const second = await call("food-workout", { server: 1, workout: "weights" }, token);
  assert.equal(second.data.ok, false);
  assert.match(second.data.message, /breath/);
  // Unknown workout refuses.
  assert.equal((await call("food-workout", { server: 1, workout: "nope" }, token)).data.ok, false);
});

test("hunger that matters: speed by hunger level, decay over real time", async () => {
  const { id, token } = await newPlayer();
  // Starving: 0.70 * 1.02 (stamina 20) = 0.714.
  setDaily(id, { hunger: 0 });
  setFood(id, { stamina: 20 });
  let res = await call("food-status", { server: 1 }, token);
  assert.equal(res.data.food.speedMult, 0.714);
  // Peckish: 0.85 * 1.02 = 0.867.
  setDaily(id, { hunger: 29 });
  setFood(id, { stamina: 20 });
  res = await call("food-status", { server: 1 }, token);
  assert.equal(res.data.food.speedMult, 0.867);
  // Maxed out: 1.10 * 1.10 = 1.21.
  setDaily(id, { hunger: 100 });
  setFood(id, { stamina: 100 });
  res = await call("food-status", { server: 1 }, token);
  assert.equal(res.data.food.speedMult, 1.21);
  // The server never drains hunger on its own (the client reports the
  // drain via food-hunger): 10 minutes of real time costs nothing here.
  setDaily(id, { hunger: 50 });
  res = await call("food-status", { server: 1 }, token);
  assert.equal(res.data.food.hunger, 50);
  // Stamina still decays with idle days: 25h idle at 1 per 12h is -2.
  const now = Date.now();
  setFood(id, { stamina: 20, lastWorkout: now - 25 * 60 * 60 * 1000, staminaAt: now - 25 * 60 * 60 * 1000 });
  res = await call("food-status", { server: 1 }, token);
  assert.equal(res.data.food.stamina, 18);
});

test("food state survives a save round-trip inside the missions column", async () => {
  const { id, token } = await newPlayer();
  setDaily(id, { hunger: 33, food: { bread: 3 } });
  setFood(id, { stamina: 44, meals: { "plaza-pizza": 2 } });
  const save = foodSave(id);
  const raw = JSON.parse(save.missions ? JSON.stringify(save.missions) : "{}");
  const daily = JSON.parse(save.daily ? JSON.stringify(save.daily) : "{}");
  assert.equal(daily.hunger, 33);
  assert.equal(daily.food.bread, 3);
  assert.equal(raw.__food.meals["plaza-pizza"], 2);
  // Hunger + pantry NO LONGER live in __food (unified model).
  assert.equal(raw.__food.hunger, undefined);
  assert.equal(raw.__food.pantry, undefined);
  // Missions still work beside it: the chain reads only its own ids.
  const list = await call("mission-list", { server: 1 }, token);
  assert.equal(list.data.ok, true);
  assert.ok(Array.isArray(list.data.missions));
});
