// Bus route check: simulate the real BusSim loop and test the full bus
// footprint (9 long x 2.6 wide) against the built world (buildCity(1)):
//   - OFF-ROAD: any footprint sample point not on ground-level asphalt
//     (roads, bridge decks, aprons, dept aprons). Sidewalk slabs and the
//     plaza do NOT count as road — the bus must stay on a road.
//   - CLIP: any footprint sample point inside a building collider
//     (maxY > 0.5, minY < 2.5 — tall enough to hit the bus body).
// Usage: esbuild-bundle, run with node.
import { buildCity } from "./web/src/game/city";
import { BusSim, BUS_WAYPOINTS, BUS_LENGTH, BUS_WIDTH } from "./web/src/game/bus";

const city = buildCity(1);
console.log(`boxes=${city.boxes.length} colliders=${city.colliders.length}`);

// --- road rects: ground-level asphalt (top <= 0.15) -----------------------
interface Rect { x0: number; z0: number; x1: number; z1: number }
const roads: Rect[] = [];
for (const b of city.boxes) {
  if (b.mat !== "asphalt") continue;
  const top = b.y + b.sy / 2;
  if (top > 0.15) continue;
  roads.push({ x0: b.x - b.sx / 2, z0: b.z - b.sz / 2, x1: b.x + b.sx / 2, z1: b.z + b.sz / 2 });
}
console.log(`roadRects=${roads.length}`);

// --- building colliders: tall enough to hit the bus body ------------------
interface Col { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number }
const cols: Col[] = [];
for (const c of city.colliders) {
  if (c.maxY <= 0.5 || c.minY >= 2.5) continue;
  cols.push({ x0: c.minX, z0: c.minZ, x1: c.maxX, z1: c.maxZ, y0: c.minY, y1: c.maxY });
}
console.log(`tallColliders=${cols.length}`);

// --- spatial hash (cell 10) for roads + colliders -------------------------
const CELL = 10;
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
function index<T extends { x0: number; z0: number; x1: number; z1: number }>(items: T[]): Map<string, number[]> {
  const g = new Map<string, number[]>();
  items.forEach((r, i) => {
    for (let gx = Math.floor(r.x0 / CELL); gx <= Math.floor(r.x1 / CELL); gx++)
      for (let gz = Math.floor(r.z0 / CELL); gz <= Math.floor(r.z1 / CELL); gz++) {
        const k = `${gx},${gz}`;
        const a = g.get(k) ?? [];
        a.push(i);
        g.set(k, a);
      }
  });
  return g;
}
const roadGrid = index(roads);
const colGrid = index(cols);
const onRoad = (x: number, z: number): boolean => {
  const arr = roadGrid.get(key(x, z));
  if (!arr) return false;
  return arr.some((i) => x >= roads[i].x0 && x <= roads[i].x1 && z >= roads[i].z0 && z <= roads[i].z1);
};
const hitCol = (x: number, z: number): Col | null => {
  const arr = colGrid.get(key(x, z));
  if (!arr) return null;
  for (const i of arr) {
    const c = cols[i];
    if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return c;
  }
  return null;
};

// --- simulate the loop ------------------------------------------------------
const HALF_L = BUS_LENGTH / 2; // 4.5
const HALF_W = BUS_WIDTH / 2; // 1.3
// footprint sample offsets (along, across): 5 x 3 grid
const SAMPLES: Array<[number, number]> = [];
for (const a of [-HALF_L, -HALF_L / 2, 0, HALF_L / 2, HALF_L])
  for (const w of [-HALF_W, 0, HALF_W]) SAMPLES.push([a, w]);

const sim = new BusSim();
const DT = 0.05;
let t = 0;
let offRoadDist = 0;
let clipDist = 0;
let totalDist = 0;
let prevX = sim.x, prevZ = sim.z;
// aggregate contiguous bad runs: {kind, leg, startT, endT, x0,z0,x1,z1, maxGap}
interface Run { kind: string; leg: number; t0: number; t1: number; x0: number; z0: number; x1: number; z1: number; worst: string }
let curOff: Run | null = null;
let curClip: Run | null = null;
const offRuns: Run[] = [];
const clipRuns: Run[] = [];
const closeRun = (run: Run | null, list: Run[]) => { if (run) list.push(run); return null; };

