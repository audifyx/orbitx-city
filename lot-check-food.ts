// Lot check for the FOOD build: find free 20x20 restaurant lots in buildCity(1).
// Bundled with esbuild from web/src/game/city.ts; run with node.
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
const cols = city.colliders;
const zones = city.zones;

function lotClear(x0: number, z0: number, w: number, d: number) {
  const x1 = x0 + w, z1 = z0 + d;
  let hits = 0;
  let first = "";
  for (const c of cols) {
    if (c.maxY < 0.05) continue; // flat ground / roads / paths
    if (c.minX < x1 - 0.5 && c.maxX > x0 + 0.5 && c.minZ < z1 - 0.5 && c.maxZ > z0 + 0.5) {
      hits++;
      if (!first) first = `col x[${c.minX.toFixed(1)},${c.maxX.toFixed(1)}] z[${c.minZ.toFixed(1)},${c.maxZ.toFixed(1)}] y[${c.minY.toFixed(1)},${c.maxY.toFixed(1)}]`;
    }
  }
  let zoneHit = "";
  for (const zn of zones) {
    if (zn.minX < x1 && zn.maxX > x0 && zn.minZ < z1 && zn.maxZ > z0) zoneHit = zn.id;
  }
  return { clear: hits === 0 && !zoneHit, hits, first, zoneHit };
}

const candidates: Array<[number, number, string]> = [
  // south row (below hall/market row, z 115..135)
  [-29, 115, "S-market"], [7, 115, "S-shop"], [43, 115, "S-hall"], [79, 115, "S-garage"],
  // east column
  [115, 43, "E-garage"], [115, 79, "E-hall"], [115, -65, "E-bank"], [115, 7, "E-mid"], [115, -29, "E-north"],
  // north row (z -65..-45)
  [7, -65, "N-shop"], [-29, -65, "N-cafe"], [43, -65, "N-bank"], [-65, -65, "N-west"],
  // west of plaza
  [-65, 43, "W-cafe"], [-65, 79, "W-market"], [-65, 115, "W-south"],
  // far south / near park
  [7, 150, "SS-1"], [43, 150, "SS-2"], [-65, 150, "SS-3"],
  // south-east open grass
  [115, 150, "SE-1"], [150, 115, "SE-2"], [115, -101, "NE-1"], [150, -65, "NE-2"],
  // west strip gaps
  [-136, 116, "WS-1"], [-136, 80, "WS-2"], [-136, 44, "WS-3"], [-136, -101, "WS-4"],
  [-65, -101, "NW-1"], [-29, -101, "NW-2"], [7, -101, "NW-3"], [43, -101, "NW-4"],
  [79, -101, "NW-5"], [79, 150, "S-garage2"], [-65, -137, "NW-6"],
];

for (const [x0, z0, label] of candidates) {
  const r = lotClear(x0, z0, 20, 20);
  console.log(`${label} (${x0},${z0}) ${r.clear ? "CLEAR" : `blocked hits=${r.hits} zone=${r.zoneHit || "-"} ${r.first}`}`);
}
console.log(`zones=${zones.length} colliders=${cols.length}`);
console.log("zone rects:");
for (const zn of zones) console.log(`  ${zn.id} x[${zn.minX.toFixed(0)},${zn.maxX.toFixed(0)}] z[${zn.minZ.toFixed(0)},${zn.maxZ.toFixed(0)}]`);
