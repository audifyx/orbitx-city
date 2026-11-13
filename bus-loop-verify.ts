// Verify the fixed bus route: every stop reached, loop closes, no NaN.
import { BusSim, BUS_WAYPOINTS, BUS_STOP_AT } from "./web/src/game/bus.ts";

const sim = new BusSim();
const dwells: { t: number; wp: number; id: string; name: string }[] = [];
let prevDwelling = sim.dwelling;
let prevAtStop = sim.atStop;
let nanAt: number | null = null;
let totalDist = 0;
let px = sim.x, pz = sim.z;
let centralReturns = 0;
const T = 900;
const dt = 0.05;
for (let t = 0; t < T; t += dt) {
  sim.update(dt);
  totalDist += Math.hypot(sim.x - px, sim.z - pz);
  px = sim.x; pz = sim.z;
  if (!Number.isFinite(sim.x) || !Number.isFinite(sim.z) || !Number.isFinite(sim.yaw)) {
    if (nanAt === null) nanAt = t;
  }
  if (sim.dwelling && !prevDwelling && sim.atStop) {
    dwells.push({ t: Math.round(t * 10) / 10, wp: sim.target, id: sim.atStop.id, name: sim.atStop.name });
    if (sim.atStop.id === "central" && dwells.length > 1) centralReturns++;
  }
  prevDwelling = sim.dwelling;
  prevAtStop = sim.atStop;
}
console.log("waypoints=" + BUS_WAYPOINTS.length + " totalDist=" + Math.round(totalDist) + " nanAt=" + nanAt);
console.log("dwells=" + dwells.length);
for (const d of dwells) console.log("  t=" + d.t + "s wp=" + d.wp + " " + d.id + " (" + d.name + ")");
const stopIds = [...new Set(dwells.map((d) => d.id))].sort();
console.log("unique stops reached: " + stopIds.join(","));
console.log("central returns (loop closes): " + centralReturns);
const firstCentral = dwells.find((d) => d.id === "central");
const secondCentral = dwells.filter((d) => d.id === "central")[1];
if (firstCentral && secondCentral) console.log("loop period ~" + Math.round(secondCentral.t - firstCentral.t) + "s");
console.log("final pos=(" + sim.x.toFixed(1) + "," + sim.z.toFixed(1) + ") target=" + sim.target + " dwelling=" + sim.dwelling);
