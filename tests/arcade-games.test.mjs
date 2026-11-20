// Mini-Games Hub — interactive PvP matches (Rock Paper Scissors,
// High Card, Quick Draw) on the same escrow rails as Coin Flip / Dice
// Roll. Paper mode (ARCADE_PAPER=1) + pinned ORBITX price: no network,
// zero real funds, real ed25519 device signatures verified server-side.
// Determinism hooks (tests only, same spirit as ctx.fixedResult):
// ctx.fixedDeck deals High Card from the front of a given deck, and
// ctx.qdDelayMs pins the Quick Draw signal delay; ctx.now drives time.
// Run: node --test tests/arcade-games.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.ARCADE_PAPER = "1";
process.env.ORBITX_USD = "0.00002";
process.env.ORBITX_MINT = "13H4WJvGEg4xrrBwWn2vsQgz7xhmhxgNdw19i1QsxPX9";

import {
  ARCADE_MATCH_ACTION_MS,
  HIGHCARD_MAX_REDRAWS,
  arcadeAct,
  arcadeCompose,
  arcadeLobby,
  arcadeSubmit,
  cardLabel,
  compareCards,
  quickDrawTap,
  rpsRoundWinner,
  shuffledDeck,
} from "../api/ads.js";
import { createSolanaKeypair, setRpcForTests } from "../api/wallet.js";
import { signVersionedTransaction } from "../api/jupiter.js";
import { b58encode } from "../api/live.js";

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

// Create + join an interactive game; returns the game id once the match
// is live (status "playing"). dealCtx carries the test hooks the join
// submit needs (fixedDeck for High Card's first deal).
async function startMatch(game, pa, a, pb, b, dealCtx = {}) {
  const created = await arcadeCompose(ctx(), pa, { game, tier: 1, address: a.address, idempotencyKey: `${game}-${pa.id}-create` });
  assert.equal(created.ok, true, created.message);
  assert.equal(created.game.creatorPick, "");
  const opened = await arcadeSubmit(ctx(), pa, { gameId: created.game.id, signedTx: sign(created.unsignedTx, a.secret) });
  assert.equal(opened.game.status, "open");
  const joined = await arcadeCompose(ctx(), pb, { game, tier: 1, address: b.address, idempotencyKey: `${game}-${pb.id}-join`, joinId: created.game.id });
  assert.equal(joined.ok, true, joined.message);
  const live = await arcadeSubmit(ctx(dealCtx), pb, { gameId: created.game.id, signedTx: sign(joined.unsignedTx, b.secret) });
  assert.equal(live.ok, true, live.message);
  assert.equal(live.game.status, "playing");
  assert.ok(live.game.match, "the match view rides the submit response");
  return created.game.id;
}

async function balance(p, kp) {
  const lobby = await arcadeLobby(ctx(), p, { address: kp.address });
  return lobby.orbitx;
}

async function myGame(p, id) {
  const lobby = await arcadeLobby(ctx(), p);
  return lobby.mine.find((g) => g.id === id);
}

test("pure resolvers: RPS matrix, card compare, quick draw timing, deck", () => {
  assert.equal(rpsRoundWinner("rock", "scissors"), "creator");
  assert.equal(rpsRoundWinner("scissors", "paper"), "creator");
  assert.equal(rpsRoundWinner("paper", "rock"), "creator");
  assert.equal(rpsRoundWinner("scissors", "rock"), "joiner");
  assert.equal(rpsRoundWinner("paper", "scissors"), "joiner");
  assert.equal(rpsRoundWinner("rock", "paper"), "joiner");
  assert.equal(rpsRoundWinner("rock", "rock"), "tie");
  assert.equal(rpsRoundWinner("spock", "rock"), "tie");
  // Rank only — suits never break a tie; ace is high.
  assert.equal(compareCards({ r: 14, s: "c" }, { r: 13, s: "s" }), 1);
  assert.equal(compareCards({ r: 9, s: "h" }, { r: 9, s: "s" }), 0);
  assert.equal(compareCards({ r: 2, s: "s" }, { r: 14, s: "d" }), -1);
  assert.equal(cardLabel({ r: 14, s: "s" }), "A♠");
  assert.equal(cardLabel({ r: 10, s: "h" }), "10♥");
  assert.deepEqual(quickDrawTap(5_000, 4_999), { falseStart: true, reactionMs: 0 });
  assert.deepEqual(quickDrawTap(5_000, 5_000), { falseStart: false, reactionMs: 0 });
  assert.deepEqual(quickDrawTap(5_000, 5_230), { falseStart: false, reactionMs: 230 });
  const deck = shuffledDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => `${c.r}${c.s}`)).size, 52);
});

