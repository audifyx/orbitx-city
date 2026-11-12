// CARS expansion: customize / wash + repair / garage upgrades — drives the
// real POST handler against the in-memory backend (no Supabase/Neon/Redis
// env set), so this never touches a live database.
//
// Storage under test (no new DB column):
// - per-car mods + wear live on the owned-vehicle entry inside the
//   existing save.vehicles JSON: { id, color, mods, dirt, damage }
// - garage upgrades live on save.homes.garage: { slots, workshop, showroom }
//
// Run: node --test api/city-cars.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "./city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Driver") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  assert.equal(session.storage, "This server memory", "test must run on the memory backend, never live Supabase");
  return { token: session.token, id: session.me.id, balance: session.me.balance };
}

function saveFor(playerId, server = 1) {
  return globalThis.__orbitx.saves.get(`${playerId}:${server}`);
}

async function buy(token, id, color = "black") {
  const res = await call("buy-car", { id, color, server: 1 }, token);
  assert.equal(res.ok, true, res.message);
  return res;
}

test("garage cap: 3 cars fit, the 4th is refused until parking is expanded", async () => {
  const { token, id } = await guest("Capped");
  await buy(token, "city-compact", "white"); // 220
  await buy(token, "city-sedan", "black"); // 450
  await buy(token, "city-suv", "red"); // 900
  assert.equal(saveFor(id, 1).vehicles.length, 3);

  const full = await call("buy-car", { id: "city-truck", color: "blue", server: 1 }, token);
  assert.equal(full.ok, false);
  assert.match(full.message, /garage is full \(3\/3 cars\)/);

  // Slots tier 1: 800 City Sol, cap 3 -> 5.
  const slots = await call("upgrade-garage", { upgrade: "slots", server: 1 }, token);
  assert.equal(slots.ok, true, slots.message);
  assert.equal(slots.me.balance, 60000 - 220 - 450 - 900 - 800);
  assert.equal(slots.me.garage.slots, 1);

  const fourth = await buy(token, "city-truck", "blue"); // 1400
  assert.equal(fourth.me.balance, 60000 - 220 - 450 - 900 - 800 - 1400);
  assert.equal(saveFor(id, 1).vehicles.length, 4);
  assert.equal(saveFor(id, 1).homes.garage.slots, 1, "garage upgrades persist on save.homes.garage");
});

test("customize: paint / rims / neon / tint charge the listed price and stick", async () => {
  const { token, id } = await guest("Painter");
  await buy(token, "city-sedan", "black"); // 450

  const paint = await call("customize-car", { id: "city-sedan", mod: "paint", value: "matte-black", server: 1 }, token);
  assert.equal(paint.ok, true, paint.message);
  assert.equal(paint.me.balance, 60000 - 450 - 150);
  assert.equal(saveFor(id, 1).vehicles[0].color, "matte-black");

  // A free shop colour is not a premium paint — repainting goes through buy-car.
  const freePaint = await call("customize-car", { id: "city-sedan", mod: "paint", value: "red", server: 1 }, token);
  assert.equal(freePaint.ok, false);
  assert.match(freePaint.message, /free in the shop/);

  const rims = await call("customize-car", { id: "city-sedan", mod: "rims", value: "gold", server: 1 }, token);
  assert.equal(rims.ok, true, rims.message);
  const neon = await call("customize-car", { id: "city-sedan", mod: "neon", value: "pink", server: 1 }, token);
  assert.equal(neon.ok, true, neon.message);
  const tint = await call("customize-car", { id: "city-sedan", mod: "tint", value: 2, server: 1 }, token);
  assert.equal(tint.ok, true, tint.message);
  assert.equal(tint.me.balance, 60000 - 450 - 150 - 300 - 220 - 140);

  const entry = saveFor(id, 1).vehicles[0];
  assert.deepEqual(entry.mods, { rims: "gold", spoiler: "none", neon: "pink", tint: 2, engine: 0, tires: 0 });

  // Re-fitting the same mod is refused, not charged twice.
  const again = await call("customize-car", { id: "city-sedan", mod: "rims", value: "gold", server: 1 }, token);
  assert.equal(again.ok, false);
  assert.equal(saveFor(id, 1).balance, 60000 - 450 - 150 - 300 - 220 - 140);

  // Unknown car / unknown mod / bad value are all refused.
  assert.equal((await call("customize-car", { id: "city-suv", mod: "rims", value: "gold", server: 1 }, token)).ok, false);
  assert.equal((await call("customize-car", { id: "city-sedan", mod: "warp", value: 1, server: 1 }, token)).ok, false);
  assert.equal((await call("customize-car", { id: "city-sedan", mod: "rims", value: "diamond", server: 1 }, token)).ok, false);
});

