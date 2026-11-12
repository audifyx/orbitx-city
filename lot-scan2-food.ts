// Full road-aware free-lot scan: 20x20, no zone, no tall collider, no road strip.
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
const CENTERS = [-180, -144, -108, -72, -36, 0, 36, 72, 108, 144, 180];
const onRoad = (a: number, b: number) => CENTERS.some((c) => a < c + 5 && b > c - 5);

function scan(x0: number, z0: number, w: number, d: number) {
  const x1 = x0 + w, z1 = z0 + d;
  let tall = 0, low = 0;
  for (const c of city.colliders) {
    if (c.minX < x1 - 0.5 && c.maxX > x0 + 0.5 && c.minZ < z1 - 0.5 && c.maxZ > z0 + 0.5) {
      if (c.maxY > 1.2) tall++;
      else if (c.maxY > 0.05) low++;
    }
  }
  const zone = city.zones.some((zn) => zn.minX < x1 && zn.maxX > x0 && zn.minZ < z1 && zn.maxZ > z0);
  return { tall, low, zone, road: onRoad(x0, x1) || onRoad(z0, z1) };
}

const found: Array<{ x: number; z: number; low: number }> = [];
for (let x0 = -188; x0 <= 188; x0 += 2) {
  for (let z0 = -188; z0 <= 248; z0 += 2) {
    const r = scan(x0, z0, 20, 20);
    if (!r.zone && !r.road && r.tall === 0) found.push({ x: x0, z: z0, low: r.low });
  }
}
console.log(`free road-clear 20x20 spots: ${found.length}`);
const picked: typeof found = [];
const sorted = [...found].sort((a, b) => Math.hypot(a.x, a.z - 54) + a.low * 8 - (Math.hypot(b.x, b.z - 54) + b.low * 8));
for (const s of sorted) {
  if (picked.every((p) => Math.hypot(p.x - s.x, p.z - s.z) >= 24)) {
    picked.push(s);
    if (picked.length >= 15) break;
  }
}
for (const p of picked) console.log(`  lot (${p.x},${p.z}) low=${p.low} dist=${Math.hypot(p.x, p.z - 54).toFixed(0)}`);
// What is the low collider inside (-30,230)?
for (const c of city.colliders) {
  if (c.minX < -10 - 0.5 && c.maxX > -30 + 0.5 && c.minZ < 250 - 0.5 && c.maxZ > 230 + 0.5 && c.maxY <= 1.2 && c.maxY > 0.05) {
    console.log(`  low col in waterfront lot: x[${c.minX},${c.maxX}] z[${c.minZ},${c.maxZ}] y[${c.minY},${c.maxY}]`);
  }
}
