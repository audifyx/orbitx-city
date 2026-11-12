// emergency.ts — Emergency services + per-district office towers + jobs
// for the OrbitX City GTA / FiveM expansion.
//
// DEAD CODE until wired (see WIRING.md at the repo root). Nothing here is
// imported by the game yet, and nothing here touches the live economy:
// every price and every pay below is City Sol, the in-game money. There is
// no real money, no burn, and no ORBITX anywhere in this module.
//
// What this module *is*: one shared template + per-district / per-department
// style parameters. "Clone each to look similar but different": every tower
// is built by buildDistrictTower and every department by buildDepartment,
// but each district drives different colors, materials, signage, rooflines
// and props through its DistrictStyle, so each tower and each department
// reads as its own place, never a bare copy-paste.
//
// Save model (user correction, 2026-11-11): saves are PER (PLAYER, SERVER).
// The player picks a server (1-5) on the menu and each server has different
// save progress. The WORLD is the same on every server — the districts,
// towers and departments defined here are identical on servers 1-5. Only
// SAVES are per-server: office claims, job progress and City Sol are keyed
// by player + server. The multiverse builder owns the save keying; this
// module only carries the `server` parameter through the office
// claim/release/directory functions so the server op can scope every
// read/write by (suite, server). A suite claimed on Server 1 lives on
// Server 1 only; the same suite can be claimed by a different player on
// Server 2 with no conflict — that is the point.

import type {
  Anchor,
  Art,
  Box,
  Collider,
  Face,
  Facade,
  Lift,
  Mat,
  Zone,
} from "./city";
import type { OfficeSuite } from "./content";

// ---------------------------------------------------------------------------
// CityParts — the arrays a builder writes into. A finished City satisfies
// this structurally, and inside buildCity the wiring agent passes the
// in-progress locals (see WIRING.md). Facades/art are returned as well as
// pushed, because buildCity keeps its own module-level facades/art arrays.
// ---------------------------------------------------------------------------

export interface CityParts {
  boxes: Box[];
  colliders: Collider[];
  zones: Zone[];
  anchors: Anchor[];
  lifts: Lift[];
  facades: Facade[];
  art: Art[];
}

export interface BuildResult {
  zones: Zone[];
  anchors: Anchor[];
  lifts: Lift[];
  facades: Facade[];
  art: Art[];
}

// ---------------------------------------------------------------------------
// Servers (save scoping). The world is the same on every server; only the
// save is per-server. Validated at the op boundary — the client sends the
// server the player picked on the menu (1-5).
// ---------------------------------------------------------------------------

export type ServerId = 1 | 2 | 3 | 4 | 5;
export const SERVERS: ServerId[] = [1, 2, 3, 4, 5];

export function isServerId(n: number): n is ServerId {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5;
}

// ---------------------------------------------------------------------------
// Districts. Four districts, one tower + four departments each. Defaults
// sit in the outer ring (outside the house grid, which ends at +/-184, and
// inside the hill ring, which starts at ~260) — see WIRING.md: the wiring
// agent MUST verify each origin live (walk there / map check) and move the
// one origin line if a hill or tree sits on it. The builders take the
// origin from this table, so moving a district is one line.
// ---------------------------------------------------------------------------

export type DistrictId = "harbor" | "north" | "east" | "west";

export interface DistrictStyle {
  /** Facade style number (0-5, same range the HQ/mall use). */
  facadeStyle: number;
  /** Roof shape on the pretty facade. */
  roof: "flat" | "gable" | "hip" | "stepped";
  /** Roof material: 0 charcoal, 1 terracotta, 2 slate blue, 3 gold. */
  roofMat: 0 | 1 | 2 | 3;
  /** Main wall material. */
  wall: Mat;
  /** Accent / trim material (cornice, rugs, signs). */
  accent: Mat;
  /** Lobby + floor material. */
  floor: Mat;
  /** Roof crown: undefined = flat parapet, otherwise a crowning box. */
  crown: { w: number; d: number; h: number } | null;
  /** Extra department prop this district adds (see buildDepartment). */
  deptExtra: "rescue-boat" | "garage-bay" | "helipad" | "training-yard";
  /** Short sign line painted on the tower. */
  motto: string;
}

export interface District {
  id: DistrictId;
  name: string;
  towerName: string;
  /** Tower footprint origin (x0, z0). Tower is 28 x 28. */
  towerX0: number;
  towerZ0: number;
  /** Side the tower door faces — always toward the city centre. */
  door: Face;
  style: DistrictStyle;
}

export const DISTRICTS: District[] = [
  {
    id: "harbor",
    name: "Harbor District",
    towerName: "Harbor Tower",
    towerX0: -126,
    towerZ0: 206,
    door: "n",
    style: {
      facadeStyle: 2,
      roof: "hip",
      roofMat: 2,
      wall: "white",
      accent: "cyan",
      floor: "stone",
      crown: { w: 18, d: 18, h: 3 },
      deptExtra: "rescue-boat",
      motto: "The harbor builds here",
    },
  },
  {
    id: "north",
    name: "North District",
    towerName: "North Tower",
    towerX0: -14,
    towerZ0: -230,
    door: "s",
    style: {
      facadeStyle: 3,
      roof: "gable",
      roofMat: 0,
      wall: "gray",
      accent: "gold",
      floor: "wood",
      crown: null,
      deptExtra: "garage-bay",
      motto: "North side, high ground",
    },
  },
  {
    id: "east",
    name: "East District",
    towerName: "East Tower",
    towerX0: 196,
    towerZ0: -14,
    door: "w",
    style: {
      facadeStyle: 1,
      roof: "stepped",
      roofMat: 3,
      wall: "cream",
      accent: "gold",
      floor: "plaza",
      crown: { w: 14, d: 14, h: 4 },
      deptExtra: "helipad",
      motto: "Gold over the east road",
    },
  },
  {
    id: "west",
    name: "Project District",
    towerName: "Project Tower",
    towerX0: -224,
    towerZ0: -14,
    door: "e",
    style: {
      facadeStyle: 5,
      roof: "gable",
      roofMat: 1,
      wall: "warm",
      accent: "red",
      floor: "wood",
      crown: null,
      deptExtra: "training-yard",
      motto: "Where projects move in",
    },
  },
];