test("RPS: full best-of-3 with a tie replay — winner takes the whole pot", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("rps-a", "Rex");
  const pb = player("rps-b", "Rue");
  const id = await startMatch("rps", pa, a, pb, b);

  // Round 1: creator's pick is invisible to the joiner until both lock.
  const locked = await arcadeAct(ctx(), pa, { gameId: id, action: "pick", value: "rock" });
  assert.equal(locked.game.match.myPick, "rock");
  const joinerView = await myGame(pb, id);
  assert.equal(joinerView.match.myPick, "");
  assert.equal(joinerView.match.oppPicked, true);
  assert.equal(JSON.stringify(joinerView).includes("rock"), false, "the locked pick never leaks");
  // A locked pick cannot change — a second pick is a safe no-op.
  const changed = await arcadeAct(ctx(), pa, { gameId: id, action: "pick", value: "paper" });
  assert.match(changed.message, /locked/);
  const scored = await arcadeAct(ctx(), pb, { gameId: id, action: "pick", value: "scissors" });
  assert.equal(scored.game.match.score.creator, 1);
  assert.equal(scored.game.match.history[0].creatorPick, "rock");
  assert.equal(scored.game.match.history[0].winner, "creator");

  // Round 2 ties (paper/paper) and replays at the same round number.
  await arcadeAct(ctx(), pa, { gameId: id, action: "pick", value: "paper" });
  const tied = await arcadeAct(ctx(), pb, { gameId: id, action: "pick", value: "paper" });
  assert.equal(tied.game.match.round, 2);
  assert.equal(tied.game.match.score.creator, 1);
  assert.equal(tied.game.match.history[1].winner, "tie");
  await arcadeAct(ctx(), pa, { gameId: id, action: "pick", value: "scissors" });
  const done = await arcadeAct(ctx(), pb, { gameId: id, action: "pick", value: "paper" });
  assert.equal(done.game.status, "resolved");
  assert.equal(done.game.winnerId, "rps-a");
  assert.equal(done.game.result, "2–0");
  assert.match(done.game.payoutSignature, /^paper_/);
  assert.equal(await balance(pa, a), 10_050_000);
  assert.equal(await balance(pb, b), 9_950_000);
});

test("RPS: one live match at a time, and a non-player cannot act", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("rps2-a", "Ana");
  const pb = player("rps2-b", "Ari");
  const id = await startMatch("rps", pa, a, pb, b);
  const second = await arcadeCompose(ctx(), pa, { game: "coinflip", tier: 1, pick: "heads", address: a.address, idempotencyKey: "rps2-second" });
  assert.equal(second.ok, false);
  assert.match(second.message, /Finish your open game first/);
  const stranger = await arcadeAct(ctx(), player("rps2-x", "Xan"), { gameId: id, action: "pick", value: "rock" });
  assert.equal(stranger.ok, false);
  assert.match(stranger.message, /not yours/);
});

test("RPS timeouts: the player who acted wins by forfeit; double-stall splits", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("rps3-a", "Fay");
  const pb = player("rps3-b", "Fox");
  const id = await startMatch("rps", pa, a, pb, b);
  await arcadeAct(ctx(), pa, { gameId: id, action: "pick", value: "rock" });
  now += ARCADE_MATCH_ACTION_MS + 1_000;
  const after = await myGame(pa, id); // the lobby read runs the sweep
  assert.equal(after.status, "resolved");
  assert.equal(after.winnerId, "rps3-a");
  assert.equal(after.result, "forfeit");
  assert.equal(await balance(pa, a), 10_050_000);
  assert.equal(await balance(pb, b), 9_950_000);

  const c = keypair();
  const d = keypair();
  const pc = player("rps4-a", "Gia");
  const pd = player("rps4-b", "Gil");
  const id2 = await startMatch("rps", pc, c, pd, d);
  now += ARCADE_MATCH_ACTION_MS + 1_000;
  const split = await myGame(pc, id2);
  assert.equal(split.status, "refunded");
  assert.equal(split.result, "abandoned");
  assert.equal(await balance(pc, c), 10_000_000);
  assert.equal(await balance(pd, d), 10_000_000);
});

