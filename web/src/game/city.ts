import { makeRng, type Rng } from "./seed";
import { buildAllRegions, buildAllBridges, WORLD_BOUNDS } from "./states";
import { buildAllHomes } from "./homes";
import { buildAllDistricts, type CityParts } from "./emergency";

export type Mat =
  | "asphalt"
  | "sidewalk"
  | "plaza"
  | "grass"
  | "hedge"
  | "leaves"
  | "leavesDark"
  | "trunk"
  | "black"
  | "white"
  | "gray"
  | "cyan"
  | "cyanhot"
  | "water"
  | "stone"
  | "lane"
  | "hill"
  | "track"
  | "wood"
  | "warm"
  | "cream"
  | "red"
  | "gold"
  | "ceil";

export interface Box {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  mat: Mat;
  ry: number;
  hide?: boolean;
}

export interface Tier {
  w: number;
  d: number;
  h: number;
}

/** A side annex attached to a building's flank (an L-shaped footprint). */
export interface Wing {
  dx: number;
  dz: number;
  w: number;
  d: number;
  h: number;
  style: number;
  roof: "flat" | "gable" | "hip";
}

export interface Facade {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: number;
  door: Face | "";
  enterable: boolean;
  hero: boolean;
  /** Street-facing side — where the storefront / porch / awning sits. */
  face: Face;
  /** Roof shape; flat = parapet kit. gable/hip = pitched roof over the walls. */
  roof?: "flat" | "gable" | "hip" | "stepped";
  /** Gable ridge runs along this face's axis ("n"/"s" = ridge along X). */
  roofDir?: Face;
  /** Roof material: 0 charcoal, 1 terracotta, 2 slate blue, 3 gold. */
  roofMat?: number;
  porch?: boolean;
  chimney?: boolean;
  wing?: Wing;
  /** A smaller box crowning the roof (centered), e.g. the HQ's stepped top. */
  crown?: Tier;
  /** Stepped tower tiers (stacked from the ground, centered on the rect). */
  tiers?: Tier[];
  /** Ground-floor glass storefront + sign band on the face side. */
  storefront?: boolean;
  awning?: boolean;
  /** Gold trim band at the top of the walls. */
  cornice?: boolean;
}

export interface Collider {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  // Optional tag for colliders the runtime enables/disables (e.g. a lift
  // door blocker: "lift-door:<liftId>:<floorIndex>").
  tag?: string;
}

export interface ShipPath {
  y: number;
  radiusX: number;
  radiusZ: number;
  speed: number;
  phase: number;
}

export interface RailPoint {
  x: number;
  y: number;
  z: number;
}

export interface Anchor {
  id: string;
  name: string;
  kind: "shop" | "cafe" | "hall" | "project" | "jobs" | "events" | "ads" | "bank" | "garage" | "arcade" | "market" | "dock" | "mall" | "office" | "offices" | "lift" | "cinema" | "library" | "gym" | "park" | "stadium" | "museum" | "casino" | "nightclub" | "hotel" | "fire" | "police" | "hospital" | "emergency";
  x: number;
  y: number;
  z: number;
  yaw: number;
  slot: number;
  liftId?: string;
  liftFloor?: number;
}

/** A painted sign / wall art plate mounted by the runtime (canvas texture). */
export interface Art {
  id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  w: number;
  h: number;
  lines: string[];
  sub: string;
}

/** A working elevator: shaft rect + the walking-surface Y of each stop. */
export interface Lift {
  id: string;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  floors: number[];
  stops: string[];
  // The shaft face the call buttons and the cab door sit on.
  landing: Face;
}

export interface BoardSlot {
  id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
}

export interface CarSpawn {
  id: string;
  x: number;
  z: number;
  yaw: number;
}

export interface Zone {
  id: string;
  name: string;
  kind: "shop" | "cafe" | "hall" | "project" | "bank" | "garage" | "arcade" | "market" | "dock" | "mall" | "office" | "cinema" | "library" | "gym" | "park" | "stadium" | "museum" | "casino" | "nightclub" | "hotel" | "fire" | "police" | "hospital" | "emergency";
  slot: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  serviceX: number;
  serviceZ: number;
  signX: number;
  signY: number;
  signZ: number;
  signRot: number;
  minY?: number;
  maxY?: number;
}

export interface City {
  boxes: Box[];
  colliders: Collider[];
  rail: RailPoint[];
  ships: ShipPath[];
  spawn: { x: number; y: number; z: number; yaw: number; pitch: number };
  focus: { x: number; y: number; z: number };
  fountain: { x: number; z: number };
  anchors: Anchor[];
  boards: BoardSlot[];
  cars: CarSpawn[];
  zones: Zone[];
  facades: Facade[];
  citizens: Citizen[];
  art: Art[];
  lifts: Lift[];
}

export interface Citizen {
  name: string;
  color: string;
  x: number;
  z: number;
}

const CENTERS = [-180, -144, -108, -72, -36, 0, 36, 72, 108, 144, 180];
const HALF = 5;
const SIDE = 2;
const SOUTH = -3;
const FOUNTAIN = { x: 0, z: 12 };
const TRACK_HALF = 110;
const TRACK_R = 18;
const TRACK_Y = 30;
let visualHide = false;
const facades: Facade[] = [];
const art: Art[] = [];

// Mega buildings: superblocks east (mall) and west (OrbitX office) of the
// plaza. Each is 58x58 and straddles the x=±72 road and the z=0 road, so
// addRoads / addStreetLife / reservedPlot all treat them as one plot.
const MALL = { x0: 43, z0: -29, x1: 101, z1: 29 };
const OFFICE = { x0: -101, z0: -29, x1: -43, z1: 29 };
function inMega(x: number, z: number) {
  return (
    (x >= MALL.x0 && x <= MALL.x1 && z >= MALL.z0 && z <= MALL.z1) ||
    (x >= OFFICE.x0 && x <= OFFICE.x1 && z >= OFFICE.z0 && z <= OFFICE.z1)
  );
}

function put(
  boxes: Box[],
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  mat: Mat,
  ry = 0,
) {
  // The voxel shell of pretty-faced buildings is hidden dead weight: the
  // pretty overlay is the only visible representation, so never emit it.
  if (visualHide) return;
  boxes.push({ x, y, z, sx, sy, sz, mat, ry, hide: visualHide || undefined });
}

function col(x: number, y: number, z: number, sx: number, sy: number, sz: number): Collider {
  return {
    minX: x - sx / 2,
    maxX: x + sx / 2,
    minY: y - sy / 2,
    maxY: y + sy / 2,
    minZ: z - sz / 2,
    maxZ: z + sz / 2,
  };
}

export type Face = "n" | "s" | "e" | "w";

function emitX(
  boxes: Box[],
  x0: number,
  y0: number,
  z: number,
  w: number,
  h: number,
  matAt: (u: number, ly: number) => Mat | "air",
) {
  for (let ly = 0; ly < h; ly++) {
    let u = 0;
    while (u < w) {
      const mat = matAt(u, ly);
      if (mat === "air") {
        u++;
        continue;
      }
      let u2 = u + 1;
      while (u2 < w && matAt(u2, ly) === mat) u2++;
      const len = u2 - u;
      put(boxes, x0 + u + len / 2, y0 + ly + 0.5, z + 0.5, len, 1, 1, mat);
      u = u2;
    }
  }
}

function emitZ(
  boxes: Box[],
  x: number,
  y0: number,
  z0: number,
  d: number,
  h: number,
  matAt: (u: number, ly: number) => Mat | "air",
) {
  for (let ly = 0; ly < h; ly++) {
    let u = 0;
    while (u < d) {
      const mat = matAt(u, ly);
      if (mat === "air") {
        u++;
        continue;
      }
      let u2 = u + 1;
      while (u2 < d && matAt(u2, ly) === mat) u2++;
      const len = u2 - u;
      put(boxes, x + 0.5, y0 + ly + 0.5, z0 + u + len / 2, 1, 1, len, mat);
      u = u2;
    }
  }
}

function shell(
  boxes: Box[],
  cols: Collider[],
  x0: number,
  y0: number,
  z0: number,
  w: number,
  h: number,
  d: number,
  sample: (u: number, ly: number, face: Face) => Mat,
  roof: Mat,
) {
  visualHide = true;
  emitX(boxes, x0, y0, z0, w, h, (u, ly) => sample(u, ly, "n"));
  emitX(boxes, x0, y0, z0 + d - 1, w, h, (u, ly) => sample(u, ly, "s"));
  if (d > 2) {
    emitZ(boxes, x0, y0, z0 + 1, d - 2, h, (u, ly) => sample(u, ly, "w"));
    emitZ(boxes, x0 + w - 1, y0, z0 + 1, d - 2, h, (u, ly) => sample(u, ly, "e"));
  }
  put(boxes, x0 + w / 2, y0 + h + 0.5, z0 + d / 2, w, 1, d, roof);
  visualHide = false;
  cols.push({
    minX: x0,
    maxX: x0 + w,
    minY: y0,
    maxY: y0 + h + 1,
    minZ: z0,
    maxZ: z0 + d,
  });
  return y0 + h + 1;
}

function facadeSample(style: number, len: number) {
  return (u: number, ly: number): Mat => {
    const edge = u === 0 || u === len - 1;
    if (ly <= 3) {
      if (ly === 0) return "stone";
      if (ly === 3) return "white";
      if (u % 4 === 0) return "white";
      if (ly === 2) return "cyan";
      return "black";
    }
    if (edge) return ly % 6 === 0 ? "cyan" : "white";
    if (style === 1) {
      if (u % 4 === 0) return "white";
      if (ly % 3 === 1) return "cyan";
      return "black";
    }
    if (style === 2) {
      if (ly % 2 === 0) return "cyan";
      return "white";
    }
    if (style === 3) {
      if (ly % 3 === 2) return "stone";
      if (u % 2 === 0) return "cyan";
      return "white";
    }
    if (ly % 4 === 0) return "white";
    if (ly % 4 === 2) return "cyan";
    return "black";
  };
}

function wallBox(cols: Collider[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05 || z1 - z0 < 0.05) return;
  cols.push({ minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 });
}

function addWallCols(cols: Collider[], x0: number, y0: number, z0: number, w: number, h: number, d: number, door: Face) {
  const top = y0 + h;
  const gap = 4;
  const faces: Face[] = ["n", "s", "e", "w"];
  for (const face of faces) {
    const alongX = face === "n" || face === "s";
    const zA = face === "s" ? z0 + d - 1 : z0;
    const zB = face === "n" || face === "s" ? zA + 1 : z0 + d;
    const xA = face === "e" ? x0 + w - 1 : x0;
    const xB = face === "n" || face === "s" ? x0 + w : xA + 1;
    if (face !== door) {
      wallBox(cols, xA, y0, face === "w" || face === "e" ? z0 : zA, xB, top, face === "w" || face === "e" ? z0 + d : zB);
      continue;
    }
    const span = alongX ? w : d - 2;
    const origin = alongX ? x0 : z0 + 1;
    const gap0 = origin + (span - gap) / 2;
    const gap1 = gap0 + gap;
    const lintel = y0 + 3;
    if (alongX) {
      wallBox(cols, x0, y0, zA, gap0, top, zB);
      wallBox(cols, gap1, y0, zA, x0 + w, top, zB);
      wallBox(cols, gap0, lintel, zA, gap1, top, zB);
    } else {
      wallBox(cols, xA, y0, z0, xB, top, gap0);
      wallBox(cols, xA, y0, gap1, xB, top, z0 + d);
      wallBox(cols, xA, lintel, gap0, xB, top, gap1);
    }
  }
}

function shellOpen(
  boxes: Box[],
  cols: Collider[],
  x0: number,
  y0: number,
  z0: number,
  w: number,
  h: number,
  d: number,
  sample: (u: number, ly: number, face: Face, len: number) => Mat | "air",
  roof: Mat,
  door: Face,
) {
  visualHide = true;
  emitX(boxes, x0, y0, z0, w, h, (u, ly) => sample(u, ly, "n", w));
  emitX(boxes, x0, y0, z0 + d - 1, w, h, (u, ly) => sample(u, ly, "s", w));
  if (d > 2) {
    emitZ(boxes, x0, y0, z0 + 1, d - 2, h, (u, ly) => sample(u, ly, "w", d - 2));
    emitZ(boxes, x0 + w - 1, y0, z0 + 1, d - 2, h, (u, ly) => sample(u, ly, "e", d - 2));
  }
  put(boxes, x0 + w / 2, y0 + h + 0.5, z0 + d / 2, w, 1, d, roof);
  visualHide = false;
  addWallCols(cols, x0, y0, z0, w, h, d, door);
  cols.push({
    minX: x0,
    maxX: x0 + w,
    minY: y0 + h,
    maxY: y0 + h + 1,
    minZ: z0,
    maxZ: z0 + d,
  });
}

function hole(face: Face, door: Face, u: number, ly: number, len: number): boolean {
  if (face !== door || ly >= 3) return false;
  const start = (len - 4) / 2;
  return u >= start && u < start + 4;
}

function addAwning(boxes: Box[], x0: number, z0: number, w: number, d: number, face: Face) {
  visualHide = true;
  const y = 3.35;
  if (face === "n") put(boxes, x0 + w / 2, y, z0 - 0.75, Math.max(4, w * 0.7), 0.14, 1.35, "white");
  if (face === "s") put(boxes, x0 + w / 2, y, z0 + d + 0.75, Math.max(4, w * 0.7), 0.14, 1.35, "white");
  if (face === "w") put(boxes, x0 - 0.75, y, z0 + d / 2, 1.35, 0.14, Math.max(4, d * 0.7), "white");
  if (face === "e") put(boxes, x0 + w + 0.75, y, z0 + d / 2, 1.35, 0.14, Math.max(4, d * 0.7), "white");
  visualHide = false;
}

function addBalcony(boxes: Box[], x0: number, y: number, z0: number, w: number, d: number, face: Face) {
  visualHide = true;
  if (face === "n") put(boxes, x0 + w / 2, y, z0 - 0.55, w * 0.72, 0.16, 1.1, "stone");
  if (face === "s") put(boxes, x0 + w / 2, y, z0 + d + 0.55, w * 0.72, 0.16, 1.1, "stone");
  if (face === "w") put(boxes, x0 - 0.55, y, z0 + d / 2, 1.1, 0.16, d * 0.72, "stone");
  if (face === "e") put(boxes, x0 + w + 0.55, y, z0 + d / 2, 1.1, 0.16, d * 0.72, "stone");
  visualHide = false;
}

function addCrown(boxes: Box[], cols: Collider[], x: number, y: number, z: number, w: number, d: number) {
  visualHide = true;
  const cw = Math.max(4, w * 0.42);
  const cd = Math.max(4, d * 0.42);
  put(boxes, x, y + 1.3, z, cw, 2.4, cd, "white");
  put(boxes, x, y + 2.7, z, cw * 0.5, 0.45, cd * 0.5, "cyan");
  put(boxes, x, y + 5.4, z, 0.4, 4.6, 0.4, "gray");
  put(boxes, x, y + 7.9, z, 0.75, 0.75, 0.75, "cyanhot");
  cols.push(col(x, y + 1.3, z, cw, 2.4, cd));
  cols.push(col(x, y + 5.4, z, 0.4, 4.6, 0.4));
  visualHide = false;
}

function addTowerPorch(boxes: Box[], cols: Collider[]) {
  visualHide = true;
  const zFace = SOUTH;
  put(boxes, 0, 0.2, zFace + 1.7, 18, 0.32, 3.4, "stone");
  put(boxes, 0, 0.48, zFace + 2.7, 12, 0.24, 1.5, "plaza");
  for (const x of [-8, -4, 4, 8]) {
    put(boxes, x, 2.7, zFace + 2.4, 0.75, 5.2, 0.75, "white");
    put(boxes, x, 4.6, zFace + 2.4, 0.28, 1.4, 0.28, "cyan");
    cols.push(col(x, 2.7, zFace + 2.4, 0.75, 5.2, 0.75));
  }
  put(boxes, 0, 5.5, zFace + 2.3, 18.5, 0.38, 4.4, "black");
  put(boxes, 0, 5.82, zFace + 2.3, 18.8, 0.16, 0.35, "cyanhot");
  cols.push(col(0, 5.5, zFace + 2.3, 18.5, 0.38, 4.4));
  visualHide = false;
}

function towerSample(len: number) {
  return (u: number, ly: number) => {
    if (u <= 1 || u >= len - 2) return ly % 4 === 1 ? ("cyanhot" as Mat) : ("white" as Mat);
    if (ly % 4 === 3) return "white" as Mat;
    if (ly % 4 === 1 || ly % 4 === 2) return "cyan" as Mat;
    return "black" as Mat;
  };
}

function addTree(boxes: Box[], cols: Collider[], x: number, z: number, y0: number) {
  put(boxes, x, y0 + 2.1, z, 0.85, 4.2, 0.85, "trunk");
  cols.push(col(x, y0 + 2.1, z, 0.85, 4.2, 0.85));
  const layers: Array<{ y: number; r: number; mat: Mat }> = [
    { y: 4.3, r: 2, mat: "leavesDark" },
    { y: 5.35, r: 2, mat: "leaves" },
    { y: 6.4, r: 1, mat: "leaves" },
  ];
  for (const layer of layers) {
    for (let dx = -layer.r; dx <= layer.r; dx++) {
      for (let dz = -layer.r; dz <= layer.r; dz++) {
        if (Math.abs(dx) === layer.r && Math.abs(dz) === layer.r) continue;
        put(boxes, x + dx, y0 + layer.y, z + dz, 0.94, 0.94, 0.94, layer.mat);
      }
    }
  }
}

function addLamp(boxes: Box[], x: number, z: number, y0 = 0) {
  put(boxes, x, y0 + 2.15, z, 0.26, 4.3, 0.26, "black");
  put(boxes, x, y0 + 4.42, z, 0.78, 0.16, 0.78, "black");
  put(boxes, x, y0 + 4.18, z, 0.55, 0.48, 0.55, "cyan");
}

function addBench(boxes: Box[], cols: Collider[], x: number, z: number, alongX: boolean) {
  const sx = alongX ? 1.7 : 0.5;
  const sz = alongX ? 0.5 : 1.7;
  put(boxes, x, 0.48, z, sx, 0.16, sz, "gray");
  put(boxes, x, 0.78, z, alongX ? sx : 0.16, 0.5, alongX ? 0.16 : sz, "black");
  cols.push(col(x, 0.55, z, sx, 0.7, sz));
}

function disc(boxes: Box[], cx: number, cy: number, cz: number, r: number, h: number, mat: Mat, hole = 0) {
  const R = Math.ceil(r);
  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x, z);
      if (d <= r && d >= hole) put(boxes, cx + x, cy, cz + z, 0.96, h, 0.96, mat);
    }
  }
}

function holoOn(c: number, r: number, cols: number, rows: number, kind: number) {
  if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) return true;
  const u = (c + 0.5) / cols - 0.5;
  const v = (r + 0.5) / rows - 0.5;
  if (kind % 3 === 0) return Math.abs(Math.hypot(u * 1.5, v * 1.8) - 0.3) < 0.07 || Math.abs(v) < 0.05;
  if (kind % 3 === 1) return Math.abs(u) < 0.07 || Math.abs(v) < 0.07 || Math.abs(Math.abs(u) - Math.abs(v)) < 0.05;
  return (c * 2 + r) % 3 === 0;
}

function addBillboard(
  boxes: Box[],
  x0: number,
  y0: number,
  z0: number,
  w: number,
  d: number,
  face: Face,
  kind: number,
) {
  const colsN = 12;
  const rowsN = 8;
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < colsN; c++) {
      if (!holoOn(c, r, colsN, rowsN, kind)) continue;
      const mat: Mat = c === 0 || r === 0 || c === colsN - 1 || r === rowsN - 1 ? "cyanhot" : "cyan";
      const y = y0 + r + 0.5;
      if (face === "n" || face === "s") {
        const x = x0 + (w - colsN) / 2 + c + 0.5;
        const z = face === "s" ? z0 + d + 0.28 : z0 - 0.28;
        put(boxes, x, y, z, 0.86, 0.86, 0.36, mat);
      } else {
        const z = z0 + (d - colsN) / 2 + c + 0.5;
        const x = face === "e" ? x0 + w + 0.28 : x0 - 0.28;
        put(boxes, x, y, z, 0.36, 0.86, 0.86, mat);
      }
    }
  }
}

function frontFace(cx: number, cz: number): Face {
  if (Math.abs(cx) > Math.abs(cz)) return cx > 0 ? "w" : "e";
  return cz > 0 ? "n" : "s";
}

function addTower(boxes: Box[], cols: Collider[]) {
  const tiers = [
    { w: 28, d: 26, h: 14 },
    { w: 24, d: 22, h: 10 },
    { w: 18, d: 16, h: 8 },
    { w: 14, d: 12, h: 8 },
    { w: 20, d: 16, h: 10 },
    { w: 26, d: 20, h: 12 },
    { w: 30, d: 16, h: 4 },
  ];
  let y = 0;
  for (const tier of tiers) {
    const x0 = -tier.w / 2;
    const z0 = SOUTH - tier.d;
    const sample = towerSample(tier.w);
    y = shell(boxes, cols, x0, y, z0, tier.w, tier.h, tier.d, (u, ly) => sample(u, ly), "black");
  }
  addTowerPorch(boxes, cols);
  facades.push({
    id: "tower",
    x: -16,
    z: SOUTH - 28,
    w: 32,
    d: 32,
    h: y,
    style: 0,
    door: "n",
    enterable: false,
    hero: true,
    face: "n",
    roof: "flat",
  });
  return y;
}

function hedgeRect(boxes: Box[], cols: Collider[], x0: number, z0: number, x1: number, z1: number) {
  put(boxes, (x0 + x1) / 2, 0.16, (z0 + z1) / 2, x1 - x0, 0.22, z1 - z0, "grass");
  const y = 0.78;
  const t = 0.7;
  put(boxes, (x0 + x1) / 2, y, z0 + t / 2, x1 - x0, 1.05, t, "hedge");
  put(boxes, (x0 + x1) / 2, y, z1 - t / 2, x1 - x0, 1.05, t, "hedge");
  put(boxes, x0 + t / 2, y, (z0 + z1) / 2, t, 1.05, z1 - z0, "hedge");
  put(boxes, x1 - t / 2, y, (z0 + z1) / 2, t, 1.05, z1 - z0, "hedge");
  cols.push({ minX: x0, maxX: x1, minY: 0.2, maxY: 1.35, minZ: z0, maxZ: z0 + t });
  cols.push({ minX: x0, maxX: x1, minY: 0.2, maxY: 1.35, minZ: z1 - t, maxZ: z1 });
  cols.push({ minX: x0, maxX: x0 + t, minY: 0.2, maxY: 1.35, minZ: z0, maxZ: z1 });
  cols.push({ minX: x1 - t, maxX: x1, minY: 0.2, maxY: 1.35, minZ: z0, maxZ: z1 });
}

function addPlaza(boxes: Box[], cols: Collider[]) {
  put(boxes, 0, 0.035, 0, 58, 0.07, 58, "plaza");
  disc(boxes, FOUNTAIN.x, 0.7, FOUNTAIN.z, 6.2, 1.15, "stone");
  disc(boxes, FOUNTAIN.x, 1.28, FOUNTAIN.z, 5.5, 0.28, "water", 4.15);
  disc(boxes, FOUNTAIN.x, 1.85, FOUNTAIN.z, 4, 1.05, "stone");
  disc(boxes, FOUNTAIN.x, 2.4, FOUNTAIN.z, 3.3, 0.26, "water", 2.15);
  disc(boxes, FOUNTAIN.x, 2.95, FOUNTAIN.z, 2, 0.9, "stone");
  disc(boxes, FOUNTAIN.x, 3.45, FOUNTAIN.z, 1.35, 0.28, "water");
  cols.push(col(FOUNTAIN.x, 1.8, FOUNTAIN.z, 12.4, 3.6, 12.4));

  const lawns: Array<[number, number, number, number]> = [
    [-24, 1, -9, 7],
    [9, 1, 24, 7],
    [-24, 18, -9, 27],
    [9, 18, 24, 27],
    [-26, -26, -16, -8],
    [16, -26, 26, -8],
  ];
  for (const [x0, z0, x1, z1] of lawns) hedgeRect(boxes, cols, x0, z0, x1, z1);

  const trees: Array<[number, number]> = [
    [-18, 4], [18, 4], [-18, 22], [18, 22], [-22, -16], [22, -16],
    [-12, 22], [12, 22], [-22, 4], [22, 4],
  ];
  for (const [x, z] of trees) addTree(boxes, cols, x, z, 0.2);

  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const x = Math.cos(a) * 20;
    const z = 8 + Math.sin(a) * 16;
    if (z < SOUTH + 1 && Math.abs(x) < 16) continue;
    if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < 8) continue;
    addLamp(boxes, x, z, 0);
  }

  addBench(boxes, cols, -8, 8, true);
  addBench(boxes, cols, 8, 8, true);
  addBench(boxes, cols, -8, 16, true);
  addBench(boxes, cols, 8, 16, true);
  addBench(boxes, cols, -10, 12, false);
  addBench(boxes, cols, 10, 12, false);
}

function bands(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < CENTERS.length - 1; i++) {
    out.push([CENTERS[i] + HALF + SIDE, CENTERS[i + 1] - HALF - SIDE]);
  }
  return out;
}

function intervalsOverlap(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 && a1 > b0;
}

function addYard(boxes: Box[], cols: Collider[], x0: number, z0: number, x1: number, z1: number, face: Face, rng: Rng) {
  // A real front yard in the strip the building was set back from: lawn,
  // stone path to the door, hedge, and (usually) a tree + lamp.
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  if (face === "n") {
    put(boxes, cx, 0.12, z0 + 1.5, x1 - x0, 0.14, 3, "grass");
    put(boxes, cx, 0.15, z0 + 1.5, 2, 0.08, 3, "stone");
    put(boxes, cx - 2.2, 0.7, z0 + 1.5, 0.6, 0.9, 2.6, "hedge");
    put(boxes, cx + 2.2, 0.7, z0 + 1.5, 0.6, 0.9, 2.6, "hedge");
    cols.push(col(cx - 2.2, 0.7, z0 + 1.5, 0.6, 0.9, 2.6));
    cols.push(col(cx + 2.2, 0.7, z0 + 1.5, 0.6, 0.9, 2.6));
    if (rng() < 0.6) addTree(boxes, cols, x0 + 4, z0 + 1.5, 0.19);
    if (rng() < 0.35) addLamp(boxes, x1 - 3.5, z0 + 1.5, 0.19);
  } else if (face === "s") {
    put(boxes, cx, 0.12, z1 - 1.5, x1 - x0, 0.14, 3, "grass");
    put(boxes, cx, 0.15, z1 - 1.5, 2, 0.08, 3, "stone");
    put(boxes, cx - 2.2, 0.7, z1 - 1.5, 0.6, 0.9, 2.6, "hedge");
    put(boxes, cx + 2.2, 0.7, z1 - 1.5, 0.6, 0.9, 2.6, "hedge");
    cols.push(col(cx - 2.2, 0.7, z1 - 1.5, 0.6, 0.9, 2.6));
    cols.push(col(cx + 2.2, 0.7, z1 - 1.5, 0.6, 0.9, 2.6));
    if (rng() < 0.6) addTree(boxes, cols, x1 - 4, z1 - 1.5, 0.19);
    if (rng() < 0.35) addLamp(boxes, x0 + 3.5, z1 - 1.5, 0.19);
  } else if (face === "w") {
    put(boxes, x0 + 1.5, 0.12, cz, 3, 0.14, z1 - z0, "grass");
    put(boxes, x0 + 1.5, 0.15, cz, 3, 0.08, 2, "stone");
    put(boxes, x0 + 1.5, 0.7, cz - 2.2, 2.6, 0.9, 0.6, "hedge");
    put(boxes, x0 + 1.5, 0.7, cz + 2.2, 2.6, 0.9, 0.6, "hedge");
    cols.push(col(x0 + 1.5, 0.7, cz - 2.2, 2.6, 0.9, 0.6));
    cols.push(col(x0 + 1.5, 0.7, cz + 2.2, 2.6, 0.9, 0.6));
    if (rng() < 0.6) addTree(boxes, cols, x0 + 1.5, z0 + 4, 0.19);
    if (rng() < 0.35) addLamp(boxes, x0 + 1.5, z1 - 3.5, 0.19);
  } else {
    put(boxes, x1 - 1.5, 0.12, cz, 3, 0.14, z1 - z0, "grass");
    put(boxes, x1 - 1.5, 0.15, cz, 3, 0.08, 2, "stone");
    put(boxes, x1 - 1.5, 0.7, cz - 2.2, 2.6, 0.9, 0.6, "hedge");
    put(boxes, x1 - 1.5, 0.7, cz + 2.2, 2.6, 0.9, 0.6, "hedge");
    cols.push(col(x1 - 1.5, 0.7, cz - 2.2, 2.6, 0.9, 0.6));
    cols.push(col(x1 - 1.5, 0.7, cz + 2.2, 2.6, 0.9, 0.6));
    if (rng() < 0.6) addTree(boxes, cols, x1 - 1.5, z1 - 4, 0.19);
    if (rng() < 0.35) addLamp(boxes, x1 - 1.5, z0 + 3.5, 0.19);
  }
}

