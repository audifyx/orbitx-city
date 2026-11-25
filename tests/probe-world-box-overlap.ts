// Probe: box-level 3D overlap audit (diagnostic for the "broke houses /
// buildings blended" report). Bundled with esbuild and run by node — same
// pattern as tests/probe-doors-floor.ts.
//
// Finds pairs of boxes whose 3D volumes genuinely intersect (not just
// touch). Interior furniture sits in hollow rooms, so a real volume
// overlap between two solid boxes means something is stuck inside
// something else. Sorted by overlap volume, biggest first — structural
// interpenetration shows up as tens to hundreds of cubic units; tiny
// seam overlaps (<2u3) are usually intentional joints.
import { buildCity } from "../web/src/game/city.ts";

const city = buildCity(1);
const boxes = city.boxes;
console.log(`boxes: ${boxes.length}`);

// Uniform-grid broad phase (cell 24u) so the pairwise test stays cheap.
const CELL = 24;
const grid = new Map<string, number[]>();
const key = (cx: number, cz: number) => `${cx},${cz}`;
for (let i = 0; i < boxes.length; i++) {
  const b = boxes[i]!;
  const x0 = Math.floor((b.x - b.sx / 2) / CELL);
  const x1 = Math.floor((b.x + b.sx / 2) / CELL);
  const z0 = Math.floor((b.z - b.sz / 2) / CELL);
  const z1 = Math.floor((b.z + b.sz / 2) / CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const k = key(cx, cz);
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(i);
    }
  }
}

type Hit = { a: number; b: number; vol: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; am: string; bm: string; asx: number; asy: number; asz: number; bsx: number; bsy: number; bsz: number };
const hits: Hit[] = [];
const seen = new Set<string>();
for (const arr of grid.values()) {
  for (let ii = 0; ii < arr.length; ii++) {
    for (let jj = ii + 1; jj < arr.length; jj++) {
      const i = arr[ii]!;
      const j = arr[jj]!;
      const pair = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ox = Math.min(a.x + a.sx / 2, b.x + b.sx / 2) - Math.max(a.x - a.sx / 2, b.x - b.sx / 2);
      if (ox <= 0.01) continue;
      const oy = Math.min(a.y + a.sy / 2, b.y + b.sy / 2) - Math.max(a.y - a.sy / 2, b.y - b.sy / 2);
      if (oy <= 0.01) continue;
      const oz = Math.min(a.z + a.sz / 2, b.z + b.sz / 2) - Math.max(a.z - a.sz / 2, b.z - b.sz / 2);
      if (oz <= 0.01) continue;
      const vol = ox * oy * oz;
      if (vol > 1) {
        hits.push({ a: i, b: j, vol, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, am: a.mat, bm: b.mat, asx: a.sx, asy: a.sy, asz: a.sz, bsx: b.sx, bsy: b.sy, bsz: b.sz });
      }
    }
  }
}
hits.sort((p, q) => q.vol - p.vol);
console.log(`box pairs with 3D overlap volume > 1u3: ${hits.length}`);
for (const h of hits.slice(0, 40)) {
  console.log(
    `  OVERLAP vol=${h.vol.toFixed(1)}u3  #${h.a} ${h.am} ${h.asx.toFixed(1)}x${h.asy.toFixed(1)}x${h.asz.toFixed(1)} @(${h.ax.toFixed(1)},${h.ay.toFixed(1)},${h.az.toFixed(1)})  x  #${h.b} ${h.bm} ${h.bsx.toFixed(1)}x${h.bsy.toFixed(1)}x${h.bsz.toFixed(1)} @(${h.bx.toFixed(1)},${h.by.toFixed(1)},${h.bz.toFixed(1)})`,
  );
}
const big = hits.filter((h) => h.vol > 10);
console.log(`box pairs with overlap volume > 10u3: ${big.length}`);
// Classify the big hits by material pair — terrain layering (hill/grass)
// is intentional and invisible; anything else is suspect.
const byMat = new Map<string, number>();
for (const h of big) {
  const k = [h.am, h.bm].sort().join(" + ");
  byMat.set(k, (byMat.get(k) ?? 0) + 1);
}
for (const [k, n] of [...byMat.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  MAT-PAIR ${k}: ${n}`);
}
const TERRAIN = new Set(["hill", "grass", "grassField"]);
const suspect = big.filter((h) => !TERRAIN.has(h.am) && !TERRAIN.has(h.bm));
console.log(`big hits NOT involving terrain (hill/grass/grassField): ${suspect.length}`);
for (const h of suspect.slice(0, 30)) {
  console.log(
    `  SUSPECT vol=${h.vol.toFixed(1)}u3  #${h.a} ${h.am} ${h.asx.toFixed(1)}x${h.asy.toFixed(1)}x${h.asz.toFixed(1)} @(${h.ax.toFixed(1)},${h.ay.toFixed(1)},${h.az.toFixed(1)})  x  #${h.b} ${h.bm} ${h.bsx.toFixed(1)}x${h.bsy.toFixed(1)}x${h.bsz.toFixed(1)} @(${h.bx.toFixed(1)},${h.by.toFixed(1)},${h.bz.toFixed(1)})`,
  );
}
if (big.length) {
  console.log("WORLD BOX OVERLAP CHECKS FAILED");
  process.exit(1);
}
console.log("ALL WORLD BOX OVERLAP CHECKS PASSED");
