import test from "node:test";
import assert from "node:assert/strict";
import { handleLive } from "./live.js";

function ctxFor() {
  const store = {
    players: new Map(),
    lots: new Map(),
    notes: new Map(),
    volatile: new Map(),
    raceLobby: { phase: "open", players: [], startedAt: 0, results: [] },
    lotsLoaded: true,
    events: [],
  };
  return {
    store,
    memory: () => store,
    sb: () => null,
    sql: null,
    note: () => {},
    savePlayer: async (player) => {
      store.players.set(player.id, player);
    },
    addEvent: async (info) => {
      store.events.push(info);
    },
    burnOf: (price) => Math.max(1, Math.round(price * 0.25)),
  };
}

function player(id = "ada") {
  return {
    id,
    name: id === "ada" ? "Ada" : "Bea",
    balance: 250,
    burned: 0,
    earned: 0,
    bestRace: 0,
    bestHover: 0,
    daily: null,
    wallet: "",
    holder: false,
  };
}

test("buying a loft burns a quarter of the price and blocks a second buyer", async () => {
  const ctx = ctxFor();
  const ada = player("ada");
  const bought = await handleLive(ctx, ada, "property-buy", { id: "loft" });
  assert.equal(bought.ok, true);
  assert.equal(ada.balance, 130);
  assert.equal(ada.burned, 30);
  assert.match(bought.message, /Burned 30/);
  const bea = player("bea");
  const denied = await handleLive(ctx, bea, "property-buy", { id: "loft" });
  assert.equal(denied.ok, false);
  const saved = await handleLive(ctx, ada, "property-save", {
    id: "loft",
    furniture: [
      { id: "a", kind: "couch", x: 50, z: 18, rot: 1 },
      { id: "b", kind: "nope", x: 51, z: 18, rot: 0 },
    ],
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.lots.find((lot) => lot.id === "loft").furniture[1].kind, "table");
  const intruder = await handleLive(ctx, bea, "property-save", { id: "loft", furniture: [] });
  assert.equal(intruder.ok, false);
});

test("daily claim pays once and courier quest pays on the second job", async () => {
  const ctx = ctxFor();
  const ada = player();
  const claim = await handleLive(ctx, ada, "daily-claim", {});
  assert.equal(claim.ok, true);
  assert.equal(ada.balance, 265);
  const again = await handleLive(ctx, ada, "daily-claim", {});
  assert.equal(again.ok, false);
  const { noteEarn } = await import("./live.js");
  noteEarn(ada, "courier", 45);
  assert.equal(ada.earned, 45);
  const bonus = noteEarn(ada, "courier", 45);
  assert.equal(bonus, 12);
  assert.equal(ada.earned, 90);
  assert.equal(ada.balance, 265 + 12);
  const skipped = await handleLive(ctx, ada, "quest-ping", { id: "courier" });
  assert.equal(skipped.ok, false);
  const visit = await handleLive(ctx, ada, "quest-ping", { id: "visit" });
  assert.equal(visit.ok, true);
  assert.equal(ada.balance, 265 + 24);
});

test("street race rejects a skipped gate and records a legal finish", async () => {
  const ctx = ctxFor();
  const ada = player();
  const started = await handleLive(ctx, ada, "race-go", { kind: "street" });
  assert.equal(started.ok, true);
  ada.race.startedAt = Date.now() - 5000;
  ada.race.at = Date.now() - 1000;
  const skip = await handleLive(ctx, ada, "race-hit", { x: 36, z: 36, car: false });
  assert.equal(skip.ok, false);
  const { GATES } = await import("./live.js");
  for (const gate of GATES) {
    ada.race.at = Date.now() - 1000;
    const hit = await handleLive(ctx, ada, "race-hit", { x: gate.x, z: gate.z, car: false });
    assert.equal(hit.ok, true, hit.message);
  }
  assert.ok(ada.bestRace > 0);
  assert.equal(ctx.store.raceLobby.phase, "done");
});

test("arcade high-low and reflex stay inside play-money payouts", async () => {
  const ctx = ctxFor();
  const ada = player();
  const hand = await handleLive(ctx, ada, "arcade-play", {});
  assert.equal(hand.ok, true);
  assert.equal(ada.balance, 240);
  assert.equal(ada.burned, 3);
  const resolved = await handleLive(ctx, ada, "arcade-play", { token: hand.token, guess: "high" });
  assert.equal(resolved.ok, true);
  assert.ok(ada.balance === 240 || ada.balance === 258);
  const armed = await handleLive(ctx, ada, "arcade-arm", {});
  assert.equal(armed.ok, true);
  const early = await handleLive(ctx, ada, "arcade-hit", { token: armed.token });
  assert.equal(early.ok, true);
  assert.match(early.message, /Play money/);
  assert.ok(!JSON.stringify(early).includes("sendTransaction"));
});

test("external wallet link is no longer a live op", async () => {
  const ctx = ctxFor();
  const ada = player();
  const linked = await handleLive(ctx, ada, "wallet-link", { pubkey: "x" });
  assert.equal(linked, null);
});

// A bought lot must stay bought: the digest re-reads the properties table
// fresh on every call, so a lot owned in the database never flips back to
// for-sale on a later read (the bug that made a bought HQ glitch in and out
// and the panel message revert to "Buy this HQ").
test("a bought HQ stays owned on the next digest, even when the in-memory copy went stale", async () => {
  // One shared "database" (the Supabase properties table) behind a fake client.
  // select() is a thenable so `await .select()` resolves to the result and
  // `.select().limit(n)` works for the leaderboard read.
  const db = { properties: new Map(), announcements: new Map() };
  const fakeSb = () => ({
    from(table) {
      const rows = table === "properties" ? db.properties : table === "announcements" ? db.announcements : new Map();
      const result = { error: null, data: [...rows.values()].map((row) => ({ ...row })) };
      return {
        select() {
          return {
            ...result,
            then(resolve) { resolve(result); },
            limit() { return Promise.resolve(result); },
          };
        },
        upsert(row) {
          rows.set(row.id, { ...row });
          return Promise.resolve({ error: null });
        },
      };
    },
  });
  const ctx = ctxFor();
  ctx.sb = fakeSb;
  const ada = player("ada");
  // First digest: nothing owned yet.
  const before = await handleLive(ctx, ada, "digest", {});
  assert.equal(before.ok, true);
  assert.equal(before.lots.find((lot) => lot.id === "hq-0")?.ownerId || "", "");
  // Buy the HQ — the database now has it owned by Ada.
  const bought = await handleLive(ctx, ada, "property-buy", { id: "hq-0" });
  assert.equal(bought.ok, true);
  assert.equal(db.properties.get("hq-0")?.owner_id, "ada");
  // Simulate the stale in-memory copy an instance holds when it loaded lots
  // before the purchase: wipe the ownership from the in-memory store.
  ctx.store.lots.set("hq-0", { id: "hq-0", ownerId: "", ownerName: "", furniture: [], brand: {} });
  // The next digest must re-read the database and show the HQ as owned.
  const after = await handleLive(ctx, ada, "digest", {});
  assert.equal(after.ok, true);
  assert.equal(after.lots.find((lot) => lot.id === "hq-0")?.ownerId, "ada");
  assert.equal(after.lots.find((lot) => lot.id === "hq-0")?.ownerName, "Ada");
});