test("customize: engine / tires buy in order; top stage needs the workshop", async () => {
  const { token, id } = await guest("Tuner");
  await buy(token, "city-sports", "red"); // 2800

  const skip = await call("customize-car", { id: "city-sports", mod: "engine", value: 2, server: 1 }, token);
  assert.equal(skip.ok, false);
  assert.match(skip.message, /in order/);

  const stage1 = await call("customize-car", { id: "city-sports", mod: "engine", value: 1, server: 1 }, token);
  assert.equal(stage1.ok, true, stage1.message);
  const stage2 = await call("customize-car", { id: "city-sports", mod: "engine", value: 2, server: 1 }, token);
  assert.equal(stage2.ok, true, stage2.message);
  assert.equal(saveFor(id, 1).vehicles[0].mods.engine, 2);

  // Stage 3 without a workshop is refused.
  const stage3 = await call("customize-car", { id: "city-sports", mod: "engine", value: 3, server: 1 }, token);
  assert.equal(stage3.ok, false);
  assert.match(stage3.message, /workshop/);

  // Tires level 2 (Race) also needs the workshop; level 1 does not.
  const tiresSkip = await call("customize-car", { id: "city-sports", mod: "tires", value: 2, server: 1 }, token);
  assert.equal(tiresSkip.ok, false);
  const tires1 = await call("customize-car", { id: "city-sports", mod: "tires", value: 1, server: 1 }, token);
  assert.equal(tires1.ok, true, tires1.message);

  const workshop = await call("upgrade-garage", { upgrade: "workshop", server: 1 }, token);
  assert.equal(workshop.ok, true, workshop.message);
  assert.equal(workshop.me.garage.workshop, true);

  const stage3b = await call("customize-car", { id: "city-sports", mod: "engine", value: 3, server: 1 }, token);
  assert.equal(stage3b.ok, true, stage3b.message);
  const tires2 = await call("customize-car", { id: "city-sports", mod: "tires", value: 2, server: 1 }, token);
  assert.equal(tires2.ok, true, tires2.message);
  assert.equal(tires2.me.balance, 60000 - 2800 - 600 - 1400 - 350 - 1500 - 2600 - 800);
  assert.deepEqual(saveFor(id, 1).vehicles[0].mods.engine, 3);
  assert.deepEqual(saveFor(id, 1).vehicles[0].mods.tires, 2);
});

test("wear: driving dirties, crashes damage; wash / repair price from wear and restore", async () => {
  const { token, id } = await guest("Dirty");
  await buy(token, "city-sedan", "black"); // 450

  // 600 units driven = +10 dirt; 2 crashes = +8 damage.
  const sync = await call("sync-vehicle-wear", { id: "city-sedan", distance: 600, crashes: 2, server: 1 }, token);
  assert.equal(sync.ok, true, sync.message);
  assert.equal(sync.vehicle.dirt, 10);
  assert.equal(sync.vehicle.damage, 8);
  assert.equal(saveFor(id, 1).vehicles[0].dirt, 10);

  // Wash: 30 + dirt = 40. Repair: 50 + 2*damage = 66.
  const wash = await call("wash-car", { id: "city-sedan", server: 1 }, token);
  assert.equal(wash.ok, true, wash.message);
  assert.equal(wash.me.balance, 60000 - 450 - 40);
  assert.equal(saveFor(id, 1).vehicles[0].dirt, 0);
  const cleanAgain = await call("wash-car", { id: "city-sedan", server: 1 }, token);
  assert.equal(cleanAgain.ok, false);
  assert.match(cleanAgain.message, /Already clean/);

  const repair = await call("repair-car", { id: "city-sedan", server: 1 }, token);
  assert.equal(repair.ok, true, repair.message);
  assert.equal(repair.me.balance, 60000 - 450 - 40 - 66);
  assert.equal(saveFor(id, 1).vehicles[0].damage, 0);
  assert.equal((await call("repair-car", { id: "city-sedan", server: 1 }, token)).ok, false);

  // Wear reports are clamped: a 999999-unit report cannot max the dirt.
  await call("sync-vehicle-wear", { id: "city-sedan", distance: 999999, crashes: 999, server: 1 }, token);
  const entry = saveFor(id, 1).vehicles[0];
  assert.equal(entry.dirt, 83, "5000 clamped distance = +83 dirt");
  assert.equal(entry.damage, 100, "25 clamped crashes = +100 damage");
});