/** The two porch-post positions for a facade with a porch. Single source of
 * truth: city.ts adds the post colliders, pretty.ts draws the posts. */
export function porchPosts(f: Facade): Array<{ x: number; z: number }> {
  const slabW = 5;
  const depth = 2.2;
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  const o = slabW / 2 - 0.15;
  if (f.face === "n")
    return [
      { x: cx - o, z: f.z - depth + 0.2 },
      { x: cx + o, z: f.z - depth + 0.2 },
    ];
  if (f.face === "s")
    return [
      { x: cx - o, z: f.z + f.d + depth - 0.2 },
      { x: cx + o, z: f.z + f.d + depth - 0.2 },
    ];
  if (f.face === "w")
    return [
      { x: f.x - depth + 0.2, z: cz - o },
      { x: f.x - depth + 0.2, z: cz + o },
    ];
  return [
    { x: f.x + f.w + depth - 0.2, z: cz - o },
    { x: f.x + f.w + depth - 0.2, z: cz + o },
  ];
}

/** The porch slab rect for a facade with a porch (center + size). */
export function porchSlab(f: Facade): { x: number; z: number; w: number; d: number } {
  const slabW = 5;
  const depth = 2.2;
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  if (f.face === "n") return { x: cx, z: f.z - depth / 2, w: slabW, d: depth };
  if (f.face === "s") return { x: cx, z: f.z + f.d + depth / 2, w: slabW, d: depth };
  if (f.face === "w") return { x: f.x - depth / 2, z: cz, w: depth, d: slabW };
  return { x: f.x + f.w + depth / 2, z: cz, w: depth, d: slabW };
}

/** Carve an L-shaped plan: the annex sits in a strip freed by shrinking the
 * building rect on one flank (the strip is inside the lot by construction,
 * since the lots are packed flush). Returns the annex box in absolute
 * coords plus which side to shrink and by how much; the caller adjusts the
 * main rect and derives the wing's dx/dz from the final origin. */
function planWing(
  rect: { x: number; z: number; w: number; d: number },
  face: Face,
  style: number,
  rng: Rng,
  minMain = 12,
): { w: number; d: number; h: number; style: number; roof: "gable" | "flat"; absX: number; absZ: number; shrinkSide: "a" | "b"; shrink: number } | undefined {
  const alongX = face === "n" || face === "s";
  const depth = 4 + Math.floor(rng() * 2); // 4..5, perpendicular to the flank
  const len = 5 + Math.floor(rng() * 4); // 5..8, along the flank
  const h = 3.5 + rng() * 1.5;
  const mainAlong = alongX ? rect.w : rect.d;
  if (mainAlong - depth < minMain) return undefined;
  const otherAlong = alongX ? rect.d : rect.w;
  if (otherAlong - len < 2) return undefined;
  const side: "a" | "b" = rng() < 0.5 ? "a" : "b";
  const off = rng() * Math.max(0.5, otherAlong - len);
  if (alongX) {
    const wx = side === "a" ? rect.x + rect.w - depth : rect.x;
    const wz = rect.z + off;
    return { w: depth, d: len, h, style, roof: rng() < 0.5 ? "gable" : "flat", absX: wx, absZ: wz, shrinkSide: side, shrink: depth };
  }
  const wz = side === "a" ? rect.z + rect.d - depth : rect.z;
  const wx = rect.x + off;
  return { w: len, d: depth, h, style, roof: rng() < 0.5 ? "gable" : "flat", absX: wx, absZ: wz, shrinkSide: side, shrink: depth };
}

/** Apply a planned wing: shrink the main rect, build the Wing record
 * (dx/dz relative to the final origin), and solid-ify the annex. */
function applyWing(
  planned: NonNullable<ReturnType<typeof planWing>>,
  rect: { x: number; z: number; w: number; d: number },
  face: Face,
  cols: Collider[],
): Wing {
  const alongX = face === "n" || face === "s";
  if (alongX) {
    if (planned.shrinkSide === "a") rect.w -= planned.shrink;
    else {
      rect.x += planned.shrink;
      rect.w -= planned.shrink;
    }
  } else if (planned.shrinkSide === "a") {
    rect.d -= planned.shrink;
  } else {
    rect.z += planned.shrink;
    rect.d -= planned.shrink;
  }
  cols.push(
    col(planned.absX + planned.w / 2, planned.h / 2, planned.absZ + planned.d / 2, planned.w, planned.h, planned.d),
  );
  return {
    dx: planned.absX - rect.x,
    dz: planned.absZ - rect.z,
    w: planned.w,
    d: planned.d,
    h: planned.h,
    style: planned.style,
    roof: planned.roof,
  };
}

function addBuildings(boxes: Box[], cols: Collider[], rng: Rng, seed: number): { zones: Zone[]; anchors: Anchor[] } {
  // A separate rng stream for yards/homes so the main sequence (heights,
  // styles, street life) stays identical to before.
  const yardRng = makeRng((seed || 1) * 131 + 7);
  // Two more isolated streams for the exterior rework: every footprint,
  // roof, tier, porch and wing decision draws here, so the main sequence
  // (lot positions, heights, styles, street life, car spawns) never moves.
  const varRng = makeRng((seed || 1) * 977 + 13);
  const homeRng = makeRng((seed || 1) * 733 + 29);
  const zones: Zone[] = [];
  const anchors: Anchor[] = [];
  let homesBuilt = 0;
  const plots = bands();
  for (const [x0, x1] of plots) {
    for (const [z0, z1] of plots) {
      if (intervalsOverlap(x0, x1, -29, 29) && intervalsOverlap(z0, z1, -29, 29)) continue;
      if (reservedPlot(x0, x1, z0, z1)) continue;
      const w = x1 - x0;
      const d = z1 - z0;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const dist = Math.hypot(cx, cz);
      const maxH = dist < 48 ? 48 : dist < 68 ? 34 : dist < 120 ? 26 : dist < 170 ? 20 : 16;
      const minH = dist < 48 ? 26 : dist < 68 ? 16 : dist < 120 ? 12 : 10;
      let height = minH + Math.floor(rng() * (maxH - minH + 1));
      if (dist < 62 && rng() > 0.72) height += 8;
      height = Math.min(height, 54);
      // Outer blocks read residential (brick / cream); downtown uses all styles.
      const style = dist > 100 ? (rng() < 0.5 ? 1 : 3) : Math.floor(rng() * 6);
      const face = frontFace(cx, cz);
      // Front yard: set the building back 3 units on its street face so the
      // outside reads finished — lawn, path, hedge, tree — not a bare slab.
      const set = 3;
      let bx = x0;
      let bz = z0;
      let bw = w;
      let bd = d;
      if (face === "n") {
        bz += set;
        bd -= set;
      } else if (face === "s") {
        bd -= set;
      } else if (face === "w") {
        bx += set;
        bw -= set;
      } else {
        bw -= set;
      }
      addYard(boxes, cols, x0, z0, x1, z1, face, yardRng);
      // A few outer residential blocks are real homes: walk in through the
      // front door to a furnished living room + kitchen, not a solid slab.
      const isHome = dist > 100 && (style === 1 || style === 3) && homesBuilt < 8 && yardRng() < 0.3;
      if (isHome) {
        // Real house footprint inside the lot: 18-23 wide, 18-22 deep, slid
        // to one side so no two houses on a street line up. (Furnishing
        // needs w>=18, d>=18 or the kitchen counter clips the wall.)
        const hw = 18 + Math.floor(homeRng() * 6);
        const hd = 18 + Math.floor(homeRng() * 5);
        const hx = bx + Math.floor(homeRng() * Math.max(1, bw - hw + 1));
        const hz = bz + Math.floor(homeRng() * Math.max(1, bd - hd + 1));
        const homeH = 5 + Math.floor(homeRng() * 3); // 5..7: one or two storeys
        const home = addHome(boxes, cols, hx, hz, hw, hd, homeH, face, homesBuilt, homeRng);
        zones.push(home.zone);
        anchors.push(home.anchor);
        homesBuilt++;
        continue;
      }
      // Vary the footprint inside the lot (never the lot itself): shrink
      // each side by 0-4 and slide the building to one side, so no two
      // buildings on a street sit flush or share a size. `bx/bz/bw/bd` stay
      // the ORIGINAL rect: the shell loop's setback decisions and the garden
      // roll draw the main rng in exactly the original order, so the main
      // sequence (heights, styles, street life) never moves. `fb*` is the
      // visible building — the shell geometry and the facade record.
      const shX = Math.floor(varRng() * 5);
      const shZ = Math.floor(varRng() * 5);
      const offX = Math.floor(varRng() * (shX + 1));
      const offZ = Math.floor(varRng() * (shZ + 1));
      let fbx = bx + offX;
      let fbz = bz + offZ;
      let fbw = Math.max(14, bw - shX);
      let fbd = Math.max(14, bd - shZ);
      // Architectural variation for this block: pitched roofs on low
      // buildings, stepped towers above 24, storefronts downtown.
      const downtown = dist < 110;
      let roof: Facade["roof"] = "flat";
      let roofMat = 0;
      let tiers: Tier[] | undefined;
      let storefront = false;
      let awning = false;
      let cornice = false;
      let chimney = false;
      let wing: Wing | undefined;
      if (height > 24) {
        roof = "stepped";
        cornice = true;
        const n = 2 + (varRng() < 0.45 ? 1 : 0);
        const h0 = Math.round(height * 0.5);
        const h1 = Math.round(height * 0.3);
        const w1 = Math.max(8, fbw - (6 + Math.floor(varRng() * 4)));
        const d1 = Math.max(8, fbd - (6 + Math.floor(varRng() * 4)));
        tiers = [
          { w: fbw, d: fbd, h: h0 },
          { w: w1, d: d1, h: h1 },
        ];
        if (n === 3) {
          tiers.push({
            w: Math.max(8, w1 - (4 + Math.floor(varRng() * 4))),
            d: Math.max(8, d1 - (4 + Math.floor(varRng() * 4))),
            h: height - h0 - h1,
          });
        }
      } else if (height <= 12) {
        roof = varRng() < 0.55 ? "gable" : "hip";
        roofMat = Math.floor(varRng() * 3);
        chimney = varRng() < 0.5;
        if (varRng() < 0.45) {
          const planned = planWing({ x: fbx, z: fbz, w: fbw, d: fbd }, face, style, varRng);
          if (planned) {
            const rect = { x: fbx, z: fbz, w: fbw, d: fbd };
            wing = applyWing(planned, rect, face, cols);
            fbx = rect.x;
            fbz = rect.z;
            fbw = rect.w;
            fbd = rect.d;
          }
        }
        if (downtown && varRng() < 0.5) {
          storefront = true;
          awning = true;
        }
      } else {
        cornice = true;
        if (downtown) {
          storefront = true;
          awning = varRng() < 0.7;
        }
      }
      facades.push({
        id: `block-${x0}-${z0}`,
        x: fbx,
        z: fbz,
        w: fbw,
        d: fbd,
        h: height,
        style,
        door: "",
        enterable: false,
        hero: false,
        face,
        roof,
        roofMat,
        tiers,
        storefront,
        awning,
        cornice,
        chimney,
        wing,
      });
      const baseX = fbx;
      const baseZ = fbz;
      const baseW = fbw;
      const baseD = fbd;
      let y = 0;
      let guard = 0;
      while (y < height && guard < 8) {
        guard++;
        const slice = Math.min(8, height - y);
        y = shell(
          boxes,
          cols,
          fbx,
          y,
          fbz,
          fbw,
          slice,
          fbd,
          (u, ly, f) => {
            const len = f === "n" || f === "s" ? fbw : fbd;
            return facadeSample(style, len)(u, ly);
          },
          "black",
        );
        // Setback decisions run on the ORIGINAL rect so the main rng draws
        // in exactly the original order; the visible rect mirrors the step.
        if (y < height && bw > 16 && bd > 16 && height - y > 8 && rng() > 0.35) {
          bx += 2;
          bz += 2;
          bw -= 4;
          bd -= 4;
          fbx += 2;
          fbz += 2;
          fbw = Math.max(8, fbw - 4);
          fbd = Math.max(8, fbd - 4);
        }
      }
      const roofY = y;
      // The garden roll is drawn exactly when the original code drew it;
      // a pitched roof just means the garden is not placed.
      const gardenRoll = bw >= 12 && bd >= 12 ? rng() : -1;
      // No garden on a pitched roof (it would pierce the slope) or a
      // stepped tower (the garden would overhang the top tier).
      if (gardenRoll > 0.42 && roof !== "gable" && roof !== "hip" && roof !== "stepped") {
        const gx0 = fbx + 2;
        const gz0 = fbz + 2;
        const gw = fbw - 4;
        const gd = fbd - 4;
        put(boxes, gx0 + gw / 2, roofY + 0.2, gz0 + gd / 2, gw, 0.35, gd, "grass");
        put(boxes, gx0 + gw / 2, roofY + 0.7, gz0 + 0.4, gw, 0.7, 0.7, "hedge");
        put(boxes, gx0 + gw / 2, roofY + 0.7, gz0 + gd - 0.4, gw, 0.7, 0.7, "hedge");
        if (gw > 6) addTree(boxes, cols, gx0 + 2, gz0 + Math.max(3, gd / 2), roofY + 0.3);
      }
      addAwning(boxes, fbx, fbz, fbw, fbd, face);
      if (height > 18) addBalcony(boxes, fbx, Math.min(12, roofY - 4), fbz, fbw, fbd, face);
      if (height > 22) addCrown(boxes, cols, fbx + fbw / 2, roofY, fbz + fbd / 2, fbw, fbd);
      if (height > 22 && dist > 40 && dist < 140 && rng() > 0.55) {
        addBillboard(boxes, baseX, 8, baseZ, baseW, baseD, face, Math.floor(rng() * 6));
      }
    }
  }
  return { zones, anchors };
}

function gapsOutside(blocked: Array<[number, number]>, from: number, to: number) {
  const spans = [...blocked].sort((a, b) => a[0] - b[0]);
  const result: Array<[number, number]> = [];
  let cursor = from;
  for (const [a, b] of spans) {
    if (a > cursor + 0.2) result.push([cursor, Math.min(a, to)]);
    cursor = Math.max(cursor, b);
    if (cursor >= to) break;
  }
  if (cursor < to - 0.2) result.push([cursor, to]);
  return result.filter(([a, b]) => b - a > 0.4);
}

function rectHitsMega(x0: number, z0: number, x1: number, z1: number) {
  for (const r of [MALL, OFFICE]) {
    if (x0 < r.x1 && x1 > r.x0 && z0 < r.z1 && z1 > r.z0) return true;
  }
  return false;
}

function addRoads(boxes: Box[]) {
  put(boxes, 0, -0.55, 0, 760, 1.1, 760, "grass");
  put(boxes, 0, 0.02, 0, 400, 0.04, 400, "sidewalk");
  put(boxes, 0, 0.045, 0, 58, 0.05, 58, "plaza");

  const nsBlock: Array<[number, number]> = CENTERS.map((c) => [c - HALF, c + HALF]);
  const plazaBlock: Array<[number, number]> = [[-31, 31]];

  for (const cx of CENTERS) {
    // The mega superblocks swallow the road that crosses them (same pattern
    // as the plaza swallowing the x=0 road).
    const gaps: Array<[number, number]> =
      cx === 0 ? plazaBlock : cx === 72 || cx === -72 ? [[MALL.z0, MALL.z1]] : [];
    const zSpans = gaps.length ? gapsOutside(gaps, -184, 184) : [[-184, 184] as [number, number]];
    for (const [z0, z1] of zSpans) {
      put(boxes, cx, 0.055, (z0 + z1) / 2, HALF * 2, 0.05, z1 - z0, "asphalt");
    }
  }
  for (const cz of CENTERS) {
    const extra = cz === 0 ? [...plazaBlock, [MALL.x0, MALL.x1] as [number, number], [OFFICE.x0, OFFICE.x1] as [number, number]] : [];
    const xSpans = gapsOutside([...nsBlock, ...extra], -184, 184);
    for (const [x0, x1] of xSpans) {
      put(boxes, (x0 + x1) / 2, 0.055, cz, x1 - x0, 0.05, HALF * 2, "asphalt");
    }
  }

  const nearCross = (v: number) => CENTERS.some((c) => Math.abs(v - c) < 9);

  for (const cx of CENTERS) {
    for (let z = -180; z <= 180; z += 5) {
      if (nearCross(z)) continue;
      if (cx === 0 && Math.abs(z) < 34) continue;
      if (inMega(cx, z)) continue;
      put(boxes, cx, 0.1, z, 0.26, 0.04, 2.1, "lane");
      put(boxes, cx - 2.35, 0.1, z + 1.2, 0.18, 0.035, 1.5, "lane");
      put(boxes, cx + 2.35, 0.1, z + 1.2, 0.18, 0.035, 1.5, "lane");
    }
    for (const side of [-1, 1]) {
      const x = cx + side * 4.35;
      for (let i = 0; i < CENTERS.length - 1; i++) {
        const z0 = CENTERS[i] + 9;
        const z1 = CENTERS[i + 1] - 9;
        if (z1 - z0 < 4) continue;
        if (cx === 0 && z0 < 34 && z1 > -34) continue;
        if (rectHitsMega(x - 0.1, z0, x + 0.1, z1)) continue;
        put(boxes, x, 0.095, (z0 + z1) / 2, 0.16, 0.03, z1 - z0, "lane");
      }
    }
  }
  for (const cz of CENTERS) {
    for (let x = -180; x <= 180; x += 5) {
      if (nearCross(x)) continue;
      if (cz === 0 && Math.abs(x) < 34) continue;
      if (inMega(x, cz)) continue;
      put(boxes, x, 0.1, cz, 2.1, 0.04, 0.26, "lane");
      put(boxes, x + 1.2, 0.1, cz - 2.35, 1.5, 0.035, 0.18, "lane");
      put(boxes, x + 1.2, 0.1, cz + 2.35, 1.5, 0.035, 0.18, "lane");
    }
  }

  for (const cx of CENTERS) {
    for (const cz of CENTERS) {
      if (cx === 0 && cz === 0) continue;
      for (let i = 0; i < 5; i++) {
        const o = 5.5 + i * 0.85;
        put(boxes, cx, 0.11, cz + o, 8.6, 0.035, 0.42, "lane");
        put(boxes, cx, 0.11, cz - o, 8.6, 0.035, 0.42, "lane");
        put(boxes, cx + o, 0.11, cz, 0.42, 0.035, 8.6, "lane");
        put(boxes, cx - o, 0.11, cz, 0.42, 0.035, 8.6, "lane");
      }
    }
  }

  // Zebra crosswalks at every core intersection (the plaza one has none —
  // pedestrians own the plaza), curbs along road edges between intersections,
  // traffic lights at intersections, gold bollards ringing the plaza.
  for (const cx of CENTERS) {
    for (const cz of CENTERS) {
      if (cx === 0 && cz === 0) continue;
      for (const approach of [-10.5, 10.5]) {
        for (let i = -2; i <= 2; i++) {
          if (inMega(cx + i * 1.5, cz + approach)) continue;
          put(boxes, cx + i * 1.5, 0.118, cz + approach, 0.7, 0.035, 1.7, "lane");
        }
      }
      for (const approach of [-10.5, 10.5]) {
        for (let i = -2; i <= 2; i++) {
          if (inMega(cx + approach, cz + i * 1.5)) continue;
          put(boxes, cx + approach, 0.118, cz + i * 1.5, 1.7, 0.035, 0.7, "lane");
        }
      }
      // Traffic light on the +x/+z corner: pole + head + red/amber/green.
      const lx = cx + 6.8;
      const lz = cz + 6.8;
      if (inMega(lx, lz)) continue;
      put(boxes, lx, 1.9, lz, 0.22, 3.8, 0.22, "black");
      put(boxes, lx, 3.95, lz, 0.55, 1.1, 0.55, "black");
      put(boxes, lx, 4.3, lz + 0.3, 0.3, 0.26, 0.1, "red");
      put(boxes, lx, 3.95, lz + 0.3, 0.3, 0.26, 0.1, "warm");
      put(boxes, lx, 3.6, lz + 0.3, 0.3, 0.26, 0.1, "leaves");
    }
  }
  for (const cx of CENTERS) {
    for (const side of [-1, 1]) {
      const x = cx + side * 5.6;
      for (let i = 0; i < CENTERS.length - 1; i++) {
        const z0 = CENTERS[i] + 11;
        const z1 = CENTERS[i + 1] - 11;
        if (z1 - z0 < 4) continue;
        if (cx === 0 && z0 < 34 && z1 > -34) continue;
        if (Math.abs(x) < 32 && z0 < 32 && z1 > -32) continue;
        if (rectHitsMega(x - 0.2, z0, x + 0.2, z1)) continue;
        put(boxes, x, 0.09, (z0 + z1) / 2, 0.3, 0.06, z1 - z0, "stone");
      }
    }
  }
  for (const cz of CENTERS) {
    for (const side of [-1, 1]) {
      const z = cz + side * 5.6;
      for (let i = 0; i < CENTERS.length - 1; i++) {
        const x0 = CENTERS[i] + 11;
        const x1 = CENTERS[i + 1] - 11;
        if (x1 - x0 < 4) continue;
        if (cz === 0 && x0 < 34 && x1 > -34) continue;
        if (Math.abs(z) < 32 && x0 < 32 && x1 > -32) continue;
        if (rectHitsMega(x0, z - 0.2, x1, z + 0.2)) continue;
        put(boxes, (x0 + x1) / 2, 0.09, z, x1 - x0, 0.06, 0.3, "stone");
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    put(boxes, Math.cos(a) * 30.5, 0.35, Math.sin(a) * 30.5, 0.5, 0.7, 0.5, "gold");
  }
}

function addStreetLife(boxes: Box[], cols: Collider[], rng: Rng) {
  let lampI = 0;
  for (const cx of CENTERS) {
    for (const side of [-1, 1]) {
      const x = cx + side * 6.15;
      for (let z = -170; z <= 170; z += 16) {
        if (CENTERS.some((c) => Math.abs(z - c) < 10)) continue;
        if (Math.abs(x) < 32 && Math.abs(z) < 32) continue;
        if (inMega(x, z)) continue;
        lampI++;
        if (lampI % 2 === 0) addLamp(boxes, x, z);
        else if (rng() > 0.55) addTree(boxes, cols, x, z, 0);
      }
    }
  }
  for (const cz of CENTERS) {
    for (const side of [-1, 1]) {
      const z = cz + side * 6.15;
      for (let x = -170; x <= 170; x += 16) {
        if (CENTERS.some((c) => Math.abs(x - c) < 10)) continue;
        if (Math.abs(x) < 32 && Math.abs(z) < 32) continue;
        if (inMega(x, z)) continue;
        if (rng() > 0.5) addLamp(boxes, x, z);
        if (rng() > 0.72) addTree(boxes, cols, x, z, 0);
      }
    }
  }
}

function loopPoints(): RailPoint[] {
  const hx = TRACK_HALF;
  const hz = TRACK_HALF;
  const r = TRACK_R;
  const y = TRACK_Y;
  const step = 4;
  const pts: RailPoint[] = [];
  const pushLine = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push({ x: x0 + (x1 - x0) * t, y, z: z0 + (z1 - z0) * t });
    }
  };
  const pushArc = (cx: number, cz: number, a0: number, a1: number) => {
    const len = Math.abs(a1 - a0) * r;
    const n = Math.max(2, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: cx + Math.cos(a) * r, y, z: cz + Math.sin(a) * r });
    }
  };
  pushLine(hx, -(hz - r), hx, hz - r);
  pushArc(hx - r, hz - r, 0, Math.PI / 2);
  pushLine(hx - r, hz, -(hx - r), hz);
  pushArc(-(hx - r), hz - r, Math.PI / 2, Math.PI);
  pushLine(-hx, hz - r, -hx, -(hz - r));
  pushArc(-(hx - r), -(hz - r), Math.PI, Math.PI * 1.5);
  pushLine(-(hx - r), -hz, hx - r, -hz);
  pushArc(hx - r, -(hz - r), Math.PI * 1.5, Math.PI * 2);
  return pts;
}

function insideBuilding(cols: Collider[], x: number, z: number) {
  return cols.some((c) => x > c.minX + 0.4 && x < c.maxX - 0.4 && z > c.minZ + 0.4 && z < c.maxZ - 0.4 && c.maxY > 8);
}

function addMonorail(boxes: Box[], cols: Collider[], rail: RailPoint[]) {
  for (let i = 0; i < rail.length; i++) {
    const a = rail[i];
    const b = rail[(i + 1) % rail.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ry = Math.atan2(-dz, dx);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    put(boxes, mx, TRACK_Y, mz, len + 0.2, 0.55, 3.3, "track", ry);
    put(boxes, mx, TRACK_Y + 0.4, mz, len + 0.2, 0.16, 0.42, "cyan", ry);
    const straight = Math.abs(dx) < 0.4 || Math.abs(dz) < 0.4;
    if (straight && i % 4 === 0 && !insideBuilding(cols, a.x, a.z)) {
      put(boxes, a.x, TRACK_Y / 2, a.z, 1.5, TRACK_Y, 1.5, "gray");
      put(boxes, a.x, TRACK_Y - 0.35, a.z, 2.6, 0.55, 2.6, "black");
      put(boxes, a.x, TRACK_Y + 0.15, a.z, 0.7, 0.28, 0.7, "cyanhot");
      cols.push(col(a.x, TRACK_Y / 2, a.z, 1.5, TRACK_Y, 1.5));
    }
  }
}

function addHills(boxes: Box[], cols: Collider[], rng: Rng) {
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng() * 0.1;
    const rad = 280 + rng() * 35;
    const h = 12 + rng() * 26;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    const sx = 22 + rng() * 18;
    const sz = 18 + rng() * 16;
    put(boxes, x, h / 2 - 1, z, sx, h, sz, "hill");
    cols.push(col(x, h / 2 - 1, z, sx, h, sz));
    // Grassy berm at the foot + trees so the hill reads as terrain from the
    // streets, not a sheer maroon wall.
    put(boxes, x, 0.5, z, sx + 4, 3, sz + 4, "grass");
    cols.push(col(x, 0.5, z, sx + 4, 3, sz + 4));
    // Stepped, grassy summit + a tree so hills read as terrain, not a blank
    // maroon wall at the end of the streets.
    put(boxes, x, h - 1 + h * 0.15, z, sx * 0.55, h * 0.3, sz * 0.55, "hill");
    cols.push(col(x, h - 1 + h * 0.15, z, sx * 0.55, h * 0.3, sz * 0.55));
    put(boxes, x, h - 1 + 0.25, z, sx + 1, 0.5, sz + 1, "grass");
    addTree(boxes, cols, x, z, h - 1 + 0.5);
    addTree(boxes, cols, x + sx * 0.7, z + 2, 0);
    addTree(boxes, cols, x - sx * 0.6, z - 3, 0);
  }
}

function reservedPlot(x0: number, x1: number, z0: number, z1: number) {
  if (x0 >= -101 && x1 <= -79) return true;
  const spots: Array<[number, number, number, number]> = [
    [7, 29, 43, 65],
    [-29, -7, 43, 65],
    [43, 65, 79, 101],
    [79, 101, -65, -43],
    [79, 101, 43, 65],
    [43, 65, 43, 65],
    [-29, -7, 79, 101],
    // Mega mall + mega OrbitX office superblocks.
    [43, 101, -29, 29],
    [-101, -43, -29, 29],
  ];
  return spots.some(([a, b, c, d]) => x0 >= a - 0.2 && x1 <= b + 0.2 && z0 >= c - 0.2 && z1 <= d + 0.2);
}

