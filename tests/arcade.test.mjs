// Mini-Games Hub — 2-player PvP pot games in real ORBITX (paper mode).
// Paper mode (ARCADE_PAPER=1) records transfers instead of broadcasting
// them, and the ORBITX price is pinned, so this file passes with no
// network and zero real funds. The device-signature path is real: the
// tests sign the composed transaction with a real ed25519 keypair and
// the server verifies it, exactly like the client does.
// Run: node --test tests/arcade.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.ARCADE_PAPER = "1";
process.env.ORBITX_USD = "0.00002";
process.env.ORBITX_MINT = "13H4WJvGEg4xrrBwWn2vsQgz7xhmhxgNdw19i1QsxPX9";

import {
  ARCADE_JOIN_TIMEOUT_MS,
  ARCADE_TIERS_USD,
  arcadeCancel,
  arcadeCompose,
  arcadeEntryRaw,
  arcadeHistory,
  arcadeLeaders,
  arcadeLobby,
  arcadeSubmit,
  arcadeSweep,
  arcadeTiers,
} from "../api/ads.js";
import { createSolanaKeypair, setRpcForTests } from "../api/wallet.js";
import { signVersionedTransaction } from "../api/jupiter.js";
import { b58encode } from "../api/live.js";

// No network in this file: decimals() falls back to 6, and paper mode
// never calls the RPC for balances or blockhashes.
setRpcForTests(async () => null);

let now = Date.now();
function ctx(extra = {}) {
  return { sb: () => null, note: () => {}, now: () => now, ...extra };
}

function player(id, name) {
  return { id, name, authUser: "" };
}

function keypair() {
  const made = createSolanaKeypair();
  return { address: made.publicKey, secret: made.secret };
}

function sign(unsigned, secret) {
  return signVersionedTransaction(unsigned, secret, b58encode).signedTx;
}

test("entry math: $1/$2/$5/$10 at the pinned ORBITX price", async () => {
  // ORBITX_USD=0.00002, 6 decimals: $1 = 50,000 ORBITX.
  assert.equal(await arcadeEntryRaw(1), 50_000_000_000n);
  assert.equal(await arcadeEntryRaw(2), 100_000_000_000n);
  assert.equal(await arcadeEntryRaw(5), 250_000_000_000n);
  assert.equal(await arcadeEntryRaw(10), 500_000_000_000n);
  assert.equal(await arcadeEntryRaw(3), 0n);
  assert.deepEqual(ARCADE_TIERS_USD, [1, 2, 5, 10]);
  const tiers = await arcadeTiers();
  assert.equal(tiers.length, 4);
  assert.equal(tiers[0].entryUi, 50_000);
  assert.equal(tiers[0].potUi, 100_000);
  assert.equal(tiers[3].entryUi, 500_000);
  assert.equal(tiers[3].potUi, 1_000_000);
});

test("lobby starts empty with tiers priced", async () => {
  const lobby = await arcadeLobby(ctx(), player("lobby-1", "Lobby"));
  assert.equal(lobby.ok, true);
  assert.equal(lobby.open.length, 0);
  assert.equal(lobby.tiers.length, 4);
  assert.equal(lobby.joinTimeoutMs, ARCADE_JOIN_TIMEOUT_MS);
});

test("compose validates before anything is built", async () => {
  const a = keypair();
  const p = player("val-1", "Validator");
  const base = { address: a.address, idempotencyKey: "val-key-1" };
  const badGame = await arcadeCompose(ctx(), p, { ...base, game: "slots", tier: 1, pick: "heads" });
  assert.equal(badGame.ok, false);
  assert.match(badGame.message, /Mini-Games Hub/);
  const badTier = await arcadeCompose(ctx(), p, { ...base, game: "coinflip", tier: 3, pick: "heads" });
  assert.equal(badTier.ok, false);
  assert.match(badTier.message, /\$1, \$2, \$5, or \$10/);
  const badPick = await arcadeCompose(ctx(), p, { ...base, game: "coinflip", tier: 1, pick: "edge" });
  assert.equal(badPick.ok, false);
  assert.match(badPick.message, /heads or tails/);
  const badAddr = await arcadeCompose(ctx(), p, { ...base, game: "coinflip", tier: 1, pick: "heads", address: "not-an-address" });
  assert.equal(badAddr.ok, false);
  assert.match(badAddr.message, /not valid/);
  const noKey = await arcadeCompose(ctx(), p, { address: a.address, game: "coinflip", tier: 1, pick: "heads" });
  assert.equal(noKey.ok, false);
  assert.match(noKey.message, /confirm id/);
});

