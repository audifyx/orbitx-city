// Home Workshop (2D editor): per-room finishes + the 2D↔3D single source
// of truth. The 2D plan and the 3D world both read the same stored layout:
// per-room finishes live in crib.decor.rooms, placed furniture (with x/z/
// rot) lives in save.homes.furniture[homeId]. Saving from the workshop
// goes through the existing crib-decor / home-theme / furniture-save ops —
// no second layout format. A one-tap theme is a whole-home preset, so it
// clears per-room finishes.
//
// Run: SOL_USD=100 node --test tests/workshop.test.mjs
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
  return { status: res.status, data: await res.json() };
}

function store() {
  return globalThis.__orbitx;
}

async function playerOn(server = 1) {
  const id = `ws-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const session = await call("session", { id, name: "ws-test" });
  assert.equal(session.data.ok, true);
  const token = session.data.token;
  const joined = await call("universe-join", { server }, token);
  assert.equal(joined.data.ok, true);
  return { id, token, save: store().saves.get(`${id}:${server}`) };
}

async function ownedHome(token, home = "home-ny-01", server = 1) {
  const bought = await call("buy-home", { home, server }, token);
  assert.equal(bought.data.ok, true, JSON.stringify(bought.data));
  return bought.data.me.balance;
}

function cribHome(crib, homeId) {
  const found = (crib.homes || []).find((entry) => entry.homeId === homeId);
  assert.ok(found, `home ${homeId} missing from crib`);
  return found;
}

test("workshop: per-room finishes save, charge half price, and load back", async () => {
  const { token } = await playerOn(1);
  const startBalance = await ownedHome(token);
  // Sunset wall whole-home is 70 → one room costs max(25, round(70/2/5)*5)=35.
  // Tile floor whole-home is 110 → one room costs round(110/2/5)*5=55.
  const decor = await call("crib-decor", {
    home: "home-ny-01", server: 1,
    rooms: { living: { wall: "sunset" }, kitchen: { floor: "tile" } },
  }, token);
  assert.equal(decor.data.ok, true, JSON.stringify(decor.data));
  assert.equal(decor.data.me.balance, startBalance - 90);

  const status = await call("crib-status", { server: 1 }, token);
  const home = cribHome(status.data.crib, "home-ny-01");
  // Rooms store the full effective finish (unchanged fields inherit the
  // whole-home finish) — that is what the 2D plan renders per room.
  assert.deepEqual(home.decor.rooms, {
    living: { wall: "sunset", floor: "wood" },
    kitchen: { wall: "cream", floor: "tile" },
  });
  // Whole-home finishes are untouched by the per-room patch.
  assert.equal(home.decor.wall, "cream");
  assert.equal(home.decor.floor, "wood");

  // Unknown room / unknown colour are refused, and nothing is charged.
  const bogusRoom = await call("crib-decor", { home: "home-ny-01", server: 1, rooms: { attic: { wall: "red" } } }, token);
  assert.equal(bogusRoom.data.ok, false);
  assert.match(bogusRoom.data.message, /Unknown room/);
  const bogusWall = await call("crib-decor", { home: "home-ny-01", server: 1, rooms: { living: { wall: "hover-paint" } } }, token);
  assert.equal(bogusWall.data.ok, false);
  assert.match(bogusWall.data.message, /Unknown wall colour/);
  const after = await call("crib-status", { server: 1 }, token);
  assert.equal(after.data.me.balance, startBalance - 90);
});

test("workshop: a one-tap theme clears per-room finishes", async () => {
  const { token } = await playerOn(1);
  await ownedHome(token);
  const decor = await call("crib-decor", {
    home: "home-ny-01", server: 1, rooms: { bedroom: { wall: "forest", floor: "tile" } },
  }, token);
  assert.equal(decor.data.ok, true, JSON.stringify(decor.data));
  const themed = await call("home-theme", { home: "home-ny-01", theme: "neon", server: 1 }, token);
  assert.equal(themed.data.ok, true, JSON.stringify(themed.data));
  const status = await call("crib-status", { server: 1 }, token);
  const home = cribHome(status.data.crib, "home-ny-01");
  assert.equal(home.decor.rooms, undefined);
  assert.equal(home.decor.wall, "black");
  assert.equal(home.style.exterior, "neon");
});

test("workshop: 2D plan and 3D world read the same placed layout", async () => {
  const { token } = await playerOn(1);
  await ownedHome(token);
  // Buy two workshop pieces, then place them from the 2D plan (x/z/rot).
  const shelf = await call("furniture-buy", { item: "bookshelf", server: 1 }, token);
  assert.equal(shelf.data.ok, true, JSON.stringify(shelf.data));
  const table = await call("furniture-buy", { item: "pool-table", server: 1 }, token);
  assert.equal(table.data.ok, true, JSON.stringify(table.data));

  const plan = [
    { id: "a", item: "bookshelf", x: -936, z: 36, rot: 1 },
    { id: "b", item: "pool-table", x: -932, z: 38, rot: 2 },
  ];
  const saved = await call("furniture-save", { home: "home-ny-01", furniture: plan, server: 1 }, token);
  assert.equal(saved.data.ok, true, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.placed, plan);

  // A fresh read returns the exact same layout — this is what the 2D
  // plan renders and what the 3D home renders. No drift, no clamping.
  const list = await call("furniture-list", { server: 1 }, token);
  assert.deepEqual(list.data.placed["home-ny-01"], plan);
  const synced = await call("sync", { state: { x: -936, y: 0, z: 36, yaw: 0 }, server: 1 }, token);
  assert.deepEqual(synced.data.me.homes.furniture["home-ny-01"], plan);
});