function roomCenter(x0: number, z0: number, w: number, d: number) {
  return { cx: x0 + w / 2, cz: z0 + d / 2 };
}

function opposite(door: Face, x0: number, z0: number, w: number, d: number, inset: number) {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  if (door === "w") return { x: x0 + w - inset, z: cz, rot: -Math.PI / 2 };
  if (door === "e") return { x: x0 + inset, z: cz, rot: Math.PI / 2 };
  if (door === "n") return { x: cx, z: z0 + d - inset, rot: Math.PI };
  return { x: cx, z: z0 + inset, rot: 0 };
}

function cladWalls(boxes: Box[], x0: number, z0: number, w: number, d: number, door: Face) {
  const y = 1.85;
  const h = 3.15;
  const t = 0.16;
  const inset = 1.18;
  if (door !== "n") put(boxes, x0 + w / 2, y, z0 + inset, w - 2.5, h, t, "cream");
  if (door !== "s") put(boxes, x0 + w / 2, y, z0 + d - inset, w - 2.5, h, t, "cream");
  if (door !== "w") put(boxes, x0 + inset, y, z0 + d / 2, t, h, d - 2.5, "cream");
  if (door !== "e") put(boxes, x0 + w - inset, y, z0 + d / 2, t, h, d - 2.5, "cream");
}

// Full-height interior cladding for tall rooms (mall, HQ): the stock
// cladWalls only covers the bottom 3.4 units, so in a 9-20 unit room the
// upper walls showed the dark exterior facade texture from inside.
function cladWallsTall(boxes: Box[], x0: number, z0: number, w: number, d: number, door: Face, h: number) {
  const t = 0.16;
  const inset = 1.18;
  const y = h / 2;
  if (door !== "n") put(boxes, x0 + w / 2, y, z0 + inset, w - 2.5, h, t, "cream");
  if (door !== "s") put(boxes, x0 + w / 2, y, z0 + d - inset, w - 2.5, h, t, "cream");
  if (door !== "w") put(boxes, x0 + inset, y, z0 + d / 2, t, h, d - 2.5, "cream");
  if (door !== "e") put(boxes, x0 + w - inset, y, z0 + d / 2, t, h, d - 2.5, "cream");
}

function addCeiling(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number) {
  put(boxes, x0 + w / 2, 3.62, z0 + d / 2, w - 2.15, 0.14, d - 2.15, "ceil");
  cols.push({
    minX: x0 + 1,
    maxX: x0 + w - 1,
    minY: 3.5,
    maxY: 3.75,
    minZ: z0 + 1,
    maxZ: z0 + d - 1,
  });
  const { cx, cz } = roomCenter(x0, z0, w, d);
  for (const [dx, dz] of [
    [-4.2, -3.2],
    [4.2, -3.2],
    [-4.2, 3.2],
    [4.2, 3.2],
    [0, 0],
  ] as Array<[number, number]>) {
    put(boxes, cx + dx, 3.2, cz + dz, 0.12, 0.55, 0.12, "gray");
    put(boxes, cx + dx, 2.85, cz + dz, 0.55, 0.16, 0.55, "warm");
  }
}

function furnishShop(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "cream");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const back = opposite(door, x0, z0, w, d, 2.4);
  const counterAlongX = door === "n" || door === "s";
  put(boxes, back.x, 0.55, back.z, counterAlongX ? 7.2 : 1.15, 1.05, counterAlongX ? 1.15 : 7.2, "wood");
  cols.push(col(back.x, 0.55, back.z, counterAlongX ? 7.2 : 1.15, 1.05, counterAlongX ? 1.15 : 7.2));
  put(boxes, back.x, 1.15, back.z, counterAlongX ? 7.4 : 1.25, 0.12, counterAlongX ? 1.25 : 7.4, "stone");
  put(boxes, back.x, 1.55, back.z, 0.35, 0.55, 0.35, "gold");
  const shelfZ = [z0 + 2.3, z0 + d - 2.3];
  const goods: Mat[] = ["cyan", "gold", "red", "white", "warm", "cyan"];
  for (const z of shelfZ) {
    // Tall stocked shelf rows (two levels of goods) instead of one low box.
    put(boxes, cx, 1.2, z, w - 8, 2.4, 0.7, "wood");
    cols.push(col(cx, 1.2, z, w - 8, 2.4, 0.7));
    put(boxes, cx, 2.45, z, w - 8, 0.12, 0.78, "stone");
    for (let level = 0; level < 2; level++) {
      const y = level === 0 ? 0.95 : 1.95;
      for (let i = 0; i < 6; i++) {
        put(boxes, cx - 5.5 + i * 2.2, y, z, 0.55, 0.5, 0.45, goods[(i + level * 2) % goods.length]);
      }
    }
  }
  // Tall end-cap units flanking the counter on the back wall.
  for (const side of [-1, 1]) {
    const ex = x0 + w - 1.9;
    const ez = cz + side * 6;
    put(boxes, ex, 1.2, ez, 1.0, 2.4, 2.6, "wood");
    cols.push(col(ex, 1.2, ez, 1.0, 2.4, 2.6));
    for (let level = 0; level < 2; level++) {
      const y = level === 0 ? 0.95 : 1.95;
      put(boxes, ex - 0.55, y, ez - 0.6, 0.4, 0.5, 0.45, goods[(side + 2 + level) % goods.length]);
      put(boxes, ex - 0.55, y, ez + 0.6, 0.4, 0.5, 0.45, goods[(side + 3 + level) % goods.length]);
    }
  }
  // Central island display with goods on top.
  put(boxes, cx, 0.5, cz, 3.2, 1.0, 1.6, "wood");
  cols.push(col(cx, 0.5, cz, 3.2, 1.0, 1.6));
  put(boxes, cx, 1.05, cz, 3.4, 0.12, 1.8, "stone");
  for (let i = 0; i < 4; i++) {
    put(boxes, cx - 1.2 + i * 0.8, 1.35, cz, 0.45, 0.45, 0.45, goods[i % goods.length]);
  }
  // Red carpet runner from the door to the counter, split around the island.
  // Sits on the cream floor slab (top 0.12), not buried under it.
  put(boxes, cx - 6, 0.145, cz, 6, 0.05, 2.4, "red");
  put(boxes, cx + 4.5, 0.145, cz, 5, 0.05, 2.4, "red");
  for (const side of [-1, 1]) {
    const z = cz + side * 4.2;
    put(boxes, cx - 1.5, 0.45, z, 1.6, 0.85, 1.1, "stone");
    cols.push(col(cx - 1.5, 0.45, z, 1.6, 0.85, 1.1));
    put(boxes, cx - 1.5, 1.05, z, 0.45, 0.7, 0.45, "white");
    put(boxes, cx - 0.9, 1.45, z, 0.35, 0.2, 0.35, "gold");
  }
  const mat = opposite(door, x0, z0, w, d, 4.2);
  // Gold floor strip — sits at 0.145 like the red carpet runner (above),
  // because at 0.06 it was buried under the cream floor slab (top 0.12).
  put(boxes, mat.x, 0.145, mat.z, counterAlongX ? 3.2 : 2.2, 0.05, counterAlongX ? 2.2 : 3.2, "gold");
  const service = opposite(door, x0, z0, w, d, 4.1);
  return {
    id: "shop",
    name: "OrbitX Shop",
    kind: "shop",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: service.x,
    serviceZ: service.z,
    signX: back.x + (door === "w" ? -0.55 : door === "e" ? 0.55 : 0),
    signY: 2.35,
    signZ: back.z + (door === "n" ? -0.55 : door === "s" ? 0.55 : 0),
    signRot: back.rot,
  };
}

function furnishCafe(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "wood");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const back = opposite(door, x0, z0, w, d, 2.3);
  const alongX = door === "n" || door === "s";
  put(boxes, back.x, 0.6, back.z, alongX ? 8 : 1.05, 1.15, alongX ? 1.05 : 8, "black");
  cols.push(col(back.x, 0.6, back.z, alongX ? 8 : 1.05, 1.15, alongX ? 1.05 : 8));
  put(boxes, back.x, 1.25, back.z, alongX ? 8.2 : 1.2, 0.14, alongX ? 1.2 : 8.2, "stone");
  put(boxes, back.x, 1.7, back.z, 0.7, 0.55, 0.45, "warm");
  const seats: Array<[number, number]> = [
    [cx - 3.2, cz - 3.4],
    [cx + 3.2, cz - 3.4],
    [cx - 3.2, cz + 3.4],
    [cx + 3.2, cz + 3.4],
  ];
  for (const [x, z] of seats) {
    put(boxes, x, 0.72, z, 1.35, 0.1, 1.35, "wood");
    put(boxes, x, 0.38, z, 0.22, 0.6, 0.22, "black");
    cols.push(col(x, 0.55, z, 1.35, 0.9, 1.35));
    for (const [dx, dz] of [[0.85, 0], [-0.85, 0], [0, 0.85], [0, -0.85]] as Array<[number, number]>) {
      put(boxes, x + dx, 0.42, z + dz, 0.38, 0.42, 0.38, "red");
    }
  }
  const service = opposite(door, x0, z0, w, d, 4);
  return {
    id: "cafe",
    name: "Cafe Nova",
    kind: "cafe",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: service.x,
    serviceZ: service.z,
    signX: back.x + (door === "w" ? -0.5 : door === "e" ? 0.5 : 0),
    signY: 2.3,
    signZ: back.z + (door === "n" ? -0.5 : door === "s" ? 0.5 : 0),
    signRot: back.rot,
  };
}

function furnishHall(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "stone");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const stage = opposite(door, x0, z0, w, d, 4.2);
  const alongX = door === "n" || door === "s";
  put(boxes, stage.x, 0.28, stage.z, alongX ? 10 : 6.5, 0.5, alongX ? 6.5 : 10, "wood");
  cols.push(col(stage.x, 0.28, stage.z, alongX ? 10 : 6.5, 0.5, alongX ? 6.5 : 10));
  put(boxes, stage.x, 0.85, stage.z, 0.7, 0.7, 0.7, "black");
  cols.push(col(stage.x, 0.85, stage.z, 0.7, 0.7, 0.7));
  put(boxes, stage.x, 1.4, stage.z, 0.28, 0.55, 0.28, "gold");
  for (const row of [-1.2, 1.6]) {
    for (const side of [-1, 1]) {
      const x = alongX ? cx + side * 3.2 : stage.x + (door === "w" ? -1 : 1) * (6 + row);
      const z = alongX ? stage.z + (door === "n" ? -1 : 1) * (6 + row) : cz + side * 3.2;
      put(boxes, x, 0.38, z, alongX ? 2.6 : 0.7, 0.45, alongX ? 0.7 : 2.6, "red");
      cols.push(col(x, 0.38, z, alongX ? 2.6 : 0.7, 0.45, alongX ? 0.7 : 2.6));
    }
  }
  put(boxes, stage.x, 2.5, stage.z, alongX ? 6 : 0.2, 1.5, alongX ? 0.2 : 6, "cyan");
  return {
    id: "hall",
    name: "Community Hall",
    kind: "hall",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: stage.x + (door === "w" ? -6 : door === "e" ? 6 : 0),
    serviceZ: stage.z + (door === "n" ? -6 : door === "s" ? 6 : 0),
    signX: stage.x + (door === "w" ? -0.4 : door === "e" ? 0.4 : 0),
    signY: 2.45,
    signZ: stage.z + (door === "n" ? -0.4 : door === "s" ? 0.4 : 0),
    signRot: stage.rot,
  };
}

function furnishOffice(
  boxes: Box[],
  cols: Collider[],
  x0: number,
  z0: number,
  w: number,
  d: number,
  door: Face,
  index: number,
): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  const accent: Mat = index % 2 === 0 ? "cyan" : "gold";
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "plaza");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const back = opposite(door, x0, z0, w, d, 1.7);
  put(boxes, back.x, 1.7, back.z, door === "w" || door === "e" ? 0.2 : 5.5, 2.2, door === "w" || door === "e" ? 5.5 : 0.2, accent);
  put(boxes, cx, 0.72, cz, 3.2, 0.12, 1.6, "wood");
  put(boxes, cx, 0.38, cz, 0.28, 0.6, 0.28, "black");
  cols.push(col(cx, 0.5, cz, 3.2, 0.85, 1.6));
  for (const side of [-1, 1]) {
    put(boxes, cx + side * 2.1, 0.4, cz, 0.45, 0.45, 0.45, "black");
    cols.push(col(cx + side * 2.1, 0.4, cz, 0.45, 0.45, 0.45));
  }
  const desk = { x: cx, z: cz + 4.2 };
  put(boxes, desk.x, 0.55, desk.z, 2.4, 1.05, 0.8, "stone");
  cols.push(col(desk.x, 0.55, desk.z, 2.4, 1.05, 0.8));
  put(boxes, desk.x, 1.2, desk.z, 0.45, 0.28, 0.35, "cyan");
  put(boxes, cx, 0.4, z0 + 2.4, 3.2, 0.45, 0.8, "red");
  cols.push(col(cx, 0.4, z0 + 2.4, 3.2, 0.45, 0.8));
  // Enrichment: two work desks on the north wall (west of the bench),
  // extra chairs at the meeting table, a bookcase + sideboard on the
  // south wall, plants in the corners, paintings flanking the door, and a
  // rug under the meeting table. Nothing already here moves.
  deskRow(boxes, cols, x0 + 2.7, 0, z0 + 2.4, 2, 2.8, true);
  // Two guest chairs facing the desk (south of it, clear of the door lane
  // and of the service point in front of the desk).
  for (const cxOff of [-2.1, 2.1]) {
    put(boxes, cx + cxOff, 0.4, cz + 6.3, 0.45, 0.45, 0.45, "black");
    cols.push(col(cx + cxOff, 0.4, cz + 6.3, 0.45, 0.45, 0.45));
  }
  put(boxes, x0 + 4.5, 1.0, z0 + d - 2.3, 3.4, 2.0, 0.7, "wood");
  cols.push(col(x0 + 4.5, 1.0, z0 + d - 2.3, 3.4, 2.0, 0.7));
  const bookMats: Mat[] = ["red", "cyan", "gold", "white"];
  for (let level = 0; level < 2; level++) {
    for (let i = 0; i < 3; i++) {
      put(boxes, x0 + 3.5 + i * 1.0, 0.7 + level * 0.9, z0 + d - 2.72, 0.4, 0.45, 0.3, bookMats[(i + level * 2) % bookMats.length]);
    }
  }
  put(boxes, x0 + w - 6.5, 0.55, z0 + d - 2.4, 2.6, 1.05, 0.9, "wood");
  cols.push(col(x0 + w - 6.5, 0.55, z0 + d - 2.4, 2.6, 1.05, 0.9));
  put(boxes, x0 + w - 7.2, 1.2, z0 + d - 2.4, 0.3, 0.3, 0.3, "white");
  put(boxes, x0 + w - 5.8, 1.2, z0 + d - 2.4, 0.3, 0.3, 0.3, "gold");
  for (const [px, pz] of [[x0 + 2.0, z0 + d - 4.0], [x0 + w - 2.7, z0 + d - 2.7]] as Array<[number, number]>) {
    put(boxes, px, 0.2, pz, 0.9, 0.4, 0.9, "stone");
    put(boxes, px, 0.5, pz, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(px, 0.5, pz, 0.8, 0.9, 0.8));
  }
  voxelPainting(boxes, x0 + w - 1.65, 1.9, z0 + 5, -Math.PI / 2, 2.2, 1.5);
  voxelPainting(boxes, x0 + w - 1.65, 1.9, z0 + d - 5, -Math.PI / 2, 2.2, 1.5);
  put(boxes, cx, 0.145, cz, 6, 0.05, 4.4, "gold");
  put(boxes, cx, 0.155, cz, 4.6, 0.05, 3.0, "red");
  return {
    id: `project-${index}`,
    name: "Project office",
    kind: "project",
    slot: index,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: desk.x,
    serviceZ: desk.z - 1.4,
    signX: back.x + (door === "e" ? 0.45 : door === "w" ? -0.45 : 0),
    signY: 2.35,
    signZ: back.z,
    signRot: back.rot,
  };
}

function addVenue(
  boxes: Box[],
  cols: Collider[],
  x0: number,
  z0: number,
  w: number,
  d: number,
  h: number,
  door: Face,
  kind: Zone["kind"],
  index = 0,
) {
  const style = kind === "cafe" ? 2 : kind === "hall" ? 3 : kind === "shop" ? 0 : 1;
  // Real-store exteriors: pitched roofs, glass storefronts, awnings, gold
  // cornices — the ground floor must read as a shop, not a blank slab.
  const arch: Pick<Facade, "roof" | "roofMat" | "storefront" | "awning" | "cornice"> =
    kind === "shop" || kind === "arcade"
      ? { roof: "gable", roofMat: 2, storefront: true, awning: true, cornice: true }
      : kind === "cafe" || kind === "market"
        ? { roof: "hip", roofMat: 1, storefront: true, awning: true, cornice: true }
        : kind === "hall"
          ? { roof: "gable", roofMat: 0, storefront: false, awning: false, cornice: true }
          : kind === "bank"
            ? { roof: "flat", roofMat: 0, storefront: true, awning: false, cornice: true }
            : kind === "project"
              ? { roof: "flat", roofMat: 0, storefront: true, awning: false, cornice: true }
              : kind === "dock"
                ? { roof: "gable", roofMat: 2, storefront: false, awning: false, cornice: false }
                : kind === "cinema"
                  ? { roof: "gable", roofMat: 2, storefront: true, awning: true, cornice: true }
                  : kind === "library"
                    ? { roof: "hip", roofMat: 1, storefront: true, awning: false, cornice: true }
                    : kind === "gym"
                      ? { roof: "flat", roofMat: 0, storefront: true, awning: true, cornice: true }
                      : kind === "museum"
                        ? { roof: "hip", roofMat: 1, storefront: true, awning: false, cornice: true }
                        : kind === "hotel"
                          ? { roof: "gable", roofMat: 2, storefront: true, awning: true, cornice: true }
                          : kind === "casino"
                            ? { roof: "flat", roofMat: 0, storefront: true, awning: false, cornice: true }
                            : kind === "nightclub"
                              ? { roof: "flat", roofMat: 0, storefront: true, awning: true, cornice: true }
                              : { roof: "flat", roofMat: 0, storefront: false, awning: false, cornice: true };
  shellOpen(
    boxes,
    cols,
    x0,
    0,
    z0,
    w,
    h,
    d,
    (u, ly, face, len) => (hole(face, door, u, ly, len) ? "air" : facadeSample(style, len)(u, ly)),
    "black",
    door,
  );
  addAwning(boxes, x0, z0, w, d, door);
  facades.push({
    id: kind === "project" ? `project-${index}` : kind,
    x: x0,
    z: z0,
    w,
    d,
    h,
    style,
    door,
    enterable: true,
    hero: false,
    face: door,
    roof: arch.roof,
    roofDir: door,
    roofMat: arch.roofMat,
    storefront: arch.storefront,
    awning: arch.awning,
    cornice: arch.cornice,
  });
  if (kind === "shop") return furnishShop(boxes, cols, x0, z0, w, d, door);
  if (kind === "cafe") return furnishCafe(boxes, cols, x0, z0, w, d, door);
  if (kind === "hall") return furnishHall(boxes, cols, x0, z0, w, d, door);
  if (kind === "project") return furnishOffice(boxes, cols, x0, z0, w, d, door, index);
  if (kind === "cinema") return furnishCinema(boxes, cols, x0, z0, w, d, door);
  if (kind === "library") return furnishLibrary(boxes, cols, x0, z0, w, d, door);
  if (kind === "gym") return furnishGym(boxes, cols, x0, z0, w, d, door);
  if (kind === "museum") return furnishMuseum(boxes, cols, x0, z0, w, d, door);
  if (kind === "hotel") return furnishHotel(boxes, cols, x0, z0, w, d, door);
  if (kind === "casino") return furnishCasino(boxes, cols, x0, z0, w, d, door);
  if (kind === "nightclub") return furnishNightclub(boxes, cols, x0, z0, w, d, door);
  return furnishSpot(boxes, cols, x0, z0, w, d, door, kind);
}

// The five generic "spot" venues each get a real interior of their own.
// Every one returns the exact Zone the old generic furnishSpot returned
// (same id / name / service point / sign), so zone + anchor + door wiring
// is untouched — only the contents inside the room change. All five keep
// their fixed doors: bank / garage / arcade enter from the west, market
// and the harbor office from the north.
function spotZone(
  kind: Zone["kind"],
  name: string,
  x0: number,
  z0: number,
  w: number,
  d: number,
  door: Face,
): Zone {
  const back = opposite(door, x0, z0, w, d, 2.4);
  const service = opposite(door, x0, z0, w, d, 4.1);
  return {
    id: kind,
    name,
    kind,
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: service.x,
    serviceZ: service.z,
    signX: back.x + (door === "w" ? -0.55 : door === "e" ? 0.55 : 0),
    signY: 2.35,
    signZ: back.z + (door === "n" ? -0.55 : door === "s" ? 0.55 : 0),
    signRot: back.rot,
  };
}

// OrbitX Bank (door west): teller counter with two glass windows on the
// back wall, vault door on the north wall, ATMs on the south wall, a
// railed queue lane down the middle, waiting chairs, plants, gold trim.
function furnishBank(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "stone");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const back = opposite(door, x0, z0, w, d, 2.4);
  // Teller counter + gold top on the back (east) wall; the zone sign sits
  // over the middle bay, so the glass windows live in the outer bays.
  put(boxes, back.x - 0.6, 0.55, back.z, 1.2, 1.05, 8.0, "stone");
  cols.push(col(back.x - 0.6, 0.55, back.z, 1.2, 1.05, 8.0));
  put(boxes, back.x - 0.6, 1.15, back.z, 1.35, 0.12, 8.2, "gold");
  for (const off of [-4.2, 4.2]) {
    put(boxes, back.x - 0.6, 1.7, back.z + off, 0.12, 1.0, 1.6, "cyan");
    put(boxes, back.x - 0.85, 1.4, back.z + off, 0.15, 0.4, 0.6, "black");
  }
  put(boxes, back.x - 0.6, 1.3, back.z, 0.3, 0.2, 0.3, "gold");
  for (const off of [-2.5, 2.5]) {
    put(boxes, back.x - 0.6, 1.35, back.z + off, 0.4, 0.4, 0.4, "gold");
  }
  // Railed queue lane: two runs either side of the door lane, open at the
  // east end so the player steps around to the service point.
  for (const rz of [cz - 2.6, cz + 2.6]) {
    put(boxes, cx - 1.25, 0.55, rz, 9.5, 0.08, 0.12, "black");
    cols.push(col(cx - 1.25, 0.55, rz, 9.5, 1.1, 0.2));
    for (const px of [cx - 6, cx - 1.25, cx + 3.5]) {
      put(boxes, px, 0.5, rz, 0.18, 1.0, 0.18, "gold");
    }
  }
  // Vault door on the north wall: gold rim, black door, gold wheel.
  put(boxes, cx + 3, 1.5, z0 + 1.32, 3.6, 3.0, 0.12, "gold");
  put(boxes, cx + 3, 1.45, z0 + 1.42, 3.2, 2.8, 0.2, "black");
  put(boxes, cx + 3, 1.45, z0 + 1.58, 0.5, 0.5, 0.15, "gold");
  // ATMs on the south wall.
  for (const ax of [cx - 6, cx - 1.5]) {
    put(boxes, ax, 0.9, z0 + d - 1.9, 1.4, 1.8, 0.8, "black");
    cols.push(col(ax, 0.9, z0 + d - 1.9, 1.4, 1.8, 0.8));
    put(boxes, ax, 1.15, z0 + d - 2.32, 0.9, 0.6, 0.1, "cyan");
    put(boxes, ax, 1.85, z0 + d - 1.9, 1.45, 0.1, 0.85, "gold");
  }
  // Waiting chairs on the north wall, plants flanking the teller counter.
  for (const chx of [cx - 7, cx - 4.4, cx - 1.8]) {
    put(boxes, chx, 0.38, z0 + 2.6, 0.95, 0.45, 0.9, "red");
    put(boxes, chx, 0.85, z0 + 2.15, 0.95, 0.9, 0.2, "red");
    cols.push(col(chx, 0.5, z0 + 2.45, 1.0, 1.0, 1.1));
  }
  for (const pz of [cz - 7.8, cz + 7.8]) {
    put(boxes, x0 + w - 3.2, 0.2, pz, 0.9, 0.4, 0.9, "stone");
    put(boxes, x0 + w - 3.2, 0.5, pz, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(x0 + w - 3.2, 0.5, pz, 0.8, 0.9, 0.8));
  }
  // Gold floor strip in front of the counter, painting on the south wall.
  put(boxes, back.x - 2.6, 0.145, back.z, 1.6, 0.05, 7.0, "gold");
  voxelPainting(boxes, cx + 4, 1.9, z0 + d - 1.4, Math.PI, 2.2, 1.5);
  roomSign("bank", x0 + 1.35, 2.2, cz - 6, Math.PI / 2, 4.2, 1.7, ["ORBITX BANK", "Tellers · Vault · ATMs"], "Demo ledger only");
  return spotZone("bank", "OrbitX Bank", x0, z0, w, d, door);
}