test("a full 2-player coin flip: winner takes the whole pot", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("game-a", "Alice");
  const pb = player("game-b", "Bob");
  const created = await arcadeCompose(ctx(), pa, { game: "coinflip", tier: 1, pick: "heads", address: a.address, idempotencyKey: "game-1-create" });
  assert.equal(created.ok, true);
  assert.equal(created.game.status, "composed");
  assert.equal(created.entryUi, 50_000);
  assert.equal(created.potUi, 100_000);
  assert.ok(created.unsignedTx);
  const submitted = await arcadeSubmit(ctx(), pa, { gameId: created.game.id, signedTx: sign(created.unsignedTx, a.secret) });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.game.status, "open");
  assert.match(submitted.game.entrySignature, /^paper_/);
  // The joiner takes the opposite side — same-side is refused.
  const sameSide = await arcadeCompose(ctx(), pb, { game: "coinflip", tier: 1, pick: "heads", address: b.address, idempotencyKey: "game-1-join-bad", joinId: created.game.id });
  assert.equal(sameSide.ok, false);
  assert.match(sameSide.message, /other side/);
  const joined = await arcadeCompose(ctx({ fixedResult: "heads" }), pb, { game: "coinflip", tier: 1, pick: "tails", address: b.address, idempotencyKey: "game-1-join", joinId: created.game.id });
  assert.equal(joined.ok, true);
  assert.equal(joined.game.status, "join-composed");
  const done = await arcadeSubmit(ctx({ fixedResult: "heads" }), pb, { gameId: created.game.id, signedTx: sign(joined.unsignedTx, b.secret) });
  assert.equal(done.ok, true);
  assert.equal(done.game.status, "resolved");
  assert.equal(done.game.result, "heads");
  assert.equal(done.game.winnerId, "game-a");
  assert.match(done.game.payoutSignature, /^paper_/);
  assert.match(done.message, /won the pot/);
  // Paper balances: winner paid 50,000 in and got 100,000 back (+50,000);
  // loser paid 50,000 in and got nothing (-50,000). Seed is 10,000,000.
  const lobbyA = await arcadeLobby(ctx(), pa, { address: a.address });
  const lobbyB = await arcadeLobby(ctx(), pb, { address: b.address });
  assert.equal(lobbyA.orbitx, 10_050_000);
  assert.equal(lobbyB.orbitx, 9_950_000);
  // History + leaders see the resolved game.
  const history = await arcadeHistory(ctx(), pa);
  assert.equal(history.games.length, 1);
  assert.equal(history.games[0].status, "resolved");
  const leaders = await arcadeLeaders(ctx(), pa);
  assert.equal(leaders.leaders[0].id, "game-a");
  assert.equal(leaders.leaders[0].wins, 1);
  assert.equal(leaders.leaders[0].biggest, 100_000);
  assert.equal(leaders.mine.wins, 1);
});

test("dice roll: high wins on 4-6, low on 1-3", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("dice-a", "Dee");
  const pb = player("dice-b", "Dan");
  const created = await arcadeCompose(ctx(), pa, { game: "diceroll", tier: 2, pick: "low", address: a.address, idempotencyKey: "dice-1-create" });
  assert.equal(created.ok, true);
  assert.equal(created.entryUi, 100_000);
  await arcadeSubmit(ctx(), pa, { gameId: created.game.id, signedTx: sign(created.unsignedTx, a.secret) });
  const joined = await arcadeCompose(ctx({ fixedResult: "5" }), pb, { game: "diceroll", tier: 2, address: b.address, idempotencyKey: "dice-1-join", joinId: created.game.id });
  assert.equal(joined.ok, true);
  assert.equal(joined.game.joinerPick, "high"); // opposite side, forced
  const done = await arcadeSubmit(ctx({ fixedResult: "5" }), pb, { gameId: created.game.id, signedTx: sign(joined.unsignedTx, b.secret) });
  assert.equal(done.game.status, "resolved");
  assert.equal(done.game.result, "5");
  assert.equal(done.game.winnerId, "dice-b"); // 5 is high, joiner took high
});

