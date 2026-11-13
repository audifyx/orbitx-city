// bus.ts — the OrbitX City Loop bus.
//
// One bus, one continuous real-time loop: home <-> New York / Los Angeles /
// Florida over the three real bridges. It drives the actual roads (no
// teleport — the bridges are continuous physical decks now, same as every
// car and walker drives),
// pulls up to real stops, dwells so the player can board / alight, then
// carries on. Riding is FREE — no City Sol, no real SOL, no burn, no wallet.
//
// Route (verified against buildCity(1) — see bus-route-check.ts, kept in
// the repo root as the clearance script): the ENTIRE loop stays on roads,
// like the train stays on its track — but on the bus's own loop, not the
// train's route. Every reversal is a rectangular block loop on real roads
// (never a U-turn on one road); every leg runs a road centreline, and the
// bus's full 9 x 2.6 footprint clears every building by its half-width.
//   - Central moved to (0,72) on the z=72 road: the old stop (0,36) sat
//     INSIDE the Plaza Central underground train station hall (x -42..42,
//     z 27.5..42), over its stairwell hole, and the z=36 road is blocked
//     both ways by the train station shelters (posts at x=+-47/+-61) — so
//     the bus cannot use z=36 at all. The Central Station canopy stays in
//     the plaza (a short walk south, through the hall's north door); the
//     stop itself is on the z=72 road, clear of every building.
//   - Eastgate / Westgate reversals loop the block east/west of the stop
//     (x=180 / x=-180, z=-36..72): x=108 is unusable (monorail pillars
//     stand at x=+-110, exactly on the bus's edge) and z=0 is blocked by
//     the gate shelters themselves.
//   - The bridge mouths are blocked by the district towers, so the bus
//     detours around them on REAL roads — east around the East Tower at
//     z=28, west around the West Tower's fire dept at z=-68 — and crosses
//     each deck on an offset lane (the deck lamps run down the middle).
//     Each detour joins its deck through a 10-wide gap cut in the deck
//     rail at the mouth (a proper road junction, like an on-ramp); the
//     south deck's east half is buried under a hill, so the FL lane is
//     x=-6.5.
//   - The south approach runs a REAL road at x=55 (z 180..251) + a z=251
//     link to the Palms Span apron: x=0 is blocked by a building, x=+-36
//     by the pond, x=72 by a building, x=144/145 by a yard + trees.
//   - Deck lanes merge to the region road centreline (z=0 / x=0) only
//     past the last deck lamp, on the state-side aprons.
//   - The train buffer stops moved 6 units off the x=+-144 roads (to
//     x=+-137, still on the track bed) — they sat in the middle of the
//     north-south road and the bus clipped them on every crossing.
//   - LA / NY use x=+-654, not the grid +-656: hedges front the road at
//     x=+-657 and the bus clears them by 1.3u at 654.
//
// The bus itself is a waypoint follower with a capped turn rate: it slows
// for sharp turns and on tight merges past the deck lamps.

import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Material,
} from "three";
import { GOLD } from "./materials";
import type { Art, City, Mat } from "./city";
import { pushBox, pushCol } from "./states";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/** One point on the loop. The bus drives these in order, wrapping. */
export interface BusWaypoint {
  x: number;
  z: number;
}