test("workshop: 25% off wash + repair once installed", async () => {
  const { token } = await guest("Washer");
  await buy(token, "city-sedan", "black"); // 450
  await call("sync-vehicle-wear", { id: "city-sedan", distance: 600, crashes: 2, server: 1 }, token);
  await call("upgrade-garage", { upgrade: "workshop", server: 1 }, token); // 1500
  // Wash 40 -> 30, repair 66 -> 50 (rounded) with the workshop discount.
  const wash = await call("wash-car", { id: "city-sedan", server: 1 }, token);
  assert.equal(wash.ok, true, wash.message);
  assert.equal(wash.me.balance, 60000 - 450 - 1500 - 30);
  const repair = await call("repair-car", { id: "city-sedan", server: 1 }, token);
  assert.equal(repair.ok, true, repair.message);
  assert.equal(repair.me.balance, 60000 - 450 - 1500 - 30 - 50);
});

test("garage upgrades: slots tiers in order, workshop / showroom once-only", async () => {
  const { token, id } = await guest("Upgrader");
  await buy(token, "city-compact", "white");

  // Slots: 800, then 1800, then 3200, then maxed.
  assert.equal((await call("upgrade-garage", { upgrade: "slots", server: 1 }, token)).me.garage.slots, 1);
  assert.equal((await call("upgrade-garage", { upgrade: "slots", server: 1 }, token)).me.garage.slots, 2);
  assert.equal((await call("upgrade-garage", { upgrade: "slots", server: 1 }, token)).me.garage.slots, 3);
  const maxed = await call("upgrade-garage", { upgrade: "slots", server: 1 }, token);
  assert.equal(maxed.ok, false);

  const showroom = await call("upgrade-garage", { upgrade: "showroom", server: 1 }, token);
  assert.equal(showroom.ok, true, showroom.message);
  assert.equal(showroom.me.garage.showroom, true);
  assert.equal((await call("upgrade-garage", { upgrade: "showroom", server: 1 }, token)).ok, false);
  assert.equal((await call("upgrade-garage", { upgrade: "bogus", server: 1 }, token)).ok, false);

  // Balances: 60000 - 220 - 800 - 1800 - 3200 - 2500.
  assert.equal(saveFor(id, 1).balance, 60000 - 220 - 800 - 1800 - 3200 - 2500);
  assert.deepEqual(saveFor(id, 1).homes.garage, { slots: 3, workshop: false, showroom: true });
});

test("sync heartbeat: me carries mods, wear and garage (overlay)", async () => {
  const { token, id } = await guest("Syncer2");
  await buy(token, "city-sedan", "black");
  await call("customize-car", { id: "city-sedan", mod: "rims", value: "sport", server: 1 }, token);
  await call("sync-vehicle-wear", { id: "city-sedan", distance: 120, crashes: 1, server: 1 }, token);
  await call("upgrade-garage", { upgrade: "showroom", server: 1 }, token);

  const sync = await call("sync", { server: 1, state: { x: 77.6, y: 0, z: 54, yaw: 1.57 } }, token);
  assert.equal(sync.ok, true, sync.message);
  assert.equal(sync.me.vehicles.length, 1);
  assert.equal(sync.me.vehicles[0].mods.rims, "sport");
  assert.equal(sync.me.vehicles[0].dirt, 2);
  assert.equal(sync.me.vehicles[0].damage, 4);
  assert.equal(sync.me.garage.showroom, true);
  assert.equal(sync.me.homes.garage.showroom, true);

  const me = await call("me", { server: 1 }, token);
  assert.equal(me.ok, true);
  assert.equal(me.me.vehicles[0].mods.rims, "sport");
  assert.equal(me.me.garage.showroom, true);
});
