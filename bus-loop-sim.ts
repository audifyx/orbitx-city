// Headless proof of the City Loop bus route logic (no rendering):
// step BusSim through a full cycle and assert it visits every stop,
// hops all six bridge gates (3 out, 3 back), and closes the loop.
import { BusSim, BUS_WAYPOINTS, BUS_STOP_AT } from "./web/src/game/bus";
import { bridgeGateFor } from "./web/src/game/states";

const bus = new BusSim();
const stopsSeen: string[] = [];
const hopsSeen: string[] = [];
let steps = 0;
let lastDwell = false;
let maxSpeed = 0;
let nan = false;
const startX = bus.x, startZ = bus.z;

while (steps < 200000) {
  bus.update(0.05);
  steps++;
  if (!isFinite(bus.x) || !isFinite(bus.z) || !isFinite(bus.yaw) || !isFinite(bus.speed)) { nan = true; break; }
  maxSpeed = Math.max(maxSpeed, bus.speed);
  if (bus.dwelling && !lastDwell && bus.atStop) stopsSeen.push(`${bus.atStop.id}@${bus.x},${bus.z}`);
  lastDwell = bus.dwelling;
  const gate = bus.takeHop();
  if (gate) hopsSeen.push(`${gate.bridgeId}/${gate.side}->${gate.to}@(${bus.x},${bus.z})`);
  // Full cycle: back at waypoint 0 dwelling at Central after visiting stops.
  if (steps > 1000 && bus.target === 1 && bus.dwelling && bus.atStop?.id === "central" && stopsSeen.length >= 10) break;
}
const gameSeconds = steps * 0.05;
console.log(`steps=${steps} gameTime=${gameSeconds.toFixed(0)}s (${(gameSeconds / 60).toFixed(1)} min)`);
console.log(`stops visited (${stopsSeen.length}): ${stopsSeen.join(" | ")}`);
console.log(`hops (${hopsSeen.length}): ${hopsSeen.join(" | ")}`);
console.log(`maxSpeed=${maxSpeed.toFixed(1)} final=(${bus.x.toFixed(1)},${bus.z.toFixed(1)}) target=${bus.target} nan=${nan}`);
console.log(`waypoints=${BUS_WAYPOINTS.length} stopsDefined=${Object.keys(BUS_STOP_AT).length}`);
const outbound = hopsSeen.filter((h) => h.includes("/a->"));
const ok =
  !nan &&
  stopsSeen.length === 11 &&
  new Set(stopsSeen.map((s) => s.split("@")[0])).size === 6 &&
  hopsSeen.length === 6 &&
  outbound.length === 3 &&
  new Set(outbound.map((h) => h.split("->")[1].split("@")[0])).size === 3;
console.log(ok ? "BUS LOOP OK" : "BUS LOOP FAILED");
process.exit(ok ? 0 : 1);