export const BUS_WAYPOINTS: BusWaypoint[] = [
  // -- Central #2 (after Eastgate) -> Eastgate -> Sunset, LA ---------------
  // Block loop north of Central to turn around (arrive west, depart east):
  // west on z=72, north on x=-36, east on z=144, south on x=72, east.
  { x: 0, z: 72 }, // 0  Central Station
  { x: -36, z: 72 }, // 1
  { x: -36, z: 144 }, // 2
  { x: 72, z: 144 }, // 3
  { x: 72, z: 72 }, // 4
  { x: 144, z: 72 }, // 5
  { x: 144, z: 0 }, // 6  Eastgate
  // Eastgate block loop (arrive north, depart south): south on x=144,
  // east on z=-36, north on x=180, west on z=72, south on x=144.
  { x: 144, z: -36 }, // 7
  { x: 180, z: -36 }, // 8
  { x: 180, z: 72 }, // 9
  { x: 144, z: 72 }, // 10
  { x: 144, z: 28 }, // 11
  { x: 258, z: 28 }, // 12  east detour road
  { x: 258, z: 6 }, // 13  mouth (through the deck-rail gap)
  { x: 610, z: 6 }, // 14  Sunset Span, north lane
  { x: 620, z: 0 }, // 15  merge to the LA road (past the last deck lamp)
  { x: 654, z: 0 }, // 16
  { x: 654, z: 144 }, // 17
  { x: 800, z: 144 }, // 18 Sunset, LA
  // Sunset block loop south (arrive east, depart west): east on z=144,
  // south on x=836, west on z=180, north on x=764, west on z=144.
  { x: 836, z: 144 }, // 19
  { x: 836, z: 180 }, // 20
  { x: 764, z: 180 }, // 21
  { x: 764, z: 144 }, // 22
  { x: 654, z: 144 }, // 23
  { x: 654, z: 0 }, // 24
  { x: 620, z: 0 }, // 25
  { x: 610, z: -6 }, // 26  merge to the south lane
  { x: 258, z: -6 }, // 27  Sunset Span, south lane
  { x: 258, z: 28 }, // 28  mouth (through the deck-rail gap)
  { x: 144, z: 28 }, // 29
  { x: 144, z: 0 }, // 30 Eastgate
  // -- Eastgate -> Palms, FL ----------------------------------------------
  { x: 144, z: 72 }, // 31
  { x: 144, z: 180 }, // 32
  { x: 55, z: 180 }, // 33
  { x: 55, z: 251 }, // 34  south approach road
  { x: -6.5, z: 251 }, // 35  link to the Palms Span apron
  { x: -6.5, z: 710 }, // 36  Palms Span (west lane — east half is a hill)
  { x: 0, z: 720 }, // 37  merge to the FL road (past the last deck lamp)
  { x: 0, z: 756 }, // 38
  { x: 38, z: 756 }, // 39
  { x: 36, z: 840 }, // 40
  { x: 36, z: 900 }, // 41
  { x: 38, z: 930 }, // 42
  { x: 38, z: 1044 }, // 43 Palms, FL
  // Palms block loop west (arrive south, depart north): south on x=38,
  // west on z=1080, north on x=0, east on z=1044, north on x=38.
  // (The east loop is blocked by the Palms shelter, which sits on z=1044.)
  { x: 38, z: 1080 }, // 44
  { x: 0, z: 1080 }, // 45
  { x: 0, z: 1044 }, // 46
  { x: 38, z: 1044 }, // 47
  { x: 38, z: 930 }, // 48
  { x: 36, z: 900 }, // 49
  { x: 36, z: 840 }, // 50
  { x: 38, z: 756 }, // 51
  { x: 0, z: 756 }, // 52
  { x: 0, z: 720 }, // 53
  { x: -6.5, z: 710 }, // 54  merge to the west lane
  { x: -6.5, z: 251 }, // 55  Palms Span
  { x: 55, z: 251 }, // 56
  { x: 55, z: 180 }, // 57
  { x: 144, z: 180 }, // 58
  { x: 144, z: 72 }, // 59
  { x: 0, z: 72 }, // 60 Central Station
  // -- Central -> Westgate -> Brooklyn, NY --------------------------------
  { x: -72, z: 72 }, // 61
  { x: -144, z: 72 }, // 62
  { x: -144, z: 0 }, // 63 Westgate
  // Westgate block loop (mirror of Eastgate): south on x=-144, west on
  // z=-36, north on x=-180, east on z=72, south on x=-144.
  { x: -144, z: -36 }, // 64
  { x: -180, z: -36 }, // 65
  { x: -180, z: 72 }, // 66
  { x: -144, z: 72 }, // 67
  { x: -144, z: -68 }, // 68
  { x: -266, z: -68 }, // 69  west detour road
  { x: -266, z: -6 }, // 70  mouth (through the deck-rail gap)
  { x: -610, z: -6 }, // 71  Empire Span, south lane
  { x: -620, z: 0 }, // 72  merge to the NY road (past the last deck lamp)
  { x: -654, z: 0 }, // 73
  { x: -654, z: 144 }, // 74
  { x: -800, z: 144 }, // 75 Brooklyn, NY
  // Brooklyn block loop south (mirror of Sunset): west on z=144, south
  // on x=-836, east on z=180, north on x=-764, east on z=144.
  { x: -836, z: 144 }, // 76
  { x: -836, z: 180 }, // 77
  { x: -764, z: 180 }, // 78
  { x: -764, z: 144 }, // 79
  { x: -654, z: 144 }, // 80
  { x: -654, z: 0 }, // 81
  { x: -620, z: 0 }, // 82
  { x: -610, z: 6 }, // 83  merge to the north lane
  { x: -266, z: 6 }, // 84  Empire Span, north lane
  { x: -266, z: -68 }, // 85  mouth (through the deck-rail gap)
  { x: -144, z: -68 }, // 86
  { x: -144, z: 0 }, // 87 Westgate
  // -- Westgate -> Eastgate -> Central (south road home) ------------------
  { x: -144, z: -144 }, // 88
  { x: 144, z: -144 }, // 89
  { x: 144, z: 0 }, // 90 Eastgate
  { x: 144, z: 72 }, // 91
  // -> 0 Central Station
];

