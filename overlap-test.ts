// Overlap check: list collider pairs whose AABBs intersect by > 0.05 on
// every axis (touching faces are fine). Uses a 10-unit spatial hash.
// Usage: esbuild-bundle, run with node. Prints counts by class + first 40
// of the non-benign ones.
//
// Classes (benign by construction, counted but not listed):
//   wallCorner: tall thin overlap (ox,oz <= 1.05, oy > 2) — two wall
//     runs crossing at a corner (pushWallColliders/addWallCols do this
//     on purpose; the union is the same wall). City voxel walls are 1
//     thick, state walls 0.6, hence the 1.05 bound.
//   ceilingEdge: a thin edge touch — at least two of (ox,oy,oz)
//     <= 0.25, e.g. a ceiling slab edge kissing a wall top
//     (stateCeiling insets its slab by 0.4 while the wall runs are
//     0.6 thick, so the slab overlaps each wall by 0.2 x 0.12).
//   other: everything else — a real defect: furniture clipping a wall,
//     two solids intersecting, a door lane blocked.
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
let wallCorner = 0, ceilingEdge = 0, other = 0;
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
        if (ox <= 1.05 && oz <= 1.05 && oy > 2) { wallCorner++; continue; }
        const thin = [ox, oy, oz].filter((v) => v <= 0.25).length;
        if (thin >= 2) { ceilingEdge++; continue; }
        other++;
        const tag = (c: any) => c.tag ?? "";
        const ix = ((Math.max(A.minX, B.minX) + Math.min(A.maxX, B.maxX)) / 2).toFixed(1);
        const iy = ((Math.max(A.minY, B.minY) + Math.min(A.maxY, B.maxY)) / 2).toFixed(1);
        const iz = ((Math.max(A.minZ, B.minZ) + Math.min(A.maxZ, B.maxZ)) / 2).toFixed(1);
        hits.push(`overlap i=${i} j=${j} at ~(${ix},${iy},${iz}) ox=${ox.toFixed(2)} oy=${oy.toFixed(2)} oz=${oz.toFixed(2)} tags=[${tag(A)}|${tag(B)}]`);
      }
    }
  }
}
console.log(`overlappingColliderPairs=${wallCorner + ceilingEdge + other} wallCorner=${wallCorner} ceilingEdge=${ceilingEdge} other=${other}`);
for (const h of hits.slice(0, 40)) console.log("  " + h);