// Hover Garage (door west): two hover cars parked on the north wall, a
// third car up on the lift in the south half, tool benches + pegboard on
// the back wall, tire stacks, parts crates, work lamps, bay lines and
// oil stains on the black floor. The drive lane from the door stays open.
function furnishGarage(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "black");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  // A hover car: black body, cyan underglow, gold belt line, white cabin.
  const hoverCar = (hx: number, hz: number, body: Mat, liftY = 0) => {
    put(boxes, hx, 0.55 + liftY, hz, 3.4, 0.7, 1.9, body);
    put(boxes, hx, 0.18 + liftY, hz, 3.5, 0.12, 2.0, "cyan");
    put(boxes, hx, 0.95 + liftY, hz, 3.45, 0.1, 1.95, "gold");
    put(boxes, hx, 1.05 + liftY, hz, 1.8, 0.55, 1.5, "white");
    cols.push(col(hx, 0.7 + liftY, hz, 3.6, 1.4, 2.1));
  };
  hoverCar(cx - 4, z0 + 4.6, "black");
  hoverCar(cx + 3.5, z0 + 4.6, "black");
  // Lift platform + corner posts in the south half, third car riding on it.
  put(boxes, cx, 0.3, cz + 5.5, 4.6, 0.6, 2.6, "stone");
  cols.push(col(cx, 0.3, cz + 5.5, 4.6, 0.6, 2.6));
  for (const [lx, lz] of [[cx - 2, cz + 4.2], [cx + 2, cz + 4.2], [cx - 2, cz + 6.8], [cx + 2, cz + 6.8]] as Array<[number, number]>) {
    put(boxes, lx, 0.9, lz, 0.25, 1.8, 0.25, "gray");
  }
  hoverCar(cx, cz + 5.5, "red", 0.5);
  // Workbench + pegboard on the back (east) wall, south of the service
  // point; parts shelf on the same wall, north of it.
  put(boxes, x0 + w - 2.8, 0.55, cz + 5.5, 1.2, 1.05, 4.6, "wood");
  cols.push(col(x0 + w - 2.8, 0.55, cz + 5.5, 1.2, 1.05, 4.6));
  put(boxes, x0 + w - 2.8, 1.2, cz + 4.3, 0.6, 0.25, 0.6, "gray");
  put(boxes, x0 + w - 2.8, 1.2, cz + 5.5, 0.4, 0.3, 0.4, "red");
  put(boxes, x0 + w - 2.8, 1.2, cz + 6.7, 0.5, 0.25, 0.5, "gold");
  put(boxes, x0 + w - 1.45, 1.9, cz + 5.5, 0.15, 1.6, 4.4, "black");
  for (const [tz, tm] of [[cz + 4.0, "gold"], [cz + 5.5, "cyan"], [cz + 7.0, "red"]] as Array<[number, Mat]>) {
    put(boxes, x0 + w - 1.58, 1.9, tz, 0.1, 0.4, 0.4, tm);
  }
  put(boxes, x0 + w - 2.8, 1.1, cz - 4.5, 1.0, 2.2, 3.4, "wood");
  cols.push(col(x0 + w - 2.8, 1.1, cz - 4.5, 1.0, 2.2, 3.4));
  for (const [gy, gz, gm] of [[0.95, cz - 5.5, "gold"], [0.95, cz - 3.5, "cyan"], [1.75, cz - 5.5, "red"], [1.75, cz - 3.5, "white"]] as Array<[number, number, Mat]>) {
    put(boxes, x0 + w - 3.45, gy, gz, 0.3, 0.4, 0.4, gm);
  }
  // Tire stacks in the west corners.
  for (const [tx, tz] of [[x0 + 3.5, z0 + 4.0], [x0 + 3.5, z0 + d - 2.5]] as Array<[number, number]>) {
    for (let level = 0; level < 3; level++) {
      put(boxes, tx, 0.15 + level * 0.3, tz, 1.3, 0.3, 1.3, "black");
    }
    put(boxes, tx, 0.95, tz, 0.5, 0.15, 0.5, "gray");
    cols.push(col(tx, 0.45, tz, 1.3, 0.9, 1.3));
  }
  // Parts crates stacked on the south wall.
  put(boxes, cx + 5.5, 0.5, z0 + d - 2.3, 1.0, 1.0, 1.0, "wood");
  put(boxes, cx + 5.5, 1.5, z0 + d - 2.3, 1.0, 1.0, 1.0, "wood");
  put(boxes, cx + 3.8, 0.5, z0 + d - 2.3, 1.0, 1.0, 1.0, "wood");
  cols.push(col(cx + 4.65, 1.0, z0 + d - 2.3, 3.4, 2.0, 1.1));
  // Standing work lamps flanking the lift.
  for (const [lx, lz] of [[cx - 4, cz + 3.8], [cx + 4.5, cz - 3.5]] as Array<[number, number]>) {
    put(boxes, lx, 0.9, lz, 0.15, 1.8, 0.15, "gray");
    put(boxes, lx, 1.85, lz, 0.5, 0.3, 0.5, "warm");
    cols.push(col(lx, 0.9, lz, 0.3, 1.8, 0.3));
  }
  // Bay lines, gold drive line, oil stains — flat paint on the floor.
  for (const bx of [cx - 6, cx - 2, cx + 1.6, cx + 5.6]) {
    put(boxes, bx, 0.145, z0 + 4.6, 0.15, 0.05, 3.2, "white");
  }
  put(boxes, cx, 0.145, cz, 14, 0.05, 0.3, "gold");
  for (const [ox, oz] of [[cx - 4, z0 + 6.8], [cx + 3.5, z0 + 6.8], [cx, cz + 7.5]] as Array<[number, number]>) {
    put(boxes, ox, 0.145, oz, 2.6, 0.05, 1.4, "gray");
  }
  roomSign("garage", cx - 4, 2.2, z0 + 1.35, 0, 4.2, 1.7, ["HOVER GARAGE", "Lifts · Tires · Tune-ups"], "Hover-cars live here");
  return spotZone("garage", "Hover Garage", x0, z0, w, d, door);
}

// Neon Arcade (door west): ten cabinets — five down the back wall, three
// on the north wall, two on the south — a prize counter in the south-west
// corner, gold stools, neon strips, a high-score board by the door.
function furnishArcade(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "cyan");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  // A cabinet: black body, gold top, glowing face + white control deck
  // on the side that looks into the room.
  const cabinet = (mx: number, mz: number, face: Face, mat: Mat) => {
    const wide = face === "n" || face === "s";
    put(boxes, mx, 1.0, mz, wide ? 1.4 : 0.9, 2.0, wide ? 0.9 : 1.4, "black");
    cols.push(col(mx, 1.0, mz, wide ? 1.4 : 0.9, 2.0, wide ? 0.9 : 1.4));
    put(boxes, mx, 2.05, mz, wide ? 1.45 : 0.95, 0.15, wide ? 0.95 : 1.45, "gold");
    const fx = mx + (face === "e" ? 0.48 : face === "w" ? -0.48 : 0);
    const fz = mz + (face === "s" ? 0.48 : face === "n" ? -0.48 : 0);
    put(boxes, fx, 1.25, fz, wide ? 1.0 : 0.1, 0.8, wide ? 0.1 : 1.0, mat);
    put(boxes, fx, 0.65, fz, wide ? 0.9 : 0.1, 0.35, wide ? 0.1 : 0.9, "white");
  };
  const mats: Mat[] = ["cyan", "red", "warm", "gold", "cyan"];
  // Five-cabinet row on the back (east) wall — the service point lands in
  // front of the middle cabinet.
  [cz - 6.5, cz - 3.25, cz, cz + 3.25, cz + 6.5].forEach((mz, i) => {
    cabinet(x0 + w - 2.7, mz, "w", mats[i % mats.length]);
  });
  for (const [nx, nm] of [[cx - 6, "red"], [cx - 2, "gold"], [cx + 2, "warm"]] as Array<[number, Mat]>) {
    cabinet(nx, z0 + 2.6, "s", nm);
  }
  for (const [sx, sm] of [[cx - 1.5, "warm"], [cx + 3.5, "cyan"]] as Array<[number, Mat]>) {
    cabinet(sx, z0 + d - 2.6, "n", sm);
  }
  // Prize counter in the south-west corner, goods on top.
  put(boxes, x0 + 4, 0.55, z0 + d - 3.5, 4.0, 1.05, 1.2, "wood");
  cols.push(col(x0 + 4, 0.55, z0 + d - 3.5, 4.0, 1.05, 1.2));
  put(boxes, x0 + 4, 1.15, z0 + d - 3.5, 4.2, 0.12, 1.35, "gold");
  const prizes: Mat[] = ["gold", "red", "cyan", "white"];
  for (let i = 0; i < 4; i++) {
    put(boxes, x0 + 2.8 + i * 0.85, 1.4, z0 + d - 3.5, 0.45, 0.45, 0.45, prizes[i]);
  }
  // Gold stools in front of the cabinets (no colliders, like the club's).
  for (const sz of [cz - 6.5, cz - 3.25, cz + 3.25, cz + 6.5]) {
    put(boxes, x0 + w - 4.8, 0.3, sz, 0.5, 0.6, 0.5, "gold");
  }
  for (const nx of [cx - 6, cx - 2, cx + 2]) {
    put(boxes, nx, 0.3, z0 + 4.3, 0.5, 0.6, 0.5, "gold");
  }
  for (const sx of [cx - 1.5, cx + 3.5]) {
    put(boxes, sx, 0.3, z0 + d - 4.5, 0.5, 0.6, 0.5, "gold");
  }
  // Neon strips above the cabinet rows (east one rides above the sign).
  put(boxes, cx, 2.9, z0 + 1.35, 12, 0.18, 0.15, "cyanhot");
  put(boxes, cx, 2.9, z0 + d - 1.35, 12, 0.18, 0.15, "cyanhot");
  put(boxes, x0 + w - 1.35, 3.3, cz, 0.15, 0.18, 12, "cyanhot");
  roomSign("arcade-scores", x0 + 1.35, 2.2, cz - 6, Math.PI / 2, 4.2, 1.7, ["HIGH SCORES", "1. ORBITX-9 · 999,420"], "Beat the top score");
  put(boxes, cx, 0.145, cz, 6, 0.05, 4, "black");
  return spotZone("arcade", "Neon Arcade", x0, z0, w, d, door);
}

// Night Market (door north): four stalls on the side walls, the service
// stall on the south wall, a communal table with crate seats, crate
// stacks, string lights, and a red runner down the door lane.
function furnishMarket(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "warm");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  // A stall: wood counter, stone top, four posts, coloured awning, goods.
  // `tall` lifts the awning above the zone sign (south / service stall).
  const stall = (sx: number, sz: number, alongX: boolean, awn: Mat, goods: Mat[], tall = false) => {
    const cw = alongX ? 4.2 : 1.3;
    const cd = alongX ? 1.3 : 4.2;
    put(boxes, sx, 0.55, sz, cw, 1.05, cd, "wood");
    cols.push(col(sx, 0.55, sz, cw, 1.05, cd));
    put(boxes, sx, 1.15, sz, cw + 0.2, 0.12, cd + 0.2, "stone");
    const postY = tall ? 2.25 : 1.75;
    const postH = tall ? 2.1 : 1.1;
    const awnY = tall ? 3.32 : 2.4;
    const pxs = alongX ? [sx - 1.9, sx + 1.9] : [sx - 0.55, sx + 0.55];
    const pzs = alongX ? [sz - 0.55, sz + 0.55] : [sz - 1.9, sz + 1.9];
    for (const px of pxs) {
      for (const pz of pzs) {
        put(boxes, px, postY, pz, 0.16, postH, 0.16, "black");
      }
    }
    put(boxes, sx, awnY, sz, alongX ? 4.6 : 1.9, 0.15, alongX ? 1.9 : 4.6, awn);
    for (let i = 0; i < 3; i++) {
      const gx = alongX ? sx - 1.3 + i * 1.3 : sx;
      const gz = alongX ? sz : sz - 1.3 + i * 1.3;
      put(boxes, gx, 1.4, gz, 0.45, 0.45, 0.45, goods[i % goods.length]);
    }
  };
  const fruit: Mat[] = ["red", "gold", "warm"];
  const bread: Mat[] = ["warm", "gold", "white"];
  stall(x0 + 2.1, z0 + 6, false, "red", fruit);
  stall(x0 + 2.1, z0 + 12.5, false, "warm", bread);
  stall(x0 + w - 2.1, z0 + 6, false, "warm", bread);
  stall(x0 + w - 2.1, z0 + 12.5, false, "red", fruit);
  stall(cx, z0 + d - 2.7, true, "red", ["cyan", "gold", "red"], true);
  // Communal table east of the door lane, crate seats around it.
  put(boxes, cx + 5.5, 0.45, z0 + 14, 3.0, 0.8, 1.6, "wood");
  cols.push(col(cx + 5.5, 0.45, z0 + 14, 3.0, 0.8, 1.6));
  put(boxes, cx + 5.0, 0.95, z0 + 14, 0.4, 0.3, 0.4, "warm");
  put(boxes, cx + 6.0, 0.95, z0 + 14, 0.4, 0.3, 0.4, "red");
  for (const [kx, kz] of [[cx + 3.5, z0 + 14], [cx + 7.5, z0 + 14], [cx + 5.5, z0 + 12.3], [cx + 5.5, z0 + 15.7]] as Array<[number, number]>) {
    put(boxes, kx, 0.3, kz, 0.6, 0.6, 0.6, "wood");
    cols.push(col(kx, 0.3, kz, 0.6, 0.6, 0.6));
  }
  // Crate stacks in the corners.
  for (const [kx, kz, stacked] of [[x0 + 3, z0 + d - 2.5, true], [x0 + w - 3, z0 + d - 2.5, true], [x0 + 3, z0 + 2.5, false]] as Array<[number, number, boolean]>) {
    put(boxes, kx, 0.5, kz, 1.0, 1.0, 1.0, "wood");
    if (stacked) put(boxes, kx, 1.5, kz, 1.0, 1.0, 1.0, "wood");
    cols.push(col(kx, stacked ? 1.0 : 0.5, kz, 1.1, stacked ? 2.0 : 1.0, 1.1));
  }
  // String lights strung across the room + a red runner down the lane.
  for (const lz of [z0 + 7, z0 + 14]) {
    put(boxes, cx, 3.0, lz, 14, 0.12, 0.12, "warm");
    for (const lx of [cx - 6, cx, cx + 6]) {
      put(boxes, lx, 2.75, lz, 0.25, 0.25, 0.25, "warm");
    }
  }
  put(boxes, cx, 0.145, z0 + 9, 2.4, 0.05, 13, "red");
  roomSign("market", cx - 6, 2.2, z0 + 1.35, 0, 4.2, 1.7, ["NIGHT MARKET", "Stalls · Food · Neon"], "Stalls open until late");
  return spotZone("market", "Night Market", x0, z0, w, d, door);
}

// Harbor Office (door north, small 16x14 room): map table in the middle,
// two desks on the west wall, notice board on the east wall, crates + net
// and a ship's anchor in the south corners, rope coil, shelf of charts
// on the south wall, lamps.
function furnishDock(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "wood");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  // Map table, east of the door lane and south of its centre line, so the
  // way in from the door stays fully open.
  put(boxes, cx + 3.5, 0.5, cz + 1.5, 3.0, 0.9, 1.8, "wood");
  cols.push(col(cx + 3.5, 0.5, cz + 1.5, 3.0, 0.9, 1.8));
  put(boxes, cx + 3.5, 1.0, cz + 1.5, 2.6, 0.1, 1.4, "cyan");
  put(boxes, cx + 3.5, 1.1, cz + 1.5, 0.35, 0.12, 0.35, "gold");
  put(boxes, cx + 2.2, 1.15, cz + 1.9, 0.5, 0.25, 0.25, "white");
  put(boxes, cx + 3.5, 0.145, cz + 1.5, 5.0, 0.05, 3.2, "red");
  // Two desks with screens on the west wall + a lamp on the first desk.
  deskRow(boxes, cols, x0 + 2.4, 0, z0 + 3.5, 2, 3.0, false);
  put(boxes, x0 + 2.4, 1.0, z0 + 3.5, 0.3, 0.3, 0.3, "warm");
  // Notice board on the east wall, notes pinned to it.
  put(boxes, x0 + w - 1.45, 1.7, z0 + 5, 0.15, 1.8, 3.0, "black");
  put(boxes, x0 + w - 1.55, 1.8, z0 + 4.3, 0.1, 0.5, 0.6, "white");
  put(boxes, x0 + w - 1.55, 1.6, z0 + 5.4, 0.1, 0.4, 0.5, "gold");
  put(boxes, x0 + w - 1.55, 2.0, z0 + 6.2, 0.1, 0.5, 0.5, "red");
  // Crates + draped net in the south-east corner.
  put(boxes, cx + 5.3, 0.5, z0 + d - 2.5, 1.0, 1.0, 1.0, "wood");
  put(boxes, cx + 5.3, 1.5, z0 + d - 2.5, 1.0, 1.0, 1.0, "wood");
  put(boxes, cx + 4.0, 0.5, z0 + d - 2.5, 1.0, 1.0, 1.0, "wood");
  put(boxes, cx + 5.3, 2.05, z0 + d - 2.5, 1.3, 0.15, 1.3, "gray");
  cols.push(col(cx + 4.8, 1.0, z0 + d - 2.5, 2.6, 2.0, 1.1));
  // Rope coil + ship's anchor in the south-west corner.
  disc(boxes, x0 + 2.5, 0.15, z0 + d - 3.5, 1.0, 0.3, "warm");
  disc(boxes, x0 + 2.5, 0.45, z0 + d - 3.5, 1.0, 0.3, "warm");
  cols.push(col(x0 + 2.5, 0.3, z0 + d - 3.5, 2.0, 0.6, 2.0));
  put(boxes, x0 + 1.7, 0.8, z0 + d - 2.2, 0.25, 1.6, 0.25, "black");
  put(boxes, x0 + 1.7, 1.4, z0 + d - 2.2, 0.9, 0.2, 0.2, "black");
  cols.push(col(x0 + 1.7, 0.8, z0 + d - 2.2, 0.5, 1.6, 0.5));
  // Shelf of rolled charts on the south wall + painting above it.
  put(boxes, cx - 3, 1.0, z0 + d - 2.0, 4.0, 1.8, 0.7, "wood");
  cols.push(col(cx - 3, 1.0, z0 + d - 2.0, 4.0, 1.8, 0.7));
  put(boxes, cx - 4.2, 2.0, z0 + d - 2.0, 0.7, 0.25, 0.5, "white");
  put(boxes, cx - 3.0, 2.0, z0 + d - 2.0, 0.7, 0.25, 0.5, "warm");
  put(boxes, cx - 1.8, 2.0, z0 + d - 2.0, 0.7, 0.25, 0.5, "white");
  voxelPainting(boxes, cx - 3, 2.6, z0 + d - 1.35, Math.PI, 2.2, 1.5);
  // Standing lamp by the map table.
  put(boxes, cx + 5.8, 0.9, z0 + 4.5, 0.15, 1.8, 0.15, "gray");
  put(boxes, cx + 5.8, 1.85, z0 + 4.5, 0.5, 0.3, 0.5, "warm");
  cols.push(col(cx + 5.8, 0.9, z0 + 4.5, 0.3, 1.8, 0.3));
  roomSign("dock", cx - 4.5, 2.2, z0 + 1.35, 0, 4.2, 1.7, ["HARBOR OFFICE", "Shifts · Ships · Cargo"], "Pier is open");
  return spotZone("dock", "Harbor Office", x0, z0, w, d, door);
}

function furnishSpot(
  boxes: Box[],
  cols: Collider[],
  x0: number,
  z0: number,
  w: number,
  d: number,
  door: Face,
  kind: Zone["kind"],
): Zone {
  if (kind === "bank") return furnishBank(boxes, cols, x0, z0, w, d, door);
  if (kind === "garage") return furnishGarage(boxes, cols, x0, z0, w, d, door);
  if (kind === "arcade") return furnishArcade(boxes, cols, x0, z0, w, d, door);
  if (kind === "market") return furnishMarket(boxes, cols, x0, z0, w, d, door);
  if (kind === "dock") return furnishDock(boxes, cols, x0, z0, w, d, door);
  // Unknown kind: the old generic shell (floor + back counter + table).
  const names: Record<string, [string, string, Mat]> = {
    bank: ["OrbitX Bank", "Demo savings window", "stone"],
    garage: ["Hover Garage", "Take a car from the avenue", "black"],
    arcade: ["Neon Arcade", "One cabinet, one high score", "cyan"],
    market: ["Night Market", "Stalls open until late", "warm"],
    dock: ["Harbor Office", "Ships and shift work", "wood"],
  };
  const [name, , floor] = names[kind] ?? ["OrbitX", "Come in", "cream"];
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, floor);
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const back = opposite(door, x0, z0, w, d, 2.4);
  const alongX = door === "n" || door === "s";
  // (The arcade's cyan counter lived here; arcade never reaches this
  // fallback — it has its own function above — so this is always black.)
  put(boxes, back.x, 0.6, back.z, alongX ? 6.4 : 1.1, 1.1, alongX ? 1.1 : 6.4, "black");
  cols.push(col(back.x, 0.6, back.z, alongX ? 6.4 : 1.1, 1.1, alongX ? 1.1 : 6.4));
  put(boxes, cx, 0.45, cz, 2.2, 0.8, 1.2, "wood");
  cols.push(col(cx, 0.45, cz, 2.2, 0.8, 1.2));
  return spotZone(kind, name, x0, z0, w, d, door);
}

// ---- new venues: cinema, library, gym (park is outdoor, below) ----

// Cinema: big glowing screen on the wall opposite the door, four rows of
// five red seats facing it, red carpet aisle, concession counter by the door.
function furnishCinema(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "black");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const screen = opposite(door, x0, z0, w, d, 1.5);
  const alongX = door === "n" || door === "s";
  // Screen: black frame, white face, cyan glow strip along its base. The
  // white face sits on the room side of the frame (east for a west-wall
  // screen, north for a south-wall screen).
  if (alongX) {
    put(boxes, screen.x, 2.1, screen.z, 11, 3.2, 0.25, "black");
    put(boxes, screen.x, 2.1, screen.z + (door === "n" ? -0.12 : 0.12), 10, 2.7, 0.12, "white");
    put(boxes, screen.x, 0.62, screen.z + (door === "n" ? -0.14 : 0.14), 10.4, 0.18, 0.12, "cyanhot");
  } else {
    put(boxes, screen.x, 2.1, screen.z, 0.25, 3.2, 11, "black");
    put(boxes, screen.x + (door === "e" ? 0.12 : -0.12), 2.1, screen.z, 0.12, 2.7, 10, "white");
    put(boxes, screen.x + (door === "e" ? 0.14 : -0.14), 0.62, screen.z, 0.12, 0.18, 10.4, "cyanhot");
  }
  // Four seat rows facing the screen, with a walkable aisle between rows.
  // Four seats per row (not five): the end seats would crowd the corners
  // where the concession counter sits, leaving no standable service point.
  const rowXs = alongX ? null : [cx - 6.5, cx - 3, cx + 0.5, cx + 4];
  const rowZs = alongX ? [cz - 6.5, cz - 3, cz + 0.5, cz + 4] : null;
  const seatAt = [cz - 4.5, cz - 1.5, cz + 1.5, cz + 4.5];
  const seatAtX = [cx - 4.5, cx - 1.5, cx + 1.5, cx + 4.5];
  for (let r = 0; r < 4; r++) {
    if (alongX) {
      const z = rowZs![r];
      for (const x of seatAtX) {
        put(boxes, x, 0.45, z, 1.4, 0.45, 1.1, "red");
        put(boxes, x, 0.9, z + (door === "n" ? 0.5 : -0.5), 1.4, 0.9, 0.25, "red");
      }
      cols.push(col(cx, 0.6, z, 11, 1.2, 1.4));
    } else {
      const x = rowXs![r];
      for (const z of seatAt) {
        put(boxes, x, 0.45, z, 1.1, 0.45, 1.4, "red");
        put(boxes, x + (door === "w" ? 0.5 : -0.5), 0.9, z, 0.25, 0.9, 1.4, "red");
      }
      cols.push(col(x, 0.6, cz, 1.4, 1.2, 11));
    }
  }
  // Red carpet runner from the door to the screen, down the middle aisle.
  if (alongX) put(boxes, cx, 0.145, cz, 2.4, 0.05, d - 6, "red");
  else put(boxes, cx, 0.145, cz, w - 6, 0.05, 2.4, "red");
  // Concession counter by the door (east corner for door e/w, north for n/s).
  const cc = door === "e" ? { x: x0 + w - 3.2, z: z0 + 3.2 } : door === "w" ? { x: x0 + 3.2, z: z0 + d - 3.2 } : door === "n" ? { x: x0 + 3.2, z: z0 + 3.2 } : { x: x0 + w - 3.2, z: z0 + d - 3.2 };
  put(boxes, cc.x, 0.55, cc.z, 3.4, 1.05, 1.2, "wood");
  cols.push(col(cc.x, 0.55, cc.z, 3.4, 1.05, 1.2));
  put(boxes, cc.x, 1.15, cc.z, 3.6, 0.12, 1.35, "stone");
  put(boxes, cc.x - 1, 1.35, cc.z, 0.45, 0.35, 0.45, "gold");
  put(boxes, cc.x + 1, 1.35, cc.z, 0.45, 0.35, 0.45, "red");
  put(boxes, cc.x, 1.35, cc.z, 0.45, 0.35, 0.45, "warm");
  // "Now showing" board on the wall beside the screen.
  const board = door === "e" ? { x: x0 + 1.35, z: cz + 6.5, rot: Math.PI / 2 } : door === "w" ? { x: x0 + w - 1.35, z: cz - 6.5, rot: -Math.PI / 2 } : door === "n" ? { x: cx + 6.5, z: z0 + d - 1.35, rot: Math.PI } : { x: cx - 6.5, z: z0 + 1.35, rot: 0 };
  roomSign("cinema-now", board.x, 2.2, board.z, board.rot, 4.2, 1.7, ["NOW SHOWING", "OrbitX Nights"], "Tonight 8pm · free seats");
  // Service point at the concession counter (not the front row — the old
  // opposite(door, 4.1) point sat inside the front-row seat collider).
  // 2.5 clear of the counter face: 2.0 was still inside its 0.4 margin.
  const serviceX = cc.x + (door === "e" ? -2.5 : door === "w" ? 2.5 : 0);
  const serviceZ = cc.z + (door === "n" ? -2.5 : door === "s" ? 2.5 : 0);
  // Zone sign on a side wall, never over the screen.
  const signPos =
    door === "e" || door === "w"
      ? { x: door === "e" ? cx - 6 : cx + 6, z: z0 + 1.35, rot: 0 }
      : { x: x0 + 1.35, z: door === "n" ? cz - 6 : cz + 6, rot: Math.PI / 2 };
  return {
    id: "cinema",
    name: "OrbitX Cinema",
    kind: "cinema",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX,
    serviceZ,
    signX: signPos.x,
    signY: 2.35,
    signZ: signPos.z,
    signRot: signPos.rot,
  };
}

// Library: tall bookshelves along both side walls, two reading tables with
// lamps, armchairs, and a librarian desk by the door.
function furnishLibrary(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "wood");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const alongX = door === "n" || door === "s";
  const bookCols: Mat[] = ["cyan", "gold", "red", "white", "warm", "cyan", "red", "gold"];
  // Shelves along the two walls perpendicular to the door axis: north/south
  // walls when the door is east/west, east/west walls when it is north/south.
  const shelfRuns = alongX
    ? [
        { x: x0 + 1.9, z: cz - 5.5, sx: 0.7, sz: 8 },
        { x: x0 + 1.9, z: cz + 5.5, sx: 0.7, sz: 8 },
        { x: x0 + w - 1.9, z: cz - 5.5, sx: 0.7, sz: 8 },
        { x: x0 + w - 1.9, z: cz + 5.5, sx: 0.7, sz: 8 },
      ]
    : [
        { x: cx - 5.5, z: z0 + 1.9, sx: 8, sz: 0.7 },
        { x: cx + 5.5, z: z0 + 1.9, sx: 8, sz: 0.7 },
        { x: cx - 5.5, z: z0 + d - 1.9, sx: 8, sz: 0.7 },
        { x: cx + 5.5, z: z0 + d - 1.9, sx: 8, sz: 0.7 },
      ];
  for (const s of shelfRuns) {
    put(boxes, s.x, 1.2, s.z, Math.max(s.sx, 0.7), 2.4, Math.max(s.sz, 0.7), "wood");
    cols.push(col(s.x, 1.2, s.z, Math.max(s.sx, 0.7), 2.4, Math.max(s.sz, 0.7)));
    for (let level = 0; level < 2; level++) {
      const y = level === 0 ? 0.85 : 1.85;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) / ((n - 1) / 2);
        // Books sit proud of the shelf face (toward the room) so they read
        // as books, not as wood — a book centered on the shelf is buried.
        const bx = alongX ? s.x + (s.x < cx ? 0.45 : -0.45) : s.x + t * 3.4;
        const bz = alongX ? s.z + t * 3.4 : s.z + (s.z < cz ? 0.45 : -0.45);
        put(boxes, bx, y, bz, alongX ? 0.5 : 0.55, 0.55, alongX ? 0.55 : 0.5, bookCols[(i + level * 3) % bookCols.length]);
      }
    }
  }
  // Two reading tables in the middle, each with a warm lamp.
  for (const tz of [cz - 3.4, cz + 3.4]) {
    put(boxes, cx, 0.95, tz, 4.2, 0.14, 1.9, "wood");
    put(boxes, cx, 0.45, tz, 0.5, 0.9, 0.5, "black");
    cols.push(col(cx, 0.55, tz, 4.2, 1.0, 1.9));
    put(boxes, cx - 1.2, 1.25, tz, 0.35, 0.4, 0.35, "warm");
    put(boxes, cx + 1.2, 1.25, tz, 0.35, 0.4, 0.35, "warm");
    for (const side of [-1, 1]) {
      const ax = cx + side * 2.9;
      put(boxes, ax, 0.38, tz, 1.1, 0.45, 1.1, "red");
      cols.push(col(ax, 0.38, tz, 1.1, 0.45, 1.1));
      put(boxes, ax + (side < 0 ? -0.55 : 0.55), 0.85, tz, 0.2, 0.7, 1.1, "red");
    }
  }
  // Librarian desk by the door, offset to the side so it never blocks the
  // doorway (the old opposite(door, w-4.6) spot sat in the door's path).
  const deskPos =
    door === "e" ? { x: x0 + w - 3, z: z0 + 5, sx: 1.2, sz: 3.4 }
    : door === "w" ? { x: x0 + 3, z: z0 + d - 5, sx: 1.2, sz: 3.4 }
    : door === "n" ? { x: x0 + 5, z: z0 + 3, sx: 3.4, sz: 1.2 }
    : { x: x0 + w - 5, z: z0 + d - 3, sx: 3.4, sz: 1.2 };
  put(boxes, deskPos.x, 0.55, deskPos.z, deskPos.sx, 1.05, deskPos.sz, "stone");
  cols.push(col(deskPos.x, 0.55, deskPos.z, deskPos.sx, 1.05, deskPos.sz));
  put(boxes, deskPos.x, 1.15, deskPos.z, deskPos.sx + 0.2, 0.12, deskPos.sz + 0.2, "wood");
  put(boxes, deskPos.x, 1.45, deskPos.z, 0.4, 0.5, 0.4, "gold");
  // Framed painting on the back wall, clear of the zone sign and shelves.
  const paintPos =
    door === "e" ? { x: x0 + 1.3, z: cz - 5, rot: Math.PI / 2 }
    : door === "w" ? { x: x0 + w - 1.3, z: cz + 5, rot: -Math.PI / 2 }
    : door === "n" ? { x: cx + 5, z: z0 + d - 1.3, rot: Math.PI }
    : { x: cx - 5, z: z0 + 1.3, rot: 0 };
  voxelPainting(boxes, paintPos.x, 1.9, paintPos.z, paintPos.rot, 2.2, 1.5);
  // Zone sign on the door wall, past the door hole (never over the screen
  // wall or the painting).
  const signPos =
    door === "e" ? { x: x0 + w - 1.35, z: cz + 5.5, rot: -Math.PI / 2 }
    : door === "w" ? { x: x0 + 1.35, z: cz - 5.5, rot: Math.PI / 2 }
    : door === "n" ? { x: cx - 5.5, z: z0 + 1.35, rot: 0 }
    : { x: cx + 5.5, z: z0 + 1.35, rot: 0 };
  // Service point at the librarian desk (the front of it, not inside it).
  const serviceX = deskPos.x + (door === "e" ? -2 : door === "w" ? 2 : 0);
  const serviceZ = deskPos.z + (door === "n" ? 2 : door === "s" ? -2 : 0);
  return {
    id: "library",
    name: "OrbitX Library",
    kind: "library",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX,
    serviceZ,
    signX: signPos.x,
    signY: 2.35,
    signZ: signPos.z,
    signRot: signPos.rot,
  };
}

