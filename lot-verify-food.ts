// Which "other" overlaps fall inside the new restaurant rects vs Cafe Nova?
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
const cols = city.colliders;
const RECTS: Record<string, [number, number, number, number]> = {
  diner: [115, 135, 43, 63],
  pizza: [186, 206, 46, 66],
  fork: [78, 98, 230, 250],
  cafe: [-29, -7, 43, 65],
  gym: [60, 86, 206, 228],
};
const CELL = 10;
const grid = new Map<string, number[]>();
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
cols.forEach((c, i) => {
  const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
  const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
  for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
    const k = `${gx},${gz}`;
    const arr = grid.get(k) ?? [];
    arr.push(i);
    grid.set(k, arr);
  }
});
function cls(A: (typeof cols)[number], B: (typeof cols)[number]) {
  const ox = Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX);
  const oy = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY);
  const oz = Math.min(A.maxZ, B.maxZ) - Math.max(A.minZ, B.minZ);
  if (ox <= 0.05 || oy <= 0.05 || oz <= 0.05) return "none";
  if (ox <= 1.05 && oz <= 1.05 && oy > 2) return "wallCorner";
  const small = [ox, oy, oz].filter((v) => v <= 0.25).length;
  if (small >= 2) return "ceilingEdge";
  return "other";
}
const seen = new Set<string>();
const counts: Record<string, number> = {};
const samples: Record<string, string[]> = {};
for (const arr of grid.values()) {
  for (let a = 0; a < arr.length; a++) {
    for (let b = a + 1; b < arr.length; b++) {
      const i = arr[a], j = arr[b];
      const pair = i < j ? `${i},${j}` : `${j},${i}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const A = cols[i], B = cols[j];
      const c = cls(A, B);
      if (c !== "other") continue;
      const mx = (Math.max(A.minX, B.minX) + Math.min(A.maxX, B.maxX)) / 2;
      const mz = (Math.max(A.minZ, B.minZ) + Math.min(A.maxZ, B.maxZ)) / 2;
      for (const [name, [x0, x1, z0, z1]] of Object.entries(RECTS)) {
        if (mx >= x0 && mx <= x1 && mz >= z0 && mz <= z1) {
          counts[name] = (counts[name] ?? 0) + 1;
          (samples[name] ??= []).push(`~(${mx.toFixed(1)},${mz.toFixed(1)}) ox=${(Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX)).toFixed(2)} oy=${(Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY)).toFixed(2)} oz=${(Math.min(A.maxZ, B.maxZ) - Math.max(A.minZ, B.minZ)).toFixed(2)}`);
        }
      }
    }
  }
}
for (const [name, n] of Object.entries(counts)) {
  console.log(`${name}: ${n} "other" overlaps`);
  for (const s of (samples[name] ?? []).slice(0, 8)) console.log(`   ${s}`);
}
// Zone check: the three restaurants + kitchen points exist.
for (const z of city.zones.filter((zn) => ["diner", "pizza", "fork"].includes(zn.id))) {
  console.log(`zone ${z.id} "${z.name}" x[${z.minX.toFixed(1)},${z.maxX.toFixed(1)}] z[${z.minZ.toFixed(1)},${z.maxZ.toFixed(1)}] service=(${z.serviceX.toFixed(1)},${z.serviceZ.toFixed(1)})`);
}
const homes = city.zones.filter((zn) => zn.kitchen);
console.log(`zones with kitchen points: ${homes.length} (sample ${homes[0]?.id} at ${homes[0]?.kitchen?.x.toFixed(1)},${homes[0]?.kitchen?.z.toFixed(1)})`);
console.log(`anchors: ${city.anchors.filter((a) => ["diner", "pizza", "fork"].includes(a.id)).map((a) => `${a.id}@(${a.x.toFixed(1)},${a.z.toFixed(1)})`).join(" ")}`);