/** A stop the bus dwells at. `door` is where a rider steps off onto the
 * sidewalk — the shelter side, ~6 units from the bus, so boarding from the
 * shelter is a short walk to the road, not a teleport. */
export interface BusStopInfo {
  id: string;
  name: string;
  region: string;
  doorX: number;
  doorZ: number;
}

/** Waypoint index -> stop. Central / Eastgate / Westgate appear twice per
 * loop (the bus passes them on both legs). Central is at (0,72) on the
 * z=72 road — the old (0,36) stop sat inside the train station hall, so
 * the stop moved; its door is on the north side of the road, toward the
 * plaza station (a short walk south, through the hall's north door). */
export const BUS_STOP_AT: Record<number, BusStopInfo> = {
  0: { id: "central", name: "Central Station", region: "home", doorX: 0, doorZ: 66 },
  6: { id: "eastgate", name: "Eastgate", region: "home", doorX: 150, doorZ: 0 },
  18: { id: "sunset", name: "Sunset, LA", region: "la", doorX: 800, doorZ: 150 },
  30: { id: "eastgate", name: "Eastgate", region: "home", doorX: 150, doorZ: 0 },
  43: { id: "palms", name: "Palms, Florida", region: "fl", doorX: 44, doorZ: 1044 },
  60: { id: "central", name: "Central Station", region: "home", doorX: 0, doorZ: 66 },
  63: { id: "westgate", name: "Westgate", region: "home", doorX: -150, doorZ: 0 },
  75: { id: "brooklyn", name: "Brooklyn, NY", region: "ny", doorX: -800, doorZ: 150 },
  87: { id: "westgate", name: "Westgate", region: "home", doorX: -150, doorZ: 0 },
  90: { id: "eastgate", name: "Eastgate", region: "home", doorX: 150, doorZ: 0 },
};

