// Car rentals (0.5 City Sol/day, paid up front) — drives the real POST
// handler against the in-memory backend (no Supabase/Neon/Redis env set),
// so this never touches a live database.
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Renter") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  assert.equal(session.storage, "This server memory", "test must run on the memory backend, never live Supabase");
  return { token: session.token, id: session.me.id, balance: session.me.balance };
}

function saveFor(playerId, server = 1) {
  return globalThis.__orbitx.saves.get(`${playerId}:${server}`);
}

test("rent-car: 2 days costs 1 City Sol, car is drivable via me.rental", async () => {
  const { token, id, balance } = await guest();
  assert.equal(balance, 60000);

  const tooShort = await call("rent-car", { id: "city-sedan", color: "black", days: 1, server: 1 }, token);
  assert.equal(tooShort.ok, false);
  assert.match(tooShort.message, /2–30 days/);

  const unknown = await call("rent-car", { id: "nope", days: 2, server: 1 }, token);
  assert.equal(unknown.ok, false);

  const rented = await call("rent-car", { id: "city-sedan", color: "black", days: 2, server: 1 }, token);
  assert.equal(rented.ok, true, rented.message);
  assert.equal(rented.rental.id, "city-sedan");
  assert.equal(rented.rental.days, 2);
  assert.equal(rented.rental.daysLeft, 2);
  assert.equal(rented.me.balance, 59999, "2 days at 0.5/day = 1 City Sol");
  assert.equal(rented.me.rental.id, "city-sedan");

  // The rental survives as JSON (what rowFromSave stores) and is NOT an owned car.
  const raw = saveFor(id, 1);
  assert.equal(raw.rental.id, "city-sedan");
  assert.deepEqual(JSON.parse(JSON.stringify(raw.rental)), raw.rental);
  assert.equal(raw.vehicles.length, 0, "a rental must not add to owned vehicles");
  assert.equal(raw.activeVehicle, null, "a rental must not steal activeVehicle");

  const status = await call("rental-status", { server: 1 }, token);
  assert.equal(status.ok, true);
  assert.equal(status.rental.id, "city-sedan");
  assert.equal(status.rental.daysLeft, 2);

  // One rental at a time.
  const second = await call("rent-car", { id: "city-compact", days: 2, server: 1 }, token);
  assert.equal(second.ok, false);
  assert.match(second.message, /already have .* rented/);

  const returned = await call("return-rental", { server: 1 }, token);
  assert.equal(returned.ok, true);
  assert.equal(returned.rental, null);
  assert.equal(returned.me.balance, 59999, "no refund — paid up front");

  const after = await call("rental-status", { server: 1 }, token);
  assert.equal(after.ok, true);
  assert.equal(after.rental, null);
  assert.equal(saveFor(id, 1).rental, null);

  const noneLeft = await call("return-rental", { server: 1 }, token);
  assert.equal(noneLeft.ok, false);
});

test("rent-car: owned cars cannot be rented; expiry clears the save", async () => {
  const { token, id } = await guest("Owner");
  const bought = await call("buy-car", { id: "city-compact", color: "white", server: 1 }, token);
  assert.equal(bought.ok, true, bought.message);
  assert.equal(bought.me.balance, 59780, "60000 - 220 for the compact");

  const rentOwned = await call("rent-car", { id: "city-compact", days: 2, server: 1 }, token);
  assert.equal(rentOwned.ok, false);
  assert.match(rentOwned.message, /already own/);

  // 7 days at 0.5/day = 3 City Sol (rounds down, never over 0.5/day).
  const rented = await call("rent-car", { id: "city-sedan", days: 7, server: 1 }, token);
  assert.equal(rented.ok, true, rented.message);
  assert.equal(rented.me.balance, 59777);

  // Age the rental past its paid days: the next status call clears it.
  saveFor(id, 1).rental.expiresAt = Date.now() - 1000;
  const expired = await call("rental-status", { server: 1 }, token);
  assert.equal(expired.ok, true);
  assert.equal(expired.rental, null);
  assert.equal(saveFor(id, 1).rental, null, "expired rental is cleared from the save");
  assert.equal(expired.me.balance, 59777, "expiry never refunds or charges");
});

test("rent-car: insufficient balance is refused", async () => {
  const { token, id } = await guest("Broke");
  // Rent + return once so the per-server save exists, then drain it.
  const first = await call("rent-car", { id: "city-sedan", days: 2, server: 1 }, token);
  assert.equal(first.ok, true, first.message);
  const returned = await call("return-rental", { server: 1 }, token);
  assert.equal(returned.ok, true);
  // Drain BOTH ledgers: the Sol fix's ensureSave reconciles a save below
  // the global row back up to the global, so draining only the save is
  // refilled on the next op. A genuinely broke player has 0 in both.
  saveFor(id, 1).balance = 0;
  globalThis.__orbitx.players.get(id).balance = 0;
  const rented = await call("rent-car", { id: "city-sedan", days: 2, server: 1 }, token);
  assert.equal(rented.ok, false);
  assert.match(rented.message, /Not enough City Sol/);
});

test("sync heartbeat: me carries the live rental and owned cars (overlay)", async () => {
  const { token, id } = await guest("Syncer");
  const bought = await call("buy-car", { id: "city-compact", color: "white", server: 1 }, token);
  assert.equal(bought.ok, true, bought.message);
  const rented = await call("rent-car", { id: "city-sedan", days: 2, server: 1 }, token);
  assert.equal(rented.ok, true, rented.message);

  // The 250ms sync heartbeat overwrites world.me, and the client's
  // applyMe() copies it into local state — so the sync's `me` must carry
  // the per-server garage data, or the rental and the owned cars are
  // wiped from the client seconds after renting/buying (the car entity
  // stays spawned and drivable, the rental line vanishes, and the
  // rental's client-side expiry never fires).
  const sync = await call("sync", { server: 1, state: { x: 77.6, y: 0, z: 54, yaw: 1.57 } }, token);
  assert.equal(sync.ok, true, sync.message);
  assert.equal(sync.me.rental.id, "city-sedan", "sync me must carry the live rental");
  assert.equal(sync.me.rental.daysLeft, 2);
  assert.deepEqual(sync.me.vehicles, [{ id: "city-compact", color: "white" }]);
  assert.equal(sync.me.activeVehicle, "city-compact");

  // An expired rental is cleared by the sync's overlay too (server-side).
  saveFor(id, 1).rental.expiresAt = Date.now() - 1000;
  const after = await call("sync", { server: 1, state: { x: 77.6, y: 0, z: 54, yaw: 1.57 } }, token);
  assert.equal(after.ok, true);
  assert.equal(after.me.rental, null);
  assert.equal(saveFor(id, 1).rental, null);
});

test("rental-status: no save yet is a clean null, not an error", async () => {
  const { token } = await guest("Fresh");
  const status = await call("rental-status", { server: 3 }, token);
  assert.equal(status.ok, true);
  assert.equal(status.rental, null);
});
