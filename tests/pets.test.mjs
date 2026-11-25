// PETS (round 7): adoptable companions that follow the player around the
// city. These tests drive the PURE follow math plus the headless sim
// (three.js Scene works without a renderer, localStorage is absent in
// Node so saves no-op there) and prove: trailing, catch-up run,
// far-away teleport catch-up, stay mode, petting, and the 3-pet cap.
//
// Run: SOL_USD=100 node --test tests/pets.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  PET_CATALOG,
  PET_CATCH_UP_DIST,
  PET_FOLLOW_DIST,
  PET_MAX,
  PET_MIN_DIST,
  PET_TELEPORT_DIST,
  angleDelta,
  createPetSim,
  followTargetFor,
  loadSavedPets,
  normalizePets,
  petMood,
  petSpeedFor,
  planPetStep,
  turnToward,
} from "../web/src/game/pets.ts";
import { Group, Scene } from "../web/node_modules/three/build/three.module.js";

const DT = 1 / 60;

function playerAt(x = 0, z = 0, yaw = 0) {
  return { x, z, yaw };
}

test("pets: follow target trails behind the player, fanned out by slot", () => {
  // Facing -Z (yaw 0): forward is (0, -1), so behind is +Z.
  const t0 = followTargetFor(playerAt(0, 0, 0), 0);
  assert.ok(Math.abs(t0.x - 0) < 1e-9, "slot 0 trails straight behind");
  assert.ok(t0.z > PET_FOLLOW_DIST - 0.01 && t0.z < PET_FOLLOW_DIST + 0.6, `slot 0 z ~ ${PET_FOLLOW_DIST}, got ${t0.z}`);
  const t1 = followTargetFor(playerAt(0, 0, 0), 1);
  const t2 = followTargetFor(playerAt(0, 0, 0), 2);
  assert.notEqual(Math.sign(t1.x), Math.sign(t2.x), "slots 1 and 2 fan to opposite sides");
  assert.ok(Math.abs(t1.x - t2.x) > 1, "pets do not stack on one spot");
});

test("pets: planPetStep walks toward the target and stops short of it", () => {
  const step = planPetStep({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 10 }, DT, { speed: 5 });
  assert.ok(step.moving, "moves when far from the target");
  assert.ok(step.z > 0 && step.z < 10, "advances without overshooting");
  assert.ok(Math.abs(step.z - 5 * DT) < 1e-9, "moves at exactly speed * dt");
  const close = planPetStep({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0.2 }, DT, { speed: 5 });
  assert.equal(close.moving, false, "stops inside stopDist instead of jittering");
  assert.equal(close.x, 0);
  assert.equal(close.z, 0);
});

test("pets: planPetStep never moves faster than speed * dt (no teleport into the player)", () => {
  const step = planPetStep({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0.5 }, DT, { speed: 9.5 });
  assert.ok(step.z <= 9.5 * DT + 1e-9, "step is capped by speed");
  assert.ok(step.z >= 0.5 - 0.35 - 1e-9, "stops stopDist short of the target");
});