export const BUS_SPEED = 18;
export const BUS_DWELL_S = 6;
export const BUS_TURN_RATE = 2.4;
export const BUS_SLOW_SPEED = 7;
export const BUS_ARRIVE_DIST = 1.2;
/** Boarding radius from the bus centre (matches the car's 7). */
export const BUS_BOARD_DIST = 7;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export class BusSim {
  x: number;
  z: number;
  /** Yaw convention of the world: forward = (sin yaw, -cos yaw). */
  yaw: number;
  target = 1;
  dwelling = false;
  speed = 0;
  /** The stop the bus is currently dwelling at, if any. */
  atStop: BusStopInfo | null = null;
  private dwellUntil = 0;
  private clock = 0;

  constructor() {
    const start = BUS_WAYPOINTS[0];
    this.x = start.x;
    this.z = start.z;
    // Heading west toward waypoint 1 (the Central block loop turns the
    // bus around the block north of the stop — it must start facing its
    // first target, or it U-turns on the road at spawn).
    this.yaw = -Math.PI / 2;
    // Start parked at Central Station so the loop is visible from spawn —
    // the first dwell is longer so a player walking in from spawn (32 units)
    // can catch it.
    this.dwelling = true;
    this.atStop = BUS_STOP_AT[0];
    this.dwellUntil = 8;
  }

  reset(): void {
    const start = BUS_WAYPOINTS[0];
    this.x = start.x;
    this.z = start.z;
    this.yaw = -Math.PI / 2;
    this.target = 1;
    this.dwelling = true;
    this.speed = 0;
    this.atStop = BUS_STOP_AT[0];
    this.dwellUntil = 8;
    this.clock = 0;
  }

  /** The next stop the bus will reach (scanning forward from the target). */
  nextStop(): BusStopInfo | null {
    for (let i = 0; i < BUS_WAYPOINTS.length; i++) {
      const stop = BUS_STOP_AT[(this.target + i) % BUS_WAYPOINTS.length];
      if (stop) return stop;
    }
    return null;
  }

  /** Advance the bus. Substepped internally (max 0.05s per step) so it
   * cannot tunnel through a bridge deck or collider in one frame. */
  update(dt: number): void {
    let left = dt;
    while (left > 0.0001) {
      const step = Math.min(0.05, left);
      this.step(step);
      left -= step;
    }
  }

  private step(dt: number): void {
    this.clock += dt;
    if (this.dwelling) {
      this.speed = 0;
      if (this.clock >= this.dwellUntil) {
        this.dwelling = false;
        this.atStop = null;
      }
      return;
    }
    const t = BUS_WAYPOINTS[this.target];
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < BUS_ARRIVE_DIST) {
      const stop = BUS_STOP_AT[this.target];
      if (stop) {
        this.dwelling = true;
        this.dwellUntil = this.clock + BUS_DWELL_S;
        this.atStop = stop;
      }
      this.target = (this.target + 1) % BUS_WAYPOINTS.length;
      return;
    }
    // Turn toward the waypoint at the capped rate.
    const want = Math.atan2(dx, -dz);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const turn = Math.max(-BUS_TURN_RATE * dt, Math.min(BUS_TURN_RATE * dt, diff));
    this.yaw += turn;
    // Speed: full speed on a straight, slow for a sharp turn and on tight
    // merges past deck lamps, and ease off as the target nears so the bus
    // pulls up, not past it.
    let maxSpeed = BUS_SPEED;
    if (Math.abs(diff) > 0.5) maxSpeed = Math.min(maxSpeed, BUS_SLOW_SPEED);
    if (dist < 12) maxSpeed = Math.min(maxSpeed, Math.max(4, dist * 0.9));
    if (this.speed > maxSpeed) this.speed = Math.max(maxSpeed, this.speed - 30 * dt);
    else this.speed = Math.min(maxSpeed, this.speed + 12 * dt);
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += -Math.cos(this.yaw) * this.speed * dt;
    // No hop any more (water batch): the bridges are continuous physical
    // decks, so the bus just drives across them like every car does.
  }
}

// ---------------------------------------------------------------------------
// Bus mesh — same conventions as makeCar / buildVehicle: front at +X,
// group.rotation.order YXZ, wheels named "wheel", userData length/width/kind.
// ---------------------------------------------------------------------------

export const BUS_LENGTH = 9;
export const BUS_WIDTH = 2.6;

