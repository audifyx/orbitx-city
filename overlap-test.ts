// Overlap check: list collider pairs whose AABBs intersect by > 0.05 on
// every axis (touching faces are fine). Uses a 10-unit spatial hash.
// Usage: esbuild-bundle, run with node. Prints count + first 40.
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
const cols = city.colliders;
console.log(`colliders=${cols.length}`);

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

const seen = new Set<string>();
const hits: string[] = [];
for (const arr of grid.values()) {
  for (let a = 0; a < arr.length; a++) {
    for (let b = a + 1; b < arr.length; b++) {
      const i = arr[a], j = arr[b];
      const pair = i < j ? `${i},${j}` : `${j},${i}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const A = cols[i], B = cols[j];
      const ox = Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX);
      const oy = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY);
      const oz = Math.min(A.maxZ, B.maxZ) - Math.max(A.minZ, B.minZ);
      if (ox > 0.05 && oy > 0.05 && oz > 0.05) {
        const tag = (c: any) => c.tag ?? "";
        const ix = ((Math.max(A.minX, B.minX) + Math.min(A.maxX, B.maxX)) / 2).toFixed(1);
        const iy = ((Math.max(A.minY, B.minY) + Math.min(A.maxY, B.maxY)) / 2).toFixed(1);
        const iz = ((Math.max(A.minZ, B.minZ) + Math.min(A.maxZ, B.maxZ)) / 2).toFixed(1);
        hits.push(`overlap i=${i} j=${j} at ~(${ix},${iy},${iz}) ox=${ox.toFixed(2)} oy=${oy.toFixed(2)} oz=${oz.toFixed(2)} tags=[${tag(A)}|${tag(B)}]`);
      }
    }
  }
}
console.log(`overlappingColliderPairs=${hits.length}`);
for (const h of hits) console.log("  " + h);
