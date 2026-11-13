// Save-persistence regression test for the Nov 2026 vehicle-disappeared bug.
//
// Root cause: the live Supabase schema lagged behind the code —
// player_saves lacked `missions` and `trail`, players lacked `trail` —
// so every saveSave / savePlayer upsert failed with PostgREST PGRST204
// and the old retry stripped a hardcoded list that included `vehicles`,
// `homes`, `rental`, `last_seen` (saves) and `home_server` (players).
// A bought vehicle was charged but never stored; home_server stayed
// NULL forever; last_seen never advanced.
//
// The test drives the real POST handler against a fake Supabase client
// that enforces the PRE-migration schema exactly like real PostgREST
// (unknown column -> PGRST204 "Could not find the 'x' column ... in the
// schema cache"), and asserts a bought vehicle, the garage, last_seen
// and home_server all persist. On the old code this test FAILS
// (vehicles stays "[]"); on the fixed code it passes.
//
// Run: node --test tests/city-save-persistence.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

// Live pre-migration schema (information_schema, blue-chair, 2026-11-13):
// player_saves has NO `missions` and NO `trail`; players has NO `trail`.
// Every other column the code sends exists.
const PLAYER_SAVES_COLUMNS = new Set([
  "player_id", "server_id", "balance", "burned", "owned", "color", "hat",
  "car", "look", "job", "job_streak", "business", "rent", "earned",
  "best_race", "best_hover", "daily", "mission", "mission_at", "homes",
  "vehicles", "active_vehicle", "rental", "last_seen", "updated_at",
]);
const PLAYERS_COLUMNS = new Set([
  "id", "token", "name", "balance", "burned", "owned", "color", "hat",
  "car", "friends", "inbox", "job", "party", "mission", "mission_at",
  "look", "earned", "best_race", "best_hover", "daily", "wallet",
  "holder", "email", "avatar", "provider", "auth_user", "address",
  "updated_at", "job_streak", "business", "rent", "home_server",
]);

// Minimal PostgREST-faithful fake: upsert rejects a row naming a column
// the table does not have (PGRST204), like the real service does; other
// tables (presence, parties, ...) accept everything. Upsert merges into
// the stored row, so a retry that omits a column leaves the OLD value in
// place — exactly how the live bug dropped the vehicle while keeping the
// deducted balance.
function fakeSupabase() {
  const tables = { players: new Map(), player_saves: new Map(), presence: new Map(), parties: new Map() };
  const columns = { players: PLAYERS_COLUMNS, player_saves: PLAYER_SAVES_COLUMNS };
  const pk = {
    players: (row) => row.id,
    player_saves: (row) => `${row.player_id}:${row.server_id}`,
    presence: (row) => row.id,
    parties: (row) => row.id,
  };
  function upsert(table, row) {
    const known = columns[table];
    if (known) {
      const unknown = Object.keys(row).find((k) => !known.has(k));
      if (unknown) {
        return {
          data: null,
          error: {
            message: `Could not find the '${unknown}' column of '${table}' in the schema cache`,
            code: "PGRST204",
          },
        };
      }
    }
    const key = pk[table] ? pk[table](row) : JSON.stringify(row);
    const prev = tables[table]?.get(key) || {};
    tables[table]?.set(key, { ...prev, ...row });
    return { data: [tables[table].get(key)], error: null };
  }
  function query(table) {
    const filters = [];
    const builder = {
      eq: (col, val) => {
        filters.push((r) => r[col] === val);
        return builder;
      },
      gt: (col, val) => {
        filters.push((r) => Number(r[col]) > Number(val));
        return builder;
      },
      gte: (col, val) => {
        filters.push((r) => Number(r[col]) >= Number(val));
        return builder;
      },
      // Chain methods the handler uses on other tables (chat ordering);
      // no-ops here — the fake stores rows in insertion order.
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const rows = [...(tables[table]?.values() || [])].filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
    };
    return builder;
  }
  return {
    _tables: tables,
    from: (table) => ({
      upsert: async (row) => upsert(table, row),
      select: () => query(table),
    }),
  };
}

// sb() reads globalThis.__orbitxSb lazily and supabaseEnv() reads
// process.env lazily, so set both before the first request (imports are
// hoisted but nothing calls sb() at import time).
process.env.SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
globalThis.__orbitxSb = fakeSupabase();

import { POST } from "../api/city.js";

const fake = globalThis.__orbitxSb;

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Keeper") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  assert.equal(session.storage, "Supabase", "test must run on the fake Supabase backend, never memory");
  return { token: session.token, id: session.me.id };
}

function dbSave(playerId, server = 1) {
  return fake._tables.player_saves.get(`${playerId}:${server}`);
}

function dbPlayer(playerId) {
  return fake._tables.players.get(playerId);
}

test("buy-car persists the vehicle when the schema lacks missions/trail", async () => {
  const { token, id } = await guest("Keeper");

  const bought = await call("buy-car", { id: "board-street", color: "black", server: 1 }, token);
  assert.equal(bought.ok, true, bought.message);
  assert.equal(bought.me.balance, 60000 - 150);
  assert.deepEqual(bought.me.vehicles, [{ id: "board-street", color: "black" }]);

  // The stored row — not just the response — holds the vehicle.
  const row = dbSave(id, 1);
  assert.ok(row, "save row should exist");
  assert.deepEqual(JSON.parse(row.vehicles), [{ id: "board-street", color: "black" }]);
  assert.equal(row.balance, 60000 - 150);
  assert.equal(row.active_vehicle, "board-street");
});

test("a second buy, select-car, sync and me all see the garage; last_seen advances", async () => {
  const { token, id } = await guest("Keeper2");
  await call("buy-car", { id: "board-street", color: "black", server: 1 }, token);
  await call("buy-car", { id: "city-compact", color: "white", server: 1 }, token);

  const selected = await call("select-car", { id: "city-compact", server: 1 }, token);
  assert.equal(selected.ok, true, selected.message);
  assert.equal(dbSave(id, 1).active_vehicle, "city-compact");
  assert.equal(JSON.parse(dbSave(id, 1).vehicles).length, 2);

  // Sync overlays the stored garage onto me (the path the HUD reads).
  const synced = await call("sync", { server: 1, state: { x: 0, z: 0 } }, token);
  assert.equal(synced.ok, true);
  assert.equal(synced.me.vehicles.length, 2);
  assert.equal(synced.me.activeVehicle, "city-compact");

  const me = await call("me", { server: 1 }, token);
  assert.equal(me.me.vehicles.length, 2);

  // last_seen was stripped by the old retry and froze on live; it must
  // advance now (the heartbeat stamps it on every sync).
  assert.ok(Number(dbSave(id, 1).last_seen) > 0, "last_seen should be stamped");
});

test("savePlayer persists home_server when players lacks trail", async () => {
  const { token, id } = await guest("Keeper3");
  await call("buy-car", { id: "board-street", color: "black", server: 1 }, token);

  // ensureSave sets homeServer on first mint; the old retry stripped it,
  // so it stayed NULL on live forever and ops defaulted to Universe 1.
  assert.equal(dbPlayer(id).home_server, 1);
  assert.equal(dbPlayer(id).balance, 60000 - 150);
});
