// Cinematic intro flyover path (round 6, piece 1).
//
// The 30s / 5-act structure is UNCHANGED (same act boundaries, same
// hard cuts, same final orbit pose) — only the camera path and how it
// feels changed. Round 5 redesigned the intro overlay but left this
// path alone: it was piecewise-linear with a smoothstep per segment,
// so the camera visibly stopped dead at every keyframe and flew in
// straight lines, and Act 1 never actually passed through the gate —
// it stopped 18u short of it.
//
// The rework, modelled on style video 03 (aerial sweep -> gate ->
// plaza, see KEYFRAME-BREAKDOWN.md section 3):
//   Act 1 (0-6s): high/wide aerial over the towers, a drone dive down
//     onto the x=0 road, gate dead ahead, THROUGH the arch (camera
//     crosses z=44 at y~6, under the 9.5u arch clearance, over the
//     1.15u turnstiles, between the hanging banners), and settles in
//     the plaza at near-eye level looking across the fountain at the
//     towers — a real sense of arrival.
//   Acts 2-5: keys unchanged; the spline below is what changes them.
//
// Motion: a centripetal-ish Catmull-Rom spline through the keys of
// each act (uniform CR on the segment parameter — key times are
// honoured exactly, so beats/chapters/seek are untouched). Inside an
// act the velocity is continuous across keys: no more stop-start at
// intermediate keyframes, and the path curves instead of cornering.
// Hard cuts between acts are preserved (a `cut` key starts a new
// spline). The very first segment eases in from rest and the very
// last segment eases out to rest at the orbit pose, so the flyover
// starts and lands instead of jumping to cruise speed.
//
// Phone framing: the gate is dead-centre on the x=0 road the whole
// way in, so it reads at portrait aspect too — ~half the frame wide
// at the approach key, filling the frame as the camera passes under
// the arch (the intended "through the gate" beat, not a framing bug).
//
// Pure math, no three.js / DOM — so node tests can import it directly
// (see tests/intro-path.test.mjs) and the clearance probe can sample
// it against the real city colliders (tests/probe-intro-clearance.ts).
export const INTRO_LEN = 30;

export interface IntroKey {
  t: number;
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
  roll: number;
  cut?: boolean;
}

export interface IntroPoseOut {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
  roll: number;
}

export const INTRO_KEYS: IntroKey[] = [
  // Act 1 (0..6s): Aerial over the glass towers at dusk -> drone dive
  // onto the road -> THROUGH the ORBITX CITY gate -> pull up over the
  // Plaza Central Station roof -> settle in the plaza, fountain ahead,
  // towers beyond. Video 03, 1s (gate head-on) then 9s (plaza wide,
  // fountain in the distance).
  //
  // Why OVER the station, not through it: the station hall (x -42..42,
  // z 27.5..42, 7u tall) sits on the x=0 road between the gate (z=44)
  // and the plaza, and its street doors are only 3.2u wide x 2.72u
  // tall — a fly-through would be a glitch-prone keyhole, and the
  // hall interior (ramps, stairwell holes) is not a set piece. The
  // roof pull-up keeps the gate beat AND lands the camera in the open
  // plaza. The two roof-trim beams (y 7.42..8.02 at z=41.85 and
  // z=27.65) are visual-only, so the path is pinned to clear them:
  // y>8.4 at both (see tests/intro-path.test.mjs).
  { t: 0, pos: [70, 130, 200], look: [0, 30, 20], fov: 60, roll: 0 },
  { t: 2.6, pos: [0, 55, 110], look: [0, 16, 44], fov: 56, roll: -0.02 },
  { t: 4.0, pos: [0, 9, 60], look: [0, 10, 20], fov: 56, roll: 0.02 },
  // Gate-plane pin: the spline passes EXACTLY through (0, 8.2, 44) —
  // under the 9.5u arch, over the 1.15u turnstiles, between the
  // hanging banners. (8.2, not 6: the spline sags ~0.7 below the
  // chord just past the gate, and the station's north roof-trim beam
  // tops out at 8.02 — the pin has to sit high enough that the sag
  // still clears it. See the trim test.)
  { t: 4.8, pos: [0, 8.2, 44], look: [0, 8, 12], fov: 57, roll: 0.01 },
  { t: 5.4, pos: [0, 13, 36], look: [0, 7, 12], fov: 58, roll: 0 },
  { t: 5.7, pos: [0, 9.5, 28.5], look: [0, 6, 12], fov: 58, roll: 0 },
  { t: 6.0, pos: [0, 5.5, 23], look: [0, 6, 10], fov: 58, roll: 0 },
  // Act 2 (6..12s): Empire Span & New York -> Los Angeles & Florida coast
  { t: 6.01, pos: [-340, 58, 88], look: [-680, 36, -15], fov: 58, roll: -0.04, cut: true },
  { t: 9.0, pos: [-620, 74, 155], look: [-780, 34, -35], fov: 52, roll: 0.03 },
  { t: 9.01, pos: [480, 56, 230], look: [760, 28, 20], fov: 58, roll: -0.035, cut: true },
  { t: 12.0, pos: [190, 66, 520], look: [0, 24, 860], fov: 54, roll: 0.025 },
  // Act 3 (12..18s): Living economy — low street canyon & neighborhood homes pass
  { t: 12.01, pos: [148, 20, 92], look: [36, 12, 52], fov: 64, roll: -0.03, cut: true },
  { t: 15.0, pos: [54, 14, 56], look: [-24, 12, 36], fov: 60, roll: 0.025 },
  { t: 18.0, pos: [-52, 18, 66], look: [0, 18, 8], fov: 56, roll: -0.02 },
  // Act 4 (18..24s): Own It All — neon night pass along the Loop Train & HQ
  { t: 18.01, pos: [-96, 33, 126], look: [0, 28, 32], fov: 56, roll: 0.04, cut: true },
  { t: 21.0, pos: [14, 34, 118], look: [0, 32, -14], fov: 52, roll: -0.03 },
  { t: 24.0, pos: [108, 46, 74], look: [-8, 30, 0], fov: 54, roll: 0.02 },
  // Act 5 (24..30s): Grand finale pullback to the exact orbit camera pose
  { t: 24.01, pos: [118, 52, 82], look: [0, 28, 12], fov: 56, roll: 0.02, cut: true },
  { t: 27.0, pos: [164, 68, 54], look: [0, 27, 16], fov: 60, roll: 0.01 },
  { t: 30.0, pos: [190, 78, 10], look: [0, 26, 20], fov: 62, roll: 0 },
];

