// Probe: OrbitX HQ build-out (2026-11-23). Bundled with esbuild and run
// by tests/hq-buildout.test.mjs. Exits non-zero on any failure.
import { buildCity } from "../web/src/game/city.ts";
import { PHOTO_SPOTS, HQ_TERMINAL_SPOTS, HQ_PODIUM_SPOT, HQ_RADIO_SPOT, HQ_BURN_SPOT, HQ_GUIDE_SPOT, HQ_FOUNDER_SPOT } from "../web/src/game/content.ts";

const failures: string[] = [];
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
};

const city = buildCity(1);

// --- Lift: six stops now, Event Hall inserted, roof on top ---
const lift = city.lifts.find((l) => l.id === "hq-lift");
check(!!lift, "hq-lift exists");
check(JSON.stringify(lift!.floors) === JSON.stringify([0, 8, 12, 16, 20, 24]), `hq lift floors are [0,8,12,16,20,24] (got ${JSON.stringify(lift!.floors)})`);
check(JSON.stringify(lift!.stops) === JSON.stringify(["Lobby", "Floor 2", "Floor 3", "Floor 4", "Event Hall", "Roof Terrace"]), `hq lift stops name all six floors (got ${JSON.stringify(lift!.stops)})`);
for (let i = 0; i <= 5; i++) {
  const a = city.anchors.find((x) => x.id === `hq-lift-${i}`);
  check(!!a && a.y === lift!.floors[i] && a.liftFloor === i, `hq-lift-${i} anchor at y=${lift!.floors[i]} with liftFloor ${i}`);
}

// --- Zones: the Event Hall band + the roof moved up ---
const zoneIds = city.zones.filter((z) => z.id.startsWith("hq-")).map((z) => z.id).sort();
check(JSON.stringify(zoneIds) === JSON.stringify(["hq-2", "hq-3", "hq-4", "hq-event", "hq-g", "hq-roof"]), `HQ zones are g/2/3/4/event/roof (got ${zoneIds.join(",")})`);
const ev = city.zones.find((z) => z.id === "hq-event")!;
check(ev.minY === 19.9 && ev.maxY === 23.9, `hq-event zone spans y 19.9..23.9 (got ${ev.minY}..${ev.maxY})`);
const roof = city.zones.find((z) => z.id === "hq-roof")!;
check(roof.minY === 23.9 && roof.maxY === 28, `hq-roof zone spans y 23.9..28 (got ${roof.minY}..${roof.maxY})`);

// --- Floors you can stand on: event slab, stage top, roof slab ---
const floorTopAt = (x: number, z: number, lo: number, hi: number) =>
  city.colliders.some((c) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.maxY >= lo && c.maxY <= hi);
check(floorTopAt(-72, 0, 19.9, 20.5), "Event Hall floor collider under the hall centre (top ~20)");
check(floorTopAt(-94, 0, 20.4, 20.5), "stage platform top collider at 20.45 (walkable step up)");
check(floorTopAt(-72, 0, 23.9, 24.5), "roof terrace floor collider (top ~24)");

// --- Signage / art for the new content ---
const artIds = new Set(city.art.map((a) => a.id));
for (const id of ["hq-dir-5", "hq-glass-room", "hq-burn", "hq-guide", "hq-term-f2", "hq-term-f3", "hq-f5-plate", "hq-event-screen", "hq-radio", "hq-event-n", "hq-event-s", "hq-kol-names-1", "hq-kol-names-2", "hq-roof-photo"]) {
  check(artIds.has(id), `sign/art "${id}" exists`);
}

// --- Interactable spots line up with the geometry + zones ---
const inHq = (x: number, z: number) => x >= -101 && x <= -43 && z >= -29 && z <= 29;
check(inHq(HQ_BURN_SPOT.x, HQ_BURN_SPOT.z) && inHq(HQ_GUIDE_SPOT.x, HQ_GUIDE_SPOT.z), "lobby spots sit inside the HQ footprint");
check(HQ_TERMINAL_SPOTS.length === 6 && HQ_TERMINAL_SPOTS.every((s) => (s.zone === "hq-2" || s.zone === "hq-3") && inHq(s.x, s.z)), "six terminal spots across hq-2/hq-3 inside the footprint");
check(inHq(HQ_FOUNDER_SPOT.x, HQ_FOUNDER_SPOT.z) && inHq(HQ_PODIUM_SPOT.x, HQ_PODIUM_SPOT.z) && inHq(HQ_RADIO_SPOT.x, HQ_RADIO_SPOT.z), "founder/podium/radio spots inside the footprint");
// The podium spot must be ON the stage platform (x -99..-89, z -12..12).
check(HQ_PODIUM_SPOT.x >= -99 && HQ_PODIUM_SPOT.x <= -89 && Math.abs(HQ_PODIUM_SPOT.z) <= 12, "podium spot is on the stage");

// --- Photo spot: rooftop, floor-pinned ---
const roofSpot = PHOTO_SPOTS.find((s) => s.id === "hq-roof");
check(!!roofSpot && roofSpot.y === 24 && roofSpot.x === -54 && roofSpot.z === 10, "hq-roof photo spot exists at (-54, 10) pinned to y=24");
check(PHOTO_SPOTS.length === 4, `four photo spots total (got ${PHOTO_SPOTS.length})`);

if (failures.length) {
  console.error(`\n${failures.length} FAILURES`);
  process.exit(1);
}
console.log("\nALL HQ BUILD-OUT CHECKS PASSED");