// Gym: treadmill row, bench presses, dumbbell rack, punching bag, mats,
// mirror wall, and a front desk by the door.
function furnishGym(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "black");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const alongX = door === "n" || door === "s";
  const back = opposite(door, x0, z0, w, d, 1.4);
  // Mirror wall on the back wall (opposite the door).
  if (alongX) put(boxes, back.x, 1.8, back.z, 8, 2.4, 0.15, "cyan");
  else put(boxes, back.x, 1.8, back.z, 0.15, 2.4, 8, "cyan");
  // Treadmill row along the east wall (door n/s) or north wall (door e/w).
  const treadBase = alongX ? { x: x0 + w - 3.4, zs: [cz - 6, cz, cz + 6] } : { x: 0, zs: [] as number[] };
  if (alongX) {
    for (const tz of treadBase.zs) {
      put(boxes, treadBase.x, 0.28, tz, 1.3, 0.5, 2.6, "black");
      put(boxes, treadBase.x, 1.0, tz - 1.15, 0.35, 1.1, 0.9, "black");
      put(boxes, treadBase.x, 1.35, tz - 1.15, 0.2, 0.35, 0.7, "cyanhot");
      cols.push(col(treadBase.x, 0.6, tz, 1.3, 1.2, 2.6));
    }
  } else {
    for (const tx of [cx - 6, cx, cx + 6]) {
      put(boxes, tx, 0.28, z0 + 3.4, 2.6, 0.5, 1.3, "black");
      put(boxes, tx - 1.15, 1.0, z0 + 3.4, 0.9, 1.1, 0.35, "black");
      put(boxes, tx - 1.15, 1.35, z0 + 3.4, 0.7, 0.35, 0.2, "cyanhot");
      cols.push(col(tx, 0.6, z0 + 3.4, 2.6, 1.2, 1.3));
    }
  }
  // Two bench presses in the middle.
  for (const bz of [cz - 3.2, cz + 3.2]) {
    put(boxes, cx - 3, 0.35, bz, 2.6, 0.45, 1.0, "stone");
    cols.push(col(cx - 3, 0.35, bz, 2.6, 0.45, 1.0));
    put(boxes, cx - 4.4, 0.6, bz, 0.18, 1.1, 0.18, "gray");
    put(boxes, cx - 1.6, 0.6, bz, 0.18, 1.1, 0.18, "gray");
    put(boxes, cx - 3, 1.18, bz, 3.4, 0.14, 0.14, "gold");
    put(boxes, cx - 4.7, 1.18, bz, 0.35, 0.35, 0.35, "black");
    put(boxes, cx - 1.3, 1.18, bz, 0.35, 0.35, 0.35, "black");
  }
  // Dumbbell rack along the west wall (door n/s) or south wall (door e/w).
  if (alongX) {
    const rx = x0 + 2.1;
    for (const rz of [cz - 4, cz + 4]) {
      put(boxes, rx, 0.55, rz, 1.0, 1.0, 5.4, "wood");
      cols.push(col(rx, 0.55, rz, 1.0, 1.0, 5.4));
      for (let i = 0; i < 4; i++) {
        put(boxes, rx, 1.15, rz - 2 + i * 1.35, 0.5, 0.3, 0.5, "gold");
      }
    }
  } else {
    const rz = z0 + d - 2.1;
    for (const rx of [cx - 4, cx + 4]) {
      put(boxes, rx, 0.55, rz, 5.4, 1.0, 1.0, "wood");
      cols.push(col(rx, 0.55, rz, 5.4, 1.0, 1.0));
      for (let i = 0; i < 4; i++) {
        put(boxes, rx - 2 + i * 1.35, 1.15, rz, 0.5, 0.3, 0.5, "gold");
      }
    }
  }
  // Punching bag hanging by the back wall + red training mats.
  const bag = alongX ? { x: cx + 6.5, z: back.z - (door === "n" ? 1.6 : -1.6) } : { x: back.x - (door === "w" ? 1.6 : -1.6), z: cz + 6.5 };
  put(boxes, bag.x, 3.1, bag.z, 0.12, 0.7, 0.12, "gray");
  put(boxes, bag.x, 1.85, bag.z, 0.85, 2.2, 0.85, "black");
  put(boxes, bag.x, 2.95, bag.z, 0.95, 0.18, 0.95, "red");
  cols.push(col(bag.x, 1.85, bag.z, 0.85, 2.2, 0.85));
  const matX = alongX ? cx + 5.5 : cx - 5.5;
  const matZ = alongX ? cz + 6 : cz - 6;
  put(boxes, matX, 0.15, matZ, alongX ? 5 : 6, 0.06, alongX ? 6 : 5, "red");
  // Front desk by the door, offset to the side so it never blocks the
  // doorway (the old opposite(door, w-4.6) spot sat in the door's path).
  const deskPos =
    door === "e" ? { x: x0 + w - 3, z: z0 + 5, sx: 1.2, sz: 3.4 }
    : door === "w" ? { x: x0 + 3, z: z0 + d - 5, sx: 1.2, sz: 3.4 }
    : door === "n" ? { x: x0 + 5, z: z0 + 3, sx: 3.4, sz: 1.2 }
    : { x: x0 + w - 5, z: z0 + d - 3, sx: 3.4, sz: 1.2 };
  put(boxes, deskPos.x, 0.55, deskPos.z, deskPos.sx, 1.05, deskPos.sz, "wood");
  cols.push(col(deskPos.x, 0.55, deskPos.z, deskPos.sx, 1.05, deskPos.sz));
  put(boxes, deskPos.x, 1.15, deskPos.z, deskPos.sx + 0.2, 0.12, deskPos.sz + 0.2, "gold");
  // Service point at the front desk; sign on a side wall, never over the
  // mirror wall.
  const serviceX = deskPos.x + (door === "e" ? -2 : door === "w" ? 2 : 0);
  const serviceZ = deskPos.z + (door === "n" ? 2 : door === "s" ? -2 : 0);
  const signPos =
    door === "n" || door === "s"
      ? { x: x0 + w - 1.35, z: door === "n" ? cz + 5 : cz - 5, rot: -Math.PI / 2 }
      : { x: door === "e" ? cx - 5 : cx + 5, z: z0 + 1.35, rot: 0 };
  return {
    id: "gym",
    name: "Harbor Gym",
    kind: "gym",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX,
    serviceZ,
    signX: signPos.x,
    signY: 2.35,
    signZ: signPos.z,
    signRot: signPos.rot,
  };
}

// ---- batch 2 venues: museum, hotel, casino, nightclub ----

// Museum: four exhibit pedestals (two per side wall), a timeline case down
// the middle, and a ticket desk by the door. Exhibit stand points live in
// content.ts (MUSEUM_EXHIBITS) — the pedestals here are 2 units behind
// those spots, so keep the two in sync if the museum ever moves.
function furnishMuseum(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "wood");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const artifacts: Mat[] = ["gold", "cyan", "red", "white"];
  const pedestals: Array<[number, number]> = [
    [x0 + 2.2, z0 + 4],
    [x0 + 2.2, z0 + d - 4],
    [x0 + w - 2.2, z0 + 4],
    [x0 + w - 2.2, z0 + d - 4],
  ];
  for (let i = 0; i < pedestals.length; i++) {
    const [px, pz] = pedestals[i];
    put(boxes, px, 0.5, pz, 1.1, 1.0, 1.1, "stone");
    cols.push(col(px, 0.5, pz, 1.1, 1.0, 1.1));
    put(boxes, px, 1.25, pz, 0.55, 0.5, 0.55, artifacts[i]);
    // Gold plaque on the room side of the plinth.
    const faceX = px + (px < cx ? 0.58 : -0.58);
    put(boxes, faceX, 0.75, pz, 0.08, 0.35, 0.6, "gold");
  }
  // Timeline case down the middle — clear of every exhibit stand point.
  put(boxes, cx, 0.5, cz, 5, 0.9, 1.4, "wood");
  cols.push(col(cx, 0.5, cz, 5, 0.9, 1.4));
  put(boxes, cx, 1.0, cz, 5.2, 0.1, 1.6, "gold");
  // Ticket desk centered on the north wall — NOT a door corner: both east
  // corners hold exhibit pedestals, and a desk there would swallow one.
  // Service point 2.5 in front of the desk, clear of every exhibit spot.
  put(boxes, cx, 0.55, z0 + 2.5, 3.4, 1.05, 1.2, "wood");
  cols.push(col(cx, 0.55, z0 + 2.5, 3.4, 1.05, 1.2));
  put(boxes, cx, 1.15, z0 + 2.5, 3.6, 0.12, 1.35, "stone");
  roomSign("museum", cx - 6, 2.2, z0 + 1.35, 0, 4.2, 1.7, ["ORBITX MUSEUM", "Four exhibits · +10 City Sol each"], "First view of each exhibit pays");
  const serviceX = cx;
  const serviceZ = z0 + 5;
  return {
    id: "museum",
    name: "OrbitX Museum",
    kind: "museum",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX,
    serviceZ,
    signX: cx - 6,
    signY: 2.35,
    signZ: z0 + 1.35,
    signRot: 0,
  };
}

// Hotel: front desk along the wall opposite the door, lobby armchairs,
// gold-framed room doors on the north wall, luggage cart by the door.
function furnishHotel(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "wood");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const desk = opposite(door, x0, z0, w, d, 2.4);
  const alongX = door === "n" || door === "s";
  // Front desk: a long wood counter on the wall opposite the door, gold
  // top trim, gold service bell.
  put(boxes, desk.x, 0.55, desk.z, alongX ? 6.4 : 1.2, 1.05, alongX ? 1.2 : 6.4, "wood");
  cols.push(col(desk.x, 0.55, desk.z, alongX ? 6.4 : 1.2, 1.05, alongX ? 1.2 : 6.4));
  put(boxes, desk.x, 1.15, desk.z, alongX ? 6.6 : 1.35, 0.12, alongX ? 1.35 : 6.6, "gold");
  put(boxes, desk.x, 1.3, desk.z, 0.3, 0.2, 0.3, "gold");
  // Lobby armchairs + a small table, clear of the desk service point.
  for (const az of [cz - 4, cz + 4]) {
    put(boxes, cx + 3, 0.45, az, 1.1, 0.45, 1.1, "red");
    put(boxes, cx + 3, 0.9, az + (az < cz ? -0.5 : 0.5), 1.1, 0.9, 0.25, "red");
    cols.push(col(cx + 3, 0.6, az, 1.3, 1.2, 1.3));
  }
  put(boxes, cx + 3, 0.4, cz, 1.0, 0.7, 1.0, "wood");
  cols.push(col(cx + 3, 0.4, cz, 1.0, 0.7, 1.0));
  // Gold-framed room doors on the north wall (decorative, flush — no
  // collider, so nobody gets stuck on a door that never opens).
  for (const dx of [cx - 4, cx, cx + 4]) {
    put(boxes, dx, 1.1, z0 + 1.3, 1.6, 2.2, 0.12, "gold");
    put(boxes, dx, 1.1, z0 + 1.32, 1.3, 1.9, 0.08, "black");
  }
  // Luggage cart by the door.
  const cart = door === "e" ? { x: x0 + w - 3.2, z: z0 + d - 3.2 } : door === "w" ? { x: x0 + 3.2, z: z0 + 3.2 } : door === "n" ? { x: x0 + w - 3.2, z: z0 + 3.2 } : { x: x0 + 3.2, z: z0 + d - 3.2 };
  put(boxes, cart.x, 0.4, cart.z, 1.2, 0.8, 0.8, "black");
  cols.push(col(cart.x, 0.4, cart.z, 1.2, 0.8, 0.8));
  put(boxes, cart.x, 0.85, cart.z, 1.3, 0.1, 0.9, "gold");
  roomSign("hotel", cx - 6, 2.2, z0 + d - 1.35, Math.PI, 4.2, 1.7, ["ORBITX HOTEL", "Stay the night · 20 City Sol"], "Rested: job pay +10% for 10 minutes");
  const serviceX = desk.x + (door === "e" ? 2.5 : door === "w" ? -2.5 : 0);
  const serviceZ = desk.z + (door === "n" ? 2.5 : door === "s" ? -2.5 : 0);
  return {
    id: "hotel",
    name: "OrbitX Hotel",
    kind: "hotel",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX,
    serviceZ,
    signX: cx - 6,
    signY: 2.35,
    signZ: z0 + d - 1.35,
    signRot: Math.PI,
  };
}

// Casino: slot machines along three walls, a gold roulette table in the
// middle, red carpet from the door. E at the table pulls the lever.
function furnishCasino(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "black");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const alongX = door === "n" || door === "s";
  // Red carpet runner from the door to the roulette table.
  if (alongX) put(boxes, cx, 0.145, cz, 2.4, 0.05, d - 6, "red");
  else put(boxes, cx, 0.145, cz, w - 6, 0.05, 2.4, "red");
  // Slot machine builder: black cabinet, gold top, colored face on the
  // room side. `face` is the axis the machine faces into the room.
  const machine = (mx: number, mz: number, face: "n" | "s" | "e" | "w", mat: Mat) => {
    const wide = face === "n" || face === "s";
    put(boxes, mx, 0.8, mz, wide ? 1.3 : 0.8, 1.6, wide ? 0.8 : 1.3, "black");
    cols.push(col(mx, 0.8, mz, wide ? 1.3 : 0.8, 1.6, wide ? 0.8 : 1.3));
    put(boxes, mx, 1.65, mz, wide ? 1.35 : 0.85, 0.15, wide ? 0.85 : 1.35, "gold");
    const fx = mx + (face === "e" ? 0.42 : face === "w" ? -0.42 : 0);
    const fz = mz + (face === "s" ? 0.42 : face === "n" ? -0.42 : 0);
    put(boxes, fx, 0.95, fz, wide ? 0.9 : 0.1, 0.7, wide ? 0.1 : 0.9, mat);
  };
  // Three machines on the wall opposite the door, two on each side wall.
  const opp = opposite(door, x0, z0, w, d, 1.5);
  const faceInto = door === "n" ? "n" : door === "s" ? "s" : door === "e" ? "e" : "w";
  const mats: Mat[] = ["red", "cyan", "warm", "red", "gold", "cyan", "warm"];
  if (alongX) {
    machine(cx - 4.5, opp.z, faceInto, mats[0]);
    machine(cx, opp.z, faceInto, mats[1]);
    machine(cx + 4.5, opp.z, faceInto, mats[2]);
    machine(x0 + 1.5, cz - 4, "e", mats[3]);
    machine(x0 + 1.5, cz + 4, "e", mats[4]);
    machine(x0 + w - 1.5, cz - 4, "w", mats[5]);
    machine(x0 + w - 1.5, cz + 4, "w", mats[6]);
  } else {
    machine(opp.x, cz - 4.5, faceInto, mats[0]);
    machine(opp.x, cz, faceInto, mats[1]);
    machine(opp.x, cz + 4.5, faceInto, mats[2]);
    machine(cx - 4, z0 + 1.5, "s", mats[3]);
    machine(cx + 4, z0 + 1.5, "s", mats[4]);
    machine(cx - 4, z0 + d - 1.5, "n", mats[5]);
    machine(cx + 4, z0 + d - 1.5, "n", mats[6]);
  }
  // Roulette table: gold rim, black wheel, white ball.
  disc(boxes, cx, 0.55, cz, 2.2, 0.5, "gold");
  disc(boxes, cx, 0.62, cz, 1.6, 0.4, "black");
  put(boxes, cx, 0.85, cz, 0.3, 0.2, 0.3, "white");
  cols.push(col(cx, 0.55, cz, 4.4, 1.1, 4.4));
  roomSign("casino", x0 + w - 1.35, 2.2, cz, -Math.PI / 2, 4.2, 1.7, ["NEON CASINO", "Slots · 5 City Sol a pull"], "E at the table pulls the lever");
  // Service point in front of the table, on the door side.
  const serviceX = cx + (door === "e" ? 3.4 : door === "w" ? -3.4 : 0);
  const serviceZ = cz + (door === "s" ? 3.4 : door === "n" ? -3.4 : 0);
  return {
    id: "casino",
    name: "Neon Casino",
    kind: "casino",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX,
    serviceZ,
    signX: x0 + w - 1.35,
    signY: 2.35,
    signZ: cz,
    signRot: -Math.PI / 2,
  };
}

// Nightclub: checkerboard dance floor in the middle, DJ booth + speaker
// stacks on the wall opposite the door, bar along a side wall, neon strips.
function furnishNightclub(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "black");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  // Dance floor: 4x4 checkerboard tiles, 1.5 each.
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      put(boxes, cx - 2.25 + i * 1.5, 0.12, cz - 2.25 + j * 1.5, 1.5, 0.06, 1.5, (i + j) % 2 === 0 ? "white" : "black");
    }
  }
  // DJ booth on the wall opposite the door + speaker stacks flanking it.
  const booth = opposite(door, x0, z0, w, d, 1.5);
  const alongX = door === "n" || door === "s";
  put(boxes, booth.x, 0.6, booth.z, alongX ? 4.2 : 1.0, 1.2, alongX ? 1.0 : 4.2, "black");
  cols.push(col(booth.x, 0.6, booth.z, alongX ? 4.2 : 1.0, 1.2, alongX ? 1.0 : 4.2));
  put(boxes, booth.x, 1.25, booth.z, alongX ? 4.2 : 1.0, 0.12, alongX ? 1.0 : 4.2, "cyan");
  for (const off of [-3.2, 3.2]) {
    const sx = alongX ? booth.x + off : booth.x;
    const sz = alongX ? booth.z : booth.z + off;
    put(boxes, sx, 1.3, sz, 1.0, 2.6, 1.0, "black");
    cols.push(col(sx, 1.3, sz, 1.0, 2.6, 1.0));
    put(boxes, sx, 1.9, sz, 1.05, 0.5, 1.05, "gold");
  }
  // Bar along a side wall: wood counter + gold stools.
  const barX = door === "n" || door === "s" ? x0 + w - 1.5 : cx + 5;
  const barZ = door === "n" || door === "s" ? cz : z0 + d - 1.5;
  const barAlongX = door === "n" || door === "s";
  put(boxes, barX, 0.55, barZ, barAlongX ? 1.2 : 6.4, 1.05, barAlongX ? 6.4 : 1.2, "wood");
  cols.push(col(barX, 0.55, barZ, barAlongX ? 1.2 : 6.4, 1.05, barAlongX ? 6.4 : 1.2));
  for (const off of [-2, 0, 2]) {
    const stx = barAlongX ? barX - 1.2 : barX + off;
    const stz = barAlongX ? barZ + off : barZ - 1.2;
    put(boxes, stx, 0.3, stz, 0.5, 0.6, 0.5, "gold");
  }
  // Neon strips above the booth and above the bar (never over a sign —
  // the west wall carries the club sign, so its strip lives east).
  put(boxes, booth.x, 2.8, booth.z + (door === "n" ? 0.14 : door === "s" ? -0.14 : 0), alongX ? 8 : 0.15, 0.18, alongX ? 0.15 : 8, "cyanhot");
  put(boxes, x0 + w - 1.3, 2.8, cz, 0.15, 0.18, 8, "cyanhot");
  roomSign("club", x0 + 1.35, 2.2, cz + 5, Math.PI / 2, 4.2, 1.7, ["CLUB ORBIT", "Dance sets · DJ booth at the back"], "E at the booth starts a set");
  // Service point in front of the DJ booth.
  const serviceX = booth.x + (door === "e" ? -2.5 : door === "w" ? 2.5 : 0);
  const serviceZ = booth.z + (door === "n" ? -2.5 : door === "s" ? 2.5 : 0);
  return {
    id: "nightclub",
    name: "Club Orbit",
    kind: "nightclub",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX,
    serviceZ,
    signX: x0 + 1.35,
    signY: 2.35,
    signZ: cz + 5,
    signRot: Math.PI / 2,
  };
}

// Sunset Park: an open waterfront green space — pond with a stone rim,
// crossing stone paths, benches, trees, lamps, flower beds, gold gate
// bollards. No walls or roof: the zone is the lawn itself.
function addSunsetPark(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number): Zone {
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  put(boxes, cx, 0.08, cz, w - 1, 0.14, d - 1, "grass");
  // Stone cross paths.
  put(boxes, cx, 0.17, cz, w - 2, 0.05, 2.2, "stone");
  put(boxes, cx, 0.17, cz, 2.2, 0.05, d - 2, "stone");
  // Pond with a stone rim, west of center; the rim keeps players out.
  const px = cx - 9;
  const pz = cz - 1;
  disc(boxes, px, 0.22, pz, 5.2, 0.3, "stone");
  disc(boxes, px, 0.36, pz, 4.5, 0.22, "water");
  cols.push({ minX: px - 5.2, maxX: px + 5.2, minY: 0, maxY: 1, minZ: pz - 5.2, maxZ: pz + 5.2 });
  // Benches facing the pond + along the paths.
  addBench(boxes, cols, px + 7.5, pz - 3, true);
  addBench(boxes, cols, px + 7.5, pz + 3, true);
  addBench(boxes, cols, cx + 8, cz - 6.5, false);
  addBench(boxes, cols, cx + 8, cz + 6.5, false);
  addBench(boxes, cols, cx - 18, cz + 6.5, false);
  // Trees and lamps, clear of the paths and the pond.
  addTree(boxes, cols, x0 + 6, z0 + 5, 0.1);
  addTree(boxes, cols, x0 + w - 6, z0 + 5, 0.1);
  addTree(boxes, cols, x0 + 6, z0 + d - 5, 0.1);
  addTree(boxes, cols, x0 + w - 6, z0 + d - 5, 0.1);
  addTree(boxes, cols, cx + 16, cz - 8, 0.1);
  addTree(boxes, cols, cx - 20, cz - 8, 0.1);
  addLamp(boxes, cx - 12, cz - 7);
  addLamp(boxes, cx + 12, cz - 7);
  addLamp(boxes, cx - 12, cz + 7);
  addLamp(boxes, cx + 12, cz + 7);
  // Flower beds along the north path.
  for (const fx of [cx - 16, cx - 8, cx + 4, cx + 16]) {
    for (let i = 0; i < 3; i++) {
      put(boxes, fx - 0.8 + i * 0.8, 0.35, z0 + 2.6, 0.5, 0.4, 0.5, i === 1 ? "gold" : "red");
    }
  }
  // Gold gate bollards flanking the north entrance.
  for (const bx of [cx - 3, cx + 3]) {
    put(boxes, bx, 0.35, z0 - 1, 0.5, 0.7, 0.5, "gold");
    cols.push(col(bx, 0.35, z0 - 1, 0.5, 0.7, 0.5));
  }
  // Posts under the freestanding gate sign (the sign plane floats at
  // y 1.55..3.25, so it needs legs).
  for (const px of [cx - 1.8, cx + 1.8]) {
    put(boxes, px, 0.85, z0 - 0.2, 0.16, 1.7, 0.16, "black");
  }
  return {
    id: "park",
    name: "Sunset Park",
    kind: "park",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: cx,
    serviceZ: cz,
    signX: cx,
    signY: 2.4,
    signZ: z0 - 0.2,
    signRot: Math.PI,
  };
}

// OrbitX Stadium: an open-air arena — stone sprint track down the middle
// (white start line, gold finish line), tiered stone stands along both
// long sides, floodlights at the corners, gold gate sign at the north
// entrance. No walls or roof: the zone is the field itself, like the park.
// The sprint runs west→east on the track; its start/finish live in
// content.ts (STADIUM_START / STADIUM_FINISH_X) — keep them in sync.
function addStadium(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number): Zone {
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  put(boxes, cx, 0.08, cz, w - 1, 0.14, d - 1, "grass");
  // Sprint track: a stone lane down the middle, white start line at the
  // west end, gold finish line at the east end.
  put(boxes, cx, 0.17, cz, w - 4, 0.05, 4, "stone");
  put(boxes, x0 + 3, 0.22, cz, 0.6, 0.06, 4, "white");
  put(boxes, x0 + w - 3, 0.22, cz, 0.6, 0.06, 4, "gold");
  // Tiered stands along both long sides: three stone steps rising away
  // from the track. The steps are colliders — the crowd sits, players run.
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 3; tier++) {
      const tz = cz + side * (4.5 + tier * 1.6);
      const th = 0.55 * (tier + 1);
      put(boxes, cx, th / 2, tz, w - 6, th, 1.6, "stone");
      cols.push(col(cx, th / 2, tz, w - 6, th, 1.6));
    }
    // Gold trim on the top tier.
    put(boxes, cx, 0.55 * 3 + 0.06, cz + side * (4.5 + 2 * 1.6), w - 6, 0.12, 1.6, "gold");
  }
  // Floodlights at the four corners: tall black poles, warm heads.
  for (const [fx, fz] of [[x0 + 2, z0 + 2], [x0 + w - 2, z0 + 2], [x0 + 2, z0 + d - 2], [x0 + w - 2, z0 + d - 2]] as Array<[number, number]>) {
    put(boxes, fx, 3.5, fz, 0.4, 7, 0.4, "black");
    cols.push(col(fx, 3.5, fz, 0.4, 7, 0.4));
    put(boxes, fx, 7.2, fz, 1.2, 0.5, 1.2, "warm");
  }
  // Gold gate bollards flanking the north entrance + posts under the sign.
  for (const bx of [cx - 3, cx + 3]) {
    put(boxes, bx, 0.35, z0 - 1, 0.5, 0.7, 0.5, "gold");
    cols.push(col(bx, 0.35, z0 - 1, 0.5, 0.7, 0.5));
  }
  for (const px of [cx - 1.8, cx + 1.8]) {
    put(boxes, px, 0.85, z0 - 0.2, 0.16, 1.7, 0.16, "black");
  }
  return {
    id: "stadium",
    name: "OrbitX Stadium",
    kind: "stadium",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    // Service point = the start line: E there starts the sprint.
    serviceX: x0 + 3,
    serviceZ: cz,
    signX: cx,
    signY: 2.4,
    signZ: z0 - 0.2,
    signRot: Math.PI,
  };
}

// ---- finished interiors: shared helpers ----

