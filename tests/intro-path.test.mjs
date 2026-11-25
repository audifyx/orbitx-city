// CINEMATIC INTRO FLYOVER (round 6, piece 1): the camera path itself.
// The old path was piecewise-linear + per-segment smoothstep, so the
// camera stopped dead at every keyframe and Act 1 never actually
// passed through the gate. The new path is a Catmull-Rom spline per
// act with ease-in from rest / ease-out to the orbit pose.
//
// Run: node --test tests/intro-path.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { INTRO_LEN, INTRO_KEYS, introPose } from "../web/src/game/introPath.ts";

const OUT = { pos: [0, 0, 0], look: [0, 0, 0], fov: 62, roll: 0 };
function pose(t) {
  introPose(t, OUT);
  return { pos: [...OUT.pos], look: [...OUT.look], fov: OUT.fov, roll: OUT.roll };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Speed at t by central difference (u/s).
function speedAt(t, h = 0.05) {
  const a = pose(Math.max(0, t - h)).pos;
  const b = pose(Math.min(INTRO_LEN, t + h)).pos;
  return dist(a, b) / (Math.min(INTRO_LEN, t + h) - Math.max(0, t - h));
}

test("intro length + act boundaries unchanged (30s, cuts at 6/12/18/24)", () => {
  assert.equal(INTRO_LEN, 30);
  const cuts = INTRO_KEYS.filter((k) => k.cut).map((k) => k.t);
  assert.deepEqual(cuts, [6.01, 9.01, 12.01, 18.01, 24.01]);
  // First key at t=0, last key the exact orbit pose (seamless handoff).
  assert.equal(INTRO_KEYS[0].t, 0);
  const last = INTRO_KEYS[INTRO_KEYS.length - 1];
  assert.equal(last.t, 30);
  assert.deepEqual(last.pos, [190, 78, 10]);
  assert.deepEqual(last.look, [0, 26, 20]);
  assert.equal(last.fov, 62);
  assert.equal(last.roll, 0);
});

test("path passes through every key at its exact time", () => {
  for (const k of INTRO_KEYS) {
    const p = pose(k.t);
    assert.ok(dist(p.pos, k.pos) < 0.01, `t=${k.t} pos ${p.pos} != key ${k.pos}`);
    assert.ok(dist(p.look, k.look) < 0.01, `t=${k.t} look`);
    assert.ok(Math.abs(p.fov - k.fov) < 0.01, `t=${k.t} fov`);
    assert.ok(Math.abs(p.roll - k.roll) < 0.001, `t=${k.t} roll`);
  }
});

test("cut gaps hold the next act's opening pose (old behaviour)", () => {
  const p = pose(6.005);
  const next = INTRO_KEYS.find((k) => k.t === 6.01);
  assert.ok(dist(p.pos, next.pos) < 0.01);
  assert.ok(dist(p.look, next.look) < 0.01);
});

test("no stop-start at intermediate keys: velocity stays continuous inside an act", () => {
  // Old smoothstep path had ~0 speed at every key (derivative of the
  // smoothstep is 0 at both ends). The spline must keep the camera
  // clearly moving through each key. The bar is absolute (>5 u/s)
  // plus relative (>10% of the act peak): Act 1 deliberately slows
  // for the gate pass (17 u/s) after the 78 u/s aerial dive, which is
  // a dolly slow-down, not a stop.
  const midKeys = [2.6, 4.0, 4.8, 5.4, 5.7, 9.0, 15.0, 21.0, 27.0];
  for (const t of midKeys) {
    const actStart = Math.floor(t / 6) * 6;
    let peak = 0;
    for (let s = actStart + 0.2; s < actStart + 5.8; s += 0.2) peak = Math.max(peak, speedAt(s));
    const atKey = speedAt(t);
    assert.ok(atKey > 5, `t=${t}: speed at key ${atKey.toFixed(1)} u/s (camera stopped)`);
    assert.ok(atKey > 0.1 * peak, `t=${t}: speed at key ${atKey.toFixed(1)} u/s, act peak ${peak.toFixed(1)} u/s`);
  }
});

test("eases in from rest at t=0 and out to rest at t=30", () => {
  assert.ok(speedAt(0.1) < 0.5 * speedAt(1.0), `start speed ${speedAt(0.1).toFixed(1)} vs cruise ${speedAt(1.0).toFixed(1)}`);
  assert.ok(speedAt(29.9) < 0.5 * speedAt(29.0), `end speed ${speedAt(29.9).toFixed(1)} vs cruise ${speedAt(29.0).toFixed(1)}`);
});

test("Act 1: high/wide start, dive to the road, gate, roof pull-up, plaza settle", () => {
  const y0 = pose(0).pos[1];
  const y26 = pose(2.6).pos[1];
  const y40 = pose(4.0).pos[1];
  const yGate = pose(4.8).pos[1];
  const yRoof = pose(5.4).pos[1];
  const yEnd = pose(6.0).pos[1];
  assert.ok(y0 > 100, `starts high (${y0})`);
  assert.ok(y0 > y26 && y26 > y40, `dives to the road ${y0} > ${y26} > ${y40}`);
  assert.ok(yGate > 6 && yGate < 9, `passes the gate under the arch (y=${yGate})`);
  assert.ok(yRoof > yGate, `pulls up over the station roof (${yRoof})`);
  assert.ok(yEnd < 6.5, `settles near eye level in the plaza (${yEnd})`);
  // Approach key frames the gate from ~55-80u out (gate ~half a phone frame wide).
  const gate = [0, 14.6, 44];
  const d = dist(pose(2.6).pos, gate);
  assert.ok(d > 50 && d < 85, `gate distance at approach ${d.toFixed(1)}`);
  // Plaza settle: north of the station (z<27.5), clear of the fountain
  // collider (z 5.8..18.2), looking north across the fountain.
  const end = pose(6.0);
  assert.ok(end.pos[2] > 19 && end.pos[2] < 27, `settles inside the plaza (z=${end.pos[2]})`);
  assert.ok(end.look[2] < end.pos[2] && end.look[1] > 5, `looks north across the plaza`);
});

test("Act 1: camera actually passes THROUGH the gate arch", () => {
  // Gate stands at z=44, arch clearance ~9.5u, turnstiles 1.15u tall.
  // The old path stopped at z=62 and never crossed it.
  let crossed = false;
  for (let t = 4.0; t <= 5.4; t += 0.01) {
    const p = pose(t).pos;
    if (Math.abs(p[2] - 44) < 0.5) {
      assert.ok(Math.abs(p[0]) < 1, `on the road axis at the gate (x=${p[0]})`);
      assert.ok(p[1] > 6 && p[1] < 9.5, `under the arch, over the turnstiles (y=${p[1].toFixed(2)})`);
      crossed = true;
    }
  }
  assert.ok(crossed, "camera crosses z=44 between t=4.0 and t=5.4");
});

test("Act 1: clears the station roof-trim beams (visual-only, no collider)", () => {
  // The station roof has black trim beams at y 7.42..8.02 on both roof
  // edges (z=41.85 north, z=27.65 south). They carry no collider, so
  // the clearance probe cannot see them — pin the spline above them.
  // The camera must also never dip INTO the station hall (z 27.5..42
  // below the 7.12 roofline) on its way over.
  for (let t = 4.8; t <= 6.0; t += 0.005) {
    const p = pose(t).pos;
    if (Math.abs(p[2] - 41.85) < 0.4) assert.ok(p[1] > 8.4, `north trim at t=${t.toFixed(2)} y=${p[1].toFixed(2)}`);
    if (Math.abs(p[2] - 27.65) < 0.4) assert.ok(p[1] > 8.4, `south trim at t=${t.toFixed(2)} y=${p[1].toFixed(2)}`);
    if (p[2] > 27.5 && p[2] < 42) assert.ok(p[1] > 7.6, `over the hall roof at t=${t.toFixed(2)} y=${p[1].toFixed(2)} z=${p[2].toFixed(1)}`);
  }
});

test("whole path stays sane: above ground, fov/roll in range, finite", () => {
  for (let t = 0; t <= INTRO_LEN; t += 1 / 60) {
    const p = pose(t);
    for (const v of [...p.pos, ...p.look]) assert.ok(Number.isFinite(v), `t=${t} finite`);
    assert.ok(p.pos[1] >= 2.2, `t=${t} y=${p.pos[1].toFixed(2)} underground`);
    assert.ok(p.fov >= 48 && p.fov <= 66, `t=${t} fov=${p.fov}`);
    assert.ok(Math.abs(p.roll) <= 0.08, `t=${t} roll=${p.roll}`);
  }
});

test("no teleport inside an act: max per-frame step is bounded", () => {
  let prev = pose(0).pos;
  for (let t = 1 / 60; t <= INTRO_LEN; t += 1 / 60) {
    const p = pose(t).pos;
    const step = dist(p, prev);
    const inGap = (t > 6 && t < 6.02) || (t > 9 && t < 9.02) || (t > 12 && t < 12.02) || (t > 18 && t < 18.02) || (t > 24 && t < 24.02);
    if (!inGap) assert.ok(step < 4, `t=${t.toFixed(2)} jumped ${step.toFixed(1)}u in one frame`);
    prev = p;
  }
});
