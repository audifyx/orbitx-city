/**
 * OrbitX City — SKY / AIR layer (realistic overhaul, round 2, 2026-11-24).
 *
 * The "crazy" layer from the style videos: flying cars with headlights
 * on sky lanes above the road grid, drones buzzing the towers, a giant
 * rotating ORBITX hologram over the plaza with a light beam, holographic
 * billboards floating above tower roofs, vertical light beams, and
 * instanced pedestrian crowds on the plaza + shopfront sidewalks.
 *
 * CHEAP by design: one InstancedMesh per moving class (flying-car
 * bodies, headlights, taillights, drone bodies, drone lights, crowd
 * bodies, crowd heads), shared geometries/materials, no per-frame
 * allocations (a module-scope dummy + temp vectors), quality gates
 * (low = hologram + beams only; medium = fewer cars/crowds).
 * Visuals only — no colliders, no gameplay logic.
 *
 * Node-safe: canvas textures are built only when `document` exists;
 * without it the hologram planes are skipped and the geometry-only
 * systems still build.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { City, Facade } from "./city";
import type { QualityName } from "./pretty";

export interface SkyLayer {
  group: Group;
  update: (dt: number, t: number, nightF: number, dayF: number, indoors: boolean) => void;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dummy = new Object3D();
const tmpM = new Matrix4();

/** Rotate a local (ox, oz) offset by rotation.y = yaw into world space. */
function rotOffset(ox: number, oz: number, yaw: number, out: { x: number; z: number }) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.x = ox * c + oz * s;
  out.z = -ox * s + oz * c;
}

/* ------------------------------------------------------------------ */
/* Hologram canvas textures                                           */
/* ------------------------------------------------------------------ */

