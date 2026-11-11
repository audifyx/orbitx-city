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
}

export interface Collider {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
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
  kind: "shop" | "cafe" | "hall" | "project" | "jobs" | "events" | "ads";
  x: number;
  y: number;
  z: number;
  yaw: number;
  slot: number;
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
  kind: "shop" | "cafe" | "hall" | "project";
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
}

const CENTERS = [-108, -72, -36, 0, 36, 72, 108];
const HALF = 5;
const SIDE = 2;
const SOUTH = -3;
const FOUNTAIN = { x: 0, z: 12 };
const TRACK_HALF = 74;
const TRACK_R = 18;
const TRACK_Y = 30;

const FONT: Record<string, string[]> = {
  O: ["01110", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "11110", "10010", "10001"],
  B: ["11110", "10001", "11110", "10001", "11110"],
  I: ["11111", "00100", "00100", "00100", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100"],
  X: ["10001", "01010", "00100", "01010", "10001"],
};

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
  boxes.push({ x, y, z, sx, sy, sz, mat, ry });
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
  emitX(boxes, x0, y0, z0, w, h, (u, ly) => sample(u, ly, "n"));
  emitX(boxes, x0, y0, z0 + d - 1, w, h, (u, ly) => sample(u, ly, "s"));
  if (d > 2) {
    emitZ(boxes, x0, y0, z0 + 1, d - 2, h, (u, ly) => sample(u, ly, "w"));
    emitZ(boxes, x0 + w - 1, y0, z0 + 1, d - 2, h, (u, ly) => sample(u, ly, "e"));
  }
  put(boxes, x0 + w / 2, y0 + h + 0.5, z0 + d / 2, w, 1, d, roof);
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
  emitX(boxes, x0, y0, z0, w, h, (u, ly) => sample(u, ly, "n", w));
  emitX(boxes, x0, y0, z0 + d - 1, w, h, (u, ly) => sample(u, ly, "s", w));
  if (d > 2) {
    emitZ(boxes, x0, y0, z0 + 1, d - 2, h, (u, ly) => sample(u, ly, "w", d - 2));
    emitZ(boxes, x0 + w - 1, y0, z0 + 1, d - 2, h, (u, ly) => sample(u, ly, "e", d - 2));
  }
  put(boxes, x0 + w / 2, y0 + h + 0.5, z0 + d / 2, w, 1, d, roof);
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
  const y = 3.35;
  if (face === "n") put(boxes, x0 + w / 2, y, z0 - 0.75, Math.max(4, w * 0.7), 0.14, 1.35, "white");
  if (face === "s") put(boxes, x0 + w / 2, y, z0 + d + 0.75, Math.max(4, w * 0.7), 0.14, 1.35, "white");
  if (face === "w") put(boxes, x0 - 0.75, y, z0 + d / 2, 1.35, 0.14, Math.max(4, d * 0.7), "white");
  if (face === "e") put(boxes, x0 + w + 0.75, y, z0 + d / 2, 1.35, 0.14, Math.max(4, d * 0.7), "white");
}

function addBalcony(boxes: Box[], x0: number, y: number, z0: number, w: number, d: number, face: Face) {
  if (face === "n") put(boxes, x0 + w / 2, y, z0 - 0.55, w * 0.72, 0.16, 1.1, "stone");
  if (face === "s") put(boxes, x0 + w / 2, y, z0 + d + 0.55, w * 0.72, 0.16, 1.1, "stone");
  if (face === "w") put(boxes, x0 - 0.55, y, z0 + d / 2, 1.1, 0.16, d * 0.72, "stone");
  if (face === "e") put(boxes, x0 + w + 0.55, y, z0 + d / 2, 1.1, 0.16, d * 0.72, "stone");
}

function addCrown(boxes: Box[], cols: Collider[], x: number, y: number, z: number, w: number, d: number) {
  const cw = Math.max(4, w * 0.42);
  const cd = Math.max(4, d * 0.42);
  put(boxes, x, y + 1.3, z, cw, 2.4, cd, "white");
  put(boxes, x, y + 2.7, z, cw * 0.5, 0.45, cd * 0.5, "cyan");
  put(boxes, x, y + 5.4, z, 0.4, 4.6, 0.4, "gray");
  put(boxes, x, y + 7.9, z, 0.75, 0.75, 0.75, "cyanhot");
  cols.push(col(x, y + 1.3, z, cw, 2.4, cd));
  cols.push(col(x, y + 5.4, z, 0.4, 4.6, 0.4));
}

