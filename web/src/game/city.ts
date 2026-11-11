import { makeRng, type Rng } from "./seed";

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
  kind: "shop" | "cafe" | "hall" | "project" | "jobs" | "events" | "ads" | "bank" | "garage" | "arcade" | "market" | "dock" | "mall" | "office" | "lift";
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
  kind: "shop" | "cafe" | "hall" | "project" | "bank" | "garage" | "arcade" | "market" | "dock" | "mall" | "office";
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

type Face = "n" | "s" | "e" | "w";

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

function addBuildings(boxes: Box[], cols: Collider[], rng: Rng, seed: number): { zones: Zone[]; anchors: Anchor[] } {
  // A separate rng stream for yards/homes so the main sequence (heights,
  // styles, street life) stays identical to before.
  const yardRng = makeRng((seed || 1) * 131 + 7);
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
        const home = addHome(boxes, cols, bx, bz, bw, bd, height, face, homesBuilt);
        zones.push(home.zone);
        anchors.push(home.anchor);
        homesBuilt++;
        continue;
      }
      facades.push({
        id: `block-${x0}-${z0}`,
        x: bx,
        z: bz,
        w: bw,
        d: bd,
        h: height,
        style,
        door: "",
        enterable: false,
        hero: false,
      });
      const baseX = bx;
      const baseZ = bz;
      const baseW = bw;
      const baseD = bd;
      let y = 0;
      let guard = 0;
      while (y < height && guard < 8) {
        guard++;
        const slice = Math.min(8, height - y);
        y = shell(
          boxes,
          cols,
          bx,
          y,
          bz,
          bw,
          slice,
          bd,
          (u, ly, f) => {
            const len = f === "n" || f === "s" ? bw : bd;
            return facadeSample(style, len)(u, ly);
          },
          "black",
        );
        if (y < height && bw > 16 && bd > 16 && height - y > 8 && rng() > 0.35) {
          bx += 2;
          bz += 2;
          bw -= 4;
          bd -= 4;
        }
      }
      const roofY = y;
      if (bw >= 12 && bd >= 12 && rng() > 0.42) {
        const gx0 = bx + 2;
        const gz0 = bz + 2;
        const gw = bw - 4;
        const gd = bd - 4;
        put(boxes, gx0 + gw / 2, roofY + 0.2, gz0 + gd / 2, gw, 0.35, gd, "grass");
        put(boxes, gx0 + gw / 2, roofY + 0.7, gz0 + 0.4, gw, 0.7, 0.7, "hedge");
        put(boxes, gx0 + gw / 2, roofY + 0.7, gz0 + gd - 0.4, gw, 0.7, 0.7, "hedge");
        if (gw > 6) addTree(boxes, cols, gx0 + 2, gz0 + Math.max(3, gd / 2), roofY + 0.3);
      }
      addAwning(boxes, bx, bz, bw, bd, face);
      if (height > 18) addBalcony(boxes, bx, Math.min(12, roofY - 4), bz, bw, bd, face);
      if (height > 22) addCrown(boxes, cols, bx + bw / 2, roofY, bz + bd / 2, bw, bd);
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
  put(boxes, mat.x, 0.06, mat.z, counterAlongX ? 3.2 : 2.2, 0.04, counterAlongX ? 2.2 : 3.2, "gold");
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
  });
  if (kind === "shop") return furnishShop(boxes, cols, x0, z0, w, d, door);
  if (kind === "cafe") return furnishCafe(boxes, cols, x0, z0, w, d, door);
  if (kind === "hall") return furnishHall(boxes, cols, x0, z0, w, d, door);
  if (kind === "project") return furnishOffice(boxes, cols, x0, z0, w, d, door, index);
  return furnishSpot(boxes, cols, x0, z0, w, d, door, kind);
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
  put(boxes, back.x, 0.6, back.z, alongX ? 6.4 : 1.1, 1.1, alongX ? 1.1 : 6.4, kind === "arcade" ? "cyan" : "black");
  cols.push(col(back.x, 0.6, back.z, alongX ? 6.4 : 1.1, 1.1, alongX ? 1.1 : 6.4));
  put(boxes, cx, 0.45, cz, 2.2, 0.8, 1.2, "wood");
  cols.push(col(cx, 0.45, cz, 2.2, 0.8, 1.2));
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

