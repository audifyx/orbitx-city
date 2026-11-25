// Probe: intro flyover clearance against the real city (seed 1).
// Bundled with esbuild and run by tests/intro-clearance.test.mjs
// (node can't resolve the game's extensionless TS imports directly).
// Samples the spline at 240 Hz and checks the camera point against
// every city collider expanded by a 0.5u margin. Exits non-zero on
// any failure.
//
// Note: the gate itself has no collider yet (round 6, separate piece
// adds gate colliders) — gate clearance is by design in introPath.ts
// (camera crosses z=44 at y~6, under the 9.5u arch, over the 1.15u
// turnstiles) and is covered by tests/intro-path.test.mjs.
import { buildCity } from "../web/src/game/city.ts";
import { INTRO_LEN, introPose } from "../web/src/game/introPath.ts";

const failures: string[] = [];
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
};

const city = buildCity(1);
console.log(`colliders: ${city.colliders.length}`);
const out = { pos: [0, 0, 0] as [number, number, number], look: [0, 0, 0] as [number, number, number], fov: 62, roll: 0 };

const MARGIN = 0.5;
let worst = { clearance: Infinity, t: 0, pos: [0, 0, 0] as [number, number, number] };
let hits = 0;
let minY = Infinity;
const hitCols: string[] = [];
const STEP = 1 / 240;
for (let t = 0; t <= INTRO_LEN + 1e-9; t += STEP) {
  introPose(Math.min(INTRO_LEN, t), out);
  const [x, y, z] = out.pos;
  if (y < minY) minY = y;
  for (const c of city.colliders) {
    // Skip colliders far away in XZ first (cheap reject).
    if (x < c.minX - MARGIN || x > c.maxX + MARGIN || z < c.minZ - MARGIN || z > c.maxZ + MARGIN) continue;
    if (y < c.minY - MARGIN || y > c.maxY + MARGIN) continue;
    // Inside the expanded box: compute penetration depth as the
    // smallest distance to a face (negative clearance).
    const dx = Math.min(x - (c.minX - MARGIN), c.maxX + MARGIN - x);
    const dy = Math.min(y - (c.minY - MARGIN), c.maxY + MARGIN - y);
    const dz = Math.min(z - (c.minZ - MARGIN), c.maxZ + MARGIN - z);
    const clearance = -Math.min(dx, dy, dz);
    if (clearance < worst.clearance) worst = { clearance, t, pos: [x, y, z] };
    hits++;
    if (hitCols.length < 5) {
      hitCols.push(
        `t=${t.toFixed(2)} pos=(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) col=[${c.minX},${c.minY},${c.minZ}]-[${c.maxX},${c.maxY},${c.maxZ}]${c.tag ? ` tag=${c.tag}` : ""}`,
      );
    }
  }
}
check(hits === 0, `no collider hits at 240 Hz (hits=${hits}${hits ? `, worst clearance ${worst.clearance.toFixed(2)}u at t=${worst.t.toFixed(2)} pos=${worst.pos.map((v) => v.toFixed(1)).join(",")}\n  ` + hitCols.join("\n  ") : ""})`);
check(minY >= 2.2, `min camera height ${minY.toFixed(2)}u >= 2.2u`);

if (failures.length) {
  console.log(`INTRO CLEARANCE FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL INTRO CLEARANCE CHECKS PASSED");
