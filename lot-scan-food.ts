// Systematic free-lot scan for FOOD restaurants: 20x20 rects with no zone
// overlap and no TALL collider overlap (maxY > 1.2 = building/tree/wall).
// Low colliders (lamps, bollards, y <= 1.2) are counted, not blocking.
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
const cols = city.colliders;
const zones = city.zones;

function scan(x0: number, z0: number, w: number, d: number) {
  const x1 = x0 + w, z1 = z0 + d;
  let tall = 0, low = 0;
  for (const c of cols) {
    if (c.minX < x1 - 0.5 && c.maxX > x0 + 0.5 && c.minZ < z1 - 0.5 && c.maxZ > z0 + 0.5) {
      if (c.maxY > 1.2) tall++;
      else if (c.maxY > 0.05) low++;
    }
  }
  let zone = "";
  for (const zn of zones) {
    if (zn.minX < x1 && zn.maxX > x0 && zn.minZ < z1 && zn.maxZ > z0) { zone = zn.id; break; }
  }
  return { tall, low, zone };
}

// Focus on the main city (not the state regions at |x|>600 / z>700).
const found: Array<{ x: number; z: number; low: number }> = [];
for (let x0 = -190; x0 <= 190; x0 += 2) {
  for (let z0 = -195; z0 <= 235; z0 += 2) {
    const r = scan(x0, z0, 20, 20);
    if (!r.zone && r.tall === 0) found.push({ x: x0, z: z0, low: r.low });
  }
}
console.log(`free 20x20 spots (no zone, no tall collider): ${found.length}`);
// Cluster: keep spots at least 24 apart, preferring low lamp counts and
// closeness to the plaza (0,54).
const picked: typeof found = [];
const sorted = [...found].sort((a, b) => {
  const da = Math.hypot(a.x - 0, a.z - 54) + a.low * 8;
  const db = Math.hypot(b.x - 0, b.z - 54) + b.low * 8;
  return da - db;
});
for (const s of sorted) {
  if (picked.every((p) => Math.hypot(p.x - s.x, p.z - s.z) >= 24)) {
    picked.push(s);
    if (picked.length >= 12) break;
  }
}
for (const p of picked) {
  console.log(`  lot (${p.x},${p.z}) low-colliders=${p.low} dist-to-plaza=${Math.hypot(p.x - 0, p.z - 54).toFixed(0)}`);
}
