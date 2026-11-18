// Node check: which colliders does carHit() see at the ATV spawn (0,62)
// and along its drive path north (z 62 -> 40)? Replicates engine.ts carHit:
// query box (x±1.7, z±1.25), collider counts if maxY >= 0.5 and the box
// intersects (c.minX-1.7, c.maxX+1.7) x (c.minZ-1.25, c.maxZ+1.25).
import { buildCity } from "../web/src/game/city.ts";

const city = buildCity(1);
console.log("spawn:", JSON.stringify(city.spawn), "colliders:", city.colliders.length);

function carHit(x, z) {
  const hits = [];
  for (const c of city.colliders) {
    if (c.maxY < 0.5) continue;
    if (x > c.minX - 1.7 && x < c.maxX + 1.7 && z > c.minZ - 1.25 && z < c.maxZ + 1.25) hits.push(c);
  }
  return hits;
}

for (const z of [62, 61, 60, 58, 56, 54, 50, 46, 43, 42, 41, 40, 36, 33, 30, 27, 20, 12, 0]) {
  const hits = carHit(0, z);
  console.log(`carHit(0, ${z}): ${hits.length ? "BLOCKED by " + hits.map((c) => `[x ${c.minX}..${c.maxX} z ${c.minZ}..${c.maxZ} y ${c.minY}..${c.maxY}]`).join(" ") : "clear"}`);
}
// Also: what colliders overlap the box at the exact spawn (0,62)?
console.log("\nAll colliders with z-range touching 55..68 and x-range touching -3..3:");
for (const c of city.colliders) {
  if (c.maxZ >= 55 && c.minZ <= 68 && c.maxX >= -3 && c.minX <= 3) {
    console.log(`  x ${c.minX}..${c.maxX} z ${c.minZ}..${c.maxZ} y ${c.minY}..${c.maxY}`);
  }
}