const STOPS = new Set(Object.keys({}).length ? [] : []);
let steps = 0;
while (t < 900 && steps < 20000) {
  sim.update(DT);
  t += DT;
  steps++;
  const dx = sim.x - prevX, dz = sim.z - prevZ;
  const moved = Math.hypot(dx, dz);
  totalDist += moved;
  prevX = sim.x; prevZ = sim.z;
  if (sim.dwelling) { curOff = closeRun(curOff, offRuns); curClip = closeRun(curClip, clipRuns); continue; }
  const fx = Math.sin(sim.yaw), fz = -Math.cos(sim.yaw);
  const rx = Math.cos(sim.yaw), rz = Math.sin(sim.yaw);
  let off = false, offPt = "";
  let clip: Col | null = null;
  for (const [a, w] of SAMPLES) {
    const px = sim.x + fx * a + rx * w;
    const pz = sim.z + fz * a + rz * w;
    if (!off && !onRoad(px, pz)) { off = true; offPt = `(${px.toFixed(1)},${pz.toFixed(1)})`; }
    if (!clip) { const c = hitCol(px, pz); if (c) clip = c; }
    if (off && clip) break;
  }
  if (off) {
    offRoadDist += moved;
    if (!curOff) curOff = { kind: "offroad", leg: sim.target, t0: t, t1: t, x0: sim.x, z0: sim.z, x1: sim.x, z1: sim.z, worst: offPt };
    else { curOff.t1 = t; curOff.x1 = sim.x; curOff.z1 = sim.z; }
  } else curOff = closeRun(curOff, offRuns);
  if (clip) {
    clipDist += moved;
    const c = clip as Col;
    const desc = `col x${c.x0.toFixed(1)}..${c.x1.toFixed(1)} z${c.z0.toFixed(1)}..${c.z1.toFixed(1)} y${c.y0.toFixed(1)}..${c.y1.toFixed(1)}`;
    if (!curClip) curClip = { kind: "clip", leg: sim.target, t0: t, t1: t, x0: sim.x, z0: sim.z, x1: sim.x, z1: sim.z, worst: desc };
    else { curClip.t1 = t; curClip.x1 = sim.x; curClip.z1 = sim.z; if (!curClip.worst.includes(desc)) curClip.worst += ` | ${desc}`; }
  } else curClip = closeRun(curClip, clipRuns);
}
closeRun(curOff, offRuns);
closeRun(curClip, clipRuns);

console.log(`simTime=${t.toFixed(0)}s totalDist=${totalDist.toFixed(0)} offRoadDist=${offRoadDist.toFixed(0)} clipDist=${clipDist.toFixed(0)}`);
console.log(`waypoints=${BUS_WAYPOINTS.length} finalTarget=${sim.target} finalPos=(${sim.x.toFixed(1)},${sim.z.toFixed(1)})`);
console.log(`\nOFF-ROAD RUNS (${offRuns.length}):`);
for (const r of offRuns) {
  const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0).toFixed(0);
  console.log(`  leg->wp${r.leg} t=${r.t0.toFixed(0)}..${r.t1.toFixed(0)}s from (${r.x0.toFixed(1)},${r.z0.toFixed(1)}) to (${r.x1.toFixed(1)},${r.z1.toFixed(1)}) ~${len}u worstPt=${r.worst}`);
}
console.log(`\nBUILDING-CLIP RUNS (${clipRuns.length}):`);
for (const r of clipRuns) {
  const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0).toFixed(0);
  console.log(`  leg->wp${r.leg} t=${r.t0.toFixed(0)}..${r.t1.toFixed(0)}s from (${r.x0.toFixed(1)},${r.z0.toFixed(1)}) to (${r.x1.toFixed(1)},${r.z1.toFixed(1)}) ~${len}u ${r.worst}`);
}