function addTowerPorch(boxes: Box[], cols: Collider[]) {
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

function addSign(boxes: Box[], cols: Collider[], roofY: number) {
  const ps = 1.48;
  const word = "ORBITX";
  const glyph = 5;
  const gap = 1;
  const totalCols = word.length * glyph + (word.length - 1) * gap;
  const totalW = totalCols * ps;
  const platY = roofY + 0.4;
  put(boxes, 0, platY, SOUTH + 1.15, totalW + 2, 0.7, 5.2, "black");
  put(boxes, 0, platY + 0.45, SOUTH + 1.15, totalW + 2.4, 0.18, 0.35, "cyanhot");
  cols.push(col(0, platY, SOUTH + 1.15, totalW + 2, 0.7, 5.2));
  let cursor = -totalW / 2;
  const z = SOUTH + 2.35;
  for (const ch of word) {
    const rows = FONT[ch];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== "1") continue;
        const x = cursor + (c + 0.5) * ps;
        const y = platY + 0.55 + (4 - r) * ps;
        put(boxes, x, y, z - 0.55, ps * 1.05, ps * 1.05, 0.35, "black");
        put(boxes, x, y, z, ps * 0.9, ps * 0.9, 0.85, "cyanhot");
      }
    }
    cursor += (glyph + gap) * ps;
  }
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
  addSign(boxes, cols, y);
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

function addBuildings(boxes: Box[], cols: Collider[], rng: Rng) {
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
      const maxH = dist < 68 ? 48 : dist < 100 ? 34 : 24;
      const minH = dist < 68 ? 26 : dist < 100 ? 16 : 12;
      let height = minH + Math.floor(rng() * (maxH - minH + 1));
      if (dist < 62 && rng() > 0.72) height += 8;
      height = Math.min(height, 54);
      const style = Math.floor(rng() * 4);
      const face = frontFace(cx, cz);
      let y = 0;
      let bx = x0;
      let bz = z0;
      let bw = w;
      let bd = d;
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
      if (height > 22 && dist > 40 && dist < 96 && rng() > 0.55) {
        addBillboard(boxes, x0, 8, z0, w, d, face, Math.floor(rng() * 6));
      }
    }
  }
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

