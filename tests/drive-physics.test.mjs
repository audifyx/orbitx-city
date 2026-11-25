// DRIVE PHYSICS: the stuck-car bug (round 3, 2026-11-24).
// The user crashed into something and could not pull the car out —
// forward blocked, reverse blocked, steering dead at a standstill.
// These tests drive a car into a wall corner + a parked car with the
// REAL resolution code and prove the recovery chain works: the move
// resolver reports the wedge, the stuck tracker fires after 2 s of
// throttle with no progress, and the nudge finds a free spot behind
// the car that the car can actually drive away from.
//
// Run: node --test tests/drive-physics.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCarMove,
  findNudgeSpot,
  createStuckTracker,
  SLIDE_SPEED_FACTOR,
  DEAD_STOP_SPEED_FACTOR,
} from "../web/src/game/drivePhysics.ts";

const DT = 1 / 60;
const STEP = 8 * DT; // 8 u/s cruise, one frame of travel

/** Forward unit vector for a car yaw (drive(): fwd = (sin yaw, -cos yaw)). */
function fwd(yaw) {
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Two walls forming an inside corner: east wall x >= 10, north wall z <= -10. */
function cornerBlocked(x, z) {
  return x >= 10 || z <= -10;
}

/**
 * The user's pocket: the corner walls PLUS a parked car (with the
 * otherCarHit margins) sitting behind the wedge, so reversing out is
 * blocked too. The car wedged at (9.95, -9.95) has no escape move:
 * forward hits the corner, reverse / both slides hit the parked car.
 */
function pocketBlocked(x, z) {
  if (cornerBlocked(x, z)) return true;
  return x > 8 && x < 10.5 && z > -10.4 && z < -9;
}

test("open road: full move succeeds, speed untouched", () => {
  const r = resolveCarMove(() => false, 0, 0, 0.13, -0.13);
  assert.equal(r.x, 0.13);
  assert.equal(r.z, -0.13);
  assert.equal(r.speedFactor, 1);
  assert.equal(r.blocked, false);
  assert.equal(r.slid, false);
});

test("single wall, diagonal approach: slides along the wall, keeps momentum", () => {
  const wall = (x) => x >= 10;
  // Drive NE into the east wall; the diagonal target clips it.
  let pos = { x: 9.95, z: 0 };
  const f = fwd(Math.PI / 4);
  const r = resolveCarMove(wall, pos.x, pos.z, pos.x + f.x * STEP, pos.z + f.z * STEP);
  assert.equal(r.slid, true);
  assert.equal(r.blocked, false);
  assert.equal(r.speedFactor, SLIDE_SPEED_FACTOR);
  assert.ok(r.z < pos.z, "the car slides along the wall instead of stopping");
  assert.equal(r.x, pos.x);
});

test("diagonal into a pillar corner where both axes are free: slides instead of dead-stopping", () => {
  // A square pillar; the diagonal target is inside it, but each axis
  // alone is clear. The old code dead-stopped here (it only slid when
  // exactly one axis was free).
  const pillar = (x, z) => x >= 10 && x <= 12 && z <= -10 && z >= -12;
  const r = resolveCarMove(pillar, 9.9, -9.9, 10.04, -10.04);
  assert.equal(r.slid, true);
  assert.equal(r.blocked, false);
  assert.equal(r.speedFactor, SLIDE_SPEED_FACTOR);
});

test("the user's wedge: forward, reverse and both slides are all blocked", () => {
  const car = { x: 9.95, z: -9.95, yaw: Math.PI / 4 };
  const f = fwd(car.yaw);
  // Forward into the corner.
  const forward = resolveCarMove(
    pocketBlocked, car.x, car.z,
    car.x + f.x * STEP, car.z + f.z * STEP,
  );
  assert.equal(forward.blocked, true);
  assert.equal(forward.speedFactor, DEAD_STOP_SPEED_FACTOR);
  assert.equal(forward.x, car.x);
  assert.equal(forward.z, car.z);
  // Reverse out — blocked by the parked car behind.
  const reverse = resolveCarMove(
    pocketBlocked, car.x, car.z,
    car.x - f.x * STEP, car.z - f.z * STEP,
  );
  assert.equal(reverse.blocked, true);
  // The wedge is total: no single-axis escape either (checked inside
  // resolveCarMove — both canX and canZ were false).
});

test("stuck tracker: throttle held with no progress for 2 s fires; movement resets it", () => {
  const tracker = createStuckTracker();
  let firedAt = -1;
  for (let i = 0; i < 180; i++) {
    if (tracker.update(true, 0, DT)) {
      firedAt = i;
      break;
    }
  }
  assert.ok(firedAt >= 115 && firedAt <= 125, `should fire at ~2 s, fired at frame ${firedAt}`);
  // A car actually moving never fires.
  const moving = createStuckTracker();
  let fired = false;
  for (let i = 0; i < 600; i++) fired ||= moving.update(true, 0.2, DT);
  assert.equal(fired, false);
  // No throttle resets the window.
  const reset = createStuckTracker();
  for (let i = 0; i < 60; i++) reset.update(true, 0, DT);
  reset.update(false, 0, DT);
  fired = false;
  for (let i = 0; i < 60; i++) fired ||= reset.update(true, 0, DT);
  assert.equal(fired, false, "one second of throttle after a reset must not fire");
});

test("nudge: finds a free spot behind the wedged car; fully surrounded returns null", () => {
  const spot = findNudgeSpot(pocketBlocked, 9.95, -9.95, Math.PI / 4);
  assert.ok(spot, "a nudge spot must exist behind the car");
  assert.equal(pocketBlocked(spot.x, spot.z), false);
  assert.ok(spot.x < 9.95 && spot.z > -9.95, "the spot is behind the car, back along its entry path");
  // And the car can actually drive away from the spot (one more step
  // back is free too — the nudge guarantees this).
  const f = fwd(Math.PI / 4);
  assert.equal(pocketBlocked(spot.x - f.x * 0.25, spot.z - f.z * 0.25), false);
  assert.equal(findNudgeSpot(() => true, 0, 0, 0), null);
});

test("end to end: wedged car -> stuck after 2 s -> nudge -> the car can move again", () => {
  const car = { x: 9.95, z: -9.95, yaw: Math.PI / 4 };
  const tracker = createStuckTracker();
  // The player holds the throttle for 2 s; the car does not move.
  let stuck = false;
  for (let i = 0; i < 130; i++) {
    const r = resolveCarMove(pocketBlocked, car.x, car.z, car.x + 0.1, car.z - 0.1);
    assert.equal(r.blocked, true);
    stuck ||= tracker.update(true, 0, DT);
  }
  assert.equal(stuck, true, "the tracker must fire while the player pushes against the wedge");
  const spot = findNudgeSpot(pocketBlocked, car.x, car.z, car.yaw);
  assert.ok(spot, "the auto-nudge must find a free spot");
  // After the nudge, reversing away works — the car is no longer stuck.
  const f = fwd(car.yaw);
  const escape = resolveCarMove(
    pocketBlocked, spot.x, spot.z,
    spot.x - f.x * STEP, spot.z - f.z * STEP,
  );
  assert.equal(escape.blocked, false);
  assert.notEqual(escape.x, spot.x);
});
