// Probe: world-geometry overlap audit (diagnostic for the "broke houses /
// buildings blended" report). Bundled with esbuild and run by node — same
// pattern as tests/probe-doors-floor.ts. Exits non-zero on any failure.
//
// Audits the REAL buildCity(1) output (which already includes all state
// regions + all 150 homes):
//  1. Facade 2D overlap — two building footprints sharing area = buildings
//     blended into each other.
//  2. Coplanar flush facades — two buildings sharing an exact edge plane
//     with a long shared edge = z-fighting faces.
//  3. House facades overlapping anything.
//  4. (2026-11-25) The city.ts geometry repairs: trading floor moved off
//     the mall west wall, casino road pass-through, tower tiers + porch,
//     garage bays inside their plots.
import { buildCity } from "../web/src/game/city.ts";
import { buildHomeCatalog, garageLayoutFor } from "../web/src/game/homes.ts";

const city = buildCity(1);
const facades = city.facades;

type Overlap = { a: string; b: string; area: number; ax: number; az: number; bx: number; bz: number };
const overlaps: Overlap[] = [];
const flush: Array<{ a: string; b: string; edge: string; len: number }> = [];

for (let i = 0; i < facades.length; i++) {
  const a = facades[i]!;
  const ax1 = a.x + a.w;
  const az1 = a.z + a.d;
  for (let j = i + 1; j < facades.length; j++) {
    const b = facades[j]!;
    const bx1 = b.x + b.w;
    const bz1 = b.z + b.d;
    const ox = Math.min(ax1, bx1) - Math.max(a.x, b.x);
    const oz = Math.min(az1, bz1) - Math.max(a.z, b.z);
    if (ox > 0.01 && oz > 0.01) {
      overlaps.push({ a: a.id, b: b.id, area: ox * oz, ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
    // Flush: share an exact edge plane with a long shared edge.
    const eps = 0.001;
    const zOverlap = Math.min(az1, bz1) - Math.max(a.z, b.z);
    const xOverlap = Math.min(ax1, bx1) - Math.max(a.x, b.x);
    if (zOverlap > 1) {
      if (Math.abs(ax1 - b.x) < eps || Math.abs(bx1 - a.x) < eps) {
        flush.push({ a: a.id, b: b.id, edge: "x", len: zOverlap });
      }
    }
    if (xOverlap > 1) {
      if (Math.abs(az1 - b.z) < eps || Math.abs(bz1 - a.z) < eps) {
        flush.push({ a: a.id, b: b.id, edge: "z", len: xOverlap });
      }
    }
  }
}

overlaps.sort((p, q) => q.area - p.area);
console.log(`facades: ${facades.length}`);
console.log(`facade overlaps (area > 0.01): ${overlaps.length}`);
for (const o of overlaps.slice(0, 40)) {
  console.log(`  OVERLAP ${o.area.toFixed(2)}u2  ${o.a} @(${o.ax},${o.az})  x  ${o.b} @(${o.bx},${o.bz})`);
}
console.log(`coplanar flush pairs (shared edge > 1u): ${flush.length}`);
for (const f of flush.slice(0, 40)) {
  console.log(`  FLUSH ${f.edge} len=${f.len.toFixed(1)}  ${f.a} x ${f.b}`);
}
const houseOverlaps = overlaps.filter((o) => o.a.startsWith("home") || o.b.startsWith("home"));
console.log(`house-involved overlaps: ${houseOverlaps.length}`);

// Wings are L-shaped annexes: the Wing record (dx/dz relative to the
// facade origin) extends the footprint beyond the shrunk main rect, so a
// wing can still overlap a neighbour even when the main rects clear.
type Rect = { id: string; x: number; z: number; w: number; d: number; kind: string };
const rects: Rect[] = [];
for (const f of facades) {
  rects.push({ id: f.id, x: f.x, z: f.z, w: f.w, d: f.d, kind: "main" });
  if (f.wing) {
    rects.push({ id: `${f.id}:wing`, x: f.x + f.wing.dx, z: f.z + f.wing.dz, w: f.wing.w, d: f.wing.d, kind: "wing" });
  }
  if (f.crown) {
    // Crowns sit on the roof (centered) — 2D overlap with the main rect
    // is by design; skip.
  }
}
const rectOverlaps: Overlap[] = [];
for (let i = 0; i < rects.length; i++) {
  const a = rects[i]!;
  for (let j = i + 1; j < rects.length; j++) {
    const b = rects[j]!;
    if (a.id.split(":")[0] === b.id.split(":")[0]) continue; // same building
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
    if (ox > 0.01 && oz > 0.01) {
      rectOverlaps.push({ a: `${a.id}(${a.kind})`, b: `${b.id}(${b.kind})`, area: ox * oz, ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  }
}
rectOverlaps.sort((p, q) => q.area - p.area);
console.log(`facade+wing rect overlaps: ${rectOverlaps.length}`);
for (const o of rectOverlaps.slice(0, 20)) {
  console.log(`  RECT-OVERLAP ${o.area.toFixed(2)}u2  ${o.a} @(${o.ax},${o.az})  x  ${o.b} @(${o.bx},${o.bz})`);
}

// Intentional overlaps (NOT defects — keep this list tight):
//  - `<state>-tower` x `<state>-tower-upper`: stepped towers — the upper
//    tier rises from inside the lobby footprint by design (states.ts
//    buildOfficeTower / furnishStateTower).
//  - `trading` x `megamall`: the trading floor is a store INSIDE the Mega
//    Mall's north half by design (city.ts addFixedPlaces, 2026-11-19).
const INTENTIONAL: Array<[string, string]> = [
  ["ny-tower", "ny-tower-upper"],
  ["la-tower", "la-tower-upper"],
  ["fl-tower", "fl-tower-upper"],
  ["megamall", "trading"],
];
const isIntentional = (a: string, b: string) =>
  INTENTIONAL.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
const realOverlaps = overlaps.filter((o) => !isIntentional(o.a, o.b));
const realRectOverlaps = rectOverlaps.filter(
  (o) => !isIntentional(o.a.split("(")[0]!, o.b.split("(")[0]!),
);
if (realOverlaps.length !== overlaps.length) {
  console.log(`(ignored ${overlaps.length - realOverlaps.length} intentional stepped-tower / in-mall overlaps)`);
}

const failures: string[] = [];
if (realOverlaps.length > 0) failures.push(`${realOverlaps.length} facade overlaps`);
if (flush.length > 0) failures.push(`${flush.length} coplanar flush pairs`);
if (realRectOverlaps.length > 0) failures.push(`${realRectOverlaps.length} facade+wing rect overlaps`);

// --- 2026-11-25 city.ts geometry repairs ---
// Trading Floor moved 2u east: its west wall at x 46 leaves a 3-wide entry
// slot between the mall west wall (43) and the store, and the food court /
// kiosk / runner / sofas no longer sit inside its footprint.
const trading = facades.find((f) => f.id === "trading");
const mallF = facades.find((f) => f.id === "megamall");
if (!trading || !mallF) failures.push("trading/megamall facades missing");
else {
  if (trading.x !== 46) failures.push(`trading west wall at x=${trading.x}, expected 46`);
  if (trading.x - mallF.x !== 3) failures.push(`trading/mall entry slot is ${trading.x - mallF.x}u, expected 3`);
  // No food-court table (wood 2x0.1x2 at y 0.45) inside the trading rect.
  const tx1 = trading.x + trading.w;
  const tz1 = trading.z + trading.d;
  const tableInStore = city.boxes.filter(
    (b) =>
      b.mat === "wood" && b.sx === 2 && b.sy === 0.1 && b.sz === 2 && Math.abs(b.y - 0.45) < 0.01 &&
      b.x > trading.x && b.x < tx1 && b.z > trading.z && b.z < tz1,
  );
  if (tableInStore.length > 0) failures.push(`${tableInStore.length} food-court table(s) inside the trading floor`);
  // Trading floor (top 0.14) must sit proud of the mall stone floor (0.12),
  // not coplanar with it.
  const tFloor = city.boxes.find((b) => b.mat === "black" && b.sx === 19.6 && b.sz === 19.6 && Math.abs(b.x - 57) < 0.01 && Math.abs(b.z - -5) < 0.01);
  const mFloor = city.boxes.find((b) => b.mat === "stone" && b.sx === 55.6 && b.sz === 55.6 && Math.abs(b.x - 72) < 0.01 && Math.abs(b.z) < 0.01);
  if (!tFloor || !mFloor) failures.push("trading/mall floor slabs missing");
  else if (Math.abs(tFloor.y + tFloor.sy / 2 - (mFloor.y + mFloor.sy / 2)) < 0.01) {
    failures.push("trading floor top is coplanar with the mall floor (z-fight)");
  }
}
// Casino: the z=-180 road passes through it (passThrough "n").
const casino = facades.find((f) => f.id === "casino");
if (!casino) failures.push("casino facade missing");
else if (casino.passThrough !== "n") failures.push(`casino passThrough is ${casino.passThrough ?? "none"}, expected "n"`);
// Tower: tiers match pretty's solidTower (facade h 60, not 72), and the
// deleted porch left no invisible post collider in front of the south door.
const tower = facades.find((f) => f.id === "tower");
if (!tower) failures.push("tower facade missing");
else if (tower.h > 60) failures.push(`tower facade h=${tower.h}, expected <= 60`);
const porchPost = city.colliders.find((c) => {
  const cx = (c.minX + c.maxX) / 2;
  const cy = (c.minY + c.maxY) / 2;
  const cz = (c.minZ + c.maxZ) / 2;
  const sx = c.maxX - c.minX;
  const sy = c.maxY - c.minY;
  const sz = c.maxZ - c.minZ;
  return (
    Math.abs(cz - -0.6) < 0.4 &&
    (Math.abs(cx - 4) < 0.4 || Math.abs(cx + 4) < 0.4 || Math.abs(cx - 8) < 0.4 || Math.abs(cx + 8) < 0.4) &&
    Math.abs(cy - 2.7) < 0.4 && sx < 1 && sz < 1 && sy > 4
  );
});
if (porchPost) failures.push("tower porch post collider still stands at the door");
// Garage bays stay inside their home's 36x36 plot (worst case: 4 cars).
// NOTE: bay.w is the LATERAL width and bay.d the OUTWARD depth — the x/z
// extents follow the door axis (bay.fx/fz outward, bay.sx/sz lateral).
const homes = buildHomeCatalog(1);
let bayOut = 0;
for (const home of homes) {
  const layout = garageLayoutFor(home, 4);
  const pcx = home.x0 + home.w / 2;
  const pcz = home.z0 + home.d / 2;
  const xHalf = Math.abs(layout.bay.fx) * layout.bay.d / 2 + Math.abs(layout.bay.sx) * layout.bay.w / 2;
  const zHalf = Math.abs(layout.bay.fz) * layout.bay.d / 2 + Math.abs(layout.bay.sz) * layout.bay.w / 2;
  const bx0 = layout.bay.cx - xHalf;
  const bx1 = layout.bay.cx + xHalf;
  const bz0 = layout.bay.cz - zHalf;
  const bz1 = layout.bay.cz + zHalf;
  if (bx0 < pcx - 18 || bx1 > pcx + 18 || bz0 < pcz - 18 || bz1 > pcz + 18) {
    bayOut++;
    if (bayOut <= 5) {
      console.log(`  BAY-OUT ${home.id} bay x ${bx0.toFixed(1)}..${bx1.toFixed(1)} z ${bz0.toFixed(1)}..${bz1.toFixed(1)} plot centre (${pcx},${pcz})`);
    }
  }
}
console.log(`garage bays outside their plot (4 cars): ${bayOut}`);
if (bayOut > 0) failures.push(`${bayOut} garage bays outside their home plot`);
if (failures.length) {
  console.log(`WORLD OVERLAP CHECKS FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("ALL WORLD OVERLAP CHECKS PASSED");
