// Audit: floor-aware interior coverage + facade enterability + door lanes.
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
// The OrbitX Tower is the one deliberate exception: its stepped hero
// mesh (pretty solidTower) has no door gap, so no in-scope interior
// can be reached. Everything else solid is an empty block.
const emptyBlocks = solidIds.filter((id) => !id.startsWith("tower("));
console.log("emptyBlockBuildings=" + emptyBlocks.length);
for (const id of emptyBlocks.slice(0, 20)) console.log("  EMPTY " + id);

// Counts that must be real (built, furnished, enterable), not just counted.
const homesByState: Record<string, number> = {};
for (const f of city.facades.filter((x) => /^home-(ny|la|fl)-/.test(x.id))) {
  const s = f.id.split("-")[1] ?? "?";
  homesByState[s] = (homesByState[s] ?? 0) + 1;
}
const homesEnterable = city.facades.filter((x) => x.id.startsWith("home-")).every((x) => x.enterable);
console.log("homesByState=" + JSON.stringify(homesByState) + " homesTotal=" +
  Object.values(homesByState).reduce((a, b) => a + b, 0) + " allEnterable=" + homesEnterable);
const venueKinds = ["shop", "cafe", "bank", "garage", "arcade", "market", "cinema", "library", "gym", "museum", "hotel", "casino", "nightclub", "dock", "hall", "project", "mall", "office", "stadium", "park"];
const venueFacades = city.facades.filter((f) => venueKinds.some((k) => f.id === k || f.id.startsWith(k + "-")));
console.log("venueFacades=" + venueFacades.length + " venueEnterable=" + venueFacades.filter((f) => f.enterable).length);
const blockZones = city.zones.filter((z) => z.id.startsWith("block-")).length;
const districtZones = city.zones.filter((z) => /^(ny|la|fl)-b-\d+$/.test(z.id)).length;
const landmarkZones = city.zones.filter((z) => z.id.endsWith("-landmark")).length;
console.log(`blockInteriors=${blockZones} districtBlockInteriors=${districtZones} landmarkInteriors=${landmarkZones}`);

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

// Door-lane check: for every enterable facade with a door, the 4-wide
// gap (y 0..2.95, 1.5 inside + 1.5 outside the wall) must stay
// PASSABLE — a clear run of >= 1.2 units along the gap, from outside to
// inside. A thin tree trunk or hedge chunk at the edge of the approach
// is passable (walk around it); a run under 1.2 is not. Wall runs beside
// the gap and the lintel (y>=3) never intersect this volume.
const cols = city.colliders;
const blocked: string[] = [];
for (const f of city.facades) {
  if (!f.enterable || !f.door) continue;
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  let gx0: number, gx1: number, gz0: number, gz1: number;
  if (f.door === "n") { gx0 = cx - 1.5; gx1 = cx + 1.5; gz0 = f.z - 1.5; gz1 = f.z + 1.5; }
  else if (f.door === "s") { gx0 = cx - 1.5; gx1 = cx + 1.5; gz0 = f.z + f.d - 1.5; gz1 = f.z + f.d + 1.5; }
  else if (f.door === "w") { gx0 = f.x - 1.5; gx1 = f.x + 1.5; gz0 = cz - 1.5; gz1 = cz + 1.5; }
  else { gx0 = f.x + f.w - 1.5; gx1 = f.x + f.w + 1.5; gz0 = cz - 1.5; gz1 = cz + 1.5; }
  const alongX = f.door === "n" || f.door === "s";
  const lo = alongX ? gx0 : gz0;
  const hi = alongX ? gx1 : gz1;
  const blockedIntervals: Array<[number, number]> = [];
  cols.forEach((c) => {
    if (c.minY >= 2.95 || c.maxY <= 0.3) return;
    if (c.maxX <= gx0 || c.minX >= gx1 || c.maxZ <= gz0 || c.minZ >= gz1) return;
    const a0 = Math.max(lo, alongX ? c.minX : c.minZ);
    const a1 = Math.min(hi, alongX ? c.maxX : c.maxZ);
    if (a1 - a0 > 0.02) blockedIntervals.push([a0, a1]);
  });
  blockedIntervals.sort((p, q) => p[0] - q[0]);
  let widest = 0, cursor = lo;
  for (const [a0, a1] of blockedIntervals) {
    if (a0 > cursor) widest = Math.max(widest, a0 - cursor);
    cursor = Math.max(cursor, a1);
  }
  if (hi > cursor) widest = Math.max(widest, hi - cursor);
  if (widest < 1.2) {
    blocked.push(`${f.id} door=${f.door} widestClear=${widest.toFixed(2)} blocked=${JSON.stringify(blockedIntervals.map(([a, b]) => [Number(a.toFixed(1)), Number(b.toFixed(1))]))}`);
  }
}
console.log("doorLanesBlocked=" + blocked.length);
for (const line of blocked.slice(0, 40)) console.log("  BLOCKED " + line);