function signTexture(lines: string[], sub: string, dark: boolean): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = dark ? "#0c0e12" : "#f4f6fa";
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = dark ? "#e0b33a" : "#111318";
  ctx.font = "bold 52px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const main = lines.join(" ");
  ctx.fillText(main, 256, lines.length > 1 ? 42 : 52);
  if (lines.length > 1) {
    ctx.font = "bold 40px Arial, sans-serif";
    ctx.fillText(lines[1], 256, 88);
  }
  ctx.fillStyle = dark ? "#f4f6fa" : "#e0b33a";
  ctx.font = "bold 26px Arial, sans-serif";
  ctx.fillText(sub, 256, 112);
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export function buildBusMesh(): Group {
  const group = new Group();
  group.rotation.order = "YXZ";
  const box = new BoxGeometry(1, 1, 1);
  const white = new MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.35, metalness: 0.25 });
  const glass = new MeshStandardMaterial({
    color: 0xbfe6ff,
    emissive: 0x3d7fa8,
    emissiveIntensity: 0.55,
    roughness: 0.12,
    metalness: 0.35,
    transparent: true,
    opacity: 0.85,
  });
  const dark = new MeshStandardMaterial({ color: 0x111318, roughness: 0.5, metalness: 0.5 });
  const chrome = new MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.8 });
  const add = (material: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const mesh = new Mesh(box, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
    return mesh;
  };
  // Body: white lower shell, glass window band, gold stripe + black roof.
  add(white, 0, 1.05, 0, 9, 1.1, 2.6);
  add(glass, 0, 1.95, 0, 7.6, 0.7, 2.55);
  add(white, 0, 2.42, 0, 9, 0.24, 2.6);
  add(dark, 0, 2.6, 0, 9, 0.12, 2.6);
  add(GOLD, 0, 1.52, 1.32, 9, 0.16, 0.05);
  add(GOLD, 0, 1.52, -1.32, 9, 0.16, 0.05);
  // Windshield + rear window.
  add(glass, 4.51, 1.95, 0, 0.06, 0.7, 2.2);
  add(glass, -4.51, 1.95, 0, 0.06, 0.7, 2.2);
  // Doors on the right side (+Z local = curb side): front + rear, dark
  // panels with a glass inset so they read as doors, not walls.
  for (const dx of [2.6, -2.6]) {
    add(dark, dx, 1.1, 1.31, 1.3, 1.7, 0.06);
    add(glass, dx, 1.75, 1.33, 1.0, 0.6, 0.06);
    add(chrome, dx, 1.1, 1.34, 0.06, 1.5, 0.05);
  }
  // Bumpers.
  add(chrome, 4.52, 0.62, 0, 0.08, 0.18, 2.4);
  add(chrome, -4.52, 0.62, 0, 0.08, 0.18, 2.4);
  // Headlights (white, emissive) + taillights (red).
  const headlamp = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 1.4, roughness: 0.2 });
  add(headlamp, 4.54, 0.95, 0.85, 0.08, 0.2, 0.5);
  add(headlamp, 4.54, 0.95, -0.85, 0.08, 0.2, 0.5);
  const tail = new MeshStandardMaterial({ color: 0xff4b5c, emissive: 0xaa1830, emissiveIntensity: 0.8, roughness: 0.3 });
  add(tail, -4.54, 0.95, 0.85, 0.08, 0.2, 0.5);
  add(tail, -4.54, 0.95, -0.85, 0.08, 0.2, 0.5);
  // Destination sign over the windshield (black, gold text) + side sign
  // (white, black text — contrast rule both ways).
  const frontSign = new Mesh(
    new PlaneGeometry(2.6, 0.66),
    new MeshStandardMaterial({ map: signTexture(["CITY LOOP"], "FREE — ALL CITIES", true), roughness: 0.4 }),
  );
  frontSign.position.set(4.56, 2.42, 0);
  frontSign.rotation.y = Math.PI / 2;
  group.add(frontSign);
  const sideSign = new Mesh(
    new PlaneGeometry(5, 0.7),
    new MeshStandardMaterial({ map: signTexture(["ORBITX · CITY LOOP"], "FREE", false), roughness: 0.4 }),
  );
  sideSign.position.set(0, 2.42, 1.33);
  group.add(sideSign);
  const sideSignL = new Mesh(
    new PlaneGeometry(5, 0.7),
    new MeshStandardMaterial({ map: signTexture(["ORBITX · CITY LOOP"], "FREE", false), roughness: 0.4 }),
  );
  sideSignL.position.set(0, 2.42, -1.33);
  sideSignL.rotation.y = Math.PI;
  group.add(sideSignL);
  // Wheels: bigger than a car's (bus), named "wheel" like makeCar.
  const wheel = new CylinderGeometry(0.45, 0.45, 0.3, 14);
  const wheelMat = new MeshStandardMaterial({ color: 0x111318, roughness: 0.6, metalness: 0.4 });
  for (const [x, z] of [
    [3.1, 1.15],
    [3.1, -1.15],
    [-3.1, 1.15],
    [-3.1, -1.15],
  ] as Array<[number, number]>) {
    const mesh = new Mesh(wheel, wheelMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 0.45, z);
    mesh.name = "wheel";
    group.add(mesh);
    const hub = new Mesh(new CylinderGeometry(0.2, 0.2, 0.32, 10), chrome);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, 0.45, z);
    group.add(hub);
  }
  group.userData.length = BUS_LENGTH;
  group.userData.width = BUS_WIDTH;
  group.userData.kind = "bus";
  return group;
}

