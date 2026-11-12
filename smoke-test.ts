// Audit: floor-aware interior coverage + facade enterability.
// Usage: esbuild-bundle, run with node.
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
const boxes = city.boxes;
console.log(JSON.stringify({
  boxes: boxes.length, zones: city.zones.length,
  anchors: city.anchors.length, facades: city.facades.length,
}));

let bad = 0;
for (const b of boxes) {
  if (![b.x, b.y, b.z, b.sx, b.sy, b.sz].every(Number.isFinite) || b.sx <= 0 || b.sy <= 0 || b.sz <= 0) bad++;
}
console.log("badBoxes=" + bad);

// Facade audit.
let enterable = 0, solid = 0;
const solidIds: string[] = [];
for (const f of city.facades) {
  if (f.enterable) enterable++;
  else { solid++; solidIds.push(`${f.id}(${f.w}x${f.d} h${f.h})`); }
}
console.log(`facades enterable=${enterable} solid=${solid}`);
const groups: Record<string, number> = {};
for (const id of solidIds) {
  const p = id.replace(/-\d+.*$/, "").replace(/-b-\d+.*$/, "-b");
  groups[p] = (groups[p] ?? 0) + 1;
}
console.log("solidByPrefix=" + JSON.stringify(groups));

// Per-zone interior count inside the zone's own y-band (default 0..4.2).
const bare: string[] = [];
const perKind: Record<string, { n: number; min: number }> = {};
for (const z of city.zones) {
  const y0 = (z as any).minY ?? 0;
  const y1 = (z as any).maxY ?? 4.2;
  let n = 0;
  for (const b of boxes) {
    if (b.x > z.minX && b.x < z.maxX && b.z > z.minZ && b.z < z.maxZ && b.y > y0 - 0.5 && b.y < y1 + 0.5) n++;
  }
  const k = perKind[z.kind] ?? { n: 0, min: 1e9 };
  k.n++; k.min = Math.min(k.min, n);
  perKind[z.kind] = k;
  if (n < 10) bare.push(`${z.id} (${z.kind}) n=${n} y=[${y0},${y1}]`);
}
console.log("zonesWithFewerThan10InteriorBoxes=" + bare.length);
for (const line of bare) console.log("  BARE " + line);
console.log("zoneKindMinCounts=" + JSON.stringify(perKind));