// Acts: contiguous key runs split at `cut` keys. A cut key starts a new
// act; the 0.01s gap between acts is never interpolated across.
interface Act {
  keys: IntroKey[];
  startT: number;
  endT: number;
}
const ACTS: Act[] = (() => {
  const acts: Act[] = [];
  let cur: IntroKey[] = [];
  for (const k of INTRO_KEYS) {
    if (k.cut && cur.length) {
      acts.push({ keys: cur, startT: cur[0].t, endT: cur[cur.length - 1].t });
      cur = [];
    }
    cur.push(k);
  }
  if (cur.length) acts.push({ keys: cur, startT: cur[0].t, endT: cur[cur.length - 1].t });
  return acts;
})();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Uniform Catmull-Rom through p1->p2 with neighbours p0/p3 (scalar). */
function cr(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

function cr3(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  u: number,
  out: [number, number, number],
): void {
  out[0] = cr(p0[0], p1[0], p2[0], p3[0], u);
  out[1] = cr(p0[1], p1[1], p2[1], p3[1], u);
  out[2] = cr(p0[2], p1[2], p2[2], p3[2], u);
}

// Boundary easings (f(0)=0, f(1)=1): ease-in starts from rest
// (f'(0)=0, f'(1)=1), ease-out lands at rest (f'(0)=1, f'(1)=0).
const easeIn = (u: number) => u * u * (2 - u);
const easeOut = (u: number) => 1 - (1 - u) * (1 - u) * (1 + u);

/** Intro camera pose at time t (seconds). Passes through every key at its exact time. */
export function introPose(t: number, out: IntroPoseOut): void {
  const clamped = clamp(t, 0, INTRO_LEN);
  // Find the act containing t; a t in the 0.01s gap between acts holds
  // the next act's opening pose (same as the old cut behaviour: e=1 -> b).
  let actIdx = ACTS.length - 1;
  for (let a = 0; a < ACTS.length; a++) {
    if (clamped <= ACTS[a].endT) {
      actIdx = a;
      break;
    }
    if (a + 1 < ACTS.length && clamped < ACTS[a + 1].startT) {
      const first = ACTS[a + 1].keys[0];
      out.pos = [first.pos[0], first.pos[1], first.pos[2]];
      out.look = [first.look[0], first.look[1], first.look[2]];
      out.fov = first.fov;
      out.roll = first.roll;
      return;
    }
  }
  const act = ACTS[actIdx];
  const keys = act.keys;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= clamped) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = Math.max(0.0001, b.t - a.t);
  let u = clamp((clamped - a.t) / span, 0, 1);
  // Ease in from rest on the very first segment, ease out to rest on
  // the very last one (the orbit handoff). Every other segment runs
  // pure spline so velocity stays continuous across its keys.
  if (actIdx === 0 && i === 0) u = easeIn(u);
  else if (actIdx === ACTS.length - 1 && i === keys.length - 2) u = easeOut(u);
  const p0 = keys[i - 1] ?? a;
  const p3 = keys[i + 2] ?? b;
  cr3(p0.pos, a.pos, b.pos, p3.pos, u, out.pos);
  cr3(p0.look, a.look, b.look, p3.look, u, out.look);
  out.fov = cr(p0.fov, a.fov, b.fov, p3.fov, u);
  out.roll = cr(p0.roll, a.roll, b.roll, p3.roll, u);
  // Safety nets: the spline must never put the camera underground or
  // outside sane lens values, whatever the keys do.
  out.pos[1] = Math.max(2.2, out.pos[1]);
  out.fov = clamp(out.fov, 48, 66);
  out.roll = clamp(out.roll, -0.08, 0.08);
}
