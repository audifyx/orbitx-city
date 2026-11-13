// Voice-token regression tests for the LiveKit migration (Nov 2026).
//
// The old custom WebRTC mesh is gone: the `voice-token` op is now the
// ONLY way into voice. It must (a) refuse requests with no/invalid
// session (the handler's auth gate), (b) report voice as not set up when
// the LiveKit env vars are missing (never silently fall back to a mesh
// that no longer exists), (c) mint a correctly signed LiveKit JWT for
// the room the player may join, and (d) never mint a token for a room
// the player may not join (party channels are members-only, unknown
// channels don't exist).
//
// The LiveKit env values used here are TEST-ONLY strings, never real
// keys. The signature check proves the SDK minted a token signed with
// the configured secret.
//
// Run: node --test tests/voice-token.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// Permissive fake Supabase: the voice-token op only reads the players
// table (session + token lookup) and the party op upserts parties.
function fakeSupabase() {
  const tables = { players: new Map(), player_saves: new Map(), presence: new Map(), parties: new Map() };
  const pk = {
    players: (row) => row.id,
    player_saves: (row) => `${row.player_id}:${row.server_id}`,
    presence: (row) => row.id,
    parties: (row) => row.id,
  };
  function query(table) {
    const filters = [];
    const builder = {
      eq: (col, val) => {
        filters.push((r) => r[col] === val);
        return builder;
      },
      gt: () => builder,
      gte: () => builder,
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
      upsert: async (row) => {
        const key = pk[table] ? pk[table](row) : JSON.stringify(row);
        const prev = tables[table]?.get(key) || {};
        tables[table]?.set(key, { ...prev, ...row });
        return { data: [tables[table].get(key)], error: null };
      },
      select: () => query(table),
    }),
  };
}

process.env.SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
// Start with NO LiveKit keys: the "not set up" test needs them absent.
delete process.env.LIVEKIT_URL;
delete process.env.LIVEKIT_API_KEY;
delete process.env.LIVEKIT_API_SECRET;

import { POST } from "../api/city.js";

const TEST_LIVEKIT = {
  url: "https://test.livekit.cloud",
  key: "test-api-key",
  secret: "test-api-secret-0123456789",
};

function setTestLivekit() {
  process.env.LIVEKIT_URL = TEST_LIVEKIT.url;
  process.env.LIVEKIT_API_KEY = TEST_LIVEKIT.key;
  process.env.LIVEKIT_API_SECRET = TEST_LIVEKIT.secret;
}

function clearLivekit() {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
}

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Keeper") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  return { token: session.token, id: session.me.id };
}

function decodeJwt(token) {
  const parts = String(token).split(".");
  assert.equal(parts.length, 3, "token must be a 3-part JWT");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  const sig = createHmac("sha256", TEST_LIVEKIT.secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  assert.equal(parts[2], sig, "token must be signed with the configured LiveKit secret");
  return { header, payload };
}

test("voice-token refuses a request with no session", async () => {
  const res = await call("voice-token", { room: "nearby" });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test("voice-token refuses a bad session token", async () => {
  const res = await call("voice-token", { room: "nearby" }, "no-such-token");
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test("voice-token reports voice not set up when LiveKit keys are missing", async () => {
  clearLivekit();
  const { token } = await guest("Keeper");
  const res = await call("voice-token", { room: "nearby" }, token);
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.match(String(res.message || ""), /LiveKit/i, "message must name LiveKit, not fall back silently");
});

test("voice-token mints a signed LiveKit token for the proximity room", async () => {
  setTestLivekit();
  const { token, id } = await guest("Keeper2");
  const res = await call("voice-token", { room: "nearby" }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.provider, "livekit");
  assert.equal(res.url, TEST_LIVEKIT.url);
  assert.equal(res.channel, "nearby");
  assert.equal(res.room, "orbitx-city-u1", "proximity is one room per universe (guest is on universe 1)");
  const { header, payload } = decodeJwt(res.token);
  assert.equal(header.alg, "HS256");
  assert.equal(payload.iss, TEST_LIVEKIT.key);
  assert.equal(payload.sub, id);
  assert.equal(payload.video.room, "orbitx-city-u1");
  assert.equal(payload.video.roomJoin, true);
  assert.equal(payload.video.canPublish, true);
  assert.equal(payload.video.canSubscribe, true);
});

test("voice-token maps a named channel to its city-wide room", async () => {
  setTestLivekit();
  const { token } = await guest("Keeper3");
  const res = await call("voice-token", { room: "plaza" }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.channel, "plaza");
  assert.equal(res.room, "orbitx-city-plaza");
});

test("voice-token proximity follows the requested universe", async () => {
  setTestLivekit();
  const { token } = await guest("Keeper4");
  const res = await call("voice-token", { room: "nearby", server: 2 }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.room, "orbitx-city-u2");
});

test("voice-token refuses an unknown channel", async () => {
  setTestLivekit();
  const { token } = await guest("Keeper5");
  const res = await call("voice-token", { room: "nope" }, token);
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
});

test("voice-token refuses a party channel when not in that party", async () => {
  setTestLivekit();
  const { token } = await guest("Keeper6");
  const res = await call("voice-token", { room: "party-abc123" }, token);
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
});

test("voice-token allows a party channel for a member", async () => {
  setTestLivekit();
  const { token } = await guest("Keeper7");
  const made = await call("party", { invite: "" }, token);
  assert.equal(made.ok, true, made.message);
  const partyId = String(made.party?.id || "");
  assert.ok(partyId.startsWith("party-"), `party id should look like a party id, got ${partyId}`);
  const res = await call("voice-token", { room: partyId }, token);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.channel, partyId);
  assert.equal(res.room, `orbitx-city-${partyId}`);
  const { payload } = decodeJwt(res.token);
  assert.equal(payload.video.room, `orbitx-city-${partyId}`);
});
