// Node check: buildVehicle() for every catalog id — proves whether a
// vehicle fails to BUILD (spawnActiveCar swallows the throw and the car
// simply never appears in the world). Also driveParamsFor() for every id
// (enterCar falls back to null on throw — the car would drive on the
// generic fallback, but a throw still signals a broken def).
import { buildVehicle, driveParamsFor, VEHICLES } from "../web/src/game/vehicles.ts";

let fails = 0;
for (const v of VEHICLES) {
  try {
    const g = buildVehicle(v.id, v.defaultColor);
    const kind = g.userData.kind;
    const wheels = g.children.filter((c) => c.name === "wheel").length;
    console.log(`OK   ${v.id} kind=${kind} fly=${!!g.userData.fly} wheels=${wheels} children=${g.children.length}`);
  } catch (e) {
    fails++;
    console.log(`FAIL buildVehicle(${v.id}): ${e.message}`);
  }
  try {
    const p = driveParamsFor(v.id);
    console.log(`     params ${v.id}: maxSpeed=${p.maxSpeed.toFixed(1)} accel=${p.accel.toFixed(1)} pushToGo=${p.pushToGo} climb=${p.climb}`);
  } catch (e) {
    fails++;
    console.log(`FAIL driveParamsFor(${v.id}): ${e.message}`);
  }
}
console.log(fails ? `\n${fails} FAILURES` : `\nALL ${VEHICLES.length} VEHICLES BUILD + PARAMS OK`);
process.exit(fails ? 1 : 0);
