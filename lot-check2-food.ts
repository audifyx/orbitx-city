// Targeted lot check for FOOD restaurants: zone overlap, tall colliders,
// low colliders, and road-strip crossing (roads are 10 wide on CENTERS).
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
const CENTERS = [-180, -144, -108, -72, -36, 0, 36, 72, 108, 144, 180];

function check(x0: number, z0: number, w: number, d: number, label: string) {
  const x1 = x0 + w, z1 = z0 + d;
  let tall = 0, low = 0; const tallFirst: string[] = [];
  for (const c of city.colliders) {
    if (c.minX < x1 - 0.5 && c.maxX > x0 + 0.5 && c.minZ < z1 - 0.5 && c.maxZ > z0 + 0.5) {
      if (c.maxY > 1.2) { tall++; if (tallFirst.length < 3) tallFirst.push(`x[${c.minX.toFixed(0)},${c.maxX.toFixed(0)}] z[${c.minZ.toFixed(0)},${c.maxZ.toFixed(0)}] y[${c.minY.toFixed(1)},${c.maxY.toFixed(1)}]`); }
      else if (c.maxY > 0.05) low++;
    }
  }
  const zones = city.zones.filter((zn) => zn.minX < x1 && zn.maxX > x0 && zn.minZ < z1 && zn.maxZ > z0).map((zn) => zn.id);
  const roadX = CENTERS.filter((c) => x0 < c + 5 && x1 > c - 5);
  const roadZ = CENTERS.filter((c) => z0 < c + 5 && z1 > c - 5);
  const clear = tall === 0 && zones.length === 0 && roadX.length === 0 && roadZ.length === 0;
  console.log(`${label} (${x0},${z0}) ${w}x${d}: ${clear ? "CLEAR" : "BLOCKED"} tall=${tall} low=${low} zones=[${zones.join(",")}] roadX=[${roadX.join(",")}] roadZ=[${roadZ.join(",")}] ${tallFirst.join(" ")}`);
}

check(115, 43, 20, 20, "R1 diner?");
check(-99, -100, 20, 20, "R2 west-strip?");
check(115, 150, 20, 20, "R3 SE?");
check(-30, 230, 20, 20, "R3 waterfront?");
check(115, -101, 20, 20, "R3 NE?");
check(-99, -64, 20, 20, "R2b west-strip2?");
check(26, 135, 20, 20, "alt S?");
check(56, 135, 20, 20, "alt S2?");
check(-48, 135, 20, 20, "alt S3?");
check(-10, 137, 20, 20, "alt S4?");
check(-4, -49, 20, 20, "alt N?");
check(26, -49, 20, 20, "alt N2?");