test("join guards: own game, wrong tier, finished game", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("guard-a", "Gail");
  const pb = player("guard-b", "Gus");
  const created = await arcadeCompose(ctx(), pa, { game: "coinflip", tier: 5, pick: "tails", address: a.address, idempotencyKey: "guard-1-create" });
  await arcadeSubmit(ctx(), pa, { gameId: created.game.id, signedTx: sign(created.unsignedTx, a.secret) });
  const own = await arcadeCompose(ctx(), pa, { game: "coinflip", tier: 5, pick: "heads", address: a.address, idempotencyKey: "guard-1-own", joinId: created.game.id });
  assert.equal(own.ok, false);
  assert.match(own.message, /your own game/);
  const wrongTier = await arcadeCompose(ctx(), pb, { game: "coinflip", tier: 1, pick: "heads", address: b.address, idempotencyKey: "guard-1-tier", joinId: created.game.id });
  assert.equal(wrongTier.ok, false);
  assert.match(wrongTier.message, /different entry/);
  const unknown = await arcadeCompose(ctx(), pb, { game: "coinflip", tier: 1, pick: "heads", address: b.address, idempotencyKey: "guard-1-unknown", joinId: "arc_nope" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /not found/);
});

test("one live game per player", async () => {
  const a = keypair();
  const p = player("one-1", "Solo");
  const first = await arcadeCompose(ctx(), p, { game: "coinflip", tier: 1, pick: "heads", address: a.address, idempotencyKey: "one-1-first" });
  assert.equal(first.ok, true);
  const second = await arcadeCompose(ctx(), p, { game: "diceroll", tier: 1, pick: "high", address: a.address, idempotencyKey: "one-1-second" });
  assert.equal(second.ok, false);
  assert.match(second.message, /Finish your open game first/);
});

test("submit verifies the signature is for THIS game, from THIS wallet", async () => {
  const a = keypair();
  const intruder = keypair();
  const p = player("verify-1", "Vera");
  const created = await arcadeCompose(ctx(), p, { game: "coinflip", tier: 1, pick: "heads", address: a.address, idempotencyKey: "verify-1-create" });
  assert.equal(created.ok, true);
  // Signed by a different key: the signature does not verify.
  const wrongKey = await arcadeSubmit(ctx(), p, { gameId: created.game.id, signedTx: sign(created.unsignedTx, intruder.secret) });
  assert.equal(wrongKey.ok, false);
  assert.match(wrongKey.message, /does not verify|not for this game/);
  // No signed tx at all.
  const empty = await arcadeSubmit(ctx(), p, { gameId: created.game.id, signedTx: "" });
  assert.equal(empty.ok, false);
  assert.match(empty.message, /No signed transaction/);
  // The right key works.
  const right = await arcadeSubmit(ctx(), p, { gameId: created.game.id, signedTx: sign(created.unsignedTx, a.secret) });
  assert.equal(right.ok, true);
  assert.equal(right.game.status, "open");
});

test("timeout refunds the creator's entry, cancel refunds it early", async () => {
  const a = keypair();
  const pa = player("refund-a", "Ruth");
  const created = await arcadeCompose(ctx(), pa, { game: "coinflip", tier: 1, pick: "heads", address: a.address, idempotencyKey: "refund-1-create" });
  await arcadeSubmit(ctx(), pa, { gameId: created.game.id, signedTx: sign(created.unsignedTx, a.secret) });
  // Cancel before the timeout: refunded at once.
  const cancelled = await arcadeCancel(ctx(), pa, { gameId: created.game.id });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.game.status, "refunded");
  assert.match(cancelled.game.refundSignature, /^paper_/);
  const afterCancel = await arcadeLobby(ctx(), pa, { address: a.address });
  assert.equal(afterCancel.orbitx, 10_000_000); // entry back, balance whole

  // Timeout: a second game that nobody joins is refunded by the sweep.
  const b = keypair();
  const pb = player("refund-b", "Ray");
  const created2 = await arcadeCompose(ctx(), pb, { game: "coinflip", tier: 1, pick: "tails", address: b.address, idempotencyKey: "refund-2-create" });
  await arcadeSubmit(ctx(), pb, { gameId: created2.game.id, signedTx: sign(created2.unsignedTx, b.secret) });
  now += ARCADE_JOIN_TIMEOUT_MS + 1000;
  await arcadeSweep(ctx());
  const lobby = await arcadeLobby(ctx(), pb, { address: b.address });
  assert.equal(lobby.open.length, 0);
  assert.equal(lobby.mine[0].status, "refunded");
  assert.match(lobby.mine[0].refundSignature, /^paper_/);
  assert.equal(lobby.orbitx, 10_000_000);
});
