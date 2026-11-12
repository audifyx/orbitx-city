// Route clearance check v5 for the OrbitX City bus (final segments).
// Precise segment-to-AABB distance test (diagonal legs included).
// cyanhot portal slabs are pass-through by design.
// Usage: esbuild-bundle, run with node.
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
console.log(`boxes=${city.boxes.length} colliders=${city.colliders.length}`);

const FLAT = new Set(["asphalt", "sidewalk", "plaza", "grass", "stone", "wood", "lane", "water", "track", "dirt", "cyanhot"]);
type Box = { x: number; y: number; z: number; sx: number; sy: number; sz: number; mat: string };

// Distance from segment (ax,az)-(bx,bz) to the box's XZ rect.
function segRectDist(ax: number, az: number, bx: number, bz: number, b: Box): number {
  const x0 = b.x - b.sx / 2, x1 = b.x + b.sx / 2;
  const z0 = b.z - b.sz / 2, z1 = b.z + b.sz / 2;
  // If either endpoint is inside the rect, distance is 0.
  const inRect = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  if (inRect(ax, az) || inRect(bx, bz)) return 0;
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  // Closest point on the segment to the rect centre, then clamp to rect.
  let t = ((b.x - ax) * dx + (b.z - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx, pz = az + t * dz;
  const cx = Math.max(x0, Math.min(x1, px)), cz = Math.max(z0, Math.min(z1, pz));
  return Math.hypot(px - cx, pz - cz);
}

function corridorBlocks(ax: number, az: number, bx: number, bz: number, halfW = 1.6): Box[] {
  const minX = Math.min(ax, bx) - halfW - 1, maxX = Math.max(ax, bx) + halfW + 1;
  const minZ = Math.min(az, bz) - halfW - 1, maxZ = Math.max(az, bz) + halfW + 1;
  const out: Box[] = [];
  for (const b of city.boxes as Box[]) {
    if (FLAT.has(b.mat)) continue;
    const top = b.y + b.sy / 2, bot = b.y - b.sy / 2;
    if (top < 0.3 || bot > 3.4) continue;
    if (b.x + b.sx / 2 < minX || b.x - b.sx / 2 > maxX) continue;
    if (b.z + b.sz / 2 < minZ || b.z - b.sz / 2 > maxZ) continue;
    if (segRectDist(ax, az, bx, bz, b) < halfW) out.push(b);
  }
  return out;
}

const SEGS: Array<[string, number, number, number, number]> = [
  ["H01 z72 E->dip", 145, 72, 36, 72],
  ["H02 dip N", 36, 72, 36, 36],
  ["H03 Central W", 36, 36, 0, 36],
  ["H04 Central W2", 0, 36, -36, 36],
  ["H05 dip S", -36, 36, -36, 72],
  ["H06 z72 W", -36, 72, -144, 72],
  ["H07 W edge N->Westgate", -144, 72, -144, 0],
  ["H08 Westgate->detour N", -144, 0, -144, -30.5],
  ["H09 west detour W", -144, -30.5, -258, -30.5],
  ["H10 detour S to gate lane", -258, -30.5, -258, -6],
  ["H11 gate approach E", -258, -6, -250, -6],
  ["H12 NY landing merge", -556, 0, -562, -6],
  ["H13 NY deck W", -562, -6, -654, -6],
  ["H14 NY spur S", -654, -6, -654, 144],
  ["H15 NY Brooklyn E", -654, 144, -800, 144],
  ["H16 NY Brooklyn W", -800, 144, -654, 144],
  ["H17 NY spur N", -654, 144, -654, 6],
  ["H18 NY deck E to gate", -654, 6, -554, 6],
  ["H19 home landing exit W", -244, 0, -258, -6],
  ["H20 exit N", -258, -6, -258, -30.5],
  ["H21 detour E", -258, -30.5, -144, -30.5],
  ["H22 detour S", -144, -30.5, -144, 0],
  ["H23 W edge N", -144, 0, -144, -144],
  ["H24 north edge E", -144, -144, 144, -144],
  ["H25 E edge S->Eastgate", 144, -144, 144, 0],
  ["H26 Eastgate->detour S", 144, 0, 144, 30],
  ["H27 east detour E", 144, 30, 258, 30],
  ["H28 detour N to gate lane", 258, 30, 258, 6],
  ["H29 gate approach W", 258, 6, 250, 6],
  ["H30 LA landing merge", 556, 0, 562, 6],
  ["H31 LA deck E", 562, 6, 654, 6],
  ["H32 LA spur S", 654, 6, 654, 144],
  ["H33 LA Sunset E", 654, 144, 800, 144],
  ["H34 LA Sunset W", 800, 144, 654, 144],
  ["H35 LA spur N", 654, 144, 654, -6],
  ["H36 LA deck W to gate", 654, -6, 554, -6],
  ["H37 home landing exit E", 244, 0, 258, 6],
  ["H38 exit S", 258, 6, 258, 30],
  ["H39 detour W", 258, 30, 144, 30],
  ["H40 detour N", 144, 30, 144, 0],
  ["H41 E edge S", 144, 0, 144, 72],
  ["H42 E edge S to FL leg", 144, 72, 145, 180],
  ["H43 FL leg S", 145, 180, 145, 251],
  ["H44 z251 W", 145, 251, -6.5, 251],
  ["H45 deck S to gate", -6.5, 251, -6.5, 314],
  ["H46 FL landing merge", 0, 656, -6.5, 664],
  ["H47 FL deck S", -6.5, 664, -6.5, 756],
  ["H48 FL north edge E", -6.5, 756, 38, 756],
  ["H49 FL spur jog E", 38, 756, 36, 840],
  ["H50 FL spur S", 36, 840, 36, 900],
  ["H51 FL spur jog E2", 36, 900, 38, 930],
  ["H52 FL spur S2 Palms", 38, 930, 38, 1044],
  ["H53 FL spur N", 38, 1044, 38, 930],
  ["H54 FL spur jog W", 38, 930, 36, 900],
  ["H55 FL spur N2", 36, 900, 36, 840],
  ["H56 FL spur jog W2", 36, 840, 38, 756],
  ["H57 FL north edge W", 38, 756, -6.5, 756],
  ["H58 FL deck N to gate", -6.5, 756, -6.5, 654],
  ["H59 home landing merge W", 0, 312, -6.5, 312],
  ["H60 deck N", -6.5, 312, -6.5, 251],
  ["H61 z251 E", -6.5, 251, 145, 251],
  ["H62 FL leg N", 145, 251, 145, 72],
];

let bad = 0;
for (const [name, ax, az, bx, bz] of SEGS) {
  const blocks = corridorBlocks(ax, az, bx, bz);
  if (blocks.length === 0) { console.log(`OK   ${name}`); continue; }
  bad++;
  console.log(`BLOCKED ${name} (${blocks.length})`);
  for (const b of blocks.slice(0, 6)) {
    console.log(`   ${b.mat} at (${b.x},${b.y},${b.z}) size ${b.sx}x${b.sy}x${b.sz}`);
  }
}
console.log(`${bad} segments blocked of ${SEGS.length}`);

function rectCheck(name: string, x0: number, z0: number, x1: number, z1: number) {
  const hits = (city.boxes as Box[]).filter((b) => {
    if (FLAT.has(b.mat)) return false;
    const top = b.y + b.sy / 2, bot = b.y - b.sy / 2;
    if (top < 0.3 || bot > 3.4) return false;
    return b.x + b.sx / 2 > x0 && b.x - b.sx / 2 < x1 && b.z + b.sz / 2 > z0 && b.z - b.sz / 2 < z1;
  });
  console.log(`${hits.length === 0 ? "CLEAR " : "BUSY  "} ${name} (${hits.length})` + (hits.length ? " e.g. " + hits.slice(0, 4).map((b) => `${b.mat}@(${b.x},${b.z})`).join(" ") : ""));
}
rectCheck("Central shelter plaza x-4..4 z25..28", -4, 25, 4, 28);
rectCheck("Eastgate shelter x150..158 z-4..4", 150, -4, 158, 4);
rectCheck("Westgate shelter x-158..-150 z-4..4", -158, -4, -150, 4);
rectCheck("LA stop shelter x792..808 z150..158", 792, 150, 808, 158);
rectCheck("NY stop shelter x-808..-792 z150..158", -808, 150, -792, 158);
rectCheck("FL stop shelter E x44..52 z1040..1048", 44, 1040, 52, 1048);
