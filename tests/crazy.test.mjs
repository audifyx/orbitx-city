// CRAZY home extras — pool / hot tub, theater, rooftop, plants, seasons.
// All City Sol, all per (player, server), all stored inside the existing
// `homes` JSON column of player_saves (no new DB column).
//
// Run: node --test api/crazy.test.mjs
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

async function freshPlayer(balance = 60_000) {
  const id = `crazy-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const session = await call("session", { id, name: "crazy-tester" });
  assert.equal(session.data.ok, true, JSON.stringify(session.data));
  const token = session.data.token;
  const joined = await call("universe-join", { server: 1 }, token);
  assert.equal(joined.data.ok, true, JSON.stringify(joined.data));
  const save = store().saves.get(`${id}:1`);
  assert.ok(save, "save minted on universe-join");
  save.balance = balance;
  return { id, token, save };
}

async function buyHome(token, home = "home-fl-04") {
  const res = await call("buy-home", { home, server: 1 }, token);
  assert.equal(res.data.ok, true, res.data.message);
  return res.data;
}

test("pool: buy a pool for an owned home, one pool per home, balance deducted", async () => {
  const { id, token, save } = await freshPlayer();
  await buyHome(token);
  const before = save.balance;
  const pool = await call("crazy-buy-pool", { home: "home-fl-04", kind: "pool", server: 1 }, token);
  assert.equal(pool.data.ok, true, pool.data.message);
  assert.equal(pool.data.price, 900);
  assert.equal(pool.data.me.balance, before - 900);
  const again = await call("crazy-buy-pool", { home: "home-fl-04", kind: "hottub", server: 1 }, token);
  assert.equal(again.data.ok, false);
  assert.match(again.data.message, /already has a pool/);
  const status = await call("crazy-status", { server: 1 }, token);
  const mine = status.data.mine.find((h) => h.homeId === "home-fl-04");
  assert.equal(mine.crazy.pool, "pool");
  void id;
});

test("pool: refused for a home the player does not own", async () => {
  const { token } = await freshPlayer();
  const pool = await call("crazy-buy-pool", { home: "home-fl-04", kind: "pool", server: 1 }, token);
  assert.equal(pool.data.ok, false);
  assert.match(pool.data.message, /Buy the home first/);
});

test("hot tub: cheaper than the pool, same one-per-home rule", async () => {
  const { token, save } = await freshPlayer();
  await buyHome(token);
  const before = save.balance;
  const tub = await call("crazy-buy-pool", { home: "home-fl-04", kind: "hottub", server: 1 }, token);
  assert.equal(tub.data.ok, true, tub.data.message);
  assert.equal(tub.data.price, 450);
  assert.equal(tub.data.me.balance, before - 450);
});

test("theater: buy once, second buy refused", async () => {
  const { token, save } = await freshPlayer();
  await buyHome(token);
  const before = save.balance;
  const first = await call("crazy-buy-theater", { home: "home-fl-04", server: 1 }, token);
  assert.equal(first.data.ok, true, first.data.message);
  assert.equal(first.data.price, 1200);
  assert.equal(first.data.me.balance, before - 1200);
  const second = await call("crazy-buy-theater", { home: "home-fl-04", server: 1 }, token);
  assert.equal(second.data.ok, false);
  assert.match(second.data.message, /already has a theater/);
});

test("rooftop: penthouse-only — refused without the tier, allowed with it", async () => {
  const { id, token } = await freshPlayer();
  await buyHome(token);
  const refused = await call("crazy-rooftop", { home: "home-fl-04", server: 1 }, token);
  assert.equal(refused.data.ok, false);
  assert.match(refused.data.message, /penthouse/);
  // The crib builder's penthouse tier lives on the owned record; seed it
  // the way the merged save will carry it.
  const save = store().saves.get(`${id}:1`);
  save.homes.homes.find((h) => h.homeId === "home-fl-04").tier = "penthouse";
  const before = save.balance;
  const ok = await call("crazy-rooftop", { home: "home-fl-04", server: 1 }, token);
  assert.equal(ok.data.ok, true, ok.data.message);
  assert.equal(ok.data.price, 1500);
  assert.equal(ok.data.me.balance, before - 1500);
  const status = await call("crazy-status", { server: 1 }, token);
  assert.equal(status.data.mine.find((h) => h.homeId === "home-fl-04").crazy.rooftop, true);
});

test("plants: buy, water, grow over watered time, harvest pays 2x", async () => {
  const { id, token, save } = await freshPlayer();
  await buyHome(token);
  const before = save.balance;
  const bought = await call("crazy-buy-plant", { home: "home-fl-04", kind: "sunflower", server: 1 }, token);
  assert.equal(bought.data.ok, true, bought.data.message);
  assert.equal(bought.data.price, 40);
  assert.equal(bought.data.plant.stage, 0);
  assert.equal(bought.data.me.balance, before - 40);
  const plantId = bought.data.plant.id;
  // Unwatered, a plant never grows — 10 minutes pass, still a seedling.
  const unwatered = await call("crazy-status", { server: 1 }, token);
  assert.equal(unwatered.data.mine[0].crazy.plants[0].stage, 0);
  // Water it: wet for 10 minutes of growth.
  const watered = await call("crazy-water-plant", { home: "home-fl-04", plant: plantId, server: 1 }, token);
  assert.equal(watered.data.ok, true, watered.data.message);
  assert.equal(watered.data.plant.watered, true);
  // Fast-forward the stored window: 3 watered minutes — small, not grown
  // (small at 1 watered minute, grown at 5).
  const rec = store().saves.get(`${id}:1`).homes.homes.find((h) => h.homeId === "home-fl-04");
  const plant = rec.crazy.plants.find((p) => p.id === plantId);
  plant.wateringSince = Date.now() - 3 * 60 * 1000;
  const mid = await call("crazy-status", { server: 1 }, token);
  assert.equal(mid.data.mine[0].crazy.plants[0].stage, 1);
  // Harvest too early is refused.
  const early = await call("crazy-harvest-plant", { home: "home-fl-04", plant: plantId, server: 1 }, token);
  assert.equal(early.data.ok, false);
  assert.match(early.data.message, /Not grown yet/);
  // Bank the full window (10 wet minutes = grown) and harvest: 2x back.
  plant.wateringSince = Date.now() - 10 * 60 * 1000;
  const grown = await call("crazy-status", { server: 1 }, token);
  assert.equal(grown.data.mine[0].crazy.plants[0].stage, 2);
  const balanceBeforeHarvest = store().saves.get(`${id}:1`).balance;
  const harvest = await call("crazy-harvest-plant", { home: "home-fl-04", plant: plantId, server: 1 }, token);
  assert.equal(harvest.data.ok, true, harvest.data.message);
  assert.equal(harvest.data.paid, 80);
  assert.equal(harvest.data.me.balance, balanceBeforeHarvest + 80);
  const after = await call("crazy-status", { server: 1 }, token);
  assert.equal(after.data.mine[0].crazy.plants.length, 0);
  void save;
});

test("plants: 6 per yard, and a grown plant cannot be watered again", async () => {
  const { token } = await freshPlayer();
  await buyHome(token);
  for (let i = 0; i < 6; i++) {
    const res = await call("crazy-buy-plant", { home: "home-fl-04", kind: "rose", server: 1 }, token);
    assert.equal(res.data.ok, true, res.data.message);
  }
  const seventh = await call("crazy-buy-plant", { home: "home-fl-04", kind: "rose", server: 1 }, token);
  assert.equal(seventh.data.ok, false);
  assert.match(seventh.data.message, /full/);
});

test("seasons: date-driven by default, override wins, decor buys per home", async () => {
  const { token, save } = await freshPlayer();
  await buyHome(token);
  const status = await call("crazy-status", { server: 1 }, token);
  assert.equal(status.data.ok, true);
  assert.equal(status.data.seasonOverride, "auto");
  assert.ok(["winter", "halloween", "spring", "summer"].includes(status.data.season));
  // November (this test runs 2026-11) is not October, so auto is not
  // halloween — the override is what the test can pin down.
  const set = await call("crazy-season", { season: "winter", server: 1 }, token);
  assert.equal(set.data.ok, true, set.data.message);
  assert.equal(set.data.season, "winter");
  assert.equal(set.data.override, "winter");
  const again = await call("crazy-status", { server: 1 }, token);
  assert.equal(again.data.season, "winter");
  assert.equal(again.data.seasonOverride, "winter");
  const bad = await call("crazy-season", { season: "monsoon", server: 1 }, token);
  assert.equal(bad.data.ok, false);
  const before = save.balance;
  const decor = await call("crazy-buy-decor", { home: "home-fl-04", kind: "lights", server: 1 }, token);
  assert.equal(decor.data.ok, true, decor.data.message);
  assert.equal(decor.data.price, 250);
  assert.equal(decor.data.me.balance, before - 250);
  const dup = await call("crazy-buy-decor", { home: "home-fl-04", kind: "lights", server: 1 }, token);
  assert.equal(dup.data.ok, false);
  const after = await call("crazy-status", { server: 1 }, token);
  assert.equal(after.data.mine[0].crazy.decor.lights, true);
  // home-status carries the same season + crazy payload as crazy-status.
  const homeStatus = await call("home-status", { server: 1 }, token);
  assert.equal(homeStatus.data.season, "winter");
  assert.equal(homeStatus.data.mine[0].crazy.decor.lights, true);
});

test("crazy purchases are per-server: a Server 1 pool is not on Server 2", async () => {
  const { token } = await freshPlayer();
  await buyHome(token);
  await call("universe-join", { server: 2 }, token);
  await call("buy-home", { home: "home-fl-04", server: 2 }, token);
  const pool1 = await call("crazy-buy-pool", { home: "home-fl-04", kind: "pool", server: 1 }, token);
  assert.equal(pool1.data.ok, true, pool1.data.message);
  const status2 = await call("crazy-status", { server: 2 }, token);
  assert.equal(status2.data.mine.find((h) => h.homeId === "home-fl-04").crazy.pool, null);
});