function holoTexture(lines: string[], accent: string): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1024, 512);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Outer ring (the holo "projector" frame).
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(512, 256, 225, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(512, 256, 205, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const n = lines.length;
  lines.forEach((line, i) => {
    const y = 256 + (i - (n - 1) / 2) * 150;
    const size = Math.min(150, Math.floor(900 / Math.max(4, line.length * 0.62)));
    ctx.font = `800 ${size}px 'Arial Black', sans-serif`;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 48;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 7;
    ctx.strokeText(line, 512, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, 512, y);
  });
  // Scanlines — the hologram flicker read from the frames.
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#ffffff";
  for (let y = 0; y < 512; y += 8) ctx.fillRect(0, y, 1024, 2);
  ctx.globalAlpha = 1;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Flying cars                                                        */
/* ------------------------------------------------------------------ */

interface LoopRect {
  hx: number;
  hz: number;
  y: number;
  speed: number;
  dir: number;
  phase: number;
}
interface AvenueRun {
  axis: "x" | "z";
  fixed: number;
  from: number;
  to: number;
  y: number;
  speed: number;
  phase: number;
}

function buildFlyerGeometry() {
  // One sleek pod: capsule hull + squashed-sphere cabin + flat disc
  // wings + tail fin. Forward is +X (matches the engine's nose vector).
  const hull = new CapsuleGeometry(0.55, 2.6, 4, 10);
  hull.rotateZ(Math.PI / 2);
  const cabin = new SphereGeometry(0.55, 12, 8);
  cabin.scale(1.7, 0.55, 0.85);
  cabin.translate(0.15, 0.48, 0);
  const wing = new CylinderGeometry(0.5, 0.5, 0.12, 12);
  wing.scale(1.5, 1, 2.4);
  wing.translate(-0.35, 0.02, 0);
  const fin = new SphereGeometry(0.42, 10, 8);
  fin.scale(0.95, 0.75, 0.14);
  fin.translate(-1.55, 0.38, 0);
  return mergeGeometries([hull, cabin, wing, fin]);
}

/** Point + heading on a rectangle perimeter (center 0,0), distance d. */
function rectPoint(hx: number, hz: number, d: number, per: number) {
  let dd = ((d % per) + per) % per;
  // Edges in travel order: south (z=-hz, -hx->hx), east (x=hx), north
  // (z=hz, hx->-hx), west (x=-hx). Heading is the travel direction.
  const e1 = 2 * hx;
  const e2 = 2 * hz;
  if (dd < e1) return { x: -hx + dd, z: -hz, dx: 1, dz: 0 };
  dd -= e1;
  if (dd < e2) return { x: hx, z: -hz + dd, dx: 0, dz: 1 };
  dd -= e2;
  if (dd < e1) return { x: hx - dd, z: hz, dx: -1, dz: 0 };
  dd -= e1;
  return { x: -hx, z: hz - dd, dx: 0, dz: -1 };
}

/* ------------------------------------------------------------------ */
/* Crowds — waypoint walkers                                          */
/* ------------------------------------------------------------------ */

interface Walker {
  pts: Array<{ x: number; z: number }>;
  cum: number[];
  total: number;
  loop: boolean;
  dist: number;
  dir: number;
  speed: number;
  scale: number;
  phase: number;
}

function walkerFromPoints(pts: Array<{ x: number; z: number }>, loop: boolean, speed: number, scale: number, phase: number): Walker {
  const cum = [0];
  let total = 0;
  for (let i = 0; i < pts.length - (loop ? 0 : 1); i++) {
    const a = pts[i] as { x: number; z: number };
    const b = pts[(i + 1) % pts.length] as { x: number; z: number };
    total += Math.hypot(b.x - a.x, b.z - a.z);
    cum.push(total);
  }
  return { pts, cum, total: Math.max(1, total), loop, dist: phase * total, dir: 1, speed, scale, phase };
}

function walkerPose(w: Walker, out: { x: number; z: number; yaw: number }) {
  // Find the segment the walker is on and interpolate.
  let i = 0;
  while (i < w.cum.length - 2 && (w.cum[i + 1] as number) <= w.dist) i++;
  const a = w.pts[i] as { x: number; z: number };
  const b = w.pts[(i + 1) % w.pts.length] as { x: number; z: number };
  const segLen = Math.max(0.001, (w.cum[i + 1] as number) - (w.cum[i] as number));
  const f = Math.max(0, Math.min(1, (w.dist - (w.cum[i] as number)) / segLen));
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  out.x = a.x + dx * f;
  out.z = a.z + dz * f;
  const len = Math.hypot(dx, dz) || 1;
  out.yaw = Math.atan2((-dz / len) * w.dir, (dx / len) * w.dir);
}

/** Sidewalk segment along a facade's street face, 3u proud of the wall
 *  (clears awnings/porches) and inset 1.5u from the corners. */
function shopfrontSegment(f: Facade, off = 3): Array<{ x: number; z: number }> | null {
  const inset = 1.5;
  if (f.face === "s") {
    if (f.w < 8) return null;
    return [
      { x: f.x + inset, z: f.z + f.d + off },
      { x: f.x + f.w - inset, z: f.z + f.d + off },
    ];
  }
  if (f.face === "n") {
    if (f.w < 8) return null;
    return [
      { x: f.x + inset, z: f.z - off },
      { x: f.x + f.w - inset, z: f.z - off },
    ];
  }
  if (f.face === "e") {
    if (f.d < 8) return null;
    return [
      { x: f.x + f.w + off, z: f.z + inset },
      { x: f.x + f.w + off, z: f.z + f.d - inset },
    ];
  }
  if (f.d < 8) return null;
  return [
    { x: f.x - off, z: f.z + inset },
    { x: f.x - off, z: f.z + f.d - inset },
  ];
}

/** Fill a geometry's vertex-colour attribute with one flat colour
 * (used by the crowd-head merge below: white head, dark eyes). */
function paintVerts(geo: BufferGeometry, r: number, g: number, b: number): BufferGeometry {
  const n = geo.attributes.position?.count ?? 0;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
  geo.setAttribute("color", new BufferAttribute(arr, 3));
  return geo;
}

function circlePoints(cx: number, cz: number, r: number, n: number): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */

const CLOTHES = ["#1d3248", "#522620", "#2a2a2e", "#e8e4da", "#c9a227", "#0f766e", "#7a4fd0", "#b3402e", "#3d5a3a", "#5b4a68"];
const SKINS = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
const HAIR = ["#1a1a1a", "#3a2a1a", "#6b6b6b", "#8a5a2a", "#2a1a12"];
const CAR_PAINTS = ["#d43a2e", "#e0b33a", "#e8ecf2", "#16181f", "#0aa5a0", "#ff2ea6", "#c9ced6"];

export function buildSkyLayer(city: City, quality: QualityName): SkyLayer {
  const rng = mulberry32(0x9e3779b9);
  const group = new Group();
  group.name = "sky-layer";
  const fountain = city.fountain ?? { x: 0, z: 12 };
  const facades = city.facades ?? [];
  const core = facades
    .filter((f) => !f.id.startsWith("home-") && f.h >= 6)
    .map((f) => ({ f, d: Math.hypot(f.x + f.w / 2, f.z + f.d / 2) }))
    .sort((a, b) => a.d - b.d);
  // Tallest facades NEAR the plaza (within 260u): the world also has
  // NY/LA/FL towers up to h~56 at x≈-800, but drones buzzing those
  // would be invisible from the plaza — the visible skyline is the
  // core's own towers (Tower h=72, district blocks h 20-32).
  const tall = [...facades]
    .filter((f) => !f.id.startsWith("home-") && f.h >= 10 && Math.hypot(f.x + f.w / 2, f.z + f.d / 2) < 260)
    .sort((a, b) => b.h - a.h);
  const tower = facades.find((f) => f.id === "tower");

  // ---- shared geometries / materials (module-cheap, one of each) ----
  const flyerGeo = buildFlyerGeometry();
  const flyerMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.85, envMapIntensity: 1.5 });
  const headGeo = new SphereGeometry(0.16, 8, 6);
  const headMat = new MeshBasicMaterial({ toneMapped: false });
  headMat.color.setRGB(2.6, 2.6, 2.3);
  const tailGeo = new SphereGeometry(0.14, 8, 6);
  const tailMat = new MeshBasicMaterial({ toneMapped: false });
  tailMat.color.setRGB(2.4, 0.25, 0.3);
  const droneGeo = new OctahedronGeometry(0.55, 0);
  const droneMat = new MeshStandardMaterial({ color: 0x23262e, roughness: 0.45, metalness: 0.7 });
  const rotorGeo = new CylinderGeometry(0.95, 0.95, 0.05, 12);
  const rotorMat = new MeshBasicMaterial({ color: 0x9db8d8, transparent: true, opacity: 0.3, depthWrite: false });
  const droneLightGeo = new SphereGeometry(0.14, 8, 6);
  const droneLightMat = new MeshBasicMaterial({ toneMapped: false });
  droneLightMat.color.setRGB(1, 1, 1);

  // ---- 1. Flying cars (off on low) ----------------------------------
  // Loops on the outer road ring (half-extents >= 72, well clear of the
  // 66-tall Tower at x -14..14, z -29..-3) plus straight avenue runs
  // along x=+-36 and z=+-72, all at y 44-68. No route crosses the tower
  // column, so no building can ever be clipped.
  const loops: LoopRect[] = [];
  const runs: AvenueRun[] = [];
  let cars: Array<{ loop?: LoopRect; run?: AvenueRun; per: number }> = [];
  if (quality !== "low") {
    const nCars = quality === "high" ? 12 : 8;
    const loopSpecs: Array<[number, number, number]> = [
      [72, 72, 46], [108, 72, 54], [72, 108, 62], [108, 108, 48],
      [144, 72, 58], [72, 144, 66], [144, 108, 52], [108, 144, 68],
    ];
    for (let i = 0; i < Math.min(8, nCars); i++) {
      const [hx, hz, y] = loopSpecs[i] as [number, number, number];
      loops.push({ hx, hz, y: y + rng() * 4, speed: 11 + rng() * 6, dir: i % 2 === 0 ? 1 : -1, phase: rng() });
    }
    const runSpecs: Array<["x" | "z", number, number]> = [
      ["x", 36, 50], ["x", -36, 58], ["z", 72, 54], ["z", -72, 60],
    ];
    for (let i = 0; i < Math.min(4, nCars - loops.length); i++) {
      const [axis, fixed, y] = runSpecs[i] as ["x" | "z", number, number];
      runs.push({ axis, fixed, from: -168, to: 168, y: y + rng() * 4, speed: 0.05 + rng() * 0.03, phase: rng() });
    }
    cars = [
      ...loops.map((loop) => ({ loop, per: 4 * (loop.hx + loop.hz) })),
      ...runs.map((run) => ({ run, per: 1 })),
    ];
  }
  let flyers: InstancedMesh | null = null;
  let headlights: InstancedMesh | null = null;
  let taillights: InstancedMesh | null = null;
  if (cars.length) {
    flyers = new InstancedMesh(flyerGeo, flyerMat, cars.length);
    flyers.frustumCulled = false;
    headlights = new InstancedMesh(headGeo, headMat, cars.length * 2);
    headlights.frustumCulled = false;
    taillights = new InstancedMesh(tailGeo, tailMat, cars.length * 2);
    taillights.frustumCulled = false;
    const c = new Color();
    for (let i = 0; i < cars.length; i++) {
      c.set(CAR_PAINTS[i % CAR_PAINTS.length] as string);
      flyers.setColorAt(i, c);
    }
    if (flyers.instanceColor) flyers.instanceColor.needsUpdate = true;
    group.add(flyers, headlights, taillights);
  }

  // ---- 2. Drones (off on low) ---------------------------------------
  interface Drone {
    cx: number;
    cz: number;
    r: number;
    y: number;
    speed: number;
    phase: number;
    blink: boolean;
  }
  const drones: Drone[] = [];
  let droneMesh: InstancedMesh | null = null;
  let droneRotors: InstancedMesh | null = null;
  let droneLights: InstancedMesh | null = null;
  if (quality !== "low") {
    const anchors = tall.slice(0, quality === "high" ? 10 : 6);
    for (const f of anchors) {
      drones.push({
        cx: f.x + f.w / 2,
        cz: f.z + f.d / 2,
        r: Math.max(f.w, f.d) / 2 + 5,
        y: f.h * (0.55 + rng() * 0.3),
        speed: 0.1 + rng() * 0.16,
        phase: rng() * Math.PI * 2,
        blink: false,
      });
    }
    if (drones.length) {
      droneMesh = new InstancedMesh(droneGeo, droneMat, drones.length);
      droneMesh.frustumCulled = false;
      droneRotors = new InstancedMesh(rotorGeo, rotorMat, drones.length);
      droneRotors.frustumCulled = false;
      droneLights = new InstancedMesh(droneLightGeo, droneLightMat, drones.length);
      droneLights.frustumCulled = false;
      const c = new Color();
      for (let i = 0; i < drones.length; i++) {
        c.setRGB(0.1, 0.9, 1);
        droneLights.setColorAt(i, c);
      }
      if (droneLights.instanceColor) droneLights.instanceColor.needsUpdate = true;
      group.add(droneMesh, droneRotors, droneLights);
    }
  }

  // ---- 3. Giant ORBITX hologram over the plaza ----------------------
  const holoMats: MeshBasicMaterial[] = [];
  let holo: Mesh | null = null;
  let holoBeam: Mesh | null = null;
  {
    const tex = holoTexture(["ORBITX", "CITY"], "#00e5ff");
    if (tex) {
      const mat = new MeshBasicMaterial({
        map: tex, transparent: true, blending: AdditiveBlending,
        depthWrite: false, side: DoubleSide, toneMapped: false, opacity: 0.9,
      });
      holoMats.push(mat);
      holo = new Mesh(new PlaneGeometry(30, 15), mat);
      // High + south of the Tower (top tier y 62..66, z -19..-3): the
      // rotating plane's edge never reaches the tower at any angle
      // (17u clear of its south face vs a 15u half-width).
      holo.position.set(fountain.x, 68, fountain.z + 2);
      holo.renderOrder = 4;
      holo.frustumCulled = false;
      group.add(holo);
    }
    const beamMat = new MeshBasicMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.1,
      blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
    });
    holoMats.push(beamMat);
    holoBeam = new Mesh(new CylinderGeometry(2.4, 3.4, 68, 16, 1, true), beamMat);
    holoBeam.position.set(fountain.x, 34, fountain.z + 2);
    holoBeam.renderOrder = 4;
    holoBeam.frustumCulled = false;
    group.add(holoBeam);
    const ringMat = new MeshStandardMaterial({ color: 0xff2ea6, emissive: 0xff2ea6, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.1 });
    const ring = new Mesh(new CylinderGeometry(4.2, 4.2, 0.18, 32), ringMat);
    ring.position.set(fountain.x, 0.12, fountain.z);
    group.add(ring);
  }

  // ---- 4. Holographic billboards floating above tower roofs --------
  // Floating, not face-mounted: the district signs (landmarks.ts)
  // already own the tower faces (giant ORBITX CITY at y=44 on the
  // Tower, billboards on the mall/office), so a face-mounted holo
  // would z-fight them. These hover just above the rooflines and face
  // the plaza, like the floating holos in the frames.
  const billboardMats: MeshBasicMaterial[] = [];
  const billboardPhases: number[] = [];
  {
    const texCyan = holoTexture(["ORBITX", "CITY"], "#00e5ff");
    const texPink = holoTexture(["ORBITX", "ENTERTAINMENT"], "#ff2ea6");
    const texWelcome = holoTexture(["WELCOME TO", "ORBITX CITY"], "#ff2ea6");
    const place = (tex: CanvasTexture | null, x: number, y: number, z: number, w: number, ry: number) => {
      if (!tex) return;
      const mat = new MeshBasicMaterial({
        map: tex, transparent: true, blending: AdditiveBlending,
        depthWrite: false, side: DoubleSide, toneMapped: false, opacity: 0.7,
      });
      billboardMats.push(mat);
      billboardPhases.push(rng() * Math.PI * 2);
      const m = new Mesh(new PlaneGeometry(w, w / 2), mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.renderOrder = 4;
      group.add(m);
    };
    // Above the roofs of the tallest towers, facing the plaza centre.
    const picks = tall.slice(0, 4);
    picks.forEach((f, i) => {
      const cx = f.x + f.w / 2;
      const cz = f.z + f.d / 2;
      const w = Math.min(Math.max(f.w, f.d) * 0.72, 16);
      const tex = i % 2 === 0 ? texCyan : texPink;
      // Plane normal must point at the plaza (0,0): ry = atan2(-x, -z).
      place(tex, cx, f.h + 7, cz, w, Math.atan2(-cx, -cz));
    });
    // One big welcome holo above the plaza's south edge, facing spawn.
    place(texWelcome, 0, 30, 30, 20, 0);
  }

  // ---- 5. Vertical light beams ---------------------------------------
  const beamMats: MeshBasicMaterial[] = [];
  {
    const spots: Array<{ x: number; z: number; base: number; h: number; r: number }> = [];
    if (tower) spots.push({ x: 0, z: -16, base: tower.h, h: 80, r: 2.2 });
    const mall = facades.find((f) => f.id === "mall" || f.id.startsWith("mega-mall"));
    const office = facades.find((f) => f.id === "office" || f.id.startsWith("mega-office"));
    for (const f of [mall, office]) {
      if (f) spots.push({ x: f.x + f.w / 2, z: f.z + f.d / 2, base: f.h, h: 60, r: 1.8 });
    }
    for (const s of spots) {
      const mat = new MeshBasicMaterial({
        color: 0x8a5cf6, transparent: true, opacity: 0.08,
        blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
      });
      beamMats.push(mat);
      const beam = new Mesh(new CylinderGeometry(s.r, s.r * 1.4, s.h, 12, 1, true), mat);
      beam.position.set(s.x, s.base + s.h / 2, s.z);
      beam.renderOrder = 4;
      beam.frustumCulled = false;
      group.add(beam);
    }
  }

  // ---- 6. Instanced pedestrian crowds (off on low) --------------------
  // Plaza fountain rings (clear of the basin r~5.4, the boxing ring at
  // (8,20,r3.5) and the market stalls at z=25) + plaza perimeter (a
  // notch detours around the Tower + porch on the north edge) +
  // ping-pong walkers along shopfront sidewalks (3u proud of the facade
  // face, tower + blocked segments skipped).
  const walkers: Walker[] = [];
  if (quality !== "low") {
    const ringN = quality === "high" ? 8 : 5;
    for (let i = 0; i < ringN; i++) {
      walkers.push(walkerFromPoints(circlePoints(fountain.x, fountain.z, 6.2, 12), true, 0.9 + rng() * 0.5, 0.88 + rng() * 0.24, rng()));
    }
    for (let i = 0; i < ringN; i++) {
      walkers.push(walkerFromPoints(circlePoints(fountain.x, fountain.z, 7.4, 12), true, 0.9 + rng() * 0.5, 0.88 + rng() * 0.24, rng()));
    }
    const perN = quality === "high" ? 14 : 8;
    // Notched around the Tower: the Tower (x -14..14, z -29..-3) + its
    // porch (columns at z=-0.6) jut into the plaza's north strip, so the
    // north edge detours down both sides at x=+-17 and crosses at z=2
    // (clear of the porch columns and the fountain at (0,12)).
    const per = [
      { x: -27, z: -27 }, { x: -17, z: -27 }, { x: -17, z: 2 }, { x: 17, z: 2 },
      { x: 17, z: -27 }, { x: 27, z: -27 }, { x: 27, z: 27 }, { x: -27, z: 27 },
    ];
    for (let i = 0; i < perN; i++) {
      walkers.push(walkerFromPoints(per, true, 1.0 + rng() * 0.6, 0.88 + rng() * 0.24, rng()));
    }
    const segN = quality === "high" ? 13 : 7;
    let placed = 0;
    for (const { f } of core) {
      if (placed >= segN) break;
      // The Tower's "sidewalk" is its porch (columns at z=-0.6) — no
      // shopfront walkers there.
      if (f.id === "tower") continue;
      const seg = shopfrontSegment(f);
      if (!seg) continue;
      // Skip a segment if any other facade's footprint swallows part of
      // it (a jutting neighbour) — sampled at both ends + midpoint.
      const pts = [seg[0], seg[1], { x: (seg[0].x + seg[1].x) / 2, z: (seg[0].z + seg[1].z) / 2 }];
      let blocked = false;
      for (const p of pts) {
        for (const g of facades) {
          if (g === f) continue;
          if (p.x > g.x - 0.5 && p.x < g.x + g.w + 0.5 && p.z > g.z - 0.5 && p.z < g.z + g.d + 0.5) {
            blocked = true;
            break;
          }
        }
        if (blocked) break;
      }
      if (blocked) continue;
      placed++;
      for (let k = 0; k < 2; k++) {
        walkers.push(walkerFromPoints(seg, false, 0.8 + rng() * 0.5, 0.88 + rng() * 0.24, rng()));
      }
    }
  }
  let crowdBodies: InstancedMesh | null = null;
  let crowdHeads: InstancedMesh | null = null;
  let crowdLegs: InstancedMesh | null = null;
  let crowdArms: InstancedMesh | null = null;
  if (walkers.length) {
    // Shaped people (round-1 look): capsule torso + sphere head, NO boxes.
    const bodyGeo = new CapsuleGeometry(0.5, 1, 4, 10);
    const bodyMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.05 });
    // Round 6: faces for free — the head geometry is the sphere with
    // two small dark eye spheres merged in (forward is local +X, the
    // walkers' yaw convention: rotation.y = atan2(-dz, dx) maps +X to
    // the travel direction). Vertex colours carry the face: white head
    // verts take the per-instance skin/hair colour, dark eye verts
    // stay dark under any instance colour. Zero extra draws — the
    // eyes ride the existing heads InstancedMesh.
    const headSphere = paintVerts(new SphereGeometry(0.5, 10, 8), 1, 1, 1);
    const eyeGeoL = paintVerts(new SphereGeometry(0.095, 6, 5), 0.07, 0.06, 0.05);
    eyeGeoL.translate(0.42, 0.08, -0.17);
    const eyeGeoR = paintVerts(new SphereGeometry(0.095, 6, 5), 0.07, 0.06, 0.05);
    eyeGeoR.translate(0.42, 0.08, 0.17);
    const headGeo = mergeGeometries([headSphere, eyeGeoL, eyeGeoR]) ?? headSphere;
    const headMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true });
    crowdBodies = new InstancedMesh(bodyGeo, bodyMat, walkers.length);
    crowdBodies.frustumCulled = false;
    crowdHeads = new InstancedMesh(headGeo, headMat, walkers.length);
    crowdHeads.frustumCulled = false;
    // Round 4: two swinging legs per walker (one extra InstancedMesh
    // draw for BOTH legs — 2 instances per walker, shared geometry +
    // material, per-instance colour from the body palette). The leg
    // geometry is translated so its TOP sits at the pivot (y 0): the
    // per-frame rotation.x swings the foot around the hip. Off on low
    // quality, like the crowds themselves (no walkers at all there).
    const legGeo = new CapsuleGeometry(0.5, 1, 4, 8);
    legGeo.translate(0, -1, 0);
    const legMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.05 });
    crowdLegs = new InstancedMesh(legGeo, legMat, walkers.length * 2);
    crowdLegs.frustumCulled = false;
    // Round 6: arms — the ONE extra instanced draw this round (2
    // instances per walker, one per arm, same pivot-at-top capsule
    // pattern as the legs, swinging opposite phase to the same-side
    // leg at the legs' cadence). Skin-coloured (bare arms), shoulder
    // pivots at 1.28 * scale. Off on low, like the legs.
    const armGeo = new CapsuleGeometry(0.5, 1, 4, 8);
    armGeo.translate(0, -1, 0);
    const armMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.05 });
    crowdArms = new InstancedMesh(armGeo, armMat, walkers.length * 2);
    crowdArms.frustumCulled = false;
    const c = new Color();
    for (let i = 0; i < walkers.length; i++) {
      c.set(CLOTHES[i % CLOTHES.length] as string);
      crowdBodies.setColorAt(i, c);
      crowdLegs.setColorAt(i * 2, c);
      crowdLegs.setColorAt(i * 2 + 1, c);
      // Pick the skin first (the arms wear it), then decide whether
      // this walker's head reads as haired/hatted instead.
      const skin = SKINS[Math.floor(rng() * SKINS.length)] as string;
      c.set(skin);
      crowdArms.setColorAt(i * 2, c);
      crowdArms.setColorAt(i * 2 + 1, c);
      // Round 4: a quarter of the crowd reads as haired/hatted — a dark
      // hair colour on the head instance instead of a skin tone.
      if (rng() < 0.25) {
        c.set(HAIR[Math.floor(rng() * HAIR.length)] as string);
      } else {
        c.set(skin);
      }
      crowdHeads.setColorAt(i, c);
    }
    if (crowdBodies.instanceColor) crowdBodies.instanceColor.needsUpdate = true;
    if (crowdHeads.instanceColor) crowdHeads.instanceColor.needsUpdate = true;
    if (crowdLegs.instanceColor) crowdLegs.instanceColor.needsUpdate = true;
    if (crowdArms.instanceColor) crowdArms.instanceColor.needsUpdate = true;
    group.add(crowdBodies, crowdHeads, crowdLegs, crowdArms);
  }

  // ---- 7. Clouds + sun + moon + stars (round 7) ----------------------
  // The sky itself was empty: no clouds by day, no sun/moon/stars by
  // night. Clouds are one InstancedMesh of flattened white puffs
  // drifting slowly on the wind (off on low); the sun + moon are flat
  // discs that fade with dayF/nightF; stars are one Points cloud that
  // fades in at night. All fog:false so they read at sky distance.
  interface Cloud { x: number; y: number; z: number; s: number; speed: number }
  const CLOUD_PUFFS = [
    { dx: 0, dy: 0, dz: 0, s: 9 },
    { dx: 7, dy: -1, dz: 2, s: 7 },
    { dx: -7, dy: -1, dz: -2, s: 7.5 },
    { dx: 2, dy: 2, dz: -3, s: 6 },
  ];
  const clouds: Cloud[] = [];
  let cloudMesh: InstancedMesh | null = null;
  if (quality !== "low") {
    const nClouds = quality === "high" ? 12 : 8;
    const puffMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.88 });
    cloudMesh = new InstancedMesh(new SphereGeometry(1, 10, 8), puffMat, nClouds * CLOUD_PUFFS.length);
    cloudMesh.frustumCulled = false;
    for (let i = 0; i < nClouds; i++) {
      clouds.push({
        x: -260 + rng() * 520,
        y: 95 + rng() * 55,
        z: -260 + rng() * 520,
        s: 0.8 + rng() * 0.7,
        speed: 1.2 + rng() * 1.6,
      });
    }
    group.add(cloudMesh);
  }
  // Sun (day) + moon (night): flat discs, far out, facing the plaza.
  const sunMat = new MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false, fog: false, transparent: true, opacity: 0 });
  const sun = new Mesh(new CircleGeometry(16, 24), sunMat);
  sun.position.set(190, 150, -240);
  sun.lookAt(0, 0, 0);
  group.add(sun);
  const moonMat = new MeshBasicMaterial({ color: 0xdde6f2, toneMapped: false, fog: false, transparent: true, opacity: 0 });
  const moon = new Mesh(new CircleGeometry(11, 24), moonMat);
  moon.position.set(-170, 130, 200);
  moon.lookAt(0, 0, 0);
  group.add(moon);
  // Stars: one Points cloud on the upper hemisphere, faded in at night.
  const starCount = quality === "low" ? 0 : quality === "high" ? 320 : 200;
  const starMat = new PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  if (starCount) {
    const starGeo = new BufferGeometry();
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = rng() * Math.PI * 2;
      const e = rng() * Math.PI * 0.48 + 0.02; // elevation ~1..87 deg
      const r = 330;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r + 10;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    starGeo.setAttribute("position", new BufferAttribute(pos, 3));
    const stars = new Points(starGeo, starMat);
    stars.frustumCulled = false;
    group.add(stars);
  }

  const pose = { x: 0, z: 0, yaw: 0 };
  const off = { x: 0, z: 0 };
  const blinkColor = new Color();
  let lastBlinkSlot = -1;

  function update(dt: number, t: number, nightF: number, dayF: number, indoors: boolean) {
    group.visible = !indoors;
    if (indoors) return;
    const glowF = Math.max(nightF, 1 - dayF); // 1 at dusk + night, 0 at day
    const clampedDt = Math.min(dt, 0.1);

    // Flying cars.
    if (flyers && headlights && taillights) {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i] as { loop?: LoopRect; run?: AvenueRun; per: number };
        let x = 0;
        let z = 0;
        let y = 50;
        let yaw = 0;
        if (car.loop) {
          const L = car.loop;
          const d = (t * L.speed * L.dir + L.phase * car.per) % car.per;
          const p = rectPoint(L.hx, L.hz, d, car.per);
          x = p.x;
          z = p.z;
          y = L.y;
          yaw = Math.atan2(-p.dz * L.dir, p.dx * L.dir);
        } else if (car.run) {
          const R = car.run;
          // Sine ping-pong: slows into the turn at each end.
          const s = (Math.sin(t * R.speed * Math.PI * 2 + R.phase * Math.PI * 2) + 1) / 2;
          const along = R.from + (R.to - R.from) * s;
          const vel = Math.cos(t * R.speed * Math.PI * 2 + R.phase * Math.PI * 2);
          if (R.axis === "x") {
            x = along;
            z = R.fixed;
            yaw = vel >= 0 ? 0 : Math.PI;
          } else {
            x = R.fixed;
            z = along;
            yaw = vel >= 0 ? -Math.PI / 2 : Math.PI / 2;
          }
          y = R.y;
        }
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        flyers.setMatrixAt(i, dummy.matrix);
        // Headlights (+X front) + taillights (-X rear), both sides.
        for (const side of [-1, 1]) {
          rotOffset(1.95, side * 0.45, yaw, off);
          tmpM.makeTranslation(x + off.x, y + 0.08, z + off.z);
          headlights.setMatrixAt(i * 2 + (side < 0 ? 0 : 1), tmpM);
          rotOffset(-1.95, side * 0.45, yaw, off);
          tmpM.makeTranslation(x + off.x, y + 0.12, z + off.z);
          taillights.setMatrixAt(i * 2 + (side < 0 ? 0 : 1), tmpM);
        }
      }
      flyers.instanceMatrix.needsUpdate = true;
      headlights.instanceMatrix.needsUpdate = true;
      taillights.instanceMatrix.needsUpdate = true;
    }

    // Drones.
    if (droneMesh && droneRotors && droneLights) {
      const slot = Math.floor(t * 2.5);
      let blinkChanged = slot !== lastBlinkSlot;
      if (blinkChanged) lastBlinkSlot = slot;
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i] as Drone;
        const a = t * d.speed + d.phase;
        const x = d.cx + Math.cos(a) * d.r;
        const z = d.cz + Math.sin(a) * d.r;
        const y = d.y + Math.sin(t * 0.7 + d.phase) * 1.2;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, -a, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        droneMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, y + 0.32, z);
        dummy.rotation.set(0, t * 2 + d.phase, 0);
        dummy.updateMatrix();
        droneRotors.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, y - 0.42, z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        droneLights.setMatrixAt(i, dummy.matrix);
        // Blink: cyan on, dim red off, staggered per drone.
        const on = Math.sin(t * 3 + d.phase * 5) > 0.2;
        if (on !== d.blink) {
          d.blink = on;
          blinkChanged = true;
          blinkColor.setRGB(on ? 0.1 : 1.4, on ? 1.6 : 0.12, on ? 2.2 : 0.12);
          droneLights.setColorAt(i, blinkColor);
        }
      }
      droneMesh.instanceMatrix.needsUpdate = true;
      droneRotors.instanceMatrix.needsUpdate = true;
      droneLights.instanceMatrix.needsUpdate = true;
      if (blinkChanged && droneLights.instanceColor) droneLights.instanceColor.needsUpdate = true;
    }

    // Hologram: slow rotation, brighter after dark, faint by day.
    if (holo) {
      holo.rotation.y = t * 0.12;
      const m = holo.material as MeshBasicMaterial;
      m.opacity = 0.22 + 0.68 * glowF;
    }
    if (holoBeam) {
      const m = holoBeam.material as MeshBasicMaterial;
      m.opacity = 0.03 + 0.13 * glowF;
    }
    // Holo-billboards pulse gently.
    for (let i = 0; i < billboardMats.length; i++) {
      const m = billboardMats[i] as MeshBasicMaterial;
      const ph = billboardPhases[i] as number;
      m.opacity = (0.3 + 0.55 * glowF) * (0.86 + 0.14 * Math.sin(t * 1.3 + ph));
    }
    // Light beams: dusk/night only.
    for (const m of beamMats) m.opacity = 0.015 + 0.11 * glowF;

    // Clouds drift on the wind, wrapping around the map edge.
    if (cloudMesh) {
      for (let i = 0; i < clouds.length; i++) {
        const cl = clouds[i] as Cloud;
        cl.x += cl.speed * clampedDt;
        if (cl.x > 300) cl.x = -300;
        for (let k = 0; k < CLOUD_PUFFS.length; k++) {
          const pf = CLOUD_PUFFS[k] as { dx: number; dy: number; dz: number; s: number };
          dummy.position.set(cl.x + pf.dx * cl.s, cl.y + pf.dy * cl.s, cl.z + pf.dz * cl.s);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(pf.s * cl.s, pf.s * cl.s * 0.42, pf.s * cl.s);
          dummy.updateMatrix();
          cloudMesh.setMatrixAt(i * CLOUD_PUFFS.length + k, dummy.matrix);
        }
      }
      cloudMesh.instanceMatrix.needsUpdate = true;
    }
    // Sun by day, moon + stars by night.
    sunMat.opacity = Math.max(0, Math.min(1, dayF));
    moonMat.opacity = Math.max(0, Math.min(1, nightF));
    starMat.opacity = Math.max(0, Math.min(1, nightF)) * 0.9;

    // Crowds.
    if (crowdBodies && crowdHeads) {
      // Legs swing in the walker's facing frame: yaw first, then the
      // pitch around the hip (Euler YXZ). The shared dummy is also
      // used for flyers/drones with a single yaw axis, where the order
      // makes no difference.
      dummy.rotation.order = "YXZ";
      for (let i = 0; i < walkers.length; i++) {
        const w = walkers[i] as Walker;
        w.dist += w.dir * w.speed * clampedDt;
        if (w.loop) {
          w.dist = ((w.dist % w.total) + w.total) % w.total;
        } else if (w.dist >= w.total) {
          w.dist = w.total;
          w.dir = -1;
        } else if (w.dist <= 0) {
          w.dist = 0;
          w.dir = 1;
        }
        walkerPose(w, pose);
        const bob = Math.abs(Math.sin(t * 5 * w.speed + w.phase * 9)) * 0.045;
        dummy.position.set(pose.x, (0.68 + bob) * w.scale, pose.z);
        dummy.rotation.set(0, pose.yaw, 0);
        dummy.scale.set(0.42 * w.scale, 0.62 * w.scale, 0.32 * w.scale);
        dummy.updateMatrix();
        crowdBodies.setMatrixAt(i, dummy.matrix);
        dummy.position.set(pose.x, 1.5 * w.scale + bob * w.scale, pose.z);
        dummy.scale.setScalar(0.34 * w.scale);
        dummy.updateMatrix();
        crowdHeads.setMatrixAt(i, dummy.matrix);
        // Round 4: legs swing with the walker's phase/speed, opposite
        // legs opposite phase, same cadence as the bob. Hip at
        // 0.55 * scale, leg 0.55 * scale long, so the foot plants at
        // ground level at rest. Round 6: the arms share this swing
        // (opposite phase to the same-side leg, 70% amplitude, like
        // the player walker in movement.ts) — one `swing` for both.
        const swing = Math.sin(t * 5 * w.speed + w.phase * 9) * 0.45;
        if (crowdLegs) {
          for (let l = 0; l < 2; l++) {
            const side = l === 0 ? -0.11 : 0.11;
            rotOffset(side, 0, pose.yaw, off);
            dummy.position.set(pose.x + off.x, (0.55 + bob) * w.scale, pose.z + off.z);
            dummy.rotation.set(l === 0 ? swing : -swing, pose.yaw, 0);
            dummy.scale.set(0.13 * w.scale, 0.275 * w.scale, 0.13 * w.scale);
            dummy.updateMatrix();
            crowdLegs.setMatrixAt(i * 2 + l, dummy.matrix);
          }
        }
        // Round 6: arms swing from the shoulder pivots (1.28 * scale,
        // just inside the torso top at 1.30), opposite phase to the
        // same-side leg. Arm 0.55 * scale long, so the wrist lands at
        // ~0.73 * scale, like the player walker's wrist at 0.72.
        if (crowdArms) {
          const armSwing = swing * 0.7;
          for (let l = 0; l < 2; l++) {
            const side = l === 0 ? -0.19 : 0.19;
            rotOffset(side * w.scale, 0, pose.yaw, off);
            dummy.position.set(pose.x + off.x, (1.28 + bob) * w.scale, pose.z + off.z);
            dummy.rotation.set(l === 0 ? -armSwing : armSwing, pose.yaw, 0);
            dummy.scale.set(0.11 * w.scale, 0.275 * w.scale, 0.11 * w.scale);
            dummy.updateMatrix();
            crowdArms.setMatrixAt(i * 2 + l, dummy.matrix);
          }
        }
      }
      crowdBodies.instanceMatrix.needsUpdate = true;
      crowdHeads.instanceMatrix.needsUpdate = true;
      if (crowdLegs) crowdLegs.instanceMatrix.needsUpdate = true;
      if (crowdArms) crowdArms.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, update };
}