function addHome(boxes: Box[], cols: Collider[], x0: number, z0: number, w: number, d: number, h: number, door: Face, index: number): { zone: Zone; anchor: Anchor } {
  const style = index % 2 === 0 ? 1 : 3;
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
    id: `home-${index}`,
    x: x0,
    z: z0,
    w,
    d,
    h,
    style,
    door,
    enterable: true,
    hero: false,
  });
  const zone = furnishHome(boxes, cols, x0, z0, w, d, door, index);
  const anchor = doorAnchor(`home-${index}`, `Home ${index + 1}`, "hall", x0, z0, w, d, door, index);
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
  // Floor slabs: 8 (with the lobby void hole), 12, 16, 20 (roof terrace).
  slabWithHoles(boxes, cols, x0, 8, z0, w, d, [[x0, 5, x0 + w, z0 + d], [-99, -27, -95, -23]], "cream");
  slabWithHoles(boxes, cols, x0, 12, z0, w, d, [[-99, -27, -95, -23]], "cream");
  slabWithHoles(boxes, cols, x0, 16, z0, w, d, [[-99, -27, -95, -23]], "cream");
  slabWithHoles(boxes, cols, x0, 20, z0, w, d, [[-99, -27, -95, -23]], "cream");
  // Floor 2 (y=8, south strip only): open office (north) + lounge (south,
  // behind the partition wall). The meeting table sits against the north
  // wall so its screen hangs on it.
  wallRunX(boxes, cols, -99, -57, 8, -14, 4, "cream", -78, 2.4);
  deskRow(boxes, cols, -95, 8, -20, 4, 5, true);
  deskRow(boxes, cols, -95, 8, -24, 4, 5, true);
  meetingTable(boxes, cols, -50, 8, -24.2, 6, 4);
  loungeSet(boxes, cols, -72, 8, -4, "s", 3.7);
  hangLights(boxes, -72, 12, -16, 40, 20);
  // (The floor-2 zone sign carries the "FLOOR 2" label.)
  // Floor 3 (y=12): open office + lounge.
  wallRunX(boxes, cols, -99, -57, 12, 6, 4, "cream", -78, 2.4);
  deskRow(boxes, cols, -95, 12, -12, 4, 5, true);
  deskRow(boxes, cols, -95, 12, -16, 4, 5, true);
  deskRow(boxes, cols, -95, 12, -20, 4, 5, true);
  loungeSet(boxes, cols, -72, 12, 16, "n", 27.7);
  voxelPainting(boxes, -52, 14, 27.7, Math.PI, 2.2, 1.5);
  hangLights(boxes, -72, 16, 0, 40, 30);
  // (The floor-3 zone sign carries the "FLOOR 3" label.)
  // Floor 4 (y=16): two meeting rooms (screens on the north wall) +
  // kitchenette on the south wall.
  wallRunZ(boxes, cols, -27, -3, 16, -71, 4, "cream", -15, 2.4);
  wallRunX(boxes, cols, -99, -71, 16, -3, 4, "cream", -85, 2.4);
  meetingTable(boxes, cols, -85, 16, -24.2, 6, 4);
  meetingTable(boxes, cols, -57, 16, -24.2, 6, 4);
  kitchenette(boxes, cols, -48, 16, 26, true);
  voxelPainting(boxes, -99 + 1.3, 18, -15, Math.PI / 2, 2.2, 1.5);
  hangLights(boxes, -72, 20, 0, 40, 30);
  // (The floor-4 zone sign carries the "FLOOR 4" label.)
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
    addVenue(boxes, cols, 7, 43, 22, 22, 16, "w", "shop"),
    addVenue(boxes, cols, -29, 43, 22, 22, 14, "e", "cafe"),
    addVenue(boxes, cols, 43, 79, 22, 22, 18, "w", "hall"),
    addVenue(boxes, cols, 79, -65, 22, 22, 16, "w", "bank"),
    addVenue(boxes, cols, 79, 43, 22, 22, 14, "w", "garage"),
    addVenue(boxes, cols, 43, 43, 22, 22, 12, "w", "arcade"),
    addVenue(boxes, cols, -29, 79, 22, 22, 12, "n", "market"),
  ];
  addHarbor(boxes, cols);
  zones.push(addVenue(boxes, cols, -8, 212, 16, 14, 10, "n", "dock"));

  const projectZs = [-65, -137, 43, 79];
  projectZs.forEach((z0, index) => {
    const h = [22, 30, 18, 26][index];
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

  return {
    boxes,
    colliders,
    rail,
    ships,
    spawn: { x: sx, y: 0, z: sz, yaw: 0, pitch: 0.44 },
    focus: { x: 0, y: Math.max(36, towerTop * 0.45), z: -10 },
    fountain: FOUNTAIN,
    anchors: [...fixed.anchors, ...built.anchors, ...mall.anchors, ...office.anchors],
    boards: fixed.boards,
    zones: [...fixed.zones, ...built.zones, ...mall.zones, ...office.zones],
    facades: facades.slice(),
    art: art.slice(),
    lifts: [...mall.lifts, ...office.lifts],
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
      { name: "Mina", color: "cyan", x: -16, z: 50 },
      { name: "Sol", color: "gold", x: 16, z: 28 },
      { name: "Nox", color: "black", x: 72, z: 40 },
      { name: "Pia", color: "white", x: -18, z: 90 },
      { name: "Harbor", color: "cyan", x: 0, z: 206 },
    ],
  };
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
    minX: -190,
    maxX: 190,
    minZ: -190,
    maxZ: 258,
    roads: [...CENTERS],
    blocks: city.facades.map((f) => ({ x: f.x, z: f.z, w: f.w, d: f.d, style: f.style, hero: f.hero })),
    plaza: { x: -29, z: -29, w: 58, d: 58 },
    tower: { x: -16, z: -31, w: 32, d: 32 },
    harbor: { x: -50, z: 198, w: 100, d: 48 },
    venues: city.anchors.map((a) => ({ id: a.id, name: a.name, x: a.x, z: a.z })),
  };
  mapModelCache.set(key, model);
  return model;
}
