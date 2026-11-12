// Home furniture: shop + Edit Home (per-server homes, City Sol only).
// The shop sells furniture into save.homes.furnitureOwned; Edit Home
// saves placed pieces into save.homes.furniture[homeId] — both inside
// the existing homes JSON, no new column. A placed piece consumes one
// owned copy; selling one back refunds half price.
//
// Run: node --test api/furniture.test.mjs
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
  const id = `furn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const session = await call("session", { id, name: "furn-test" });
  assert.equal(session.data.ok, true);
  const token = session.data.token;
  const joined = await call("universe-join", { server }, token);
  assert.equal(joined.data.ok, true);
  // Starter balance is 60,000; the buy-home check below spends 2,300.
  return { id, token, save: store().saves.get(`${id}:${server}`) };
}

test("furniture-list with no save: catalog + empty inventory", async () => {
  const id = `furn-guest-${Date.now()}`;
  const session = await call("session", { id, name: "furn-guest" });
  const list = await call("furniture-list", { server: 1 }, session.data.token);
  assert.equal(list.data.ok, true);
  assert.equal(list.data.catalog.length, 14);
  assert.deepEqual(list.data.owned, []);
  assert.deepEqual(list.data.placed, {});
  assert.ok(list.data.catalog.some((item) => item.id === "tv" && item.price === 450));
});

test("buy, place, persist, sell-back — full flow on one server", async () => {
  const { token } = await playerOn(1);
  const bought = await call("buy-home", { home: "home-ny-01", server: 1 }, token);
  assert.equal(bought.data.ok, true, JSON.stringify(bought.data));
  const startBalance = bought.data.me.balance;

  const tv = await call("furniture-buy", { item: "tv", server: 1 }, token);
  assert.equal(tv.data.ok, true, JSON.stringify(tv.data));
  assert.equal(tv.data.me.balance, startBalance - 450);
  assert.deepEqual(tv.data.owned, ["tv"]);
  await call("furniture-buy", { item: "tv", server: 1 }, token);

  // Placing two TVs is fine (owns two); three is not.
  const two = [
    { id: "a", item: "tv", x: 1, z: 2, rot: 0 },
    { id: "b", item: "tv", x: 3, z: 4, rot: 1 },
  ];
  const saved = await call("furniture-save", { home: "home-ny-01", furniture: two, server: 1 }, token);
  assert.equal(saved.data.ok, true, JSON.stringify(saved.data));
  assert.equal(saved.data.placed.length, 2);

  const three = [...two, { id: "c", item: "tv", x: 5, z: 6, rot: 0 }];
  const over = await call("furniture-save", { home: "home-ny-01", furniture: three, server: 1 }, token);
  assert.equal(over.data.ok, false);
  assert.match(over.data.message, /only own 2/);

  // Placed pieces survive a fresh read — and the other server is empty.
  const list = await call("furniture-list", { server: 1 }, token);
  assert.equal(list.data.placed["home-ny-01"].length, 2);
  assert.equal(list.data.placed["home-ny-01"][0].item, "tv");
  const other = await call("furniture-list", { server: 2 }, token);
  assert.deepEqual(other.data.placed, {});

  // Cannot sell a copy while both are placed; unplace one, then sell.
  const blocked = await call("furniture-sell", { item: "tv", server: 1 }, token);
  assert.equal(blocked.data.ok, false);
  const unplaced = await call("furniture-save", { home: "home-ny-01", furniture: [two[0]], server: 1 }, token);
  assert.equal(unplaced.data.ok, true);
  const balanceBefore = unplaced.data.me.balance;
  const sold = await call("furniture-sell", { item: "tv", server: 1 }, token);
  assert.equal(sold.data.ok, true, JSON.stringify(sold.data));
  assert.equal(sold.data.refund, 225); // half of 450
  assert.equal(sold.data.me.balance, balanceBefore + 225);
  assert.deepEqual(sold.data.owned, ["tv"]);
});

test("cannot decorate a home you do not own; cannot buy broke or bogus", async () => {
  const { id, token } = await playerOn(1);
  const notOwned = await call("furniture-save", { home: "home-ny-02", furniture: [], server: 1 }, token);
  assert.equal(notOwned.data.ok, false);
  assert.match(notOwned.data.message, /only decorate a home you own/);

  const bogus = await call("furniture-buy", { item: "hover-throne", server: 1 }, token);
  assert.equal(bogus.data.ok, false);

  const save = store().saves.get(`${id}:1`);
  const player = store().players.get(id);
  // Zero both ledgers: ensureSave reconciles a low save UP to the global
  // balance, so the global row must be broke too for this check to bite.
  save.balance = 100;
  player.balance = 100;
  const broke = await call("furniture-buy", { item: "tv", server: 1 }, token);
  assert.equal(broke.data.ok, false);
  assert.match(broke.data.message, /Not enough City Sol/);

  const sellNone = await call("furniture-sell", { item: "couch", server: 1 }, token);
  assert.equal(sellNone.data.ok, false);
});