export function districtById(id: DistrictId): District {
  const found = DISTRICTS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown district: ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// Departments. Four per district: fire department, police station, hospital,
// emergency center. Same builder, different look per kind AND per district
// (district style shifts the roof material + adds the district's extra prop).
//
// ANCHOR / ZONE KIND NOTE: city.ts's Anchor/Zone kind unions do not have
// "fire" | "police" | "hospital" | "emergency" yet, and this module may not
// edit city.ts. Until the wiring agent adds those four kinds to the unions,
// departments are emitted with the mapped kind below (walk-in, no panel).
// The department record itself keeps its true kind, so jobs and panels key
// off DepartmentKind, not the interim anchor kind. The map is the ONE place
// to flip to identity once the unions gain the kinds — see WIRING.md §1.
// ---------------------------------------------------------------------------

export type DepartmentKind = "fire" | "police" | "hospital" | "emergency";

export interface DepartmentInfo {
  kind: DepartmentKind;
  /** Short name used in signs + job text. */
  shortName: string;
  /** Sign line painted over the door. */
  sign: string;
  sub: string;
  /** Wall / accent / roof materials for this department (before the
   * district's variation is applied). */
  wall: Mat;
  accent: Mat;
  roof: "flat" | "gable" | "hip";
  roofMat: 0 | 1 | 2 | 3;
}

export const DEPARTMENTS: DepartmentInfo[] = [
  {
    kind: "fire",
    shortName: "Fire Department",
    sign: "FIRE DEPARTMENT",
    sub: "Engine bay · smoke reports answered here",
    wall: "red",
    accent: "gold",
    roof: "gable",
    roofMat: 1,
  },
  {
    kind: "police",
    shortName: "Police Station",
    sign: "POLICE STATION",
    sub: "Patrol desk · report for duty here",
    wall: "white",
    accent: "cyan",
    roof: "flat",
    roofMat: 0,
  },
  {
    kind: "hospital",
    shortName: "General Hospital",
    sign: "GENERAL HOSPITAL",
    sub: "Wards · clinic · ambulance bay",
    wall: "white",
    accent: "cyanhot",
    roof: "hip",
    roofMat: 2,
  },
  {
    kind: "emergency",
    shortName: "Emergency Center",
    sign: "EMERGENCY CENTER",
    sub: "Dispatch · 24-hour response",
    wall: "cream",
    accent: "red",
    roof: "gable",
    roofMat: 3,
  },
];

export function departmentInfo(kind: DepartmentKind): DepartmentInfo {
  const found = DEPARTMENTS.find((d) => d.kind === kind);
  if (!found) throw new Error(`Unknown department: ${kind}`);
  return found;
}

/** Interim anchor/zone kind no longer needed: city.ts now has the four
 * department kinds, so departments use their real kind. */
export const DEPT_ANCHOR_KIND: Record<DepartmentKind, Zone["kind"]> = {
  fire: "fire",
  police: "police",
  hospital: "hospital",
  emergency: "emergency",
};

/** Door anchor id for a department. Jobs resolve these by kind + nearest. */
export function departmentAnchorId(district: DistrictId, kind: DepartmentKind): string {
  return `dept-${district}-${kind}`;
}

export function departmentName(district: DistrictId, kind: DepartmentKind): string {
  return `${districtById(district).name} ${departmentInfo(kind).shortName}`;
}

// ---------------------------------------------------------------------------
// Geometry helpers. city.ts's put/col/shellOpen helpers are NOT exported,
// so this module builds Box/Collider/Zone/Anchor/Lift/Facade/Art literals
// directly — same shapes, same field order.
// ---------------------------------------------------------------------------

const TOWER_W = 28;
const TOWER_D = 28;
const TOWER_H = 20;
/** Walking-surface Y of each tower level: lobby, floors 2-4, roof. */
export const TOWER_FLOORS_Y = [0, 8, 12, 16, 20] as const;
export const TOWER_STOPS = ["Lobby", "Floor 2", "Floor 3", "Floor 4", "Roof Terrace"] as const;

const DEPT_W = 18;
const DEPT_D = 12;
const DEPT_H = 7;

/** Department placement relative to its district tower's origin — one row
 * per district, because no two districts have the same free space around
 * them. The old shared table (fire -24 / police +32 / hospital -20 /
 * emergency +32) hugged every tower with 4-8 unit gaps, clipped aprons
 * and helipads into the tower walls, and put buildings ON things:
 * east fire straddled the x=180 / z=0 crossroads, west fire sat on the
 * bridge-west deck + gate, east/west police touched the bridge decks.
 * The per-district values below were verified against the seeded
 * buildCity(1) geometry: every department is 18-28 from its tower, clear
 * of the road grid (roads run to +/-184), clear of the magic-bridge decks
 * and gates, clear of the seeded hill ring, and clear of the outer grid
 * blocks (including the grid homes). Do NOT re-tighten these to a shared
 * table — the constraints differ per district:
 * - harbor: the z=180 road caps the north side, so the hospital takes
 *   the NW corner instead — and it must sit WEST of the x=-144 road
 *   (dx -46: x -172..-154, 5 clear of the asphalt); at dx -38 its east
 *   3 units sat ON the road. Seeded hills sit SW and S of the tower,
 *   so fire/police/emergency stack on the east side.
 * - north: the z=-180 road caps the south side, so emergency takes the
 *   SE corner; the hill ring caps the north at dz -32.
 * - east: the x=180 road + outer grid blocks leave no room west of the
 *   tower, and the bridge-east deck/gate occupy the mid-east, so all
 *   four departments sit in two open rows east of the tower.
 * - west: mirror of east — the bridge-west deck/gate occupy the
 *   mid-west, so fire/police take the NW/SW corners west of the tower.
 * Doors face the tower wherever the forecourt allows; the one exception
 * is harbor fire, whose door faces south, toward the police station.
 * Gaps after the move (tower <-> department, smallest first): harbor
 * police/emergency 18, north police/emergency 18, hospital 20-21
 * (corner) except harbor hospital at 29, east/west outer rows 26-28. */
const DEPT_OFFSETS: Record<DistrictId, Record<DepartmentKind, { dx: number; dz: number; door: Face }>> = {
  harbor: {
    fire: { dx: 50, dz: -20, door: "s" },
    police: { dx: 46, dz: 8, door: "w" },
    hospital: { dx: -46, dz: -20, door: "e" },
    emergency: { dx: 46, dz: 32, door: "w" },
  },
  north: {
    fire: { dx: -38, dz: 8, door: "e" },
    police: { dx: 46, dz: 8, door: "w" },
    hospital: { dx: 5, dz: -32, door: "s" },
    emergency: { dx: 46, dz: 32, door: "w" },
  },
  east: {
    fire: { dx: 46, dz: -32, door: "w" },
    police: { dx: 46, dz: 48, door: "w" },
    hospital: { dx: 5, dz: -32, door: "s" },
    emergency: { dx: 5, dz: 48, door: "n" },
  },
  west: {
    fire: { dx: -38, dz: -32, door: "e" },
    police: { dx: -38, dz: 32, door: "e" },
    hospital: { dx: 5, dz: -32, door: "s" },
    emergency: { dx: 5, dz: 48, door: "n" },
  },
};

function box(
  parts: CityParts,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  mat: Mat,
): void {
  parts.boxes.push({ x, y, z, sx, sy, sz, mat, ry: 0 });
}

function col(
  parts: CityParts,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  parts.colliders.push({
    minX: x - sx / 2,
    maxX: x + sx / 2,
    minY: y - sy / 2,
    maxY: y + sy / 2,
    minZ: z - sz / 2,
    maxZ: z + sz / 2,
  });
}

function solidBox(
  parts: CityParts,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  mat: Mat,
): void {
  box(parts, x, y, z, sx, sy, sz, mat);
  col(parts, x, y, z, sx, sy, sz);
}

/** Roof-material number (facade) -> box material. */
function roofBoxMat(roofMat: 0 | 1 | 2 | 3): Mat {
  if (roofMat === 1) return "red";
  if (roofMat === 2) return "gray";
  if (roofMat === 3) return "gold";
  return "black";
}

/** Sign rotation so the plate faces the same way the door anchor faces. */
function doorYaw(door: Face): number {
  if (door === "n") return Math.PI;
  if (door === "s") return 0;
  if (door === "w") return Math.PI / 2;
  return -Math.PI / 2;
}

/** Door anchor, same math as city.ts doorAnchor (anchor just outside the
 * door, facing in). */
function doorAnchorFor(
  id: string,
  name: string,
  kind: Anchor["kind"],
  x0: number,
  z0: number,
  w: number,
  d: number,
  door: Face,
  slot = 0,
): Anchor {
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  if (door === "n") return { id, name, kind, x: cx, y: 0, z: z0 - 1.4, yaw: Math.PI, slot };
  if (door === "s") return { id, name, kind, x: cx, y: 0, z: z0 + d + 1.4, yaw: 0, slot };
  if (door === "w") return { id, name, kind, x: x0 - 1.4, y: 0, z: cz, yaw: Math.PI / 2, slot };
  return { id, name, kind, x: x0 + w + 1.4, y: 0, z: cz, yaw: -Math.PI / 2, slot };
}

function zoneFor(
  id: string,
  name: string,
  kind: Zone["kind"],
  x0: number,
  z0: number,
  w: number,
  d: number,
  minY: number,
  maxY: number,
  svcX: number,
  svcZ: number,
  signX: number,
  signY: number,
  signZ: number,
  signRot: number,
  slot = 0,
): Zone {
  return {
    id,
    name,
    kind,
    slot,
    minX: x0,
    maxX: x0 + w,
    minZ: z0,
    maxZ: z0 + d,
    serviceX: svcX,
    serviceZ: svcZ,
    signX,
    signY,
    signZ,
    signRot,
    minY,
    maxY,
  };
}

function signArt(
  parts: CityParts,
  id: string,
  x: number,
  y: number,
  z: number,
  rotY: number,
  w: number,
  h: number,
  lines: string[],
  sub: string,
): void {
  parts.art.push({ id, x, y, z, rotY, w, h, lines, sub });
}

/** Four perimeter walls with a door gap on the door face (and, when set,
 *  the same gap on the pass-through face — a tower astride a road, e.g.
 *  the west/east district towers on the bridge lines). Walls are 0.6
 *  thick, centred on the rect edges, with colliders. */
function shellWalls(
  parts: CityParts,
  x0: number,
  z0: number,
  w: number,
  d: number,
  h: number,
  wallMat: Mat,
  door: Face,
  doorW = 3,
  passThrough?: Face,
  // The through-door is a car lane (4 wide), not a person door (3) —
  // the facade overlay already cuts a 4-wide gap on both faces, so the
  // physics must match the visual opening or the car hits an invisible
  // half-wall on each side of the doorway.
  passW = 4,
): void {
  const t = 0.6;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const gapOn = (face: Face) => face === door || face === passThrough;
  const gapW = (face: Face) => (face === passThrough ? passW : doorW);
  // North wall (z = z0) and south wall (z = z0 + d).
  for (const z of [z0, z0 + d]) {
    const face: Face = z === z0 ? "n" : "s";
    if (gapOn(face)) {
      const gw = gapW(face);
      const leftW = cx - gw / 2 - x0;
      const rightW = x0 + w - (cx + gw / 2);
      solidBox(parts, x0 + leftW / 2, h / 2, z, leftW, h, t, wallMat);
      solidBox(parts, cx + gw / 2 + rightW / 2, h / 2, z, rightW, h, t, wallMat);
    } else {
      solidBox(parts, cx, h / 2, z, w, h, t, wallMat);
    }
  }
  // West wall (x = x0) and east wall (x = x0 + w).
  for (const x of [x0, x0 + w]) {
    const face: Face = x === x0 ? "w" : "e";
    if (gapOn(face)) {
      const gw = gapW(face);
      const northD = cz - gw / 2 - z0;
      const southD = z0 + d - (cz + gw / 2);
      solidBox(parts, x, h / 2, z0 + northD / 2, t, h, northD, wallMat);
      solidBox(parts, x, h / 2, cz + gw / 2 + southD / 2, t, h, southD, wallMat);
    } else {
      solidBox(parts, x, h / 2, cz, t, h, d, wallMat);
    }
  }
  // Closed real door (2026-11-12): a solid wood panel fills the gap, with
  // a lintel above it and a gold handle on both sides. The door is solid —
  // entry is E at the door anchor, never a walk-through.
  const alongX = door === "n" || door === "s";
  const dz = door === "n" ? z0 : door === "s" ? z0 + d : cz;
  const dx = door === "w" ? x0 : door === "e" ? x0 + w : cx;
  const px = alongX ? cx : dx;
  const pz = alongX ? dz : cz;
  solidBox(parts, px, 1.45, pz, alongX ? doorW - 0.1 : 0.35, 2.9, alongX ? 0.35 : doorW - 0.1, "wood");
  solidBox(parts, px, 3 + (h - 3) / 2, pz, alongX ? doorW : t, h - 3, alongX ? t : doorW, wallMat);
  const hx = alongX ? cx + 1.1 : dx;
  const hz = alongX ? dz : cz + 1.1;
  const out = alongX ? (door === "n" ? -0.3 : 0.3) : door === "w" ? -0.3 : 0.3;
  if (alongX) {
    box(parts, hx, 1.15, pz + out, 0.16, 0.16, 0.14, "gold");
    box(parts, hx, 1.15, pz - out, 0.16, 0.16, 0.14, "gold");
  } else {
    box(parts, px + out, 1.15, hz, 0.14, 0.16, 0.16, "gold");
    box(parts, px - out, 1.15, hz, 0.14, 0.16, 0.16, "gold");
  }
}

function floorSlab(parts: CityParts, x0: number, z0: number, w: number, d: number, y: number, mat: Mat): void {
  box(parts, x0 + w / 2, y, z0 + d / 2, w - 0.8, 0.12, d - 0.8, mat);
  col(parts, x0 + w / 2, y, z0 + d / 2, w - 0.8, 0.12, d - 0.8);
}

// District-shifted roof material: the same department in another district
// gets the next roof material, so no two districts' copies match.
function deptRoofMat(kind: DepartmentKind, district: District): 0 | 1 | 2 | 3 {
  const base = departmentInfo(kind).roofMat;
  const shift = DISTRICTS.findIndex((d) => d.id === district.id);
  return ((base + shift) % 4) as 0 | 1 | 2 | 3;
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export interface DepartmentBuild {
  district: DistrictId;
  kind: DepartmentKind;
  x0: number;
  z0: number;
  zone: Zone;
  anchor: Anchor;
}

function deptPropsFire(parts: CityParts, cx: number, cz: number): void {
  // Engine truck: red body + black cab + wheels, parked across the bay.
  solidBox(parts, cx - 2, 1.0, cz - 1, 5.5, 1.8, 2.4, "red");
  solidBox(parts, cx + 1.6, 0.9, cz - 1, 1.6, 1.4, 2.2, "black");
  for (const [wx, wz] of [[cx - 4, cz - 2.4], [cx - 4, cz + 0.4], [cx + 0.5, cz - 2.4], [cx + 0.5, cz + 0.4]] as Array<[number, number]>) {
    box(parts, wx, 0.35, wz, 0.7, 0.7, 0.4, "black");
  }
  // Hose rack on the wall + brass pole.
  solidBox(parts, cx + 7.5, 1.2, cz + 4.5, 0.4, 2.2, 2.4, "wood");
  solidBox(parts, cx - 7.5, 3.0, cz + 4.5, 0.4, 6, 0.4, "gold");
}

function deptPropsPolice(parts: CityParts, cx: number, cz: number, door: Face): void {
  // Patrol desk row with screens + holding cells at the back wall.
  for (const dx of [-4, 0]) {
    solidBox(parts, cx + dx, 0.55, cz + 3, 3, 0.9, 1.2, "wood");
    box(parts, cx + dx, 1.35, cz + 3.4, 1.4, 0.9, 0.1, "cyan");
  }
  for (const bx of [-6, -4.5, -3]) {
    box(parts, cx + bx, 1.6, cz - 4.5, 0.25, 3.2, 0.25, "black");
  }
  solidBox(parts, cx - 4.5, 0.4, cz - 4.5, 4.5, 0.5, 1.0, "red");
  // Evidence lockers along the side wall — on the wall OPPOSITE the door,
  // so they never block the door gap (west police has an east door).
  const lockerX = door === "e" ? cx - 7.5 : cx + 7.5;
  solidBox(parts, lockerX, 1.1, cz - 1, 0.8, 2.2, 4, "gray");
}

function deptPropsHospital(parts: CityParts, cx: number, cz: number): void {
  // Three ward beds + triage desk + privacy screens.
  for (const bx of [-5.5, 0, 5.5]) {
    solidBox(parts, cx + bx, 0.45, cz - 2.5, 2.0, 0.6, 3.2, "white");
    box(parts, cx + bx, 0.8, cz - 3.7, 1.4, 0.25, 0.7, "cream");
  }
  solidBox(parts, cx - 6, 0.55, cz + 3.5, 3, 0.9, 1.2, "wood");
  box(parts, cx - 6, 1.35, cz + 3.9, 1.4, 0.9, 0.1, "cyanhot");
  for (const sx of [-2.5, 2.5]) {
    box(parts, cx + sx, 1.0, cz + 0.5, 0.15, 2.0, 3.0, "cream");
  }
}

function deptPropsEmergency(parts: CityParts, cx: number, cz: number): void {
  // Dispatch consoles with glowing screens + rest bunks.
  for (const dx of [-5, 0, 5]) {
    solidBox(parts, cx + dx, 0.55, cz + 3, 2.6, 0.9, 1.2, "black");
    box(parts, cx + dx, 1.35, cz + 3.4, 1.6, 0.9, 0.1, "cyan");
  }
  for (const bx of [-6.5, 6.5]) {
    solidBox(parts, cx + bx, 0.4, cz - 3.5, 2.2, 0.5, 1.0, "red");
  }
  // Radio mast outside the door side is added by the caller (needs the
  // door face); the wall map lives here.
  box(parts, cx - 7.5, 1.8, cz, 0.3, 3.6, 3.0, "black");
  box(parts, cx - 7.5, 1.8, cz, 0.2, 3.0, 2.6, "cyanhot");
}

/** The district's extra prop — the per-district variation on departments. */
function deptExtraProp(parts: CityParts, district: District, x0: number, z0: number, door: Face): void {
  const cx = x0 + DEPT_W / 2;
  const cz = z0 + DEPT_D / 2;
  const extra = district.style.deptExtra;
  if (extra === "rescue-boat") {
    // Harbor: a rescue boat on a rack against the side wall.
    solidBox(parts, cx + 6, 0.9, cz - 3.5, 3.2, 0.8, 1.4, "white");
    box(parts, cx + 6, 1.35, cz - 3.5, 3.4, 0.15, 1.6, "cyan");
    solidBox(parts, cx + 6, 0.35, cz - 3.5, 3.4, 0.5, 1.6, "wood");
  } else if (extra === "garage-bay") {
    // North: a second response vehicle + marked bay outside.
    solidBox(parts, cx - 5, 0.9, cz + 3.5, 4, 1.6, 2.0, "gray");
    box(parts, cx, 0.06, cz + DEPT_D / 2 + 2.5, 6, 0.06, 4, "lane");
  } else if (extra === "helipad") {
    // East: a helipad pad beside the building (hospital + emergency only
    // get the H plate; every department gets the pad).
    const px = door === "e" ? x0 + DEPT_W + 6 : door === "w" ? x0 - 6 : cx + 8;
    const pz = door === "n" || door === "s" ? z0 + DEPT_D + 6 : cz;
    box(parts, px, 0.08, pz, 8, 0.12, 8, "stone");
    signArt(parts, `dept-${district.id}-helipad`, px, 1.2, pz, 0, 3, 3, ["H"], "Helipad");
  } else {
    // West: a training yard — cones + hurdle outside the door.
    const ox = door === "e" ? x0 + DEPT_W + 3 : door === "w" ? x0 - 3 : cx;
    const oz = door === "s" ? z0 + DEPT_D + 3 : door === "n" ? z0 - 3 : cz;
    for (const [coneX, coneZ] of [[ox - 2, oz - 2], [ox + 2, oz - 2], [ox - 2, oz + 2], [ox + 2, oz + 2]] as Array<[number, number]>) {
      box(parts, coneX, 0.35, coneZ, 0.5, 0.7, 0.5, "red");
    }
    solidBox(parts, ox, 0.5, oz, 2.4, 0.5, 0.3, "wood");
  }
}

/** A potted plant: stone pot + dark leaves, with a collider. */
function plant(parts: CityParts, x: number, z: number, y0 = 0): void {
  box(parts, x, y0 + 0.2, z, 0.9, 0.4, 0.9, "stone");
  solidBox(parts, x, y0 + 0.5, z, 0.8, 0.9, 0.8, "leavesDark");
}

/** One wallpapered wall segment (shellWalls: inner face at inset 0.3 ->
 * paint centre 0.40, band centre 0.47). Same stripe/band language as
 * city.ts wallpaperWalls. alongX: wall runs along X (fixed z) or Z. */
function wallpaperWall(
  parts: CityParts,
  alongX: boolean,
  paintC: number,
  bandC: number,
  from: number,
  to: number,
  y0: number,
  wall: Mat,
  accent: Mat,
): void {
  if (to - from < 0.2) return;
  const mid = (from + to) / 2;
  let u = from;
  while (u < to - 0.05) {
    const wallEnd = Math.min(u + 3.05, to);
    const accEnd = Math.min(u + 3.4, to);
    if (alongX) {
      box(parts, (u + wallEnd) / 2, y0 + 1.85, paintC, wallEnd - u, 3.15, 0.08, wall);
      if (accEnd - wallEnd > 0.05) box(parts, (wallEnd + accEnd) / 2, y0 + 1.85, paintC, accEnd - wallEnd, 3.15, 0.08, accent);
    } else {
      box(parts, paintC, y0 + 1.85, (u + wallEnd) / 2, 0.08, 3.15, wallEnd - u, wall);
      if (accEnd - wallEnd > 0.05) box(parts, paintC, y0 + 1.85, (wallEnd + accEnd) / 2, 0.08, 3.15, accEnd - wallEnd, accent);
    }
    u += 3.4;
  }
  const len = to - from;
  const band = (y: number, h: number, mat: Mat) => {
    if (alongX) box(parts, mid, y0 + y, bandC, len, h, 0.08, mat);
    else box(parts, bandC, y0 + y, mid, 0.08, h, len, mat);
  };
  band(0.55, 1.0, accent); // wainscot
  band(1.18, 0.12, accent); // chair rail
  band(3.25, 0.18, accent); // top stripe
  band(0.12, 0.18, "black"); // baseboard
}

/** Audit finish for one department (2026-11-11): wallpaper on the shell
 * walls, a rug, and two plants. The plant corners are hand-picked per kind
 * so they never overlap that kind's props (fire: hose rack + brass pole
 * own the south corners; police: desks own the south centre; hospital:
 * triage desk owns the south-west; emergency: the wall map owns the west
 * centre). Called by buildDepartment after the props. */
function deptFinish(
  parts: CityParts,
  kind: DepartmentKind,
  district: District,
  bx0: number,
  bz0: number,
  door: Face,
): void {
  const cx = bx0 + DEPT_W / 2;
  const cz = bz0 + DEPT_D / 2;
  const accent = district.style.accent;
  // Wallpaper: split around the 3-wide door gap on the door face.
  if (door === "n") {
    wallpaperWall(parts, true, bz0 + 0.4, bz0 + 0.47, bx0 + 1.25, cx - 1.5, 0, "white", accent);
    wallpaperWall(parts, true, bz0 + 0.4, bz0 + 0.47, cx + 1.5, bx0 + 16.75, 0, "white", accent);
  } else {
    wallpaperWall(parts, true, bz0 + 0.4, bz0 + 0.47, bx0 + 1.25, bx0 + 16.75, 0, "white", accent);
  }
  if (door === "s") {
    wallpaperWall(parts, true, bz0 + 11.6, bz0 + 11.53, bx0 + 1.25, cx - 1.5, 0, "white", accent);
    wallpaperWall(parts, true, bz0 + 11.6, bz0 + 11.53, cx + 1.5, bx0 + 16.75, 0, "white", accent);
  } else {
    wallpaperWall(parts, true, bz0 + 11.6, bz0 + 11.53, bx0 + 1.25, bx0 + 16.75, 0, "white", accent);
  }
  if (door === "w") {
    wallpaperWall(parts, false, bx0 + 0.4, bx0 + 0.47, bz0 + 1.25, cz - 1.5, 0, "white", accent);
    wallpaperWall(parts, false, bx0 + 0.4, bx0 + 0.47, cz + 1.5, bz0 + 10.75, 0, "white", accent);
  } else {
    wallpaperWall(parts, false, bx0 + 0.4, bx0 + 0.47, bz0 + 1.25, bz0 + 10.75, 0, "white", accent);
  }
  if (door === "e") {
    wallpaperWall(parts, false, bx0 + 17.6, bx0 + 17.53, bz0 + 1.25, cz - 1.5, 0, "white", accent);
    wallpaperWall(parts, false, bx0 + 17.6, bx0 + 17.53, cz + 1.5, bz0 + 10.75, 0, "white", accent);
  } else {
    wallpaperWall(parts, false, bx0 + 17.6, bx0 + 17.53, bz0 + 1.25, bz0 + 10.75, 0, "white", accent);
  }
  // Rug in the free centre, per kind.
  const rug = (x: number, z: number, mat: Mat) => box(parts, x, 0.09, z, 4, 0.06, 3, mat);
  if (kind === "fire") rug(cx - 2, cz + 4, "red");
  else if (kind === "police") rug(cx, cz + 0.5, "black");
  else if (kind === "hospital") rug(cx, cz + 1, "white");
  else rug(cx, cz + 0.5, "cyan");
  // Plants in the free corners.
  const corners: Array<[number, number]> =
    kind === "fire" ? [[bx0 + 1.5, bz0 + 1.5], [bx0 + 16.5, bz0 + 1.5]]
    : kind === "police" ? [[bx0 + 1.5, bz0 + 10.5], [bx0 + 16.5, bz0 + 10.5]]
    : kind === "hospital" ? [[bx0 + 16.5, bz0 + 1.5], [bx0 + 16.5, bz0 + 10.5]]
    : [[bx0 + 1.5, bz0 + 1.5], [bx0 + 16.5, bz0 + 1.5]];
  for (const [px, pz] of corners) plant(parts, px, pz);
}

export function buildDepartment(
  kind: DepartmentKind,
  district: District,
  parts: CityParts,
  x0?: number,
  z0?: number,
  door?: Face,
): DepartmentBuild {
  const info = departmentInfo(kind);
  const off = DEPT_OFFSETS[district.id][kind];
  const bx0 = x0 ?? district.towerX0 + off.dx;
  const bz0 = z0 ?? district.towerZ0 + off.dz;
  const face = door ?? off.door;
  const cx = bx0 + DEPT_W / 2;
  const cz = bz0 + DEPT_D / 2;
  const roofMat = deptRoofMat(kind, district);
  const anchorKind = DEPT_ANCHOR_KIND[kind];

  // Shell: floor, walls with door gap, roof slab, district-accent plinth.
  floorSlab(parts, bx0, bz0, DEPT_W, DEPT_D, 0.08, "stone");
  shellWalls(parts, bx0, bz0, DEPT_W, DEPT_D, DEPT_H, info.wall, face);
  box(parts, cx, DEPT_H + 0.2, cz, DEPT_W + 0.8, 0.4, DEPT_D + 0.8, roofBoxMat(roofMat));
  col(parts, cx, DEPT_H + 0.2, cz, DEPT_W + 0.8, 0.4, DEPT_D + 0.8);
  box(parts, cx, 0.15, cz, DEPT_W + 0.6, 0.3, DEPT_D + 0.6, district.style.accent);
  // Apron outside the door.
  const apron =
    face === "e" ? { x: bx0 + DEPT_W + 2.5, z: cz, w: 5, d: 6 }
    : face === "w" ? { x: bx0 - 2.5, z: cz, w: 5, d: 6 }
    : face === "s" ? { x: cx, z: bz0 + DEPT_D + 2.5, w: 6, d: 5 }
    : { x: cx, z: bz0 - 2.5, w: 6, d: 5 };
  box(parts, apron.x, 0.06, apron.z, apron.w, 0.06, apron.d, "asphalt");

  // Interior props per kind + the district's extra prop.
  if (kind === "fire") deptPropsFire(parts, cx, cz);
  else if (kind === "police") deptPropsPolice(parts, cx, cz, face);
  else if (kind === "hospital") deptPropsHospital(parts, cx, cz);
  else deptPropsEmergency(parts, cx, cz);
  deptExtraProp(parts, district, bx0, bz0, face);
  deptFinish(parts, kind, district, bx0, bz0, face);

  // Radio mast for the emergency center (outside, by the door).
  if (kind === "emergency") {
    const mx = face === "e" ? bx0 + DEPT_W + 4 : face === "w" ? bx0 - 4 : cx + 7;
    const mz = face === "s" ? bz0 + DEPT_D + 4 : face === "n" ? bz0 - 4 : cz - 4;
    solidBox(parts, mx, 6, mz, 0.5, 12, 0.5, "black");
    box(parts, mx, 12.3, mz, 0.4, 0.6, 0.4, "cyanhot");
  }

  const name = departmentName(district.id, kind);
  // Sign sits over the door, on the door wall.
  const doorSign =
    face === "e" ? { x: bx0 + DEPT_W, z: cz }
    : face === "w" ? { x: bx0, z: cz }
    : face === "s" ? { x: cx, z: bz0 + DEPT_D }
    : { x: cx, z: bz0 };
  const zone = zoneFor(
    departmentAnchorId(district.id, kind),
    name,
    anchorKind,
    bx0, bz0, DEPT_W, DEPT_D,
    0, DEPT_H,
    cx, cz + (face === "s" ? 2 : face === "n" ? -2 : 0),
    doorSign.x, 4.6, doorSign.z,
    doorYaw(face),
  );
  const anchor = doorAnchorFor(departmentAnchorId(district.id, kind), name, anchorKind, bx0, bz0, DEPT_W, DEPT_D, face);

  // Exterior sign over the door + facade entry (pretty overlay).
  const signPos =
    face === "e" ? { x: bx0 + DEPT_W + 0.35, z: cz }
    : face === "w" ? { x: bx0 - 0.35, z: cz }
    : face === "s" ? { x: cx, z: bz0 + DEPT_D + 0.35 }
    : { x: cx, z: bz0 - 0.35 };
  signArt(parts, `sign-${departmentAnchorId(district.id, kind)}`, signPos.x, 4.6, signPos.z, doorYaw(face), 10, 1.6, [info.sign], `${district.name} · ${info.sub}`);
  parts.facades.push({
    id: departmentAnchorId(district.id, kind),
    x: bx0,
    z: bz0,
    w: DEPT_W,
    d: DEPT_D,
    h: DEPT_H,
    style: district.style.facadeStyle,
    door: face,
    enterable: true,
    hero: false,
    face,
    roof: info.roof,
    roofMat,
    storefront: kind === "hospital" || kind === "police",
    awning: kind === "fire",
    cornice: true,
  });
  parts.zones.push(zone);
  parts.anchors.push(anchor);
  return { district: district.id, kind, x0: bx0, z0: bz0, zone, anchor };
}

// ---------------------------------------------------------------------------
// District towers — one shared builder, styled per district. 28 x 28,
// lobby + floors 2-4 + roof terrace, glass lift in the NW corner, 25 suites
// in the catalog (24 claimable + the founder top suite, never for sale).
// The geometry is deliberately smaller than the 58 x 58 OrbitX HQ; the
// SUITE CATALOG mirrors the HQ's structure exactly (same floors, same
// tiers, same prices, City Sol only).
// ---------------------------------------------------------------------------

export interface DistrictTowerBuild {
  district: DistrictId;
  x0: number;
  z0: number;
  zones: Zone[];
  anchors: Anchor[];
  lifts: Lift[];
  suites: OfficeSuite[];
}

function oppositeFace(face: Face): Face {
  if (face === "n") return "s";
  if (face === "s") return "n";
  if (face === "e") return "w";
  return "e";
}

/** One office suite bay: desk + chair + visitor chair + rug + plant +
 * name plate on the back wall. */
function suiteBay(
  parts: CityParts,
  id: string,
  name: string,
  tierLabel: string,
  floorY: number,
  bayCx: number,
  backZ: number,
  plateRotY: number,
  deskZ: number,
  chairZ: number,
  premium: boolean,
  accent: Mat,
): void {
  solidBox(parts, bayCx, floorY + 0.45, deskZ, 2.0, 0.75, 1.0, "wood");
  box(parts, bayCx, floorY + 0.3, chairZ, 0.7, 0.6, 0.7, premium ? "gold" : "black");
  col(parts, bayCx, floorY + 0.3, chairZ, 0.7, 0.6, 0.7);
  solidBox(parts, bayCx + 2.2, floorY + 0.3, chairZ, 0.7, 0.6, 0.7, "black");
  box(parts, bayCx, floorY + 0.09, (deskZ + chairZ) / 2, 3.2, 0.06, 2.6, premium ? "gold" : accent);
  plant(parts, bayCx + 2.6, chairZ + (chairZ > deskZ ? 1.5 : -1.5), floorY);
  signArt(parts, `suite-${id}`, bayCx, floorY + 2.6, backZ, plateRotY, 4.6, 0.9, [name], tierLabel);
}

/** Partition walls for one floor's two suite rows, with a door gap at the
 * middle corridor. Bay boundaries run along X. */
function suitePartitions(
  parts: CityParts,
  z0: number,
  floorY: number,
  rowStartX: number,
  rowWidth: number,
  bayCount: number,
): void {
  const bayW = rowWidth / bayCount;
  for (let k = 1; k < bayCount; k++) {
    const px = rowStartX + bayW * k;
    // North row: wall stops 1.6 short of the corridor (door gap).
    solidBox(parts, px, floorY + 1.6, z0 + 5.7, 0.3, 3.2, 10.2, "cream");
    // South row: same, mirrored.
    solidBox(parts, px, floorY + 1.6, z0 + 22.3, 0.3, 3.2, 10.2, "cream");
  }
}

function towerSlabWithLiftHole(parts: CityParts, x0: number, z0: number, y: number, mat: Mat): void {
  // Lift shaft occupies x0+1..x0+5, z0+1..z0+5. Slab = east piece + south
  // piece around the hole.
  box(parts, x0 + 16.5, y, z0 + 14, 23, 0.12, 28, mat);
  col(parts, x0 + 16.5, y, z0 + 14, 23, 0.12, 28);
  box(parts, x0 + 2.5, y, z0 + 16.5, 5, 0.12, 23, mat);
  col(parts, x0 + 2.5, y, z0 + 16.5, 5, 0.12, 23);
}

export function buildDistrictTower(district: District, parts: CityParts): DistrictTowerBuild {
  const x0 = district.towerX0;
  const z0 = district.towerZ0;
  const cx = x0 + TOWER_W / 2;
  const cz = z0 + TOWER_D / 2;
  const style = district.style;
  const door = district.door;
  // 2026-11-12 (water-crossings batch): the west/east towers sit astride
  // the bridge lines — the road enters through `door` and must leave
  // through the opposite face, or no car can cross to the states. The
  // north/harbor towers are not on a bridge line and stay single-door.
  // The ground-floor lane between the doors is clear by construction
  // (desk, directory, lift and sofas all sit off the centre line).
  const passThrough: Face | undefined = district.id === "west" ? "w" : district.id === "east" ? "e" : undefined;
  // A face has a ground-floor gap if it is the door face or the
  // pass-through face (a helper, so TS does not narrow passThrough
  // to "e" | "w" and reject the "n" / "s" comparisons below).
  const gapOn = (face: Face) => door === face || passThrough === face;
  // Half-width of the ground-floor gap: the person door is 3 wide,
  // the car through-door is 4 (matches shellWalls passW).
  const gapHalf = (face: Face) => (passThrough !== undefined && face === passThrough ? 2 : 1.5);
  const suites = districtOfficeSuites(district.id);
  const liftId = `lift-${district.id}`;
  const towerId = `tower-${district.id}`;

  // Shell + roof + cornice band in the district accent.
  floorSlab(parts, x0, z0, TOWER_W, TOWER_D, 0.08, style.floor);
  shellWalls(parts, x0, z0, TOWER_W, TOWER_D, TOWER_H, style.wall, door, 3, passThrough);
  for (const [bx, bz, bw, bd] of [
    [cx, z0 + 0.3, TOWER_W, 0.5],
    [cx, z0 + TOWER_D - 0.3, TOWER_W, 0.5],
    [x0 + 0.3, cz, 0.5, TOWER_D],
    [x0 + TOWER_W - 0.3, cz, 0.5, TOWER_D],
  ] as Array<[number, number, number, number]>) {
    box(parts, bx, TOWER_H - 0.6, bz, bw, 0.7, bd, style.accent);
  }
  box(parts, cx, TOWER_H + 0.2, cz, TOWER_W + 0.8, 0.4, TOWER_D + 0.8, roofBoxMat(style.roofMat));
  col(parts, cx, TOWER_H + 0.2, cz, TOWER_W + 0.8, 0.4, TOWER_D + 0.8);
  if (style.crown) {
    box(parts, cx, TOWER_H + 0.4 + style.crown.h / 2, cz, style.crown.w, style.crown.h, style.crown.d, style.accent);
  }
  // Glass lift shaft, NW corner, full height.
  box(parts, x0 + 5, TOWER_H / 2, z0 + 3, 0.3, TOWER_H, 4, "cyan");
  box(parts, x0 + 3, TOWER_H / 2, z0 + 5, 4, TOWER_H, 0.3, "cyan");
  col(parts, x0 + 3, TOWER_H / 2, z0 + 3, 4, TOWER_H, 4);
  // Floor slabs (8/12/16/20) with the shaft hole.
  for (const y of [8, 12, 16, 20]) towerSlabWithLiftHole(parts, x0, z0, y, "cream");

  // Lobby: reception desk, directory board on the wall opposite the door,
  // rug, sofas, plants.
  const boardFace = oppositeFace(door);
  const boardPos =
    boardFace === "w" ? { x: x0 + 0.9, z: cz + 6, rotY: Math.PI / 2 }
    : boardFace === "e" ? { x: x0 + TOWER_W - 0.9, z: cz + 6, rotY: -Math.PI / 2 }
    : boardFace === "n" ? { x: cx - 6, z: z0 + 0.9, rotY: 0 }
    : { x: cx - 6, z: z0 + TOWER_D - 0.9, rotY: Math.PI };
  solidBox(parts, cx, 0.55, cz - 6, 3.2, 0.9, 1.4, "wood");
  box(parts, cx, 1.15, cz - 6, 2.6, 0.5, 0.1, "cyan");
  solidBox(parts, boardPos.x, 2.0, boardPos.z, boardFace === "w" || boardFace === "e" ? 0.3 : 5.0, 3.9, boardFace === "w" || boardFace === "e" ? 5.0 : 0.3, "black");
  signArt(parts, `dir-${towerId}`, boardPos.x + (boardFace === "w" ? 0.3 : boardFace === "e" ? -0.3 : 0), 3.35, boardPos.z + (boardFace === "n" ? 0.3 : boardFace === "s" ? -0.3 : 0), boardPos.rotY, 4.6, 0.85, ["OFFICE DIRECTORY"], district.towerName);
  signArt(parts, `dir2-${towerId}`, boardPos.x + (boardFace === "w" ? 0.3 : boardFace === "e" ? -0.3 : 0), 2.45, boardPos.z + (boardFace === "n" ? 0.3 : boardFace === "s" ? -0.3 : 0), boardPos.rotY, 4.6, 0.85, ["Floor 2", "Suites 2A – 2H"], "Standard offices");
  signArt(parts, `dir3-${towerId}`, boardPos.x + (boardFace === "w" ? 0.3 : boardFace === "e" ? -0.3 : 0), 1.55, boardPos.z + (boardFace === "n" ? 0.3 : boardFace === "s" ? -0.3 : 0), boardPos.rotY, 4.6, 0.85, ["Floor 3", "Suites 3A – 3H"], "Standard offices");
  signArt(parts, `dir4-${towerId}`, boardPos.x + (boardFace === "w" ? 0.3 : boardFace === "e" ? -0.3 : 0), 0.65, boardPos.z + (boardFace === "n" ? 0.3 : boardFace === "s" ? -0.3 : 0), boardPos.rotY, 4.6, 0.85, ["Floor 4", "Founder's Office · 4A – 4H"], "Premium suites");
  box(parts, cx, 0.12, cz + 2, 8, 0.06, 6, style.accent);
  for (const [sx, sz] of [[x0 + 6, z0 + 22], [x0 + 22, z0 + 22]] as Array<[number, number]>) {
    solidBox(parts, sx, 0.38, sz, 3.4, 0.45, 1.1, "red");
    solidBox(parts, sx + 4.5, 0.5, sz, 0.8, 0.9, 0.8, "leavesDark");
  }

  // Floors 2-3: two rows of four standard suites + corridor.
  for (const [floor, floorY] of [[2, 8], [3, 12]] as Array<[number, number]>) {
    suitePartitions(parts, z0, floorY, x0 + 0.6, TOWER_W - 1.2, 4);
    const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
    for (let i = 0; i < 8; i++) {
      const bayCx = x0 + 0.6 + (TOWER_W - 1.2) / 8 + (TOWER_W - 1.2) / 4 * (i % 4);
      const north = i < 4;
      const id = `office-${district.id}-f${floor}-${letters[i]}`;
      suiteBay(
        parts, id, `Suite ${floor}${letters[i].toUpperCase()}`, "Standard office",
        floorY, bayCx,
        north ? z0 + 0.75 : z0 + TOWER_D - 0.75, north ? 0 : Math.PI,
        north ? z0 + 2.6 : z0 + TOWER_D - 2.6,
        north ? z0 + 4.4 : z0 + TOWER_D - 4.4,
        false,
        style.accent,
      );
    }
  }

  // Floor 4: Founder's Office (west block) + eight premium suites (east).
  const f4 = 16;
  solidBox(parts, x0 + 14, f4 + 1.6, z0 + 5.7, 0.3, 3.2, 10.2, "cream");
  solidBox(parts, x0 + 14, f4 + 1.6, z0 + 22.3, 0.3, 3.2, 10.2, "cream");
  // Founder hero desk + gold rug + logo on the west wall.
  box(parts, x0 + 7, f4 + 0.12, cz, 9, 0.06, 7, "gold");
  solidBox(parts, x0 + 7, f4 + 0.45, cz - 4, 4.5, 0.75, 1.8, "wood");
  box(parts, x0 + 7, f4 + 0.3, cz - 1.6, 0.8, 0.6, 0.8, "gold");
  col(parts, x0 + 7, f4 + 0.3, cz - 1.6, 0.8, 0.6, 0.8);
  signArt(parts, `suite-office-${district.id}-f4-founder`, x0 + 0.75, f4 + 2.6, cz, Math.PI / 2, 5.0, 1.0, ["Founder's Office"], "Floor 4 · Private — not for sale");
  signArt(parts, `logo-${towerId}`, x0 + 0.75, f4 + 3.4, cz - 8, Math.PI / 2, 8, 2, [district.towerName.toUpperCase()], "Founder's Office");
  // Premium suites: east block, 2 rows x 4 cols.
  suitePartitions(parts, z0, f4, x0 + 14, TOWER_W - 14.6, 4);
  // NOTE: suitePartitions lays partitions for the full tower width rows;
  // the floor-4 call reuses the same row geometry for the east block only
  // (partitions land at x0+14+... — same X positions, correct bays).
  for (let i = 0; i < 8; i++) {
    const bayCx = x0 + 14 + (TOWER_W - 14.6) / 8 + (TOWER_W - 14.6) / 4 * (i % 4);
    const north = i < 4;
    const letter = ["a", "b", "c", "d", "e", "f", "g", "h"][i];
    suiteBay(
      parts, `office-${district.id}-f4-${letter}`, `Suite 4${letter.toUpperCase()}`, "Premium suite",
      f4, bayCx,
      north ? z0 + 0.75 : z0 + TOWER_D - 0.75, north ? 0 : Math.PI,
      north ? z0 + 2.6 : z0 + TOWER_D - 2.6,
      north ? z0 + 4.4 : z0 + TOWER_D - 4.4,
      true,
      style.accent,
    );
  }

  // Wallpaper on the tower shell, per floor (audit finish, 2026-11-11).
  // The ground floor splits around the door gap (shellWalls doorW = 3,
  // pass-through 4) — on the door face AND the pass-through face, so no
  // paint hangs across either opening; the suite floors get the full walls.
  for (const floorY of [0, 8, 12, 16]) {
    const ground = floorY === 0;
    if (ground && gapOn("n")) {
      wallpaperWall(parts, true, z0 + 0.4, z0 + 0.47, x0 + 1.25, cx - gapHalf("n"), floorY, "white", style.accent);
      wallpaperWall(parts, true, z0 + 0.4, z0 + 0.47, cx + gapHalf("n"), x0 + 26.75, floorY, "white", style.accent);
    } else {
      wallpaperWall(parts, true, z0 + 0.4, z0 + 0.47, x0 + 1.25, x0 + 26.75, floorY, "white", style.accent);
    }
    if (ground && gapOn("s")) {
      wallpaperWall(parts, true, z0 + 27.6, z0 + 27.53, x0 + 1.25, cx - gapHalf("s"), floorY, "white", style.accent);
      wallpaperWall(parts, true, z0 + 27.6, z0 + 27.53, cx + gapHalf("s"), x0 + 26.75, floorY, "white", style.accent);
    } else {
      wallpaperWall(parts, true, z0 + 27.6, z0 + 27.53, x0 + 1.25, x0 + 26.75, floorY, "white", style.accent);
    }
    if (ground && gapOn("w")) {
      wallpaperWall(parts, false, x0 + 0.4, x0 + 0.47, z0 + 1.25, cz - gapHalf("w"), floorY, "white", style.accent);
      wallpaperWall(parts, false, x0 + 0.4, x0 + 0.47, cz + gapHalf("w"), z0 + 26.75, floorY, "white", style.accent);
    } else {
      wallpaperWall(parts, false, x0 + 0.4, x0 + 0.47, z0 + 1.25, z0 + 26.75, floorY, "white", style.accent);
    }
    if (ground && gapOn("e")) {
      wallpaperWall(parts, false, x0 + 27.6, x0 + 27.53, z0 + 1.25, cz - gapHalf("e"), floorY, "white", style.accent);
      wallpaperWall(parts, false, x0 + 27.6, x0 + 27.53, cz + gapHalf("e"), z0 + 26.75, floorY, "white", style.accent);
    } else {
      wallpaperWall(parts, false, x0 + 27.6, x0 + 27.53, z0 + 1.25, z0 + 26.75, floorY, "white", style.accent);
    }
  }

  // Roof terrace: railing, trees, benches, sign.
  for (const [rx, rz, rw, rd] of [
    [x0 + 0.3, z0 + 0.3, TOWER_W - 0.6, 0.3],
    [x0 + 0.3, z0 + TOWER_D - 0.6, TOWER_W - 0.6, 0.3],
    [x0 + 0.3, z0 + 0.3, 0.3, TOWER_D - 0.6],
    [x0 + TOWER_W - 0.6, z0 + 0.3, 0.3, TOWER_D - 0.6],
  ] as Array<[number, number, number, number]>) {
    solidBox(parts, rx + rw / 2, 20.55, rz + rd / 2, rw, 1.1, rd, style.accent);
  }
  for (const [px, pz] of [[x0 + 6, z0 + 20], [x0 + 22, z0 + 20], [x0 + 6, z0 + 8], [x0 + 22, z0 + 8]] as Array<[number, number]>) {
    solidBox(parts, px, 21, pz, 0.5, 2, 0.5, "trunk");
    box(parts, px, 22.5, pz, 2.2, 2.2, 2.2, "leavesDark");
    solidBox(parts, px + 3, 20.38, pz, 1.1, 0.45, 3.4, "red");
  }
  signArt(parts, `roof-${towerId}`, cx, 22.2, z0 + TOWER_D - 0.4, Math.PI, 12, 2.4, [district.towerName.toUpperCase()], style.motto);

  // Zones (one per level), door + directory anchors, lift + lift anchors.
  const zones: Zone[] = [
    zoneFor(`${towerId}-g`, `${district.towerName} — Lobby`, "office", x0, z0, TOWER_W, TOWER_D, -0.1, 7.9, cx, cz - 6, cx, 2.6, z0 + TOWER_D - 0.4, 0, 0),
    zoneFor(`${towerId}-2`, `${district.towerName} — Floor 2`, "office", x0, z0, TOWER_W, TOWER_D, 7.9, 11.9, cx, cz, cx, 10.6, z0 + 0.4, 0, 1),
    zoneFor(`${towerId}-3`, `${district.towerName} — Floor 3`, "office", x0, z0, TOWER_W, TOWER_D, 11.9, 15.9, cx, cz, cx, 14.6, z0 + 0.4, 0, 2),
    zoneFor(`${towerId}-4`, `${district.towerName} — Floor 4`, "office", x0, z0, TOWER_W, TOWER_D, 15.9, 19.9, x0 + 7, cz, cx, 18.6, z0 + 0.4, 0, 3),
    zoneFor(`${towerId}-roof`, `${district.towerName} — Roof Terrace`, "office", x0, z0, TOWER_W, TOWER_D, 19.9, 24, cx, cz, cx, 22.2, z0 + TOWER_D - 0.4, Math.PI, 4),
  ];
  const anchors: Anchor[] = [
    doorAnchorFor(towerId, district.towerName, "office", x0, z0, TOWER_W, TOWER_D, door),
    { id: `${towerId}-directory`, name: "Office directory", kind: "offices", x: boardPos.x, y: 0, z: boardPos.z, yaw: boardPos.rotY, slot: 0 },
  ];
  for (let i = 0; i < TOWER_FLOORS_Y.length; i++) {
    anchors.push({
      id: `${liftId}-${i}`, name: `${district.towerName} Lift`, kind: "lift",
      x: x0 + 6.5, y: TOWER_FLOORS_Y[i], z: z0 + 3, yaw: -Math.PI / 2, slot: i,
      liftId, liftFloor: i,
    });
  }
  const lifts: Lift[] = [{
    id: liftId, name: `${district.towerName} Lift`, x: x0 + 3, z: z0 + 3, w: 4, d: 4,
    floors: [...TOWER_FLOORS_Y], stops: [...TOWER_STOPS], landing: "e",
  }];
  parts.facades.push({
    id: towerId,
    x: x0,
    z: z0,
    w: TOWER_W,
    d: TOWER_D,
    h: TOWER_H,
    style: style.facadeStyle,
    door,
    passThrough,
    enterable: true,
    hero: false,
    face: door,
    roof: style.roof,
    roofMat: style.roofMat,
    storefront: true,
    awning: district.id === "harbor",
    cornice: true,
    crown: style.crown ?? undefined,
  });
  parts.zones.push(...zones);
  parts.anchors.push(...anchors);
  parts.lifts.push(...lifts);
  return { district: district.id, x0, z0, zones, anchors, lifts, suites };
}

export interface DistrictBuild {
  district: DistrictId;
  tower: DistrictTowerBuild;
  departments: DepartmentBuild[];
}

/** One whole district: its tower + all four departments. */
export function buildDistrict(districtId: DistrictId, parts: CityParts): DistrictBuild {
  const district = districtById(districtId);
  const tower = buildDistrictTower(district, parts);
  const departments = (["fire", "police", "hospital", "emergency"] as DepartmentKind[]).map(
    (kind) => buildDepartment(kind, district, parts),
  );
  return { district: districtId, tower, departments };
}

/** All four districts: 4 towers + 16 departments. */
export function buildAllDistricts(parts: CityParts): DistrictBuild[] {
  return DISTRICTS.map((d) => buildDistrict(d.id, parts));
}

// ---------------------------------------------------------------------------
// District bridges — PHYSICAL decks from the road grid to each tower
// ---------------------------------------------------------------------------
// The four towers sit outside the home city's road grid (roads end at
// +/-184; the towers start at +/-196..230), so the player used to cross
// open grass to reach them. Each district gets one proper bridge deck —
// asphalt, sidewalks, gold rails with real colliders, lamps, a sign —
// running from the road grid to its tower door, so adjacent districts are
// bridged to each other through the hub without ever walking grass.
//
// Routing: the deck follows the tower door's axis where it is clear, and
// steps sideways around the department that fronts the door where it is
// not (the emergency department fronts the North tower, the fire
// department fronts the East tower, the police department fronts the West
// tower, the hospital fronts the Harbor tower) — and around the venues and
// homes that sit in the outer ring (the casino fronts the North tower's
// west lane, the museum fronts the Harbor tower's east lane, Home 2 fronts
// the West tower's east lane). The rects below are offsets from the
// district's tower origin in the DISTRICTS table — anchored to the
// district, never to a single building — so they survive any building
// move. Each rect was checked against DEPT_OFFSETS and the built venue /
// home footprints (seed 1): no deck touches a tower wall, a department, a
// venue or a home except where it lands on its tower.
// ---------------------------------------------------------------------------

export interface BaseBridgeSegment {
  /** Per-segment id, e.g. "bridge-north-a". */
  id: string;
  /** The bridge this segment belongs to, e.g. "bridge-north". */
  bridgeId: string;
  name: string;
  /** Deck centre (world coords). */
  x: number;
  z: number;
  /** true = the deck runs east-west (long axis X), false = north-south. */
  alongX: boolean;
  len: number;
  width: number;
  /** Sign lines — only the approach segment carries one. */
  sign?: [string, string];
  /** Which end the sign stands on AND the player approaches from:
   * "a" = west / north end, "b" = east / south end, "none" = no approach
   * (a second segment of an L: both ends are junctions / walls). */
  approachEnd: "a" | "b" | "none";
  /**
   * A gap in one long-edge rail, where a second segment joins this one:
   * the rail is built as runs on either side of [from, to] (world coords
   * along the rail), so the player can turn from one segment onto the
   * other. Without it the rail collider would wall off the junction.
   */
  railGap?: { side: "n" | "s" | "e" | "w"; from: number; to: number };
}

/**
 * Segment rects as offsets from the district tower origin (x0, z0).
 * One or two segments per district: a single straight bridge where the
 * road lines up with the tower, an L (two segments) where the blocks wall
 * off the direct line and the bridge has to turn a corner to reach the
 * door. Every rect is anchored to the district (tower origin), never to a
 * single building, so the bridges survive any building move.
 */
export const BASE_BRIDGE_SEGMENTS: Record<DistrictId, Array<{
  suffix: string;
  dx0: number; dz0: number; dx1: number; dz1: number;
  /** Force the deck's long axis (the crossing direction). Defaults to
   * whichever span is longer — wrong for a near-square deck like north-b,
   * whose crossing runs east-west across an 11-unit span. */
  alongX?: boolean;
  sign: boolean;
  approachEnd: "a" | "b" | "none";
  railGap?: { side: "n" | "s" | "e" | "w"; from: number; to: number };
}>> = {
  // North: door south. The emergency dept (x0+5..x0+23, z0+32..z0+44)
  // fronts the door and the casino fronts the tower's west lane, so
  // segment A runs WEST of the casino, on the x=-36 road line, from the
  // z=-180 road to the fire department's south face. Segment B turns east
  // along the fire dept's south face and stops 4 short of the tower's
  // west face — the deck must end short of the wall, or its side rails
  // would box the player in at the end with no way to turn south. From
  // there the player turns south around the deck's end and walks the
  // tower's south frontage to the door.
  // (The fire dept is the district's frontage: its door faces the tower.)
  north: [
    { suffix: "a", dx0: -29, dz0: 20, dx1: -15, dz1: 46, sign: true, approachEnd: "b", railGap: { side: "e", from: -210, to: -198 } },
    { suffix: "b", dx0: -15, dz0: 20, dx1: -4, dz1: 32, alongX: true, sign: false, approachEnd: "none" },
  ],
  // East: door west. The fire dept fronts the door and the x=151..173
  // block wall + the fire dept form one continuous wall from the road
  // grid to the tower, so the bridge comes in from the SOUTH: segment A
  // runs east along the z=-36 road's east end to the hospital's south-west
  // corner, segment B turns toward the door along the fire dept's east
  // side and stops 4 short of the dept's south face, so the player can
  // turn east around the deck's end and walk along the road (z≈-8) to the
  // door slot between the tower and the fire dept. A deck ending flush on
  // the wall would box the player in behind its own side rails.
  // Segment B joins A on A's SOUTH side (z=-29 edge), so the rail gap is
  // in A's south rail ("s" = the larger-z rail); the first draft put it
  // in "n" and the solid south rail walled the turn off.
  // Segment B is kept WEST of the tower's east road (x 190..250): that
  // road's north guard rail (z=-11.4, x 190..250) would wall the deck
  // off mid-span, so B ends at x=190, clear of the rail's west end.
  east: [
    { suffix: "a", dx0: -21, dz0: -29, dx1: 4, dz1: -15, sign: true, approachEnd: "a", railGap: { side: "s", from: 176, to: 190 } },
    { suffix: "b", dx0: -20, dz0: -15, dx1: -6, dz1: 4, sign: false, approachEnd: "none" },
  ],
  // West: door east. The police dept fronts the door, Home 2 fronts the
  // north lane and the x=-173 block fronts the east lane, so the bridge
  // comes in from the SOUTH: segment A runs west along the z=-36 road's
  // west end to open ground south of the tower, segment B turns toward
  // the door along the police dept's west side and stops 4 short of the
  // dept's south face, so the player can turn west around the deck's end
  // and walk along the road (z≈-8) to the door slot between the tower and
  // the police dept. A deck ending flush on the wall would box the player
  // in behind its own side rails. Segment B joins A on A's SOUTH side
  // (z=-28 edge), so the rail gap is in A's south rail — same "n"→"s"
  // fix as East. Segment B is kept EAST of the
  // tower's west road (x -250..-190): that road's north guard rail
  // (z=-11.4, x -250..-190) would wall the deck off mid-span, so B starts
  // at x=-190, clear of the rail's east end.
  west: [
    { suffix: "a", dx0: 28, dz0: -28, dx1: 50, dz1: -14, sign: true, approachEnd: "b", railGap: { side: "s", from: -190, to: -176 } },
    { suffix: "b", dx0: 34, dz0: -14, dx1: 48, dz1: 4, sign: false, approachEnd: "none" },
  ],
  // Harbor: door north. The hospital fronts the door and the museum
  // fronts its east lane, so the single deck runs WEST of the hospital,
  // from the z=180 road to 4 north of the tower's north face, so the
  // player can turn east around the deck's end and walk the tower's north
  // frontage to the door. A deck ending flush on the north face would box
  // the player in behind its own side rails.
  harbor: [
    { suffix: "a", dx0: -14, dz0: -22, dx1: 0, dz1: -4, sign: true, approachEnd: "a" },
  ],
};

export function baseBridgeSegments(district: District): BaseBridgeSegment[] {
  return BASE_BRIDGE_SEGMENTS[district.id].map((r) => {
    const x0 = district.towerX0 + r.dx0;
    const x1 = district.towerX0 + r.dx1;
    const z0 = district.towerZ0 + r.dz0;
    const z1 = district.towerZ0 + r.dz1;
    const alongX = r.alongX ?? (x1 - x0 >= z1 - z0);
    return {
      id: `bridge-${district.id}-${r.suffix}`,
      bridgeId: `bridge-${district.id}`,
      name: `${district.towerName} Bridge`,
      x: (x0 + x1) / 2,
      z: (z0 + z1) / 2,
      alongX,
      len: alongX ? x1 - x0 : z1 - z0,
      width: alongX ? z1 - z0 : x1 - x0,
      sign: r.sign ? [`${district.towerName} Bridge`.toUpperCase(), "TO ORBITX CITY"] : undefined,
      approachEnd: r.approachEnd,
      railGap: r.railGap,
    };
  });
}

/**
 * One physical district bridge segment, same deck as states.ts
 * buildDistrictBridge (asphalt 0.015 above the road so no top faces are
 * coplanar, sidewalks, gold rails with real colliders, lamps, sign on the
 * approach segment). No portal, no gate — you walk or drive across it
 * normally. A railGap leaves an opening in one long-edge rail where the
 * next segment joins, so an L turns instead of walling itself off.
 */
function buildBaseDistrictBridge(parts: CityParts, def: BaseBridgeSegment): void {
  const { x: cx, z: cz, alongX, len, width } = def;
  const railOff = width / 2 - 0.6;
  box(parts, cx, 0.075, cz, alongX ? len : width, 0.12, alongX ? width : len, "asphalt");
  if (alongX) {
    box(parts, cx, 0.115, cz - width / 2 + 1, len, 0.12, 2, "sidewalk");
    box(parts, cx, 0.115, cz + width / 2 - 1, len, 0.12, 2, "sidewalk");
  } else {
    box(parts, cx - width / 2 + 1, 0.115, cz, 2, 0.12, len, "sidewalk");
    box(parts, cx + width / 2 - 1, 0.115, cz, 2, 0.12, len, "sidewalk");
  }
  // One rail per long edge, as runs: a railGap splits the rail so the
  // joining segment can turn in (runs under 2 units are dropped).
  const railRuns = (side: "n" | "s" | "e" | "w"): Array<[number, number]> => {
    const start = alongX ? cx - len / 2 : cz - len / 2;
    const end = alongX ? cx + len / 2 : cz + len / 2;
    const gap = def.railGap && def.railGap.side === side ? def.railGap : null;
    if (!gap) return [[start, end]];
    const runs: Array<[number, number]> = [[start, gap.from], [gap.to, end]];
    return runs.filter(([a, b]) => b - a >= 2);
  };
  for (const s of [-1, 1]) {
    const side: "n" | "s" | "e" | "w" = alongX ? (s < 0 ? "n" : "s") : (s < 0 ? "w" : "e");
    const fixed = alongX ? cz + s * railOff : cx + s * railOff;
    for (const [a, b] of railRuns(side)) {
      const mid = (a + b) / 2;
      const runLen = b - a;
      const rx = alongX ? mid : fixed;
      const rz = alongX ? fixed : mid;
      box(parts, rx, 0.7, rz, alongX ? runLen : 0.4, 0.5, alongX ? 0.4 : runLen, "gold");
      col(parts, rx, 0.7, rz, alongX ? runLen : 0.4, 1.2, alongX ? 0.4 : runLen);
    }
  }
  const steps = Math.max(1, Math.floor(len / 12));
  for (let i = 0; i < steps; i++) {
    const o = (i - (steps - 1) / 2) * 12;
    const lx = alongX ? cx + o : cx;
    const lz = alongX ? cz : cz + o;
    box(parts, lx, 1.5, lz, 0.3, 3, 0.3, "black");
    box(parts, lx, 3.1, lz, 0.9, 0.5, 0.9, "gold");
  }
  // Sign on the approach segment only, at the approach end (the end the
  // player arrives from): "a" = west / north end, "b" = east / south end.
  if (def.sign) {
    const signAtA = def.approachEnd === "a";
    const signX = alongX ? (signAtA ? cx - len / 2 + 2 : cx + len / 2 - 2) : cx;
    const signZ = alongX ? cz : (signAtA ? cz - len / 2 + 2 : cz + len / 2 - 2);
    signArt(parts, `${def.bridgeId}-sign`, signX, 4.2, signZ, alongX ? Math.PI / 2 : 0, 14, 3, [def.sign[0], def.sign[1]], "Walk or drive across");
  }
}

/** All base-city district bridges: 4 bridges in 7 deck segments. */
export function buildAllDistrictBridges(parts: CityParts): BaseBridgeSegment[] {
  return DISTRICTS.flatMap((d) => {
    const segs = baseBridgeSegments(d);
    for (const seg of segs) buildBaseDistrictBridge(parts, seg);
    return segs;
  });
}

// ---------------------------------------------------------------------------
// District offices — a parameterized clone of the OrbitX HQ office pattern
// (api/city.js OFFICES / OFFICE_PRICES, content.ts OFFICE_SUITES).
//
// 25 suites per tower: 24 claimable + a founder-style top suite that is
// never for sale. Same tiers, same prices, City Sol only — no real money,
// no burn, no SOL/ORBITX. Suite ids are district-scoped
// (office-{district}-f{floor}-{letter}) so districts never collide.
//
// SERVER SCOPING (the per-(player, server) save model): every claim carries
// a `server` (1-5). A claim is unique per (suite, server): the same suite
// can be claimed by different players on different servers with no
// conflict, and a claim on Server 1 is invisible on Server 2. The directory
// is always rendered for ONE server — the server the player picked on the
// menu. The multiverse builder owns the save keying; these are pure
// functions over a claims array so the server op stays a thin wrapper
// (see WIRING.md §4). The in-memory store below mirrors api/city.js's
// memory() fallback and is keyed `${server}:${suite}`.
// ---------------------------------------------------------------------------

const SUITE_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

export function districtOfficeSuiteId(district: DistrictId, floor: 2 | 3 | 4, letter: string): string {
  return `office-${district}-f${floor}-${letter}`;
}

export function districtFounderSuiteId(district: DistrictId): string {
  return `office-${district}-f4-founder`;
}

export function districtOfficeSuites(district: DistrictId): OfficeSuite[] {
  const suites: OfficeSuite[] = [];
  for (const floor of [2, 3] as const) {
    for (const letter of SUITE_LETTERS) {
      suites.push({
        id: districtOfficeSuiteId(district, floor, letter),
        name: `Suite ${floor}${letter.toUpperCase()}`,
        floor,
        tier: "standard",
        claimable: true,
      });
    }
  }
  suites.push({
    id: districtFounderSuiteId(district),
    name: "Founder's Office",
    floor: 4,
    tier: "founder",
    claimable: false,
  });
  for (const letter of SUITE_LETTERS) {
    suites.push({
      id: districtOfficeSuiteId(district, 4, letter),
      name: `Suite 4${letter.toUpperCase()}`,
      floor: 4,
      tier: "premium",
      claimable: true,
    });
  }
  return suites;
}

/** All district suites across all four districts (100: 4 x 25). */
export function allDistrictOfficeSuites(): OfficeSuite[] {
  return DISTRICTS.flatMap((d) => districtOfficeSuites(d.id));
}

export function districtOfficeSuite(district: DistrictId, suiteId: string): OfficeSuite | null {
  return districtOfficeSuites(district).find((s) => s.id === suiteId) ?? null;
}

/** Same opening prices as the HQ tower (City Sol): standard 100/day,
 * 500/week, 1500/month; premium floor 4: 250/1200/3500. */
export const DISTRICT_OFFICE_PRICES = {
  standard: { 1: 100, 7: 500, 30: 1500 },
  premium: { 1: 250, 7: 1200, 30: 3500 },
} as const;

export type OfficeTermDays = 1 | 7 | 30;

export function districtOfficePrice(suite: OfficeSuite, termDays: number): number {
  if (suite.tier === "standard") {
    if (termDays === 1) return DISTRICT_OFFICE_PRICES.standard[1];
    if (termDays === 7) return DISTRICT_OFFICE_PRICES.standard[7];
    if (termDays === 30) return DISTRICT_OFFICE_PRICES.standard[30];
  }
  if (suite.tier === "premium") {
    if (termDays === 1) return DISTRICT_OFFICE_PRICES.premium[1];
    if (termDays === 7) return DISTRICT_OFFICE_PRICES.premium[7];
    if (termDays === 30) return DISTRICT_OFFICE_PRICES.premium[30];
  }
  return 0;
}

export function districtOfficeTermLabel(termDays: number): string {
  if (termDays === 1) return "1 day";
  if (termDays === 7) return "7 days";
  return "30 days";
}

export interface DistrictOfficeClaim {
  suite: string;
  /** The server this claim lives on (1-5). Same suite, other server = a
   * different claim entirely. */
  server: ServerId;
  owner_id: string;
  owner_name: string;
  project: string;
  logo: string;
  site: string;
  term_days: number;
  start: string;
  until: string;
  price: number;
  claimed_at: string;
}

export interface DistrictOfficeDirectoryRow {
  id: string;
  district: DistrictId;
  server: ServerId;
  floor: 2 | 3 | 4;
  name: string;
  tier: "standard" | "premium" | "founder";
  claimable: boolean;
  prices: { 1: number; 7: number; 30: number };
  claim: DistrictOfficeClaim | null;
}

export interface DistrictOfficeClaimsStore {
  all(): DistrictOfficeClaim[];
  get(suiteId: string, server: ServerId): DistrictOfficeClaim | null;
  put(claim: DistrictOfficeClaim): void;
  remove(suiteId: string, server: ServerId): void;
}

/** In-memory store (mirrors api/city.js's memory() fallback). Keyed by
 * `${server}:${suite}` — never by suite alone. */
export function createMemoryDistrictOfficeStore(): DistrictOfficeClaimsStore {
  const map = new Map<string, DistrictOfficeClaim>();
  const key = (suiteId: string, server: ServerId): string => `${server}:${suiteId}`;
  return {
    all: () => [...map.values()],
    get: (suiteId, server) => map.get(key(suiteId, server)) ?? null,
    put: (claim) => {
      map.set(key(claim.suite, claim.server), claim);
    },
    remove: (suiteId, server) => {
      map.delete(key(suiteId, server));
    },
  };
}

function districtTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function districtAddDaysISO(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function activeDistrictOfficeClaim(
  claims: DistrictOfficeClaim[],
  suiteId: string,
  server: ServerId,
): DistrictOfficeClaim | null {
  const today = districtTodayISO();
  return claims.find((row) => row.suite === suiteId && row.server === server && row.until >= today) ?? null;
}

/** Directory for ONE district on ONE server. */
export function districtOfficeDirectory(
  district: DistrictId,
  server: ServerId,
  claims: DistrictOfficeClaim[],
): DistrictOfficeDirectoryRow[] {
  return districtOfficeSuites(district).map((suite) => {
    const claim = suite.claimable ? activeDistrictOfficeClaim(claims, suite.id, server) : null;
    return {
      id: suite.id,
      district,
      server,
      floor: suite.floor,
      name: suite.name,
      tier: suite.tier,
      claimable: suite.claimable,
      prices: suite.claimable
        ? { 1: districtOfficePrice(suite, 1), 7: districtOfficePrice(suite, 7), 30: districtOfficePrice(suite, 30) }
        : { 1: 0, 7: 0, 30: 0 },
      claim,
    };
  });
}

export type DistrictClaimValidation =
  | { ok: true; suite: OfficeSuite; price: number }
  | { ok: false; message: string };

/** Pure validation mirroring api/city.js claimOffice — same checks, same
 * messages, plus the server scope: the conflict check is (suite, server),
 * so a claim on another server never blocks this one. */
export function validateDistrictOfficeClaim(
  district: DistrictId,
  server: ServerId,
  suiteId: string,
  termDays: number,
  project: string,
  logo: string,
  site: string,
  balance: number,
  claims: DistrictOfficeClaim[],
): DistrictClaimValidation {
  const suite = districtOfficeSuite(district, suiteId);
  if (!suite) return { ok: false, message: "Unknown suite." };
  if (!suite.claimable) {
    return { ok: false, message: "The Founder's Office belongs to the district. It is never for sale." };
  }
  if (termDays !== 1 && termDays !== 7 && termDays !== 30) {
    return { ok: false, message: "Pick a 1-day, 7-day, or 30-day lease." };
  }
  const cleanProject = project.trim().slice(0, 48);
  if (!cleanProject) return { ok: false, message: "Name the project claiming this office." };
  for (const url of [logo.trim(), site.trim()]) {
    if (url && !/^https?:\/\//i.test(url)) {
      return { ok: false, message: "Logo and site links must start with http:// or https://." };
    }
  }
  const price = districtOfficePrice(suite, termDays);
  if (!price) return { ok: false, message: "That lease term is not priced." };
  const taken = activeDistrictOfficeClaim(claims, suite.id, server);
  if (taken) {
    return { ok: false, message: `${suite.name} is already claimed by ${taken.project} on Server ${server} until ${taken.until}.` };
  }
  if (balance < price) {
    return { ok: false, message: `Not enough City Sol — ${suite.name} for ${districtOfficeTermLabel(termDays)} costs ${price} City Sol.` };
  }
  return { ok: true, suite, price };
}

/** Build the claim record (pure). The server op deducts the balance, saves
 * the player, then persists this — refunding on save failure, exactly like
 * claimOffice. */
export function buildDistrictOfficeClaim(
  district: DistrictId,
  server: ServerId,
  suite: OfficeSuite,
  ownerId: string,
  ownerName: string,
  project: string,
  logo: string,
  site: string,
  termDays: OfficeTermDays,
  price: number,
  start?: string,
): DistrictOfficeClaim {
  if (!districtOfficeSuite(district, suite.id)) {
    throw new Error(`Suite ${suite.id} does not belong to district ${district}.`);
  }
  const startDay = start ?? districtTodayISO();
  return {
    suite: suite.id,
    server,
    owner_id: ownerId,
    owner_name: ownerName,
    project: project.trim().slice(0, 48),
    logo: logo.trim().slice(0, 200),
    site: site.trim().slice(0, 200),
    term_days: termDays,
    start: startDay,
    until: districtAddDaysISO(startDay, termDays),
    price,
    claimed_at: new Date().toISOString(),
  };
}

export type DistrictReleaseValidation =
  | { ok: true; claim: DistrictOfficeClaim }
  | { ok: false; message: string };

/** Release check mirroring releaseOffice: the claim must exist ON THIS
 * SERVER and belong to the player. No refund for the days left. */
export function validateDistrictOfficeRelease(
  district: DistrictId,
  server: ServerId,
  suiteId: string,
  ownerId: string,
  claims: DistrictOfficeClaim[],
): DistrictReleaseValidation {
  const suite = districtOfficeSuite(district, suiteId);
  if (!suite) return { ok: false, message: "Unknown suite." };
  const claim = activeDistrictOfficeClaim(claims, suite.id, server);
  if (!claim) return { ok: false, message: `${suite.name} is not claimed on Server ${server}.` };
  if (claim.owner_id !== ownerId) {
    return { ok: false, message: `Only ${claim.project} can release ${suite.name}.` };
  }
  return { ok: true, claim };
}

// ---------------------------------------------------------------------------
// Emergency jobs + the 20-job roster.
//
// Two NEW jobs — cop (police) and paramedic (EMT) — plus fire and doctor
// extended from their existing waypoint jobs into proper department jobs:
// each now starts by reporting to its department building. fire/doctor pay
// is UNCHANGED (75 / 70 — server parity, do not touch JOBS for those).
//
// Phase model mirrors runtime.ts tickJobs: `phase` is an index, each phase
// resolves to one target point (a department anchor — nearest of its kind —
// a fixed anchor, or a fixed point). A phase WITH dwellSeconds is a hold-
// still phase (same as lifeguard/cleaner/bus/fire/doctor today: 2-3s);
// a phase without it completes on arrival. The wiring agent adds cop +
// paramedic to the dwellJob set for their dwell phases — see WIRING.md §3.
// All pay is City Sol (goes through the existing job-start / earn ops, so
// the +5%-per-streak scaling in scaledPay applies unchanged).
// ---------------------------------------------------------------------------

export type JobTarget =
  | { kind: "dept"; dept: DepartmentKind }
  | { kind: "anchor"; id: string }
  | { kind: "point"; x: number; z: number };

export interface JobPhase {
  target: JobTarget;
  /** Objective line shown while this phase is active. */
  label: string;
  /** Hold-still seconds; absent = completes on arrival. */
  dwellSeconds?: number;
}

export interface EmergencyJobSpec {
  id: string;
  title: string;
  department: DepartmentKind;
  basePay: number;
  phases: JobPhase[];
}

/** Smoke reports, from the existing runtime FIRE_SPOTS (unchanged). */
export const FIRE_REPORT_POINTS = [
  { x: 18, z: 72, label: "Put out the fire at the north avenue" },
  { x: -18, z: -72, label: "Put out the fire at the south avenue" },
  { x: 72, z: 90, label: "Put out the fire at the east avenue" },
] as const;

export const EMERGENCY_JOBS: EmergencyJobSpec[] = [
  {
    id: "cop",
    title: "Police Officer",
    department: "police",
    basePay: 85,
    phases: [
      { target: { kind: "dept", dept: "police" }, label: "Report to the police station" },
      { target: { kind: "point", x: 0, z: 12 }, label: "Patrol the plaza fountain" },
      { target: { kind: "anchor", id: "project-0" }, label: "Patrol the Project District office" },
      { target: { kind: "dept", dept: "police" }, label: "File the report at the station", dwellSeconds: 3 },
    ],
  },
  {
    id: "paramedic",
    title: "Paramedic",
    department: "hospital",
    basePay: 80,
    phases: [
      { target: { kind: "dept", dept: "hospital" }, label: "Report to the hospital" },
      { target: { kind: "dept", dept: "emergency" }, label: "Pick up the stretcher at the Emergency Center" },
      { target: { kind: "point", x: 0, z: 12 }, label: "Treat the patient at the fountain", dwellSeconds: 3 },
      { target: { kind: "dept", dept: "hospital" }, label: "Bring the patient back to the hospital", dwellSeconds: 3 },
    ],
  },
  {
    id: "fire",
    title: "Firefighter",
    department: "fire",
    basePay: 75,
    phases: [
      { target: { kind: "dept", dept: "fire" }, label: "Report to the Fire Department" },
      ...FIRE_REPORT_POINTS.map((spot) => ({
        target: { kind: "point", x: spot.x, z: spot.z } as JobTarget,
        label: spot.label,
        dwellSeconds: 3,
      })),
    ],
  },
  {
    id: "doctor",
    title: "Doctor",
    department: "hospital",
    basePay: 70,
    phases: [
      { target: { kind: "dept", dept: "hospital" }, label: "Report to the hospital" },
      { target: { kind: "anchor", id: "hall" }, label: "Treat patient 1 at the hall clinic", dwellSeconds: 3 },
      { target: { kind: "anchor", id: "hall" }, label: "Treat patient 2 at the hall clinic", dwellSeconds: 3 },
      { target: { kind: "anchor", id: "hall" }, label: "Treat patient 3 at the hall clinic", dwellSeconds: 3 },
      { target: { kind: "dept", dept: "emergency" }, label: "Restock at the Emergency Center" },
    ],
  },
];

/** Pay to ADD to api/city.js JOBS. fire (75) and doctor (70) are already
 * there — unchanged. */
export const EMERGENCY_JOB_PAY: Record<string, number> = {
  cop: 85,
  paramedic: 80,
};

export function emergencyJobById(id: string): EmergencyJobSpec | null {
  return EMERGENCY_JOBS.find((job) => job.id === id) ?? null;
}

/** Nearest department anchor of a kind to a player position — department
 * anchors are district-scoped (`dept-{district}-{kind}`), so the job
 * always sends the player to the closest one. */
export function resolveDeptAnchor(
  dept: DepartmentKind,
  px: number,
  pz: number,
  anchors: Anchor[],
): Anchor | null {
  let best: Anchor | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    if (!anchor.id.startsWith("dept-") || !anchor.id.endsWith(`-${dept}`)) continue;
    const dist = Math.hypot(anchor.x - px, anchor.z - pz);
    if (dist < bestDist) {
      bestDist = dist;
      best = anchor;
    }
  }
  return best;
}

/** tickJobs-style target lookup for one emergency-job phase. */
export function jobTargetFor(
  spec: EmergencyJobSpec,
  phaseIndex: number,
  px: number,
  pz: number,
  anchors: Anchor[],
): { x: number; z: number } | null {
  const phase = spec.phases[phaseIndex];
  if (!phase) return null;
  const target = phase.target;
  if (target.kind === "point") return { x: target.x, z: target.z };
  if (target.kind === "anchor") {
    const found = anchors.find((a) => a.id === target.id);
    return found ? { x: found.x, z: found.z } : null;
  }
  const dept = resolveDeptAnchor(target.dept, px, pz, anchors);
  return dept ? { x: dept.x, z: dept.z } : null;
}

/** objectiveText-style line for one emergency-job phase. */
export function jobObjective(spec: EmergencyJobSpec, phaseIndex: number): string {
  return spec.phases[phaseIndex]?.label ?? spec.title;
}

// ---------------------------------------------------------------------------
// The 20-job roster — the curated GTA-style set. The 19 existing jobs
// (JOB_LIST, App.tsx) + cop + paramedic = 21, so one is cut: photographer
// (40, the lowest pay, overlaps the guide's tour stops). Photographer stays
// a playable job in the game — it is simply not in the curated 20.
// Every roster job is a real working job: take it, run the phases, get
// paid in City Sol through the existing job-start / earn ops.
// ---------------------------------------------------------------------------

export interface RosterJob {
  id: string;
  name: string;
  area: string;
  base: number;
  duty: string;
}

export const JOBS_20: RosterJob[] = [
  { id: "courier", name: "Courier", area: "City", base: 45, duty: "Pick up a package at the fountain and drop it at the shop." },
  { id: "taxi", name: "Taxi driver", area: "City", base: 90, duty: "Three fares around the city — pick up, drop off, repeat." },
  { id: "guide", name: "City guide", area: "City", base: 60, duty: "Visit the shop, the hall, and OrbitX HQ." },
  { id: "barista", name: "Barista", area: "City", base: 45, duty: "Serve the shift at Cafe Nova." },
  { id: "vendor", name: "Market vendor", area: "Market", base: 55, duty: "Open a stall at the Night Market." },
  { id: "security", name: "Security", area: "City", base: 75, duty: "Patrol the fountain, the hall, and OrbitX HQ." },
  { id: "mail", name: "Mail carrier", area: "City", base: 70, duty: "Collect the bag at the Jobs board, then deliver to two homes and a project office." },
  { id: "lifeguard", name: "Lifeguard", area: "Harbor", base: 65, duty: "Walk the harbor pier and scan the water at all three posts." },
  { id: "cleaner", name: "Street cleaner", area: "Plaza", base: 55, duty: "Sweep five litter spots around the plaza — stand still to sweep each one." },
  { id: "bus", name: "Bus driver", area: "City", base: 80, duty: "Run the city bus — four stops, pause at each to board riders." },
  { id: "fire", name: "Firefighter", area: "Fire Department", base: 75, duty: "Report to the Fire Department, then answer three smoke reports — stand at each fire to put it out." },
  { id: "doctor", name: "Doctor", area: "Hospital", base: 70, duty: "Report to the hospital, run the hall clinic — treat three patients, one at a time — then restock at the Emergency Center." },
  { id: "teacher", name: "Teacher", area: "City", base: 60, duty: "Take the class on a field trip — library, park, then the fountain." },
  { id: "mechanic", name: "Mechanic", area: "City", base: 55, duty: "Service the hover-car on the east road." },
  { id: "promoter", name: "Promoter", area: "City", base: 50, duty: "Visit the hall, then the plaza ad kiosk." },
  { id: "dock", name: "Dock hand", area: "Harbor", base: 65, duty: "Clock in at the harbor office, down the pier." },
  { id: "dj", name: "DJ", area: "Community Hall", base: 55, duty: "Play a set inside the Community Hall." },
  { id: "banker", name: "Bank teller", area: "Bank", base: 50, duty: "Open the window at OrbitX Bank." },
  { id: "cop", name: "Police Officer", area: "Police", base: 85, duty: "Report to the police station, patrol the fountain and the Project District, then file the report." },
  { id: "paramedic", name: "Paramedic", area: "Emergency Center", base: 80, duty: "Report to the hospital, pick up the stretcher at the Emergency Center, treat a patient at the fountain, bring them back." },
];

/** Entries to ADD to App.tsx JOB_LIST (cop + paramedic) and the two
 * descriptions to REPLACE there (fire + doctor, now department jobs). */
export const JOB_LIST_ADDITION: Array<{ id: string; name: string; desc: string; base: number }> = [
  { id: "cop", name: "Police Officer", desc: "Report to the police station, patrol the fountain and the Project District, then file the report.", base: 85 },
  { id: "paramedic", name: "Paramedic", desc: "Report to the hospital, pick up the stretcher at the Emergency Center, treat a patient at the fountain, bring them back.", base: 80 },
];

export const JOB_LIST_DESC_UPDATES: Record<string, string> = {
  fire: "Report to the Fire Department, then answer three smoke reports — stand at each fire to put it out.",
  doctor: "Report to the hospital, run the hall clinic — treat three patients, one at a time — then restock at the Emergency Center.",
};
