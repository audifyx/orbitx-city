// Probe: Trading Floor building + interior. Bundled with esbuild and run
// by tests/trading-floor-city.test.mjs (node can't resolve the game's
// extensionless TS imports directly). Exits non-zero on any failure.
//
// The floor is a store INSIDE the Mega Mall's north half (44,-16,22,22,
// door south into the mall hall). The mall-g / mall-2 floor zones cover
// the whole mall, so they overlap — but fixed-place zones come first in
// the zones array, so zoneAt() returns trading for a player inside it.
import { buildCity } from "../web/src/game/city.ts";

const failures: string[] = [];
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
};

const city = buildCity(1);
const boxes = (city as any).boxes ?? [];
const cols = city.colliders;
const zones = city.zones as any[];

// --- Zone ---
const z = zones.find((zz) => zz.id === "trading");
check(!!z, "trading zone exists");
check(z?.name === "OrbitX Trading Floor", `trading zone name is OrbitX Trading Floor (got ${z?.name})`);
check(z?.kind === "trading", `trading zone kind is trading (got ${z?.kind})`);
check(Math.abs((z?.minX ?? 0) - 45.15) < 0.01 && Math.abs((z?.maxX ?? 0) - 64.85) < 0.01, `trading zone x rect 45.15..64.85 (got ${z?.minX}..${z?.maxX})`);
check(Math.abs((z?.minZ ?? 0) - -14.85) < 0.01 && Math.abs((z?.maxZ ?? 0) - 4.85) < 0.01, `trading zone z rect -14.85..4.85 (got ${z?.minZ}..${z?.maxZ})`);
check(Math.abs((z?.serviceX ?? 0) - 61.5) < 0.01 && Math.abs((z?.serviceZ ?? 0) - -5) < 0.01, `service point at the middle back-row desk stool (61.5, -5) (got ${z?.serviceX}, ${z?.serviceZ})`);
// EVERY desk is a service point (2026-11-19 fix): the original build
// only wired the middle back-row stool, and the front row walled it
// off — players at the other five desks got no prompt, no terminal.
const sps = (z?.servicePoints ?? []) as Array<{ x: number; z: number }>;
check(sps.length === 6, `6 desk service points (got ${sps.length})`);
check(sps.some((p) => Math.abs(p.x - 58.1) < 0.01 && Math.abs(p.z - -5) < 0.01), "front-row middle stool (58.1, -5) is a service point");
check(sps.some((p) => Math.abs(p.x - 61.5) < 0.01 && Math.abs(p.z - -9.5) < 0.01), "back-row north stool (61.5, -9.5) is a service point");
// Trading must precede the mall floor zones, or zoneAt() would return
// mall-g for a player standing inside the floor.
const tradingIdx = zones.findIndex((zz) => zz.id === "trading");
const mallIdx = zones.findIndex((zz) => zz.id === "mall-g");
check(tradingIdx >= 0 && mallIdx >= 0 && tradingIdx < mallIdx, `trading zone precedes mall-g in the zones array (trading ${tradingIdx}, mall-g ${mallIdx})`);

// --- Interior: desks + computers ---
const inRect = (b: any) => b.x >= 44 && b.x <= 66 && b.z >= -16 && b.z <= 6;
const desks = boxes.filter((b: any) => inRect(b) && b.mat === "black" && Math.abs(b.sy - 1.0) < 0.01 && b.sx >= 1.1 && b.sx <= 1.3);
check(desks.length === 6, `6 trading desks (got ${desks.length})`);
check(desks.every((b: any) => b.sz >= 2.3 && b.sz <= 2.5), `desks slimmed to 2.4 deep so the row gaps are walkable (got ${desks.map((b: any) => b.sz).join(",")})`);
// Ceiling skirt seals the rim gap (mall lights floated over the room).
const skirt = boxes.filter((b: any) => b.mat === "ceil" && Math.abs(b.y - 3.62) < 0.1 && b.x - b.sx / 2 <= 44.6 && b.x + b.sx / 2 >= 44.6 && b.z - b.sz / 2 <= -5 && b.z + b.sz / 2 >= -5);
check(skirt.length >= 1, "ceiling skirt covers the west rim point (44.5, -5)");
const screens = boxes.filter((b: any) => inRect(b) && b.mat === "cyanhot" && b.sy >= 0.7 && b.sy <= 0.9);
check(screens.length >= 6, `6+ glowing computer screens (got ${screens.length})`);
const goldTrim = boxes.filter((b: any) => inRect(b) && b.mat === "gold" && b.sy <= 0.1);
check(goldTrim.length >= 6, `gold desk trim present (got ${goldTrim.length})`);
const ticker = boxes.filter((b: any) => inRect(b) && b.mat === "black" && b.sy >= 0.9 && b.sy <= 1.1 && b.sz >= 14);
check(ticker.length >= 1, `ticker board on the back wall (got ${ticker.length})`);

// --- Entrance lane: south door (55, 6) north to the service approach ---
// The north-south lane at x=55 (door centre) must be clear of tall
// colliders, and the north gap around the middle front-row desk
// (z -7.5, x 55..61.5) must be clear so the player can reach the stool.
const tallIn = (minX: number, maxX: number, minZ: number, maxZ: number) =>
  cols.filter((c: any) => c.maxX > minX && c.minX < maxX && c.maxZ > minZ && c.minZ < maxZ && c.maxY - c.minY > 1.2 && c.minY < 2 && !(typeof c.tag === "string" && c.tag.startsWith("door:")));
check(tallIn(54, 56, -5, 6).length === 0, `entrance lane (x 54..56, z -5..6) clear (blocked by ${tallIn(54, 56, -5, 6).length})`);
check(tallIn(55, 61.5, -8, -6.5).length === 0, `north gap approach (z -8..-6.5, x 55..61.5) clear (blocked by ${tallIn(55, 61.5, -8, -6.5).length})`);

// --- No other zone overlaps the trading rect except the mall floors ---
const overlap = zones.filter((zz) => zz.id !== "trading" && zz.id !== "mall-g" && zz.id !== "mall-2" && zz.minX < 66 && zz.maxX > 44 && zz.minZ < 6 && zz.maxZ > -16);
check(overlap.length === 0, `no other zone overlaps the trading lot (got ${overlap.map((o: any) => o.id).join(",")})`);

// --- No mall store anchor inside the trading rect ---
const anchors = (city as any).anchors ?? [];
const storeInside = anchors.filter((a: any) => a.id.startsWith("store-") && a.x >= 44 && a.x <= 66 && a.z >= -16 && a.z <= 6);
check(storeInside.length === 0, `no mall store anchor inside the trading floor (got ${storeInside.map((a: any) => a.id).join(",")})`);

// --- Door anchor: south door into the mall hall, spot clear ---
const doorAnchor = anchors.find((a: any) => a.id === "trading");
check(!!doorAnchor, "trading door anchor exists");
check(doorAnchor ? Math.abs(doorAnchor.x - 55) < 0.01 && Math.abs(doorAnchor.z - 7.4) < 0.01 : false, `door anchor at (55, 7.4) in the mall hall (got ${doorAnchor?.x}, ${doorAnchor?.z})`);
check(tallIn(53, 57, 5.4, 9.4).length === 0, `door anchor spot clear (blocked by ${tallIn(53, 57, 5.4, 9.4).length})`);

if (failures.length) {
  console.log(`\nTRADING FLOOR CHECKS FAILED: ${failures.length}`);
  process.exit(1);
}
console.log("\nALL TRADING FLOOR CHECKS PASSED");
