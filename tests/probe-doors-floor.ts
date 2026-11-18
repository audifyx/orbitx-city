// Probe: HQ floor + dynamic doors. Bundled with esbuild and run by
// tests/city-doors-floor.test.mjs (node can't resolve the game's
// extensionless TS imports directly). Exits non-zero on any failure.
import { buildCity, doorsForFacades } from "../web/src/game/city.ts";

const failures: string[] = [];
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
};

const city = buildCity(1);

// --- Doors ---
const facadesWithDoor = city.facades.filter((f) => f.enterable && f.door);
const doors = doorsForFacades(city.facades);
check(doors.length === facadesWithDoor.length - 1, `doors ${doors.length} == facades-with-door ${facadesWithDoor.length} minus the Tower`);
check(doors.length > 300, `door count ${doors.length} > 300 (every exterior door)`);
check(!doors.some((d) => d.id === "tower"), "no door for the ORBITX Tower (solid facade stays)");
const ids = new Set(doors.map((d) => d.id));
check(ids.size === doors.length, "door ids are unique");
const byTag = new Map<string, number>();
for (const c of city.colliders) if (c.tag) byTag.set(c.tag, (byTag.get(c.tag) ?? 0) + 1);
let badCols = 0;
for (const d of doors) {
  const tag = `door:${d.id}`;
  if (byTag.get(tag) !== 1) { badCols++; continue; }
  const c = city.colliders.find((x) => x.tag === tag)!;
  const w = d.alongX ? c.maxX - c.minX : c.maxZ - c.minZ;
  if (w !== 4 || c.maxY - c.minY !== 3 || c.minY !== 0) badCols++;
}
check(badCols === 0, `every door has exactly one 4-wide x 3-high tagged collider (bad: ${badCols})`);
// Every door sits on its facade's face centre.
const facById = new Map(city.facades.map((f) => [f.id, f]));
let badPos = 0;
for (const d of doors) {
  const f = facById.get(d.id)!;
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  const ex = d.alongX ? cx : d.face === "w" ? f.x : f.x + f.w;
  const ez = d.alongX ? (d.face === "n" ? f.z : f.z + f.d) : cz;
  if (Math.abs(d.x - ex) > 0.001 || Math.abs(d.z - ez) > 0.001 || d.y0 !== 0) badPos++;
}
check(badPos === 0, `every door is on its facade face centre at y0 0 (bad: ${badPos})`);

// --- HQ floor (fall-through) ---
const zonesBelow = city.zones.filter((z) => z.minY !== undefined && z.minY < -1);
check(zonesBelow.length === 1 && zonesBelow[0]!.id === "train-plaza", `only the station is below-grade (minY < -1): ${zonesBelow.map((z) => z.id).join(",")}`);
const floorAt = (x: number, z: number) =>
  city.colliders.filter((c) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.maxY > 0 && c.maxY <= 0.2);
// Zones at minY -0.1 (slab tolerance, NOT below-grade since the < -1 fix)
// must still have a real floor collider under their centre — otherwise
// the player would fall through them if they were ever marked indoors.
const zonesMarginal = city.zones.filter((z) => z.minY !== undefined && z.minY < 0 && z.minY >= -1);
let badMarginal: string[] = [];
for (const z of zonesMarginal) {
  const cx = (z.minX + z.maxX) / 2;
  const cz = (z.minZ + z.maxZ) / 2;
  if (!floorAt(cx, cz).length) badMarginal.push(z.id);
}
check(badMarginal.length === 0, `every minY -0.1 zone has a floor collider at its centre (bad: ${badMarginal.join(",") || "none"})`);
const hqFloor = floorAt(-72, 8.5).find((c) => c.maxY === 0.12);
check(!!hqFloor, "HQ lobby floor collider exists at (-72, 8.5) with top 0.12");
if (hqFloor) check(hqFloor.minX <= -99 && hqFloor.maxX >= -45 && hqFloor.minZ <= -27 && hqFloor.maxZ >= 27, "HQ lobby floor collider spans the lobby");
const mallFloor = floorAt(72, 0).find((c) => c.maxY === 0.12);
check(!!mallFloor, "Mega Mall ground floor collider exists at (72, 0) with top 0.12");
const stationFloor = city.colliders.find((c) => c.minY === -6.3 && c.maxY === -6);
check(!!stationFloor, "underground station floor collider still present (minY -6.3, maxY -6)");

// --- Lift landings: every upper lift anchor must sit on a floor collider
// whose top is the anchor y (otherwise the rider is deposited in the open
// shaft and falls through it back to the lobby).
const liftAnchors = city.anchors.filter((a) => a.kind === "lift" && a.y > 0);
let badLanding: string[] = [];
for (const a of liftAnchors) {
  const ok = city.colliders.some((c) => a.x >= c.minX && a.x <= c.maxX && a.z >= c.minZ && a.z <= c.maxZ && Math.abs(c.maxY - a.y) < 0.5);
  if (!ok) badLanding.push(a.id);
}
check(badLanding.length === 0, `every upper lift landing sits on a floor collider (bad: ${badLanding.join(",") || "none"}; ${liftAnchors.length} landings checked)`);

if (failures.length) {
  console.error(`\n${failures.length} FAILURES`);
  process.exit(1);
}
console.log("\nALL DOOR + FLOOR CHECKS PASSED");