// A solid wall run along X with a door gap (colliders + visual), at elevation y0.
function wallRunX(boxes: Box[], cols: Collider[], x0: number, x1: number, y0: number, z: number, h: number, mat: Mat, doorAt: number, doorW: number) {
  const t = 0.3;
  if (doorW > 0) {
    const g0 = doorAt - doorW / 2;
    const g1 = doorAt + doorW / 2;
    if (g0 - x0 > 0.05) {
      put(boxes, (x0 + g0) / 2, y0 + h / 2, z, g0 - x0, h, t, mat);
      cols.push({ minX: x0, maxX: g0, minY: y0, maxY: y0 + h, minZ: z - t / 2, maxZ: z + t / 2 });
    }
    if (x1 - g1 > 0.05) {
      put(boxes, (g1 + x1) / 2, y0 + h / 2, z, x1 - g1, h, t, mat);
      cols.push({ minX: g1, maxX: x1, minY: y0, maxY: y0 + h, minZ: z - t / 2, maxZ: z + t / 2 });
    }
    put(boxes, doorAt, y0 + 2.6 + (h - 2.6) / 2, z, doorW, h - 2.6, t, mat);
    cols.push({ minX: g0, maxX: g1, minY: y0 + 2.6, maxY: y0 + h, minZ: z - t / 2, maxZ: z + t / 2 });
  } else {
    put(boxes, (x0 + x1) / 2, y0 + h / 2, z, x1 - x0, h, t, mat);
    cols.push({ minX: x0, maxX: x1, minY: y0, maxY: y0 + h, minZ: z - t / 2, maxZ: z + t / 2 });
  }
}

// A solid wall run along Z with a door gap, at elevation y0.
function wallRunZ(boxes: Box[], cols: Collider[], z0: number, z1: number, y0: number, x: number, h: number, mat: Mat, doorAt: number, doorW: number) {
  const t = 0.3;
  if (doorW > 0) {
    const g0 = doorAt - doorW / 2;
    const g1 = doorAt + doorW / 2;
    if (g0 - z0 > 0.05) {
      put(boxes, x, y0 + h / 2, (z0 + g0) / 2, t, h, g0 - z0, mat);
      cols.push({ minX: x - t / 2, maxX: x + t / 2, minY: y0, maxY: y0 + h, minZ: z0, maxZ: g0 });
    }
    if (z1 - g1 > 0.05) {
      put(boxes, x, y0 + h / 2, (g1 + z1) / 2, t, h, z1 - g1, mat);
      cols.push({ minX: x - t / 2, maxX: x + t / 2, minY: y0, maxY: y0 + h, minZ: g1, maxZ: z1 });
    }
    put(boxes, x, y0 + 2.6 + (h - 2.6) / 2, doorAt, t, h - 2.6, doorW, mat);
    cols.push({ minX: x - t / 2, maxX: x + t / 2, minY: y0 + 2.6, maxY: y0 + h, minZ: g0, maxZ: g1 });
  } else {
    put(boxes, x, y0 + h / 2, (z0 + z1) / 2, t, h, z1 - z0, mat);
    cols.push({ minX: x - t / 2, maxX: x + t / 2, minY: y0, maxY: y0 + h, minZ: z0, maxZ: z1 });
  }
}

// A floor slab at elevation y0 (walking surface at y0) with rectangular holes
// (lift shaft, stairwell). Emitted as a set of boxes that avoid the holes.
function slabWithHoles(boxes: Box[], cols: Collider[], x0: number, y0: number, z0: number, w: number, d: number, holes: Array<[number, number, number, number]>, mat: Mat) {
  let rects: Array<[number, number, number, number]> = [[x0, z0, x0 + w, z0 + d]];
  for (const [hx0, hz0, hx1, hz1] of holes) {
    const next: Array<[number, number, number, number]> = [];
    for (const [a0, b0, a1, b1] of rects) {
      if (hx1 <= a0 || hx0 >= a1 || hz1 <= b0 || hz0 >= b1) {
        next.push([a0, b0, a1, b1]);
        continue;
      }
      if (hx0 > a0) next.push([a0, b0, hx0, b1]);
      if (hx1 < a1) next.push([hx1, b0, a1, b1]);
      const cx0 = Math.max(a0, hx0);
      const cx1 = Math.min(a1, hx1);
      if (hz0 > b0) next.push([cx0, b0, cx1, hz0]);
      if (hz1 < b1) next.push([cx0, hz1, cx1, b1]);
    }
    rects = next;
  }
  for (const [a0, b0, a1, b1] of rects) {
    if (a1 - a0 < 0.05 || b1 - b0 < 0.05) continue;
    put(boxes, (a0 + a1) / 2, y0 - 0.15, (b0 + b1) / 2, a1 - a0, 0.3, b1 - b0, mat);
    cols.push({ minX: a0, maxX: a1, minY: y0 - 0.3, maxY: y0, minZ: b0, maxZ: b1 });
  }
}

// Pendant lights hanging from the slab above (ceilingY), over a floor.
function hangLights(boxes: Box[], cx: number, ceilingY: number, cz: number, w: number, d: number) {
  const xs = w > 30 ? [-w / 4, 0, w / 4] : [-w / 5, w / 5];
  const zs = d > 30 ? [-d / 4, 0, d / 4] : [-d / 5, d / 5];
  for (const dx of xs) {
    for (const dz of zs) {
      put(boxes, cx + dx, ceilingY - 0.6, cz + dz, 0.12, 0.55, 0.12, "gray");
      put(boxes, cx + dx, ceilingY - 0.92, cz + dz, 0.55, 0.16, 0.55, "warm");
    }
  }
}

// A framed abstract painting on a wall: gold frame + three colored panels.
// rotY rotates the painting's facing (0 = faces +z, PI/2 = faces +x).
function voxelPainting(boxes: Box[], x: number, y: number, z: number, rotY: number, w: number, h: number) {
  const nx = Math.sin(rotY);
  const nz = Math.cos(rotY);
  const alongX = Math.abs(nz) > 0.5;
  const t = 0.12;
  if (alongX) {
    put(boxes, x, y, z, w + 0.3, h + 0.3, t, "gold");
    put(boxes, x - w * 0.22, y + h * 0.1, z + nz * 0.1, w * 0.42, h * 0.5, 0.06, "cyan");
    put(boxes, x + w * 0.2, y - h * 0.12, z + nz * 0.1, w * 0.38, h * 0.42, 0.06, "warm");
    put(boxes, x + w * 0.05, y + h * 0.28, z + nz * 0.1, w * 0.24, h * 0.24, 0.06, "red");
  } else {
    put(boxes, x, y, z, t, h + 0.3, w + 0.3, "gold");
    put(boxes, x + nx * 0.1, y + h * 0.1, z - w * 0.22, 0.06, h * 0.5, w * 0.42, "cyan");
    put(boxes, x + nx * 0.1, y - h * 0.12, z + w * 0.2, 0.06, h * 0.42, w * 0.38, "warm");
    put(boxes, x + nx * 0.1, y + h * 0.28, z + w * 0.05, 0.06, h * 0.24, w * 0.24, "red");
  }
}

function roomSign(id: string, x: number, y: number, z: number, rotY: number, w: number, h: number, lines: string[], sub: string) {
  art.push({ id, x, y, z, rotY, w, h, lines, sub });
}

// The anchor a player presses E on to step inside a venue: just outside the
// front door, facing in.
function doorAnchor(id: string, name: string, kind: Anchor["kind"], x0: number, z0: number, w: number, d: number, door: Face, slot = 0): Anchor {
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  if (door === "n") return { id, name, kind, x: cx, y: 0, z: z0 - 1.4, yaw: Math.PI, slot };
  if (door === "s") return { id, name, kind, x: cx, y: 0, z: z0 + d + 1.4, yaw: 0, slot };
  if (door === "w") return { id, name, kind, x: x0 - 1.4, y: 0, z: cz, yaw: Math.PI / 2, slot };
  return { id, name, kind, x: x0 + w + 1.4, y: 0, z: cz, yaw: -Math.PI / 2, slot };
}

// A furnished home: living room (sofa, rug, TV, paintings), kitchenette,
// bedroom nook. Ground floor only, like the other venues.
function furnishHome(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, door: Face, index: number): Zone {
  const { cx, cz } = roomCenter(x0, z0, w, d);
  put(boxes, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "wood");
  addCeiling(boxes, cols, x0, z0, w, d);
  cladWalls(boxes, x0, z0, w, d, door);
  const back = opposite(door, x0, z0, w, d, 2.4);
  const alongX = door === "n" || door === "s";
  // Living room: sofa + coffee table + rug, facing the TV on the far wall.
  const tv = opposite(door, x0, z0, w, d, 1.35);
  put(boxes, tv.x, 1.5, tv.z, alongX ? 3.6 : 0.2, 2, alongX ? 0.2 : 3.6, "black");
  put(boxes, tv.x, 1.5, tv.z, alongX ? 3.2 : 0.1, 1.6, alongX ? 0.1 : 3.2, "cyan");
  put(boxes, cx, 0.12, cz, alongX ? 5 : 3.6, 0.05, alongX ? 3.6 : 5, "red");
  if (alongX) {
    // TV is on the far wall (south for door n, north for door s); sofa sits
    // on the door side of center, facing the TV.
    const s = door === "s" ? 1 : -1;
    put(boxes, cx, 0.38, cz + s * 1.5, 3.4, 0.45, 1.1, "red");
    cols.push(col(cx, 0.38, cz + s * 1.5, 3.4, 0.45, 1.1));
    put(boxes, cx, 0.85, cz + s * 2.05, 3.4, 0.7, 0.2, "red");
    put(boxes, cx, 0.4, cz - s * 0.3, 1.6, 0.35, 0.9, "wood");
    cols.push(col(cx, 0.4, cz - s * 0.3, 1.6, 0.35, 0.9));
  } else {
    const s = door === "e" ? 1 : -1;
    put(boxes, cx + s * 1.5, 0.38, cz, 1.1, 0.45, 3.4, "red");
    cols.push(col(cx + s * 1.5, 0.38, cz, 1.1, 0.45, 3.4));
    put(boxes, cx + s * 2.05, 0.85, cz, 0.2, 0.7, 3.4, "red");
    put(boxes, cx - s * 0.3, 0.4, cz, 0.9, 0.35, 1.6, "wood");
    cols.push(col(cx - s * 0.3, 0.4, cz, 0.9, 0.35, 1.6));
  }
  // Kitchenette along the back wall: counter + cabinets + fridge.
  const kx = alongX ? cx + 5 : back.x;
  const kz = alongX ? back.z : cz + 5;
  put(boxes, kx, 0.55, kz, alongX ? 4.6 : 1.1, 1.05, alongX ? 1.1 : 4.6, "stone");
  cols.push(col(kx, 0.55, kz, alongX ? 4.6 : 1.1, 1.05, alongX ? 1.1 : 4.6));
  put(boxes, kx, 1.2, kz, alongX ? 4.8 : 1.2, 0.14, alongX ? 1.2 : 4.8, "wood");
  put(boxes, alongX ? kx + 2.8 : kx, 1.0, alongX ? kz : kz + 2.8, 0.9, 2, 0.9, "white");
  cols.push(col(alongX ? kx + 2.8 : kx, 1.0, alongX ? kz : kz + 2.8, 0.9, 2, 0.9));
  // Bedroom nook: bed + nightstand.
  const bedX = x0 + w - 3.4;
  const bedZ = z0 + d - 3.4;
  put(boxes, bedX, 0.35, bedZ, 2.4, 0.55, 3.4, "wood");
  cols.push(col(bedX, 0.35, bedZ, 2.4, 0.55, 3.4));
  put(boxes, bedX, 0.7, bedZ, 2.2, 0.22, 3.2, "white");
  put(boxes, bedX, 0.85, bedZ - 1.4, 1.6, 0.3, 0.5, "red");
  put(boxes, bedX + 1.6, 0.4, bedZ + 1.6, 0.6, 0.7, 0.6, "black");
  // Paintings on the side walls + a plant by the door.
  const side = opposite(door, x0, z0, w, d, 1.4);
  voxelPainting(boxes, alongX ? cx + 6 : x0 + 1.3, 1.9, alongX ? z0 + 1.3 : cz + 6, alongX ? 0 : Math.PI / 2, 2.2, 1.5);
  voxelPainting(boxes, alongX ? cx - 6 : x0 + w - 1.3, 1.9, alongX ? z0 + d - 1.3 : cz - 6, alongX ? Math.PI : -Math.PI / 2, 2.2, 1.5);
  put(boxes, side.x, 0.5, side.z, 0.7, 0.9, 0.7, "leavesDark");
  cols.push(col(side.x, 0.5, side.z, 0.7, 0.9, 0.7));
  const service = opposite(door, x0, z0, w, d, 4.1);
  return {
    id: `home-${index}`,
    name: `Home ${index + 1}`,
    kind: "hall",
    slot: index,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: service.x,
    serviceZ: service.z,
    signX: back.x + (door === "w" ? -0.55 : door === "e" ? 0.55 : 0),
    signY: 2.35,
    signZ: back.z + (door === "n" ? -0.55 : door === "s" ? 0.55 : 0),
    signRot: back.rot,
  };
}

function addHome(
  boxes: Box[],
  cols: Collider[],
  x0: number,
  z0: number,
  w: number,
  d: number,
  h: number,
  door: Face,
  index: number,
  rng: Rng,
): { zone: Zone; anchor: Anchor } {
  const style = index % 2 === 0 ? 1 : 3;
  // A real house: pitched roof (ridge along the street), a porch over the
  // door, a chimney, and sometimes a side annex — no two alike.
  const roof: "gable" | "hip" = rng() < 0.6 ? "gable" : "hip";
  const roofMat = Math.floor(rng() * 3);
  const porch = rng() < 0.65;
  const chimney = rng() < 0.5;
  // The annex is carved out of the house's own rect (L-shaped plan), so the
  // furnished interior (which needs w>=18, d>=18) stays intact.
  let hx = x0;
  let hz = z0;
  let hw = w;
  let hd = d;
  let wing: Wing | undefined;
  if (rng() < 0.4) {
    const planned = planWing({ x: hx, z: hz, w: hw, d: hd }, door, style, rng, 18);
    if (planned) {
      const rect = { x: hx, z: hz, w: hw, d: hd };
      wing = applyWing(planned, rect, door, cols);
      hx = rect.x;
      hz = rect.z;
      hw = rect.w;
      hd = rect.d;
    }
  }
  shellOpen(
    boxes,
    cols,
    hx,
    0,
    hz,
    hw,
    h,
    hd,
    (u, ly, face, len) => (hole(face, door, u, ly, len) ? "air" : facadeSample(style, len)(u, ly)),
    "black",
    door,
  );
  addAwning(boxes, hx, hz, hw, hd, door);
  const facade: Facade = {
    id: `home-${index}`,
    x: hx,
    z: hz,
    w: hw,
    d: hd,
    h,
    style,
    door,
    enterable: true,
    hero: false,
    face: door,
    roof,
    roofDir: door,
    roofMat,
    porch,
    chimney,
    wing,
  };
  if (porch) {
    // Porch posts are solid; the slab is a visual-only 0.18 step.
    for (const p of porchPosts(facade)) cols.push(col(p.x, 1.3, p.z, 0.3, 2.6, 0.3));
  }
  facades.push(facade);
  const zone = furnishHome(boxes, cols, hx, hz, hw, hd, door, index);
  const anchor = doorAnchor(`home-${index}`, `Home ${index + 1}`, "hall", hx, hz, hw, hd, door, index);
  return { zone, anchor };
}

// ---- mega mall + mega office ----

const MALL_FLOOR2 = 5;
const MALL_ROOF = 9.5;
const OFFICE_FLOORS = [0, 8, 12, 16, 20];
const OFFICE_STOPS = ["Lobby", "Floor 2", "Floor 3", "Floor 4", "Roof Terrace"];

// A glass lift shaft: glass walls + cap, with a door opening on each floor's
// landing side. The opening is blocked by one solid (invisible) collider per
// floor so nobody can step into the void; the cab door panel is a runtime mesh.
function buildGlassShaft(boxes: Box[], cols: Collider[], liftId: string, x0: number, z0: number, w: number, d: number, capY: number, floors: number[], landing: Face) {
  const doorW = 2.4;
  for (const face of ["n", "s", "w", "e"] as Face[]) {
    const isLanding = face === landing;
    const alongX = face === "n" || face === "s";
    const mid = alongX ? x0 + w / 2 : z0 + d / 2;
    const g0 = mid - doorW / 2;
    const g1 = mid + doorW / 2;
    const panel = (a0: number, a1: number, y0: number, y1: number) => {
      if (a1 - a0 < 0.05 || y1 - y0 < 0.05) return;
      if (alongX) {
        const z = face === "n" ? z0 : z0 + d;
        // White, not cyan: an opaque cyan wall filled the cab view from
        // inside (cyan wash). The cab's own glass stays tinted.
        put(boxes, (a0 + a1) / 2, (y0 + y1) / 2, z, a1 - a0, y1 - y0, 0.15, "white");
        cols.push({ minX: a0, maxX: a1, minY: y0, maxY: y1, minZ: z - 0.075, maxZ: z + 0.075 });
      } else {
        const x = face === "w" ? x0 : x0 + w;
        put(boxes, x, (y0 + y1) / 2, (a0 + a1) / 2, 0.15, y1 - y0, a1 - a0, "white");
        cols.push({ minX: x - 0.075, maxX: x + 0.075, minY: y0, maxY: y1, minZ: a0, maxZ: a1 });
      }
    };
    if (!isLanding) {
      panel(alongX ? x0 : z0, alongX ? x0 + w : z0 + d, 0, capY);
    } else {
      panel(alongX ? x0 : z0, g0, 0, capY);
      panel(g1, alongX ? x0 + w : z0 + d, 0, capY);
      for (let i = 0; i < floors.length; i++) {
        const y0 = floors[i] + 3;
        const y1 = i + 1 < floors.length ? floors[i + 1] : capY;
        panel(g0, g1, y0, y1);
      }
      for (let i = 0; i < floors.length; i++) {
        const f = floors[i];
        if (alongX) {
          const z = face === "n" ? z0 : z0 + d;
          cols.push({ minX: g0, maxX: g1, minY: f, maxY: f + 3, minZ: z - 0.075, maxZ: z + 0.075, tag: `lift-door:${liftId}:${i}` });
        } else {
          const x = face === "w" ? x0 : x0 + w;
          cols.push({ minX: x - 0.075, maxX: x + 0.075, minY: f, maxY: f + 3, minZ: g0, maxZ: g1, tag: `lift-door:${liftId}:${i}` });
        }
      }
    }
  }
  put(boxes, x0 + w / 2, capY + 0.1, z0 + d / 2, w + 0.4, 0.2, d + 0.4, "cyan");
  put(boxes, x0 + w / 2, capY + 0.35, z0 + d / 2, 0.5, 0.4, 0.5, "gold");
}

// A staircase along +z: 10 steps, each 0.5 high and 2 deep, spanning the
// full stairwell width. The 0.5 step-up in the engine makes it walkable.
function buildStairs(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, y0: number, y1: number) {
  const steps = Math.round((y1 - y0) / 0.5);
  for (let i = 0; i < steps; i++) {
    const top = y0 + 0.5 * (i + 1);
    put(boxes, x0 + w / 2, top - 0.25, z0 + i * 2 + 1, w, 0.5, 2, "stone");
    cols.push({ minX: x0, maxX: x0 + w, minY: y0, maxY: top, minZ: z0 + i * 2, maxZ: z0 + (i + 1) * 2 });
    // Stepped railing on the open (west) side.
    put(boxes, x0 + 0.1, top + 0.55, z0 + i * 2 + 1, 0.15, 1.1, 2, "gold");
    cols.push({ minX: x0, maxX: x0 + 0.2, minY: top, maxY: top + 1.1, minZ: z0 + i * 2, maxZ: z0 + (i + 1) * 2 });
  }
}

// One mall shopfront: counter + shelves + goods + a wall sign above.
// rotY rotates the sign's facing (PI = faces -z, 0 = faces +z).
function mallShop(boxes: Box[], cols: Collider[], x: number, y0: number, z: number, w: number, alongX: boolean, rotY: number, lines: string[], sub: string, goods: Mat) {
  // Counter + two shelves against the wall, goods on top.
  if (alongX) {
    put(boxes, x, y0 + 0.55, z, w - 1, 1.05, 1.1, "wood");
    cols.push(col(x, y0 + 0.55, z, w - 1, 1.05, 1.1));
    put(boxes, x - (w - 1) / 4, y0 + 1.2, z + 0.4, (w - 1) / 2, 0.14, 0.9, "stone");
    put(boxes, x + (w - 1) / 4, y0 + 1.2, z + 0.4, (w - 1) / 2, 0.14, 0.9, "stone");
    put(boxes, x - (w - 1) / 4, y0 + 1.5, z + 0.4, (w - 1) / 2 - 0.4, 0.55, 0.7, goods);
    put(boxes, x + (w - 1) / 4, y0 + 1.5, z + 0.4, (w - 1) / 2 - 0.4, 0.55, 0.7, "cyan");
  } else {
    put(boxes, x, y0 + 0.55, z, 1.1, 1.05, w - 1, "wood");
    cols.push(col(x, y0 + 0.55, z, 1.1, 1.05, w - 1));
    put(boxes, x + 0.4, y0 + 1.2, z - (w - 1) / 4, 0.9, 0.14, (w - 1) / 2, "stone");
    put(boxes, x + 0.4, y0 + 1.2, z + (w - 1) / 4, 0.9, 0.14, (w - 1) / 2, "stone");
    put(boxes, x + 0.4, y0 + 1.5, z - (w - 1) / 4, 0.7, 0.55, (w - 1) / 2 - 0.4, goods);
    put(boxes, x + 0.4, y0 + 1.5, z + (w - 1) / 4, 0.7, 0.55, (w - 1) / 2 - 0.4, "cyan");
  }
  roomSign(`mall-shop-${x}-${z}-${y0}`, x, y0 + 2.6, z, rotY, Math.min(6, w - 1.5), 1.2, lines, sub);
}

// Food court: four tables with chairs.
function foodCourt(boxes: Box[], cols: Collider[], x0: number, y0: number, z0: number, x1: number, z1: number) {
  for (const [tx, tz] of [[x0 + 3, z0 + 3], [x1 - 3, z0 + 3], [x0 + 3, z1 - 3], [x1 - 3, z1 - 3]]) {
    put(boxes, tx, y0 + 0.45, tz, 2, 0.1, 2, "wood");
    put(boxes, tx, y0 + 0.22, tz, 0.3, 0.4, 0.3, "black");
    cols.push(col(tx, y0 + 0.5, tz, 1.6, 0.9, 1.6));
    for (const [cx2, cz2] of [[tx - 1.6, tz], [tx + 1.6, tz], [tx, tz - 1.6], [tx, tz + 1.6]]) {
      put(boxes, cx2, y0 + 0.3, cz2, 0.7, 0.5, 0.7, "red");
      cols.push(col(cx2, y0 + 0.3, cz2, 0.7, 0.5, 0.7));
    }
  }
}

// A row of desks: tops, legs, glowing screens.
function deskRow(boxes: Box[], cols: Collider[], x0: number, y0: number, z: number, n: number, spacing: number, alongX: boolean) {
  for (let i = 0; i < n; i++) {
    const px = alongX ? x0 + i * spacing : x0;
    const pz = alongX ? z : z + i * spacing;
    put(boxes, px, y0 + 0.4, pz, 1.8, 0.08, 0.9, "wood");
    put(boxes, px, y0 + 0.2, pz, 0.2, 0.4, 0.7, "black");
    cols.push(col(px, y0 + 0.45, pz, 1.8, 0.8, 0.9));
    put(boxes, px, y0 + 1.0, pz - 0.22, 0.9, 0.6, 0.08, "cyan");
    put(boxes, px, y0 + 0.25, pz + 0.55, 0.6, 0.45, 0.6, "gray");
  }
}

// A meeting room: big table, chairs, wall screen.
function meetingTable(boxes: Box[], cols: Collider[], cx: number, y0: number, cz: number, w: number, d: number) {
  put(boxes, cx, y0 + 0.45, cz, w, 0.1, d, "wood");
  put(boxes, cx, y0 + 0.22, cz, 0.4, 0.4, 0.4, "black");
  cols.push(col(cx, y0 + 0.5, cz, w, 0.9, d));
  for (let i = 0; i < 3; i++) {
    put(boxes, cx - w / 2 + 1 + i * (w / 3), y0 + 0.3, cz - d / 2 - 0.9, 0.7, 0.5, 0.7, "red");
    cols.push(col(cx - w / 2 + 1 + i * (w / 3), y0 + 0.3, cz - d / 2 - 0.9, 0.7, 0.5, 0.7));
    put(boxes, cx - w / 2 + 1 + i * (w / 3), y0 + 0.3, cz + d / 2 + 0.9, 0.7, 0.5, 0.7, "red");
    cols.push(col(cx - w / 2 + 1 + i * (w / 3), y0 + 0.3, cz + d / 2 + 0.9, 0.7, 0.5, 0.7));
  }
  put(boxes, cx, y0 + 1.6, cz - d / 2 - 1.5, w - 1, 1.6, 0.2, "black");
  put(boxes, cx, y0 + 1.6, cz - d / 2 - 1.4, w - 1.6, 1.2, 0.1, "cyan");
}

// A lounge: two sofas, coffee table, rug, paintings on the wall behind
// (wall = the room face the paintings hang on, wallCoord = its inner surface).
function loungeSet(boxes: Box[], cols: Collider[], cx: number, y0: number, cz: number, wall: Face, wallCoord: number) {
  put(boxes, cx, y0 + 0.12, cz, 6, 0.05, 4.4, "gold");
  put(boxes, cx - 2.2, y0 + 0.38, cz, 1.1, 0.45, 3.4, "red");
  cols.push(col(cx - 2.2, y0 + 0.38, cz, 1.1, 0.45, 3.4));
  put(boxes, cx + 2.2, y0 + 0.38, cz, 1.1, 0.45, 3.4, "red");
  cols.push(col(cx + 2.2, y0 + 0.38, cz, 1.1, 0.45, 3.4));
  put(boxes, cx, y0 + 0.4, cz, 1.6, 0.35, 0.9, "wood");
  cols.push(col(cx, y0 + 0.4, cz, 1.6, 0.35, 0.9));
  if (wall === "n") {
    voxelPainting(boxes, cx - 3, y0 + 1.9, wallCoord, Math.PI, 2.2, 1.5);
    voxelPainting(boxes, cx + 3, y0 + 1.9, wallCoord, Math.PI, 2.2, 1.5);
  } else if (wall === "s") {
    voxelPainting(boxes, cx - 3, y0 + 1.9, wallCoord, 0, 2.2, 1.5);
    voxelPainting(boxes, cx + 3, y0 + 1.9, wallCoord, 0, 2.2, 1.5);
  } else if (wall === "e") {
    voxelPainting(boxes, wallCoord, y0 + 1.9, cz - 3, -Math.PI / 2, 2.2, 1.5);
    voxelPainting(boxes, wallCoord, y0 + 1.9, cz + 3, -Math.PI / 2, 2.2, 1.5);
  } else {
    voxelPainting(boxes, wallCoord, y0 + 1.9, cz - 3, Math.PI / 2, 2.2, 1.5);
    voxelPainting(boxes, wallCoord, y0 + 1.9, cz + 3, Math.PI / 2, 2.2, 1.5);
  }
}

// A kitchenette: counter + stools + fridge.
function kitchenette(boxes: Box[], cols: Collider[], x: number, y0: number, z: number, alongX: boolean) {
  if (alongX) {
    put(boxes, x, y0 + 0.55, z, 4.6, 1.05, 1.1, "stone");
    cols.push(col(x, y0 + 0.55, z, 4.6, 1.05, 1.1));
    put(boxes, x - 1.4, y0 + 0.3, z + 1.2, 0.7, 0.5, 0.7, "gray");
    cols.push(col(x - 1.4, y0 + 0.3, z + 1.2, 0.7, 0.5, 0.7));
    put(boxes, x + 1.4, y0 + 0.3, z + 1.2, 0.7, 0.5, 0.7, "gray");
    cols.push(col(x + 1.4, y0 + 0.3, z + 1.2, 0.7, 0.5, 0.7));
    put(boxes, x + 2.9, y0 + 1.0, z, 0.9, 2, 0.9, "white");
    cols.push(col(x + 2.9, y0 + 1.0, z, 0.9, 2, 0.9));
  } else {
    put(boxes, x, y0 + 0.55, z, 1.1, 1.05, 4.6, "stone");
    cols.push(col(x, y0 + 0.55, z, 1.1, 1.05, 4.6));
    put(boxes, x + 1.2, y0 + 0.3, z - 1.4, 0.7, 0.5, 0.7, "gray");
    cols.push(col(x + 1.2, y0 + 0.3, z - 1.4, 0.7, 0.5, 0.7));
    put(boxes, x + 1.2, y0 + 0.3, z + 1.4, 0.7, 0.5, 0.7, "gray");
    cols.push(col(x + 1.2, y0 + 0.3, z + 1.4, 0.7, 0.5, 0.7));
    put(boxes, x, y0 + 1.0, z + 2.9, 0.9, 2, 0.9, "white");
    cols.push(col(x, y0 + 1.0, z + 2.9, 0.9, 2, 0.9));
  }
}