test("High Card: server-dealt cards stay hidden until both reveal", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("hc-a", "Hal");
  const pb = player("hc-b", "Hana");
  const id = await startMatch("highcard", pa, a, pb, b, { fixedDeck: [{ r: 14, s: "s" }, { r: 13, s: "h" }] });
  const viewA = await myGame(pa, id);
  assert.equal(viewA.match.myCard, null);
  assert.equal(viewA.match.oppCard, null);
  assert.equal(JSON.stringify(viewA).includes("♠"), false, "no card leaks before the reveal");
  const one = await arcadeAct(ctx(), pa, { gameId: id, action: "reveal" });
  assert.equal(one.game.status, "playing");
  assert.equal(one.game.match.myRevealed, true);
  const done = await arcadeAct(ctx(), pb, { gameId: id, action: "reveal" });
  assert.equal(done.game.status, "resolved");
  assert.equal(done.game.winnerId, "hc-a");
  assert.equal(done.game.result, "A♠ over K♥");
  assert.equal(done.game.match.history[0].creatorCard.r, 14);
  assert.equal(await balance(pa, a), 10_050_000);
  assert.equal(await balance(pb, b), 9_950_000);
});

test("High Card: ties redraw up to the cap, then the pot splits", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("hc2-a", "Ivy");
  const pb = player("hc2-b", "Ike");
  const tie = (r) => [{ r, s: "s" }, { r, s: "h" }];
  const id = await startMatch("highcard", pa, a, pb, b, { fixedDeck: tie(5) });
  // Each redeal happens inside the act call that resolved the tie, so
  // that call's fixedDeck decides the next pair: ties at 6, 7, 8 follow.
  const rounds = [tie(6), tie(7), tie(8)];
  for (let i = 0; i <= HIGHCARD_MAX_REDRAWS; i++) {
    await arcadeAct(ctx(rounds[i] ? { fixedDeck: rounds[i] } : {}), pa, { gameId: id, action: "reveal" });
    const res = await arcadeAct(ctx(rounds[i] ? { fixedDeck: rounds[i] } : {}), pb, { gameId: id, action: "reveal" });
    if (i < HIGHCARD_MAX_REDRAWS) {
      assert.equal(res.game.status, "playing");
      assert.equal(res.game.match.redraws, i + 1);
    } else {
      assert.equal(res.game.status, "refunded");
      assert.equal(res.game.result, "split");
    }
  }
  assert.equal(await balance(pa, a), 10_000_000);
  assert.equal(await balance(pb, b), 10_000_000);
});

test("Quick Draw: false start loses the round, server times the draw, best of 3", async () => {
  const a = keypair();
  const b = keypair();
  const pa = player("qd-a", "Quinn");
  const pb = player("qd-b", "Quade");
  const id = await startMatch("quickdraw", pa, a, pb, b);
  const readyBoth = async () => {
    await arcadeAct(ctx({ qdDelayMs: 2_000 }), pa, { gameId: id, action: "ready" });
    const armed = await arcadeAct(ctx({ qdDelayMs: 2_000 }), pb, { gameId: id, action: "ready" });
    assert.equal(armed.game.match.phase, "wait");
    assert.equal(armed.game.match.fired, false);
    return now; // signal fires at now + 2000
  };

  // Round 1: a tap during the ready phase is a harmless no-op…
  const early = await arcadeAct(ctx(), pa, { gameId: id, action: "tap" });
  assert.match(early.message, /ready up/);
  // …but a tap BEFORE the signal is a false start and loses the round.
  const armedAt = await readyBoth();
  now = armedAt + 500;
  const fs = await arcadeAct(ctx(), pa, { gameId: id, action: "tap" });
  assert.equal(fs.game.match.score.joiner, 1);
  assert.equal(fs.game.match.history[0].reason, "false-start");

  // Round 2: creator waits for the signal and draws in 600ms.
  const armedAt2 = await readyBoth();
  now = armedAt2 + 2_600;
  const draw = await arcadeAct(ctx(), pa, { gameId: id, action: "tap" });
  assert.equal(draw.game.match.score.creator, 1);
  assert.equal(draw.game.match.history[1].reactionMs, 600);

  // Round 3: joiner is faster — 2–1, joiner takes the pot.
  const armedAt3 = await readyBoth();
  now = armedAt3 + 2_300;
  const done = await arcadeAct(ctx(), pb, { gameId: id, action: "tap" });
  assert.equal(done.game.status, "resolved");
  assert.equal(done.game.winnerId, "qd-b");
  assert.equal(done.game.result, "1–2");
  assert.equal(await balance(pb, b), 10_050_000);
  assert.equal(await balance(pa, a), 9_950_000);
});

test("interactive create is idempotent per key — no double stake", async () => {
  const a = keypair();
  const pa = player("idem-a", "Ida");
  const body = { game: "rps", tier: 1, address: a.address, idempotencyKey: "idem-rps-1" };
  const first = await arcadeCompose(ctx(), pa, body);
  const again = await arcadeCompose(ctx(), pa, body);
  assert.equal(first.ok, true);
  assert.equal(again.ok, true);
  assert.equal(again.game.id, first.game.id);
  assert.equal(again.resumed, true);
  assert.equal(again.unsignedTx, first.unsignedTx);
});