// ---------------------------------------------------------------------------
// Station + stops — built into the city (boxes / colliders / art signs).
// Every footprint below was clearance-checked against buildCity(1).
// ---------------------------------------------------------------------------

interface ShelterSpec {
  /** Stop id (matches BUS_STOP_AT). */
  id: string;
  name: string;
  /** Centre of the shelter. */
  x: number;
  z: number;
  /** Long axis: "ns" (along a north-south road) or "ew" (east-west road). */
  axis: "ns" | "ew";
  /** rotY of the sign plane so the text faces the road. */
  signRotY: number;
  /** Sign position (above the shelter, facing the road). */
  signX: number;
  signZ: number;
}

const SHELTERS: ShelterSpec[] = [
  { id: "eastgate", name: "EASTGATE", x: 154, z: 0, axis: "ns", signRotY: -Math.PI / 2, signX: 149.5, signZ: 0 },
  { id: "westgate", name: "WESTGATE", x: -154, z: 0, axis: "ns", signRotY: Math.PI / 2, signX: -149.5, signZ: 0 },
  { id: "sunset", name: "SUNSET · LA", x: 800, z: 154, axis: "ew", signRotY: Math.PI, signX: 800, signZ: 149.5 },
  { id: "brooklyn", name: "BROOKLYN · NY", x: -800, z: 154, axis: "ew", signRotY: Math.PI, signX: -800, signZ: 149.5 },
  { id: "palms", name: "PALMS · FLORIDA", x: 48, z: 1044, axis: "ns", signRotY: -Math.PI / 2, signX: 43.5, signZ: 1044 },
];

/** One standard stop shelter: gold canopy on black posts, white back wall,
 * wood bench, sign pole + painted sign. `city` gains the boxes, colliders
 * (posts / wall / bench — the player walks around them) and the art sign. */
function buildShelter(city: City, spec: ShelterSpec): void {
  const ns = spec.axis === "ns";
  const rw = ns ? 2.6 : 6; // roof footprint
  const rd = ns ? 6 : 2.6;
  const bx = (dx: number, dz: number, sx: number, sy: number, sz: number, mat: Mat, y = sy / 2) =>
    pushBox(city, spec.x + dx, y, spec.z + dz, sx, sy, sz, mat);
  const bc = (dx: number, dz: number, sx: number, sy: number, sz: number, y = sy / 2) =>
    pushCol(city, spec.x + dx, y, spec.z + dz, sx, sy, sz);
  // Platform (walkable, no collider — same 0.15 step as a sidewalk).
  pushBox(city, spec.x, 0.075, spec.z, rw + 0.6, 0.15, rd + 0.6, "sidewalk");
  // Posts + canopy.
  const px = ns ? rw / 2 - 0.2 : rw / 2 - 0.2;
  const pz = ns ? rd / 2 - 0.2 : rd / 2 - 0.2;
  for (const [dx, dz] of [
    [-px, -pz],
    [px, -pz],
    [-px, pz],
    [px, pz],
  ] as Array<[number, number]>) {
    bx(dx, dz, 0.3, 2.6, 0.3, "black");
    bc(dx, dz, 0.3, 2.6, 0.3);
  }
  bx(0, 0, rw, 0.22, rd, "gold", 2.7);
  // Back wall on the side away from the road + bench facing the road.
  if (ns) {
    const away = spec.x > 0 ? 1 : -1;
    bx((away * rw) / 2, 0, 0.3, 2.0, rd - 0.4, "white");
    bc((away * rw) / 2, 0, 0.3, 2.0, rd - 0.4);
    bx(-away * 0.3, 0, 2.6, 0.45, 0.6, "wood");
    bc(-away * 0.3, 0, 2.6, 0.45, 0.6);
  } else {
    const away = spec.z > 0 ? 1 : -1;
    bx(0, (away * rd) / 2, rw - 0.4, 2.0, 0.3, "white");
    bc(0, (away * rd) / 2, rw - 0.4, 2.0, 0.3);
    bx(0, -away * 0.3, 2.6, 0.45, 0.6, "wood");
    bc(0, -away * 0.3, 2.6, 0.45, 0.6);
  }
  // Sign pole + painted sign facing the road (pole reaches the sign top).
  const poleX = spec.signX;
  const poleZ = spec.signZ;
  pushBox(city, poleX, 1.95, poleZ, 0.18, 3.9, 0.18, "black");
  pushCol(city, poleX, 1.95, poleZ, 0.18, 3.9, 0.18);
  const art: Art = {
    id: `bus-stop-${spec.id}`,
    x: poleX,
    y: 3.2,
    z: poleZ,
    rotY: spec.signRotY,
    w: 4.4,
    h: 1.1,
    lines: ["BUS STOP", spec.name],
    sub: "CITY LOOP · FREE",
  };
  city.art.push(art);
}