function addRoads(boxes: Box[]) {
  put(boxes, 0, -0.55, 0, 520, 1.1, 520, "hill");
  put(boxes, 0, 0.02, 0, 250, 0.04, 250, "sidewalk");
  put(boxes, 0, 0.045, 0, 58, 0.05, 58, "plaza");

  const nsBlock: Array<[number, number]> = CENTERS.map((c) => [c - HALF, c + HALF]);
  const plazaBlock: Array<[number, number]> = [[-31, 31]];

  for (const cx of CENTERS) {
    const zSpans = cx === 0
      ? gapsOutside(plazaBlock, -124, 124)
      : [[-124, 124] as [number, number]];
    for (const [z0, z1] of zSpans) {
      put(boxes, cx, 0.055, (z0 + z1) / 2, HALF * 2, 0.05, z1 - z0, "asphalt");
    }
  }
  for (const cz of CENTERS) {
    const extra = cz === 0 ? plazaBlock : [];
    const xSpans = gapsOutside([...nsBlock, ...extra], -124, 124);
    for (const [x0, x1] of xSpans) {
      put(boxes, (x0 + x1) / 2, 0.055, cz, x1 - x0, 0.05, HALF * 2, "asphalt");
    }
  }

  const nearCross = (v: number) => CENTERS.some((c) => Math.abs(v - c) < 9);

  for (const cx of CENTERS) {
    for (let z = -120; z <= 120; z += 5) {
      if (nearCross(z)) continue;
      if (cx === 0 && Math.abs(z) < 34) continue;
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
        put(boxes, x, 0.095, (z0 + z1) / 2, 0.16, 0.03, z1 - z0, "lane");
      }
    }
  }
  for (const cz of CENTERS) {
    for (let x = -120; x <= 120; x += 5) {
      if (nearCross(x)) continue;
      if (cz === 0 && Math.abs(x) < 34) continue;
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
}

function addStreetLife(boxes: Box[], cols: Collider[], rng: Rng) {
  let lampI = 0;
  for (const cx of CENTERS) {
    for (const side of [-1, 1]) {
      const x = cx + side * 6.15;
      for (let z = -110; z <= 110; z += 16) {
        if (CENTERS.some((c) => Math.abs(z - c) < 10)) continue;
        if (Math.abs(x) < 32 && Math.abs(z) < 32) continue;
        lampI++;
        if (lampI % 2 === 0) addLamp(boxes, x, z);
        else if (rng() > 0.55) addTree(boxes, cols, x, z, 0);
      }
    }
  }
  for (const cz of CENTERS) {
    for (const side of [-1, 1]) {
      const z = cz + side * 6.15;
      for (let x = -110; x <= 110; x += 16) {
        if (CENTERS.some((c) => Math.abs(x - c) < 10)) continue;
        if (Math.abs(x) < 32 && Math.abs(z) < 32) continue;
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
    const rad = 175 + rng() * 28;
    const h = 12 + rng() * 26;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    const sx = 22 + rng() * 18;
    const sz = 18 + rng() * 16;
    put(boxes, x, h / 2 - 1, z, sx, h, sz, "hill");
    cols.push(col(x, h / 2 - 1, z, sx, h, sz));
  }
}

function reservedPlot(x0: number, x1: number, z0: number, z1: number) {
  if (x0 >= -101 && x1 <= -79) return true;
  const spots: Array<[number, number, number, number]> = [
    [7, 29, 43, 65],
    [-29, -7, 43, 65],
    [43, 65, 7, 29],
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
  for (const z of shelfZ) {
    put(boxes, cx, 0.85, z, w - 8, 1.5, 0.7, "wood");
    cols.push(col(cx, 0.85, z, w - 8, 1.5, 0.7));
    put(boxes, cx, 1.62, z, w - 8, 0.1, 0.78, "stone");
    put(boxes, cx - 2.4, 1.9, z, 0.7, 0.4, 0.45, "cyan");
    put(boxes, cx, 1.9, z, 0.55, 0.45, 0.45, "gold");
    put(boxes, cx + 2.4, 1.85, z, 0.45, 0.55, 0.4, "white");
    put(boxes, cx + 4, 1.85, z, 0.4, 0.35, 0.4, "red");
  }
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
  if (kind === "shop") return furnishShop(boxes, cols, x0, z0, w, d, door);
  if (kind === "cafe") return furnishCafe(boxes, cols, x0, z0, w, d, door);
  if (kind === "hall") return furnishHall(boxes, cols, x0, z0, w, d, door);
  return furnishOffice(boxes, cols, x0, z0, w, d, door, index);
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

function addFixedPlaces(boxes: Box[], cols: Collider[]): { anchors: Anchor[]; boards: BoardSlot[]; zones: Zone[] } {
  const zones = [
    addVenue(boxes, cols, 7, 43, 22, 22, 16, "w", "shop"),
    addVenue(boxes, cols, -29, 43, 22, 22, 14, "e", "cafe"),
    addVenue(boxes, cols, 43, 7, 22, 22, 18, "w", "hall"),
  ];

  const projectZs = [-65, -29, 43, 79];
  projectZs.forEach((z0, index) => {
    const h = [22, 30, 18, 26][index];
    zones.push(addVenue(boxes, cols, -101, z0, 22, 22, h, "e", "project", index));
  });
  addPark(boxes, cols, -101, -101, -79, -79);
  addPark(boxes, cols, -101, 7, -79, 29);

  addKiosk(boxes, cols, 10, 16, "white");
  addKiosk(boxes, cols, -10, 16, "cyan");
  addKiosk(boxes, cols, 8, 68, "white");

  const anchors: Anchor[] = [
    { id: "shop", name: "OrbitX Shop", kind: "shop", x: 5.6, y: 0, z: 54, yaw: Math.PI / 2, slot: 0 },
    { id: "cafe", name: "Cafe Nova", kind: "cafe", x: -5.6, y: 0, z: 54, yaw: -Math.PI / 2, slot: 1 },
    { id: "hall", name: "Community Hall", kind: "hall", x: 41.6, y: 0, z: 18, yaw: Math.PI / 2, slot: 2 },
    { id: "jobs", name: "Jobs board", kind: "jobs", x: 10, y: 0, z: 17.6, yaw: 0, slot: 0 },
    { id: "events", name: "Events board", kind: "events", x: -10, y: 0, z: 17.6, yaw: 0, slot: 0 },
    { id: "ads", name: "Billboard desk", kind: "ads", x: 8, y: 0, z: 69.8, yaw: 0, slot: 0 },
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
  const rng = makeRng(seed || 1);
  const boxes: Box[] = [];
  const colliders: Collider[] = [];
  addRoads(boxes);
  addPlaza(boxes, colliders);
  const towerTop = addTower(boxes, colliders);
  addBuildings(boxes, colliders, rng);
  const fixed = addFixedPlaces(boxes, colliders);
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
    anchors: fixed.anchors,
    boards: fixed.boards,
    zones: fixed.zones,
    cars: [
      { id: "north", x: 0, z: 46, yaw: 0 },
      { id: "south", x: 0, z: 84, yaw: Math.PI },
      { id: "east", x: 36, z: 50, yaw: 0 },
      { id: "west", x: -36, z: 50, yaw: Math.PI },
      { id: "east-ave", x: 72, z: 18, yaw: 0 },
      { id: "west-ave", x: -72, z: -18, yaw: Math.PI },
      { id: "north-ave", x: 18, z: 72, yaw: Math.PI / 2 },
      { id: "south-ave", x: -18, z: -72, yaw: -Math.PI / 2 },
    ],
  };
}
