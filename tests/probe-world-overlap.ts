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
import { buildCity } from "../web/src/game/city.ts";

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
if (failures.length) {
  console.log(`WORLD OVERLAP CHECKS FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("ALL WORLD OVERLAP CHECKS PASSED");