// A reception desk: stone counter with a gold top, plants flanking it.
function receptionDesk(boxes: Box[], cols: Collider[], x: number, y0: number, z: number, alongX: boolean) {
  const w = alongX ? 6 : 1.4;
  const d = alongX ? 1.4 : 6;
  put(boxes, x, y0 + 0.6, z, w, 1.15, d, "stone");
  cols.push(col(x, y0 + 0.6, z, w, 1.15, d));
  put(boxes, x, y0 + 1.25, z, w + 0.3, 0.16, d + 0.3, "gold");
  for (const s of [-1, 1]) {
    const px = alongX ? x + s * 4.2 : x;
    const pz = alongX ? z : z + s * 4.2;
    put(boxes, px, y0 + 0.5, pz, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(px, y0 + 0.5, pz, 0.8, 0.9, 0.8));
  }
}

// A floor zone (one level of a mega building), floor-aware via minY/maxY.
function floorZone(id: string, name: string, kind: Zone["kind"], x0: number, z0: number, w: number, d: number, minY: number, maxY: number, svcX: number, svcZ: number, signX: number, signY: number, signZ: number, signRot: number): Zone {
  return {
    id,
    name,
    kind,
    slot: 0,
    minX: x0 + 0.6,
    maxX: x0 + w - 0.6,
    minZ: z0 + 0.6,
    maxZ: z0 + d - 0.6,
    minY,
    maxY,
    serviceX: svcX,
    serviceZ: svcZ,
    signX,
    signY,
    signZ,
    signRot,
  };
}

function addMegaMall(boxes: Box[], cols: Collider[]): { zones: Zone[]; anchors: Anchor[]; lifts: Lift[] } {
  const x0 = MALL.x0;
  const z0 = MALL.z0;
  const w = MALL.x1 - MALL.x0;
  const d = MALL.z1 - MALL.z0;
  const h = MALL_ROOF;
  shellOpen(
    boxes,
    cols,
    x0,
    0,
    z0,
    w,
    h,
    d,
    (u, ly, face, len) => (hole(face, "w", u, ly, len) ? "air" : facadeSample(4, len)(u, ly)),
    "black",
    "w",
  );
  facades.push({
    id: "megamall",
    x: x0,
    z: z0,
    w,
    d,
    h,
    style: 4,
    door: "w",
    enterable: true,
    hero: true,
    face: "w",
    roof: "flat",
    cornice: true,
    storefront: true,
  });
  // Ground floor: stone finish, ceiling slab is the mezzanine (built below).
  put(boxes, x0 + w / 2, 0.08, z0 + d / 2, w - 2.4, 0.08, d - 2.4, "stone");
  cladWallsTall(boxes, x0, z0, w, d, "w", 9.5);
  // Shopfronts along the south wall.
  const shops: Array<[string, string, Mat]> = [
    ["ORBITX GEAR", "Merch + gear", "gold"],
    ["PLAZA COFFEE", "Coffee + bites", "warm"],
    ["SNEAKER DEN", "Kicks + streetwear", "red"],
    ["NEON ARCADE", "Games + prizes", "cyan"],
    ["STYLE LAB", "Fashion + fits", "gold"],
    ["TOKEN TOYS", "Toys + collectibles", "warm"],
  ];
  for (let i = 0; i < shops.length; i++) {
    const sx = x0 + 6 + i * 8.6;
    mallShop(boxes, cols, sx, 0, z0 + d - 2.1, 8, true, Math.PI, [shops[i][0]], shops[i][1], shops[i][2]);
  }
  // Food court, NW corner. The sign hangs on the north wall, facing in.
  foodCourt(boxes, cols, x0 + 3, 0, z0 + 3, x0 + 17, z0 + 17);
  roomSign("mall-food", x0 + 10, 2.6, z0 + 1.3, 0, 6, 1.2, ["FOOD COURT"], "Eat + drink");
  // Atrium: benches + planters, glass skylight in the roof. (The zone sign
  // by the west door carries the directory text.)
  for (const bz of [-6, 6]) {
    put(boxes, 66, 0.38, bz, 1.1, 0.45, 3.4, "red");
    cols.push(col(66, 0.38, bz, 1.1, 0.45, 3.4));
    put(boxes, 78, 0.38, bz, 1.1, 0.45, 3.4, "red");
    cols.push(col(78, 0.38, bz, 1.1, 0.45, 3.4));
  }
  for (const [px, pz] of [[64, -8], [80, -8], [64, 8], [80, 8]] as Array<[number, number]>) {
    put(boxes, px, 0.5, pz, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(px, 0.5, pz, 0.8, 0.9, 0.8));
  }
  // Ground-floor center dressing: the atrium + food court read well, but the
  // north strip (z -29..-12, x 60..90) and the west entry (x 44..62, z -9..9)
  // were flat empty stone. Directory kiosk by the west door, a gold runner
  // down the entry walk, seating clusters + planters on the north strip.
  // Directory kiosk at (48, -7) — offset from the west-door entry path so it
  // never blocks the door. Stone base, cyan screen, gold trim, and a sign
  // facing east into the mall (rotY pi/2).
  put(boxes, 48, 0.5, -7, 1.6, 0.9, 1.2, "stone");
  cols.push(col(48, 0.5, -7, 1.6, 0.9, 1.2));
  put(boxes, 48, 1.1, -7, 1.4, 0.7, 0.1, "cyan");
  put(boxes, 48, 1.55, -7, 1.7, 0.12, 1.3, "gold");
  roomSign("mall-directory", 48.9, 2.2, -7, Math.PI / 2, 3.4, 1.1, ["DIRECTORY"], "Shops · Food court · Lift");
  // Gold runner along z = 0 from the west door to the atrium.
  put(boxes, 53, 0.145, 0, 17, 0.05, 2.4, "gold");
  // Seating clusters on the north strip: bench + table + planter, with colliders.
  for (const [bx, bz] of [[66, -18], [80, -18]] as Array<[number, number]>) {
    put(boxes, bx, 0.38, bz, 1.1, 0.45, 3.4, "red");
    cols.push(col(bx, 0.38, bz, 1.1, 0.45, 3.4));
    put(boxes, bx + 2.6, 0.72, bz, 1.35, 0.1, 1.35, "wood");
    put(boxes, bx + 2.6, 0.38, bz, 0.22, 0.6, 0.22, "black");
    cols.push(col(bx + 2.6, 0.55, bz, 1.35, 0.9, 1.35));
    put(boxes, bx - 2.6, 0.5, bz, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(bx - 2.6, 0.5, bz, 0.8, 0.9, 0.8));
  }
  // North-wall planters along the strip.
  for (const [px, pz] of [[68, -26.5], [84, -26.5]] as Array<[number, number]>) {
    put(boxes, px, 0.5, pz, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(px, 0.5, pz, 0.8, 0.9, 0.8));
  }
  // Mezzanine floor: slab with atrium + shaft + stairwell holes, atrium railing.
  slabWithHoles(boxes, cols, x0, MALL_FLOOR2, z0, w, d, [[63, -9, 81, 9], [93, -27, 97, -23], [95, 5, 99, 25]], "cream");
  for (const [rx, rz, rw, rd] of [[63, -9.15, 18, 0.3], [63, 8.85, 18, 0.3], [62.85, -9, 0.3, 18], [81.15, -9, 0.3, 18]] as Array<[number, number, number, number]>) {
    put(boxes, rx + rw / 2, MALL_FLOOR2 + 0.55, rz + rd / 2, rw, 1.1, rd, "cyan");
    cols.push({ minX: rx, maxX: rx + rw, minY: MALL_FLOOR2, maxY: MALL_FLOOR2 + 1.1, minZ: rz, maxZ: rz + rd });
  }
  hangLights(boxes, 72, MALL_FLOOR2, 20, 30, 14);
  hangLights(boxes, 72, MALL_FLOOR2, -20, 30, 14);
  // Chandelier over the atrium, hung from the roof (the mezzanine has a
  // hole there, so nothing hangs from it).
  put(boxes, 72, 8.4, 0, 0.14, 1.4, 0.14, "gold");
  put(boxes, 72, 7.6, 0, 1.4, 0.3, 1.4, "warm");
  put(boxes, 72, 7.1, 0, 0.7, 0.7, 0.7, "gold");
  // Mezzanine lights hang from the roof slab (solid over the atrium).
  hangLights(boxes, 72, MALL_ROOF, 0, 40, 30);
  // Mezzanine shops along the north wall + a lounge on the east side.
  const mezz: Array<[string, string, Mat]> = [
    ["SKY COFFEE", "Coffee above the crowd", "warm"],
    ["ORBITX LAB", "New drops first", "gold"],
    ["VINYL VAULT", "Records + audio", "red"],
    ["CLOUD CAFE", "Tea + desserts", "cyan"],
  ];
  for (let i = 0; i < mezz.length; i++) {
    const sx = x0 + 6 + i * 8.6;
    mallShop(boxes, cols, sx, MALL_FLOOR2, z0 + 2.1, 8, true, 0, [mezz[i][0]], mezz[i][1], mezz[i][2]);
  }
  loungeSet(boxes, cols, 89, MALL_FLOOR2, -1, "e", 99.7);
  // Roof: slab, skylight over the atrium, parapet, AC + beacon.
  put(boxes, x0 + w / 2, MALL_ROOF - 0.15, z0 + d / 2, w, 0.3, d, "stone");
  put(boxes, 72, MALL_ROOF + 0.2, 0, 16, 0.35, 16, "cyan");
  for (const [px, pz, pw, pd] of [[x0 + w / 2, z0 + 0.35, w, 0.7], [x0 + w / 2, z0 + d - 0.35, w, 0.7], [x0 + 0.35, z0 + d / 2, 0.7, d], [x0 + w - 0.35, z0 + d / 2, 0.7, d]] as Array<[number, number, number, number]>) {
    put(boxes, px, MALL_ROOF + 0.5, pz, pw, 0.6, pd, "black");
  }
  put(boxes, x0 + w - 6, MALL_ROOF + 0.6, z0 + 6, 3, 1.2, 3, "gray");
  put(boxes, x0 + w / 2, MALL_ROOF + 0.9, z0 + d / 2, 0.5, 0.8, 0.5, "gold");
  // Glass lift shaft (NE corner) + stairs (east wall).
  buildGlassShaft(boxes, cols, "mall-lift", 93, -27, 4, 4, MALL_FLOOR2 + 2.8, [0, MALL_FLOOR2], "w");
  buildStairs(boxes, cols, 95, 5, 4, 0, MALL_FLOOR2);
  const zones: Zone[] = [
    floorZone("mall-g", "Mega Mall", "mall", x0, z0, w, d, -0.1, 4.9, 72, 0, 44.6, 2.6, 0, Math.PI / 2),
    floorZone("mall-2", "Mega Mall — Mezzanine", "mall", x0, z0, w, d, 4.9, 9.4, 89, -1, 72, 7.2, -8.4, 0),
  ];
  const anchors: Anchor[] = [
    doorAnchor("megamall", "Mega Mall", "mall", x0, z0, w, d, "w"),
    { id: "mall-lift-0", name: "Mall Lift", kind: "lift", x: 91.5, y: 0, z: -25, yaw: Math.PI / 2, slot: 0, liftId: "mall-lift", liftFloor: 0 },
    { id: "mall-lift-1", name: "Mall Lift", kind: "lift", x: 91.5, y: MALL_FLOOR2, z: -25, yaw: Math.PI / 2, slot: 1, liftId: "mall-lift", liftFloor: 1 },
  ];
  const lifts: Lift[] = [{ id: "mall-lift", name: "Mall Lift", x: 95, z: -25, w: 4, d: 4, floors: [0, MALL_FLOOR2], stops: ["Ground Floor", "Mezzanine"], landing: "w" }];
  return { zones, anchors, lifts };
}

interface OfficeSuiteSpec {
  id: string;
  name: string;
  floorLabel: string;
  tierLabel: string;
  x0: number;
  x1: number;
  y0: number;
  // North wall (door wall, faces a corridor) and south wall — or the lobby
  // void edge on floor 2, where the suite ends at the mezzanine rail.
  z0: number;
  z1: number;
  voidEdge?: boolean;
  premium?: boolean;
}

// One claimable tower suite: partition wall on the north corridor with a
// door + name sign, desks along the west wall, a meeting table against the
// partition wall (or a hand-rolled breakout table in narrow suites, so no
// screen ever floats mid-room), a painting, and a furnished south end
// (lounge against a real south wall, rug + benches on the floor-2 void
// edge). The door sits near the suite's west side so the entry lane runs
// clear of the desks and the table. The lift landing (-93.5, -25) and the
// corridors stay open — nothing here touches the shaft or the slab holes.
function furnishOfficeSuite(boxes: Box[], cols: Collider[], spec: OfficeSuiteSpec) {
  const { id, name, floorLabel, tierLabel, x0, x1, y0, z0, z1, voidEdge, premium } = spec;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const doorX = x0 + 3.2;
  wallRunX(boxes, cols, x0, x1, y0, z0, 4, "cream", doorX, 2.4);
  // Suite sign on the corridor face, beside the door (faces the corridor).
  if (w >= 12) roomSign(`suite-${id}`, doorX + 4.0, y0 + 2.6, z0 - 0.35, Math.PI, 4.4, 1.0, [name], `${floorLabel} · ${tierLabel}`);
  else roomSign(`suite-${id}`, x0 + 6.3, y0 + 2.6, z0 - 0.35, Math.PI, 3.2, 1.0, [name], `${floorLabel} · ${tierLabel}`);
  // Desks along the west wall; the entry lane runs clear of them.
  deskRow(boxes, cols, x0 + 1.1, y0, z0 + 4.5, d >= 18 ? 3 : 2, 3.4, false);
  // Painting on the partition wall, west of the door.
  voxelPainting(boxes, x0 + 2.5, y0 + 2, z0 + 0.65, 0, 2.2, 1.5);
  if (w >= 12) {
    // Real meeting table against the partition wall (screen on the wall),
    // east side, clear of the door lane.
    meetingTable(boxes, cols, x1 - 3.8, y0, z0 + 4.3, 6, 4);
  } else {
    // Narrow suite: hand-rolled breakout table + chairs, no floating screen.
    put(boxes, x1 - 2.2, y0 + 0.45, z0 + 8.5, 2.4, 0.1, 1.6, "wood");
    put(boxes, x1 - 2.2, y0 + 0.22, z0 + 8.5, 0.3, 0.4, 0.3, "black");
    cols.push(col(x1 - 2.2, y0 + 0.5, z0 + 8.5, 2.4, 0.9, 1.6));
    for (const [chx, chz] of [[x1 - 0.9, z0 + 8.5], [x1 - 2.2, z0 + 10.1]] as Array<[number, number]>) {
      put(boxes, chx, y0 + 0.3, chz, 0.7, 0.5, 0.7, "red");
      cols.push(col(chx, y0 + 0.3, chz, 0.7, 0.5, 0.7));
    }
  }
  // South end: full lounge against a real south wall, rug + benches on the
  // floor-2 void edge, rug + plants in between.
  if (voidEdge) {
    put(boxes, cx, y0 + 0.12, z1 - 2, 8, 0.06, 5, "gold");
    put(boxes, cx, y0 + 0.16, z1 - 2, 6.5, 0.06, 3.5, "red");
    put(boxes, cx, y0 + 0.4, z1 - 2, 1.6, 0.35, 0.9, "wood");
    cols.push(col(cx, y0 + 0.4, z1 - 2, 1.6, 0.35, 0.9));
    for (const bz of [z1 - 3.2, z1 - 0.8]) {
      put(boxes, cx, y0 + 0.38, bz, 3.4, 0.45, 1.1, "red");
      cols.push(col(cx, y0 + 0.38, bz, 3.4, 0.45, 1.1));
    }
    for (const px of [x0 + 1.3, x1 - 1.3]) {
      put(boxes, px, y0 + 0.5, z1 - 1.5, 0.8, 0.9, 0.8, "leavesDark");
      cols.push(col(px, y0 + 0.5, z1 - 1.5, 0.8, 0.9, 0.8));
    }
  } else if (d >= 20) {
    loungeSet(boxes, cols, cx, y0, z1 - 8, "n", z1 - 0.7);
    for (const px of [x0 + 1.5, x1 - 1.5]) {
      put(boxes, px, y0 + 0.5, z1 - 2, 0.8, 0.9, 0.8, "leavesDark");
      cols.push(col(px, y0 + 0.5, z1 - 2, 0.8, 0.9, 0.8));
    }
  } else {
    put(boxes, cx, y0 + 0.12, z1 - 3.5, 7, 0.06, 5, "gold");
    put(boxes, cx, y0 + 0.16, z1 - 3.5, 5.5, 0.06, 3.5, premium ? "gold" : "red");
    for (const px of [x0 + 1.3, x1 - 1.3]) {
      put(boxes, px, y0 + 0.5, z1 - 1.5, 0.8, 0.9, 0.8, "leavesDark");
      cols.push(col(px, y0 + 0.5, z1 - 1.5, 0.8, 0.9, 0.8));
    }
  }
  if (premium) {
    // Premium suites: paintings on both side walls.
    voxelPainting(boxes, x1 - 0.3, y0 + 2, z0 + 10, -Math.PI / 2, 2.2, 1.5);
    voxelPainting(boxes, x0 + 0.3, y0 + 2, z0 + 10, Math.PI / 2, 2.2, 1.5);
  }
  hangLights(boxes, cx, y0 + 4, (z0 + z1) / 2, w, d);
}

