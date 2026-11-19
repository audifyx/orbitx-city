// Find a clear 22x22 lot for the Trading Floor: count tall colliders whose
// centre falls inside each candidate rect (ground slabs / roads excluded by
// maxY > 1). Run with: npx tsx lot-check-trading.ts  (from repo root)
import { buildCity } from "./web/src/game/city";

const city = buildCity(1);
const cols = city.colliders;
const zones = city.zones ?? [];

const CANDIDATES: Record<string, [number, number, number, number]> = {
  A_arcadeSouth: [43, 65, 7, 29],
  E_hallNorth: [43, 65, 115, 137],
  F_garageNorth: [79, 101, 79, 101],
  G_plazaEast: [43, 65, -29, -7],
  H_bankSouth: [79, 101, -29, -7],
  I_westStrip: [-65, -43, 7, 29],
};

for (const [name, [x0, x1, z0, z1]] of Object.entries(CANDIDATES)) {
  let tall = 0;
  const samples: string[] = [];
  for (const c of cols) {
    const mx = (c.minX + c.maxX) / 2;
    const mz = (c.minZ + c.maxZ) / 2;
    if (mx >= x0 && mx <= x1 && mz >= z0 && mz <= z1 && c.maxY > 1) {
      tall++;
      if (samples.length < 4) samples.push(`~(${mx.toFixed(0)},${mz.toFixed(0)}) y${c.minY.toFixed(1)}-${c.maxY.toFixed(1)}`);
    }
  }
  const zonesHere = zones.filter((z: any) => {
    const zx = (z.minX + z.maxX) / 2;
    const zz = (z.minZ + z.maxZ) / 2;
    return zx >= x0 && zx <= x1 && zz >= z0 && zz <= z1;
  }).map((z: any) => z.id);
  console.log(`${name} [${x0},${x1}]x[${z0},${z1}]: tallColliders=${tall} zones=${JSON.stringify(zonesHere)} ${samples.join(" ")}`);
}