/** Central Station + the five stop shelters. Must run inside buildCity —
 * cityMapModel caches by seed, so calling it after buildCity() returns
 * would serve a pre-station model. */
export function buildBusStation(city: City): void {
  // Central Station — in the plaza at (0, 26.5), between the fountain (0,12)
  // and the z=36 road. Footprint x -4..4, z 25..28 was clearance-checked.
  // NOTE (bus-route fix): the bus itself no longer stops here — the stop
  // moved to (0,72) on the z=72 road, because (0,36) sat inside the train
  // station hall and the z=36 road is blocked by its shelters. The canopy
  // stays in the plaza as the station building (a short walk south from
  // the stop, through the hall's north door); no shelter fits beside the
  // z=72 road there — the buildings front it with only a 2u sidewalk.
  const cx = 0;
  const cz = 26.5;
  pushBox(city, cx, 0.075, cz, 8.6, 0.15, 3.6, "plaza");
  // Four posts + gold canopy.
  for (const [dx, dz] of [
    [-3.7, -1.3],
    [3.7, -1.3],
    [-3.7, 1.3],
    [3.7, 1.3],
  ] as Array<[number, number]>) {
    pushBox(city, cx + dx, 1.7, cz + dz, 0.35, 3.4, 0.35, "black");
    pushCol(city, cx + dx, 1.7, cz + dz, 0.35, 3.4, 0.35);
  }
  pushBox(city, cx, 3.5, cz, 8.6, 0.25, 3.6, "gold");
  // Back wall (north side, away from the road) + two benches facing the road.
  pushBox(city, cx, 1.0, cz - 1.45, 8.6, 2.0, 0.3, "white");
  pushCol(city, cx, 1.0, cz - 1.45, 8.6, 2.0, 0.3);
  for (const dx of [-1.9, 1.9]) {
    pushBox(city, cx + dx, 0.225, cz + 0.3, 2.6, 0.45, 0.6, "wood");
    pushCol(city, cx + dx, 0.225, cz + 0.3, 2.6, 0.45, 0.6);
  }
  // Station sign on two posts at the south edge, facing the road (south).
  for (const dx of [-2.5, 2.5]) {
    pushBox(city, cx + dx, 1.95, cz + 1.55, 0.2, 3.9, 0.2, "black");
    pushCol(city, cx + dx, 1.95, cz + 1.55, 0.2, 3.9, 0.2);
  }
  city.art.push({
    id: "bus-station-central",
    x: cx,
    y: 3.2,
    z: cz + 1.55,
    rotY: 0,
    w: 6.4,
    h: 1.3,
    lines: ["CENTRAL STATION", "CITY LOOP BUS"],
    sub: "FREE · ALL CITIES",
  });
  for (const spec of SHELTERS) buildShelter(city, spec);
}