test("pets: turnToward turns the short way around and clamps the step", () => {
  assert.ok(Math.abs(angleDelta(0, Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9, "wraps across ±PI");
  const turned = turnToward(0, Math.PI, 0.5);
  assert.ok(Math.abs(turned - 0.5) < 1e-9, "turns at most maxStep per call");
  assert.equal(turnToward(0, 0.1, 0.5), 0.1, "snaps when inside maxStep");
});

test("pets: run speed past the catch-up distance, walk speed near", () => {
  assert.equal(petSpeedFor("dog", PET_CATCH_UP_DIST + 1), PET_CATALOG.dog.runSpeed);
  assert.equal(petSpeedFor("dog", 2), PET_CATALOG.dog.walkSpeed);
  assert.equal(petSpeedFor("cat", PET_CATCH_UP_DIST + 1), PET_CATALOG.cat.runSpeed);
});

test("pets: mood follows happiness", () => {
  assert.equal(petMood(90), "Happy");
  assert.equal(petMood(50), "Content");
  assert.equal(petMood(10), "Sad");
});

test("pets: normalizePets drops bad rows, clamps the cap and fills defaults", () => {
  const out = normalizePets({
    pets: [
      { id: "a", species: "dog", coat: "golden", name: "  Rex  ", mode: "follow", happiness: 120, adoptedAt: 1 },
      { id: "b", species: "fish", coat: "x", name: "Nope" },
      { species: "cat", coat: "nope", name: "", mode: "stay", happiness: -5 },
      { id: "d", species: "dog", coat: "snow", name: "D4" },
      { id: "e", species: "cat", coat: "grey", name: "E5" },
    ],
  });
  assert.equal(out.length, PET_MAX, "caps at 3 pets");
  assert.equal(out[0].name, "Rex", "trims names");
  assert.equal(out[0].happiness, 100, "clamps happiness to 100");
  assert.equal(out[1].species, "cat", "keeps the valid cat, drops the fish");
  assert.equal(out[1].coat, "grey", "falls back to a real coat");
  assert.equal(out[1].happiness, 0, "clamps happiness to 0");
  assert.ok(out[1].name.length > 0, "empty name gets a default");
  assert.deepEqual(loadSavedPets(), [], "no localStorage in Node: nothing restored");
});

test("pets: sim adopts, follows, runs to catch up, and teleports when far away", () => {
  const scene = new Scene();
  const sim = createPetSim(scene);
  assert.equal(sim.count(), 0);
  const adopted = sim.adopt("dog", "golden", "Rex", { x: 0, z: 0 });
  assert.equal(adopted.ok, true, adopted.message);
  assert.equal(sim.count(), 1);
  assert.equal(sim.list()[0].name, "Rex");
  assert.equal(sim.list()[0].mode, "follow");

  // Walk the player away slowly: the pet trails behind, never inside
  // the player and never further than a few metres back.
  const ctx = { onFoot: true, lowQuality: false };
  let player = playerAt(0, 0, 0);
  for (let i = 0; i < 600; i++) {
    player = playerAt(0, -i * 0.05, 0); // strolling north at 3 u/s
    sim.update(DT, player, ctx);
    const snap = sim.list()[0];
    assert.ok(snap.dist < PET_CATCH_UP_DIST + 1, `pet keeps up while walking (dist ${snap.dist})`);
  }
  const afterWalk = sim.list()[0];
  assert.ok(afterWalk.dist >= PET_MIN_DIST - 0.01, "pet never stands inside the player");
  assert.ok(afterWalk.dist < 6, `pet trails close behind, dist ${afterWalk.dist}`);

  // Player sprints away: the pet runs (catch-up speed) and closes in.
  const far = playerAt(0, -60, 0);
  sim.update(DT, far, ctx); // one frame to register the new gap
  const before = sim.list()[0].dist;
  assert.ok(before > PET_CATCH_UP_DIST, "sprint puts the pet in catch-up range");
  for (let i = 0; i < 300; i++) sim.update(DT, far, ctx);
  assert.ok(sim.list()[0].dist < before, "pet closes the gap while running");

  // Player teleports across the city: the pet catches up beside them
  // instead of running the whole way.
  const across = playerAt(500, 500, 0);
  sim.update(DT, across, ctx);
  assert.ok(sim.list()[0].dist < PET_TELEPORT_DIST, `pet teleports to catch up, dist ${sim.list()[0].dist}`);
  assert.ok(sim.list()[0].dist < 5, "pet lands trailing the player");
});

test("pets: stay mode holds position; follow resumes on command", () => {
  const scene = new Scene();
  const sim = createPetSim(scene);
  sim.adopt("cat", "ginger", "Milo", { x: 0, z: 0 });
  const ctx = { onFoot: true, lowQuality: false };
  sim.update(DT, playerAt(0, 0, 0), ctx);
  assert.equal(sim.setMode(sim.list()[0].id, "stay"), "Milo will stay here.");
  assert.equal(sim.list()[0].mode, "stay");
  // Player walks 40 units away: a staying pet stays put (small wander only).
  for (let i = 0; i < 300; i++) sim.update(DT, playerAt(0, -40, 0), ctx);
  assert.ok(sim.list()[0].dist > 30, `staying pet does not follow, dist ${sim.list()[0].dist}`);
  assert.equal(sim.setMode(sim.list()[0].id, "follow"), "Milo is following you again.");
  for (let i = 0; i < 600; i++) sim.update(DT, playerAt(0, -40, 0), ctx);
  assert.ok(sim.list()[0].dist < 5, `following pet returns to the player, dist ${sim.list()[0].dist}`);
});

test("pets: petting raises happiness, waits while the player drives, cap of 3", () => {
  const scene = new Scene();
  const sim = createPetSim(scene);
  sim.adopt("dog", "golden", "Rex", { x: 0, z: 0 });
  const id = sim.list()[0].id;
  const before = sim.list()[0].happiness;
  assert.match(sim.pet(id), /wags happily/);
  assert.ok(sim.list()[0].happiness > before, "petting raises happiness");
  assert.equal(sim.rename(id, "  Biscuit  "), "Your pet is now called Biscuit.");
  assert.equal(sim.list()[0].name, "Biscuit");
  assert.equal(sim.rename(id, "   "), "Give your pet a name first.");

  // While driving the pet waits where it is.
  const ctx = { onFoot: false, lowQuality: false };
  for (let i = 0; i < 120; i++) sim.update(DT, playerAt(100, 100, 0), ctx);
  assert.ok(sim.list()[0].dist > 50, "pet waits while the player drives away");

  sim.adopt("cat", "grey", "Milo", { x: 0, z: 0 });
  sim.adopt("dog", "snow", "Snow", { x: 0, z: 0 });
  assert.equal(sim.count(), PET_MAX);
  const fourth = sim.adopt("cat", "ginger", "Extra", { x: 0, z: 0 });
  assert.equal(fourth.ok, false, "fourth adoption is refused");
  assert.match(fourth.message, /already have 3 pets/);
  assert.equal(sim.release(id), "Biscuit found a new home.");
  assert.equal(sim.count(), PET_MAX - 1);
  assert.equal(scene.children.filter((c) => c instanceof Group && c.name === "pets").length, 1, "one pets root in the scene");
});