function addMegaOffice(boxes: Box[], cols: Collider[]): { zones: Zone[]; anchors: Anchor[]; lifts: Lift[] } {
  const x0 = OFFICE.x0;
  const z0 = OFFICE.z0;
  const w = OFFICE.x1 - OFFICE.x0;
  const d = OFFICE.z1 - OFFICE.z0;
  const h = 20;
  shellOpen(
    boxes,
    cols,
    x0,
    0,
    z0,
    w,
    h,
    d,
    (u, ly, face, len) => (hole(face, "e", u, ly, len) ? "air" : facadeSample(5, len)(u, ly)),
    "black",
    "e",
  );
  facades.push({
    id: "orbitx-hq",
    x: x0,
    z: z0,
    w,
    d,
    h,
    style: 5,
    door: "e",
    enterable: true,
    hero: true,
    face: "e",
    roof: "flat",
    cornice: true,
    storefront: true,
    crown: { w: 40, d: 40, h: 3 },
  });
  // Ground floor: lobby, double-height void over the north strip (z 5..29).
  put(boxes, x0 + w / 2, 0.08, z0 + d / 2, w - 2.4, 0.08, d - 2.4, "cream");
  cladWallsTall(boxes, x0, z0, w, d, "e", 20);
  // Gold ORBITX logo wall on the north wall + reception desk at the void edge.
  roomSign("hq-logo", -72, 4.2, z0 + d - 0.75, Math.PI, 14, 3, ["ORBITX"], "The city builds here");
  receptionDesk(boxes, cols, -72, 0, 3.4, true);
  loungeSet(boxes, cols, -92, 0, 14, "n", 27.7);
  // Lobby seating + plants on the south strip (under floor 2).
  for (const [px, pz] of [[-92, -20], [-52, -20]] as Array<[number, number]>) {
    put(boxes, px, 0.38, pz, 1.1, 0.45, 3.4, "red");
    cols.push(col(px, 0.38, pz, 1.1, 0.45, 3.4));
    put(boxes, px, 0.5, pz + 2.6, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(px, 0.5, pz + 2.6, 0.8, 0.9, 0.8));
  }
  // Lobby centrepiece: a gold-trimmed rug with a coffee table and seating,
  // so the big double-height lobby reads furnished from its centre, not
  // just at the edges.
  put(boxes, -72, 0.12, -8, 12, 0.06, 9, "gold");
  put(boxes, -72, 0.16, -8, 10.5, 0.06, 7.5, "red");
  put(boxes, -72, 0.5, -8, 3.2, 0.5, 1.6, "wood");
  cols.push(col(-72, 0.5, -8, 3.2, 0.5, 1.6));
  for (const [bx, bz, bw, bd] of [[-72, -13.2, 3.4, 1.1], [-72, -2.8, 3.4, 1.1], [-77.5, -8, 1.1, 3.4], [-66.5, -8, 1.1, 3.4]] as Array<[number, number, number, number]>) {
    put(boxes, bx, 0.38, bz, bw, 0.45, bd, "red");
    cols.push(col(bx, 0.38, bz, bw, 0.45, bd));
  }
  for (const [px, pz] of [[-79.5, -13.5], [-64.5, -13.5]] as Array<[number, number]>) {
    put(boxes, px, 0.5, pz, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(px, 0.5, pz, 0.8, 0.9, 0.8));
  }
  hangLights(boxes, -72, 12, 14, 40, 22);
  hangLights(boxes, -72, 8, -14, 40, 22);
  // Office directory board: freestanding, just east of the front desk, so a
  // player landing by the desk sees it straight ahead. Lists suite names +
  // floors only — no prices (the directory panel shows those). E at the
  // board opens the offices panel (anchor "hq-directory", kind "offices").
  put(boxes, -64, 2.0, 6, 5.0, 3.9, 0.3, "black");
  cols.push(col(-64, 2.0, 6, 5.0, 3.9, 0.3));
  put(boxes, -64, 4.02, 6, 5.2, 0.15, 0.45, "gold");
  for (const px of [-66.2, -61.8]) {
    put(boxes, px, 0.55, 6, 0.3, 1.1, 0.3, "black");
    cols.push(col(px, 0.55, 6, 0.3, 1.1, 0.3));
  }
  roomSign("hq-dir-0", -64, 3.35, 6.3, 0, 4.6, 0.85, ["OFFICE DIRECTORY"], "OrbitX HQ");
  roomSign("hq-dir-2", -64, 2.45, 6.3, 0, 4.6, 0.85, ["Floor 2", "Suites 2A – 2H"], "Standard offices");
  roomSign("hq-dir-3", -64, 1.55, 6.3, 0, 4.6, 0.85, ["Floor 3", "Suites 3A – 3H"], "Standard offices");
  roomSign("hq-dir-4", -64, 0.65, 6.3, 0, 4.6, 0.85, ["Floor 4", "Founder's Office · 4A – 4H"], "Premium suites · Roof Terrace above");
  // Floor slabs: 8 (with the lobby void hole), 12, 16, 20 (roof terrace).
  slabWithHoles(boxes, cols, x0, 8, z0, w, d, [[x0, 5, x0 + w, z0 + d], [-99, -27, -95, -23]], "cream");
  slabWithHoles(boxes, cols, x0, 12, z0, w, d, [[-99, -27, -95, -23]], "cream");
  slabWithHoles(boxes, cols, x0, 16, z0, w, d, [[-99, -27, -95, -23]], "cream");
  slabWithHoles(boxes, cols, x0, 20, z0, w, d, [[-99, -27, -95, -23]], "cream");
  // Floor 2 (y=8, south strip only — the lobby void runs z 5..29): a
  // corridor along the north wall off the lift, four suites in the north row
  // (2A–2D), a middle corridor reached by the east passage, and four suites
  // in the south row (2E–2H) on the void edge, behind a gold mezzanine
  // rail so nobody walks off into the lobby below.
  wallRunZ(boxes, cols, -22, -8, 8, -86.75, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -22, -8, 8, -73.5, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -22, -8, 8, -60.25, 4, "cream", 0, 0);
  wallRunX(boxes, cols, -100, -47, 8, -8, 4, "cream", 0, 0);
  // East passage west wall: alongside the north row only — it must stop at
  // the middle corridor (z -8) or it seals the corridor off.
  wallRunZ(boxes, cols, -22, -8, 8, -47, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -5, 4, 8, -86, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -5, 4, 8, -72, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -5, 4, 8, -58, 4, "cream", 0, 0);
  furnishOfficeSuite(boxes, cols, { id: "office-f2-a", name: "Suite 2A", floorLabel: "Floor 2", tierLabel: "Standard office", x0: -100, x1: -86.75, y0: 8, z0: -22, z1: -8 });
  furnishOfficeSuite(boxes, cols, { id: "office-f2-b", name: "Suite 2B", floorLabel: "Floor 2", tierLabel: "Standard office", x0: -86.75, x1: -73.5, y0: 8, z0: -22, z1: -8 });
  furnishOfficeSuite(boxes, cols, { id: "office-f2-c", name: "Suite 2C", floorLabel: "Floor 2", tierLabel: "Standard office", x0: -73.5, x1: -60.25, y0: 8, z0: -22, z1: -8 });
  furnishOfficeSuite(boxes, cols, { id: "office-f2-d", name: "Suite 2D", floorLabel: "Floor 2", tierLabel: "Standard office", x0: -60.25, x1: -47, y0: 8, z0: -22, z1: -8 });
  furnishOfficeSuite(boxes, cols, { id: "office-f2-e", name: "Suite 2E", floorLabel: "Floor 2", tierLabel: "Standard office", x0: -100, x1: -86, y0: 8, z0: -5, z1: 4, voidEdge: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f2-f", name: "Suite 2F", floorLabel: "Floor 2", tierLabel: "Standard office", x0: -86, x1: -72, y0: 8, z0: -5, z1: 4, voidEdge: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f2-g", name: "Suite 2G", floorLabel: "Floor 2", tierLabel: "Standard office", x0: -72, x1: -58, y0: 8, z0: -5, z1: 4, voidEdge: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f2-h", name: "Suite 2H", floorLabel: "Floor 2", tierLabel: "Standard office", x0: -58, x1: -44, y0: 8, z0: -5, z1: 4, voidEdge: true });
  put(boxes, -72, 8.55, 4.7, 56, 1.1, 0.3, "gold");
  cols.push({ minX: -100, maxX: -44, minY: 8, maxY: 9.1, minZ: 4.55, maxZ: 4.85 });
  roomSign("hq-f2-plate", -88, 10.6, -27.4, 0, 6, 1.2, ["Floor 2", "Suites 2A – 2H"], "Standard offices");
  hangLights(boxes, -72, 12, -25.5, 40, 5);
  hangLights(boxes, -72, 12, -6.5, 40, 5);
  // Floor 3 (y=12): same two-row shape as floor 2, full depth — north row
  // (3A–3D), middle corridor, south row (3E–3H) with lounges at the real
  // south wall.
  wallRunZ(boxes, cols, -22, -2, 12, -86.75, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -22, -2, 12, -73.5, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -22, -2, 12, -60.25, 4, "cream", 0, 0);
  wallRunX(boxes, cols, -100, -47, 12, -2, 4, "cream", 0, 0);
  // East passage west wall: alongside the north row only — it must stop at
  // the middle corridor (z -2) or it seals the corridor off.
  wallRunZ(boxes, cols, -22, -2, 12, -47, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, 1, 28, 12, -86, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, 1, 28, 12, -72, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, 1, 28, 12, -58, 4, "cream", 0, 0);
  furnishOfficeSuite(boxes, cols, { id: "office-f3-a", name: "Suite 3A", floorLabel: "Floor 3", tierLabel: "Standard office", x0: -100, x1: -86.75, y0: 12, z0: -22, z1: -2 });
  furnishOfficeSuite(boxes, cols, { id: "office-f3-b", name: "Suite 3B", floorLabel: "Floor 3", tierLabel: "Standard office", x0: -86.75, x1: -73.5, y0: 12, z0: -22, z1: -2 });
  furnishOfficeSuite(boxes, cols, { id: "office-f3-c", name: "Suite 3C", floorLabel: "Floor 3", tierLabel: "Standard office", x0: -73.5, x1: -60.25, y0: 12, z0: -22, z1: -2 });
  furnishOfficeSuite(boxes, cols, { id: "office-f3-d", name: "Suite 3D", floorLabel: "Floor 3", tierLabel: "Standard office", x0: -60.25, x1: -47, y0: 12, z0: -22, z1: -2 });
  furnishOfficeSuite(boxes, cols, { id: "office-f3-e", name: "Suite 3E", floorLabel: "Floor 3", tierLabel: "Standard office", x0: -100, x1: -86, y0: 12, z0: 1, z1: 28 });
  furnishOfficeSuite(boxes, cols, { id: "office-f3-f", name: "Suite 3F", floorLabel: "Floor 3", tierLabel: "Standard office", x0: -86, x1: -72, y0: 12, z0: 1, z1: 28 });
  furnishOfficeSuite(boxes, cols, { id: "office-f3-g", name: "Suite 3G", floorLabel: "Floor 3", tierLabel: "Standard office", x0: -72, x1: -58, y0: 12, z0: 1, z1: 28 });
  furnishOfficeSuite(boxes, cols, { id: "office-f3-h", name: "Suite 3H", floorLabel: "Floor 3", tierLabel: "Standard office", x0: -58, x1: -44, y0: 12, z0: 1, z1: 28 });
  roomSign("hq-f3-plate", -88, 14.6, -27.4, 0, 6, 1.2, ["Floor 3", "Suites 3A – 3H"], "Standard offices");
  hangLights(boxes, -72, 16, -25.5, 40, 5);
  hangLights(boxes, -72, 16, -0.5, 40, 5);
  // Floor 4 (y=16): the Founder's Office — the biggest room in the tower
  // (west block, off the lift landing) — plus eight premium suites in
  // three rows: north 4A/4B, middle 4C–4E, south 4F–4H. The kitchenette
  // stays on the floor, at the east end of the north corridor.
  wallRunZ(boxes, cols, -22, 7, 16, -74, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -22, -9, 16, -60.5, 4, "cream", 0, 0);
  wallRunX(boxes, cols, -74, -47, 16, -9, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -6, 7, 16, -65, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -6, 7, 16, -56, 4, "cream", 0, 0);
  wallRunX(boxes, cols, -100, -47, 16, 7, 4, "cream", 0, 0);
  // East passage west wall: two segments, alongside the north row
  // (z -22..-9) and the middle row (z -6..7) — with gaps at the middle
  // corridor (z -9..-6) and the south corridor (z 7..10), or both
  // corridors are sealed off.
  wallRunZ(boxes, cols, -22, -9, 16, -47, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, -6, 7, 16, -47, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, 10, 28, 16, -82.33, 4, "cream", 0, 0);
  wallRunZ(boxes, cols, 10, 28, 16, -64.67, 4, "cream", 0, 0);
  wallRunX(boxes, cols, -100, -74, 16, -22, 4, "cream", -95.5, 2.4);
  roomSign("suite-office-f4-founder", -91.3, 18.6, -22.35, Math.PI, 5.0, 1.0, ["Founder's Office"], "Floor 4 · Private — not for sale");
  // Gold ORBITX wall on the west wall + gold rug under the hero desk.
  roomSign("founder-logo", -99.7, 19, 0, Math.PI / 2, 8, 2, ["ORBITX"], "Founder's Office");
  put(boxes, -88, 16.12, -8, 10, 0.06, 8, "gold");
  put(boxes, -88, 16.16, -8, 8.5, 0.06, 6.5, "red");
  // Hero desk (facing south) with a gold chair.
  put(boxes, -88, 16.45, -10, 5, 0.12, 2.2, "wood");
  cols.push(col(-88, 16.5, -10, 5, 0.9, 2.2));
  put(boxes, -90, 16.2, -10, 0.25, 0.4, 1.8, "black");
  put(boxes, -86, 16.2, -10, 0.25, 0.4, 1.8, "black");
  put(boxes, -88, 17.1, -10.9, 1.6, 1.0, 0.1, "cyan");
  put(boxes, -88, 16.3, -7.6, 0.8, 0.6, 0.8, "gold");
  cols.push(col(-88, 16.3, -7.6, 0.8, 0.6, 0.8));
  // Meeting table against the partition wall + lounge at the south end.
  meetingTable(boxes, cols, -88, 16, -17.2, 8, 5);
  loungeSet(boxes, cols, -88, 16, 3, "n", 6.3);
  voxelPainting(boxes, -74.3, 18, -2, -Math.PI / 2, 2.2, 1.5);
  voxelPainting(boxes, -74.3, 18, -14, -Math.PI / 2, 2.2, 1.5);
  for (const [px, pz] of [[-98.5, 5.5], [-75.5, 5.5], [-98.5, -2]] as Array<[number, number]>) {
    put(boxes, px, 16.5, pz, 0.8, 0.9, 0.8, "leavesDark");
    cols.push(col(px, 16.5, pz, 0.8, 0.9, 0.8));
  }
  hangLights(boxes, -88, 20, -7.5, 20, 25);
  furnishOfficeSuite(boxes, cols, { id: "office-f4-a", name: "Suite 4A", floorLabel: "Floor 4", tierLabel: "Premium suite", x0: -74, x1: -60.5, y0: 16, z0: -22, z1: -9, premium: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f4-b", name: "Suite 4B", floorLabel: "Floor 4", tierLabel: "Premium suite", x0: -60.5, x1: -47, y0: 16, z0: -22, z1: -9, premium: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f4-c", name: "Suite 4C", floorLabel: "Floor 4", tierLabel: "Premium suite", x0: -74, x1: -65, y0: 16, z0: -6, z1: 7, premium: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f4-d", name: "Suite 4D", floorLabel: "Floor 4", tierLabel: "Premium suite", x0: -65, x1: -56, y0: 16, z0: -6, z1: 7, premium: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f4-e", name: "Suite 4E", floorLabel: "Floor 4", tierLabel: "Premium suite", x0: -56, x1: -47, y0: 16, z0: -6, z1: 7, premium: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f4-f", name: "Suite 4F", floorLabel: "Floor 4", tierLabel: "Premium suite", x0: -100, x1: -82.33, y0: 16, z0: 10, z1: 28, premium: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f4-g", name: "Suite 4G", floorLabel: "Floor 4", tierLabel: "Premium suite", x0: -82.33, x1: -64.67, y0: 16, z0: 10, z1: 28, premium: true });
  furnishOfficeSuite(boxes, cols, { id: "office-f4-h", name: "Suite 4H", floorLabel: "Floor 4", tierLabel: "Premium suite", x0: -64.67, x1: -44, y0: 16, z0: 10, z1: 28, premium: true });
  kitchenette(boxes, cols, -52, 16, -27.6, true);
  roomSign("hq-f4-plate", -88, 18.6, -27.4, 0, 6, 1.2, ["Floor 4", "Founder's Office · 4A – 4H"], "Premium suites");
  hangLights(boxes, -72, 20, -25.5, 40, 5);
  hangLights(boxes, -60, 20, -7.5, 24, 5);
  hangLights(boxes, -72, 20, 8.5, 40, 5);
  // Roof terrace (y=20): railing, trees, benches, gold ORBITX sign east.
  for (const [rx, rz, rw, rd] of [[x0 + 0.15, z0 + 0.15, w - 0.3, 0.3], [x0 + 0.15, z0 + d - 0.45, w - 0.3, 0.3], [x0 + 0.15, z0 + 0.15, 0.3, d - 0.3], [x0 + w - 0.45, z0 + 0.15, 0.3, d - 0.3]] as Array<[number, number, number, number]>) {
    put(boxes, rx + rw / 2, 20.55, rz + rd / 2, rw, 1.1, rd, "gold");
    cols.push({ minX: rx, maxX: rx + rw, minY: 20, maxY: 21.1, minZ: rz, maxZ: rz + rd });
  }
  for (const [px, pz] of [[-92, 18], [-52, 18], [-92, -18], [-52, -18]] as Array<[number, number]>) {
    addTree(boxes, cols, px, pz, 20);
    put(boxes, px + 3, 20.38, pz, 1.1, 0.45, 3.4, "red");
    cols.push(col(px + 3, 20.38, pz, 1.1, 0.45, 3.4));
  }
  roomSign("hq-roof", -43.4, 22.2, 0, Math.PI / 2, 12, 2.4, ["ORBITX"], "Roof terrace · the city below");
  // Glass lift shaft (NW corner, through all floors) + roof penthouse cap.
  buildGlassShaft(boxes, cols, "hq-lift", -99, -27, 4, 4, 22.8, OFFICE_FLOORS, "e");
  const zones: Zone[] = [
    floorZone("hq-g", "OrbitX HQ — Lobby", "office", x0, z0, w, d, -0.1, 7.9, -72, 3.4, -44.4, 2.6, 14, -Math.PI / 2),
    floorZone("hq-2", "OrbitX HQ — Floor 2", "office", x0, z0, w, d, 7.9, 11.9, -72, -20, -72, 10.4, -27.4, 0),
    floorZone("hq-3", "OrbitX HQ — Floor 3", "office", x0, z0, w, d, 11.9, 15.9, -72, -12, -72, 14.4, -27.4, 0),
    floorZone("hq-4", "OrbitX HQ — Floor 4", "office", x0, z0, w, d, 15.9, 19.9, -85, -15, -72, 18.4, -27.4, 0),
    floorZone("hq-roof", "OrbitX HQ — Roof Terrace", "office", x0, z0, w, d, 19.9, 24, -72, 0, -72, 22.2, 27.7, Math.PI),
  ];
  const anchors: Anchor[] = [
    doorAnchor("orbitx-hq", "OrbitX HQ", "office", x0, z0, w, d, "e"),
    // Office directory board in the lobby — E opens the offices panel.
    { id: "hq-directory", name: "Office directory", kind: "offices", x: -64, y: 0, z: 7.6, yaw: 0, slot: 0 },
    { id: "hq-lift-0", name: "HQ Lift", kind: "lift", x: -93.5, y: 0, z: -25, yaw: -Math.PI / 2, slot: 0, liftId: "hq-lift", liftFloor: 0 },
    { id: "hq-lift-1", name: "HQ Lift", kind: "lift", x: -93.5, y: 8, z: -25, yaw: -Math.PI / 2, slot: 1, liftId: "hq-lift", liftFloor: 1 },
    { id: "hq-lift-2", name: "HQ Lift", kind: "lift", x: -93.5, y: 12, z: -25, yaw: -Math.PI / 2, slot: 2, liftId: "hq-lift", liftFloor: 2 },
    { id: "hq-lift-3", name: "HQ Lift", kind: "lift", x: -93.5, y: 16, z: -25, yaw: -Math.PI / 2, slot: 3, liftId: "hq-lift", liftFloor: 3 },
    { id: "hq-lift-4", name: "HQ Lift", kind: "lift", x: -93.5, y: 20, z: -25, yaw: -Math.PI / 2, slot: 4, liftId: "hq-lift", liftFloor: 4 },
  ];
  const lifts: Lift[] = [{ id: "hq-lift", name: "HQ Lift", x: -97, z: -25, w: 4, d: 4, floors: OFFICE_FLOORS, stops: OFFICE_STOPS, landing: "e" }];
  return { zones, anchors, lifts };
}

function addPark(boxes: Box[], cols: Collider[], x0: number, z0: number, x1: number, z1: number) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  put(boxes, cx, 0.08, cz, x1 - x0 - 1, 0.14, z1 - z0 - 1, "grass");
  addTree(boxes, cols, cx - 4, cz - 3, 0.1);
  addTree(boxes, cols, cx + 5, cz + 4, 0.1);
  addLamp(boxes, cx, cz + 6);
}

function addKiosk(boxes: Box[], cols: Collider[], x: number, z: number, top: Mat) {
  put(boxes, x, 0.85, z, 1.5, 1.5, 1.5, "black");
  put(boxes, x, 1.72, z, 1.7, 0.22, 1.7, top);
  put(boxes, x, 2.05, z, 0.4, 0.5, 0.4, "cyanhot");
  cols.push(col(x, 0.9, z, 1.5, 1.6, 1.5));
}

function addHarbor(boxes: Box[], cols: Collider[]) {
  put(boxes, -30, 0.04, 222, 40, 0.08, 48, "water");
  put(boxes, 30, 0.04, 222, 40, 0.08, 48, "water");
  cols.push({ minX: -50, maxX: -10, minY: 0, maxY: 1.2, minZ: 198, maxZ: 246 });
  cols.push({ minX: 10, maxX: 50, minY: 0, maxY: 1.2, minZ: 198, maxZ: 246 });
  put(boxes, 0, 0.12, 220, 6, 0.16, 52, "wood");
  put(boxes, 0, 0.2, 220, 5.2, 0.08, 50, "stone");
  for (const z of [202, 216, 230, 242]) {
    put(boxes, -2.4, 1.3, z, 0.25, 2.2, 0.25, "black");
    put(boxes, 2.4, 1.3, z, 0.25, 2.2, 0.25, "black");
    put(boxes, 0, 2.35, z, 5.2, 0.12, 0.2, "cyanhot");
    cols.push(col(-2.4, 1.3, z, 0.25, 2.2, 0.25));
    cols.push(col(2.4, 1.3, z, 0.25, 2.2, 0.25));
  }
  put(boxes, -18, 0.2, 226, 10, 0.3, 3.2, "black");
  put(boxes, 18, 0.2, 230, 12, 0.35, 3.4, "white");
  // Stone quay in front of the water so the harbor reads as a waterfront,
  // not a bright blue stripe at the base of the dock (the pier gap stays open).
  put(boxes, -27, 0.75, 196.5, 46, 1.5, 1.2, "stone");
  put(boxes, 27, 0.75, 196.5, 46, 1.5, 1.2, "stone");
  cols.push({ minX: -50, maxX: -4, minY: 0, maxY: 1.5, minZ: 195.9, maxZ: 197.1 });
  cols.push({ minX: 4, maxX: 50, minY: 0, maxY: 1.5, minZ: 195.9, maxZ: 197.1 });
}

function addFixedPlaces(boxes: Box[], cols: Collider[]): { anchors: Anchor[]; boards: BoardSlot[]; zones: Zone[] } {
  const zones = [
    // Real-store heights: one or two storeys, not 12-18m slabs. (Interiors
    // are ground-floor only; the ceiling sits at 3.6 either way.)
    addVenue(boxes, cols, 7, 43, 22, 22, 8, "w", "shop"),
    addVenue(boxes, cols, -29, 43, 22, 22, 7, "e", "cafe"),
    addVenue(boxes, cols, 43, 79, 22, 22, 10, "w", "hall"),
    addVenue(boxes, cols, 79, -65, 22, 22, 10, "w", "bank"),
    addVenue(boxes, cols, 79, 43, 22, 22, 7, "w", "garage"),
    addVenue(boxes, cols, 43, 43, 22, 22, 8, "w", "arcade"),
    addVenue(boxes, cols, -29, 79, 22, 22, 7, "n", "market"),
    // New venues: the two empty lots in the reserved west strip (inset 2
    // from the lot edges so the corner traffic lights stay clear), plus the
    // waterfront pair east of the harbor (empty grass, no lots/roads/hills).
    addVenue(boxes, cols, -99, -171, 20, 20, 9, "e", "cinema"),
    addVenue(boxes, cols, -99, 153, 20, 20, 8, "e", "library"),
    addVenue(boxes, cols, 60, 206, 26, 22, 8, "n", "gym"),
    // Batch 2: the remaining free lots — museum + hotel in the west strip
    // (museum south of the library, hotel in the 123..153 gap; both dodge
    // the strip trees, canopies brush the roof edges only), casino on the
    // north strip between the lamp lines, nightclub on the waterfront
    // east of the promenade, stadium on the open grass east of the park.
    addVenue(boxes, cols, -99, 176, 20, 20, 8, "e", "museum"),
    addVenue(boxes, cols, -98, 126, 20, 20, 8, "e", "hotel"),
    addVenue(boxes, cols, -28, -190, 17, 20, 8, "s", "casino"),
    addVenue(boxes, cols, 172, 188, 20, 20, 8, "n", "nightclub"),
  ];
  zones.push(addSunsetPark(boxes, cols, 94, 204, 54, 26));
  zones.push(addStadium(boxes, cols, 148, 204, 46, 26));
  // Stone promenade linking the z=180 road to the gym + park, so the
  // waterfront venues are reachable on foot, not across bare grass.
  put(boxes, 103, 0.1, 201, 94, 0.06, 4, "stone");
  put(boxes, 73, 0.1, 192.5, 6, 0.06, 15, "stone");
  // Promenade extension to the stadium door + a stone path from the z=180
  // road to the nightclub door.
  put(boxes, 171, 0.1, 201, 46, 0.06, 4, "stone");
  put(boxes, 182, 0.1, 184, 6, 0.06, 8, "stone");
  addHarbor(boxes, cols);
  zones.push(addVenue(boxes, cols, -8, 212, 16, 14, 7, "n", "dock"));

  const projectZs = [-65, -137, 43, 79];
  projectZs.forEach((z0, index) => {
    const h = [18, 26, 14, 20][index];
    zones.push(addVenue(boxes, cols, -101, z0, 22, 22, h, "e", "project", index));
  });
  addPark(boxes, cols, -101, -101, -79, -79);
  addPark(boxes, cols, -101, 101, -79, 123);

  addKiosk(boxes, cols, 10, 16, "white");
  addKiosk(boxes, cols, -10, 16, "cyan");
  addKiosk(boxes, cols, 8, 68, "white");

  const anchors: Anchor[] = [
    { id: "shop", name: "OrbitX Shop", kind: "shop", x: 5.6, y: 0, z: 54, yaw: Math.PI / 2, slot: 0 },
    { id: "cafe", name: "Cafe Nova", kind: "cafe", x: -5.6, y: 0, z: 54, yaw: -Math.PI / 2, slot: 1 },
    { id: "hall", name: "Community Hall", kind: "hall", x: 41.6, y: 0, z: 90, yaw: Math.PI / 2, slot: 2 },
    { id: "jobs", name: "Jobs board", kind: "jobs", x: 10, y: 0, z: 17.6, yaw: 0, slot: 0 },
    { id: "events", name: "Events board", kind: "events", x: -10, y: 0, z: 17.6, yaw: 0, slot: 0 },
    { id: "ads", name: "Billboard desk", kind: "ads", x: 12, y: 0, z: 66, yaw: 0, slot: 0 },
    { id: "bank", name: "OrbitX Bank", kind: "bank", x: 77.6, y: 0, z: -54, yaw: Math.PI / 2, slot: 0 },
    { id: "garage", name: "Hover Garage", kind: "garage", x: 77.6, y: 0, z: 54, yaw: Math.PI / 2, slot: 0 },
    { id: "arcade", name: "Neon Arcade", kind: "arcade", x: 41.6, y: 0, z: 54, yaw: Math.PI / 2, slot: 0 },
    { id: "market", name: "Night Market", kind: "market", x: -18, y: 0, z: 77.6, yaw: Math.PI, slot: 0 },
    { id: "dock", name: "Harbor Office", kind: "dock", x: 0, y: 0, z: 210.6, yaw: Math.PI, slot: 0 },
    // New venue doors: doorAnchor puts the anchor just outside the door,
    // facing in (walk-in is E at the anchor).
    doorAnchor("cinema", "OrbitX Cinema", "cinema", -99, -171, 20, 20, "e"),
    doorAnchor("library", "OrbitX Library", "library", -99, 153, 20, 20, "e"),
    doorAnchor("gym", "Harbor Gym", "gym", 60, 206, 26, 22, "n"),
    doorAnchor("park", "Sunset Park", "park", 94, 204, 54, 26, "n"),
    doorAnchor("museum", "OrbitX Museum", "museum", -99, 176, 20, 20, "e"),
    doorAnchor("hotel", "OrbitX Hotel", "hotel", -98, 126, 20, 20, "e"),
    doorAnchor("casino", "Neon Casino", "casino", -28, -190, 17, 20, "s"),
    doorAnchor("nightclub", "Club Orbit", "nightclub", 172, 188, 20, 20, "n"),
    doorAnchor("stadium", "OrbitX Stadium", "stadium", 148, 204, 46, 26, "n"),
  ];
  projectZs.forEach((z0, index) => {
    anchors.push({
      id: `project-${index}`,
      name: "Project office",
      kind: "project",
      x: -77.4,
      y: 0,
      z: z0 + 11,
      yaw: -Math.PI / 2,
      slot: index,
    });
  });

  const boards: BoardSlot[] = [
    { id: "plaza-east", x: 6.35, y: 7.2, z: 54, rotY: -Math.PI / 2 },
    { id: "plaza-west", x: -6.35, y: 6.6, z: 54, rotY: Math.PI / 2 },
    { id: "hall-front", x: 42.35, y: 7.4, z: 18, rotY: -Math.PI / 2 },
    { id: "district-row", x: -78.35, y: 8.2, z: -54, rotY: Math.PI / 2 },
  ];
  return { anchors, boards, zones };
}

function blocked(cols: Collider[], x: number, z: number) {
  return cols.some(
    (c) => x > c.minX - 0.4 && x < c.maxX + 0.4 && z > c.minZ - 0.4 && z < c.maxZ + 0.4 && c.minY < 1.8 && c.maxY > 0.05,
  );
}

export function buildCity(seed: number): City {
  facades.length = 0;
  art.length = 0;
  const rng = makeRng(seed || 1);
  const boxes: Box[] = [];
  const colliders: Collider[] = [];
  addRoads(boxes);
  addPlaza(boxes, colliders);
  const towerTop = addTower(boxes, colliders);
  const built = addBuildings(boxes, colliders, rng, seed || 1);
  const fixed = addFixedPlaces(boxes, colliders);
  const mall = addMegaMall(boxes, colliders);
  const office = addMegaOffice(boxes, colliders);
  // District towers + departments (emergency.ts). Boxes/colliders are
  // pushed directly into the shared arrays; zones/anchors/facades/art/
  // lifts merge into the City literal below.
  const emergencyParts: CityParts = {
    boxes,
    colliders,
    zones: [] as Zone[],
    anchors: [] as Anchor[],
    lifts: [] as Lift[],
    facades: [] as Facade[],
    art: [] as Art[],
  };
  buildAllDistricts(emergencyParts);
  addStreetLife(boxes, colliders, rng);
  const rail = loopPoints();
  addMonorail(boxes, colliders, rail);
  addHills(boxes, colliders, rng);

  let sz = 62;
  let sx = 0;
  for (let i = 0; i < 30 && blocked(colliders, sx, sz); i++) sz += 2;

  const ships: ShipPath[] = [
    { y: 22, radiusX: 58, radiusZ: 46, speed: 0.16, phase: rng() * 6 },
    { y: 30, radiusX: 84, radiusZ: 62, speed: 0.11, phase: rng() * 6 },
    { y: 42, radiusX: 108, radiusZ: 78, speed: 0.08, phase: rng() * 6 },
    { y: 18, radiusX: 48, radiusZ: 40, speed: 0.2, phase: rng() * 6 },
    { y: 36, radiusX: 96, radiusZ: 70, speed: 0.1, phase: rng() * 6 },
  ];

  const city: City = {
    boxes,
    colliders,
    rail,
    ships,
    spawn: { x: sx, y: 0, z: sz, yaw: 0, pitch: 0.44 },
    focus: { x: 0, y: Math.max(36, towerTop * 0.45), z: -10 },
    fountain: FOUNTAIN,
    anchors: [...fixed.anchors, ...built.anchors, ...mall.anchors, ...office.anchors, ...emergencyParts.anchors],
    boards: fixed.boards,
    zones: [...fixed.zones, ...built.zones, ...mall.zones, ...office.zones, ...emergencyParts.zones],
    facades: [...facades, ...emergencyParts.facades],
    art: [...art, ...emergencyParts.art],
    lifts: [...mall.lifts, ...office.lifts, ...emergencyParts.lifts],
    cars: [
      { id: "north", x: 0, z: 46, yaw: 0 },
      { id: "south", x: 0, z: 84, yaw: Math.PI },
      { id: "east", x: 36, z: 50, yaw: 0 },
      { id: "west", x: -36, z: 50, yaw: Math.PI },
      { id: "east-ave", x: 72, z: 90, yaw: 0 },
      { id: "west-ave", x: -72, z: -90, yaw: Math.PI },
      { id: "north-ave", x: 18, z: 72, yaw: Math.PI / 2 },
      { id: "south-ave", x: -18, z: -72, yaw: -Math.PI / 2 },
      { id: "garage-row", x: 72, z: 54, yaw: Math.PI },
      { id: "pier", x: 0, z: 220, yaw: 0 },
      { id: "outer-north", x: -108, z: 50, yaw: 0 },
      { id: "outer-south", x: 108, z: -50, yaw: Math.PI },
      { id: "outer-east", x: 144, z: 18, yaw: 0 },
      { id: "outer-west", x: -144, z: -18, yaw: Math.PI },
      { id: "outer-ne", x: 180, z: 54, yaw: Math.PI / 2 },
      { id: "outer-nw", x: -180, z: -54, yaw: -Math.PI / 2 },
      { id: "outer-se", x: 54, z: 180, yaw: Math.PI },
      { id: "outer-sw", x: -54, z: -180, yaw: 0 },
    ],
    citizens: [
      { name: "Rio", color: "sunset", x: 4, z: 20 },
      { name: "Mina", color: "cyan", x: -18, z: 54 },
      { name: "Sol", color: "gold", x: 12, z: 54 },
      { name: "Nox", color: "black", x: 72, z: 40 },
      { name: "Pia", color: "white", x: -24, z: 86 },
      { name: "Kai", color: "cyan", x: 6, z: 204 },
      { name: "Juno", color: "sunset", x: 37, z: 97 },
      { name: "Theo", color: "white", x: 20, z: -2 },
      { name: "Vera", color: "gold", x: -74, z: -161 },
      { name: "Otis", color: "white", x: -74, z: 163 },
      { name: "Remy", color: "red", x: 73, z: 201 },
      { name: "Wren", color: "cyan", x: 117, z: 209 },
      { name: "Nadia", color: "sunset", x: 74, z: -50 },
      { name: "Felix", color: "silver", x: 38, z: 58 },
    ],
  };

  // GTA / FiveM expansion: states first (roads/core/blocks/services/tower),
  // homes second (they sit on the outer-ring plots the region builder leaves
  // free), bridges last (decks + gates are standalone). Must run inside
  // buildCity — cityMapModel caches by seed, so calling these after
  // buildCity() returns would serve a pre-states model.
  buildAllRegions(city, seed || 1);
  buildAllHomes(city, seed || 1);
  buildAllBridges(city);
  return city;
}

export interface CityMapModel {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  roads: number[];
  blocks: Array<{ x: number; z: number; w: number; d: number; style: number; hero: boolean }>;
  plaza: { x: number; z: number; w: number; d: number };
  tower: { x: number; z: number; w: number; d: number };
  harbor: { x: number; z: number; w: number; d: number };
  venues: Array<{ id: string; name: string; x: number; z: number }>;
}

const mapModelCache = new Map<number, CityMapModel>();
export function cityMapModel(seed: number): CityMapModel {
  const key = seed || 1;
  const cached = mapModelCache.get(key);
  if (cached) return cached;
  const city = buildCity(key);
  const model: CityMapModel = {
    minX: WORLD_BOUNDS.minX,
    maxX: WORLD_BOUNDS.maxX,
    minZ: WORLD_BOUNDS.minZ,
    maxZ: WORLD_BOUNDS.maxZ,
    roads: [...CENTERS],
    blocks: [
      ...city.facades.map((f) => ({ x: f.x, z: f.z, w: f.w, d: f.d, style: f.style, hero: f.hero })),
      // Side annexes get their own minimap rect so the map matches the world.
      ...city.facades.flatMap((f) =>
        f.wing
          ? [{ x: f.x + f.wing.dx, z: f.z + f.wing.dz, w: f.wing.w, d: f.wing.d, style: f.wing.style, hero: false }]
          : [],
      ),
    ],
    plaza: { x: -29, z: -29, w: 58, d: 58 },
    tower: { x: -16, z: -31, w: 32, d: 32 },
    harbor: { x: -50, z: 198, w: 100, d: 48 },
    venues: city.anchors.map((a) => ({ id: a.id, name: a.name, x: a.x, z: a.z })),
  };
  mapModelCache.set(key, model);
  return model;
}
