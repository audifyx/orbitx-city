/**
 * OrbitX City — landmarks (realistic overhaul, 2026-11-24).
 *
 * The set-pieces the 6 style videos are built around, matched frame for
 * frame: the ORBITX CITY entrance gate (video 03, 1s), the plaza fountain
 * with purple/blue light (video 01, 9s), palm trees with pink neon trunk
 * rings (videos 01/02/05), market stalls + colorful umbrellas (video 03,
 * 9s), the street boxing ring with FIGHT NIGHT banners (video 06), the
 * ROUTE 12 DOWNTOWN street sign (video 03, 9s), and the neon district
 * signage mounted on real facades (all videos).
 *
 * Everything here is shaped geometry (cylinders, torus, cones, extrudes)
 * — NO boxes. Trees are rendered as instanced palms from the positions
 * city.ts records (see `palms` on the City object); the old box trees are
 * no longer emitted. Colliders stay in city.ts (trunk colliders), so
 * gameplay and door approaches are unchanged.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SRGBColorSpace,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { City, Facade } from "./city";
import { makeBillboard, makeNeonSign, type NeonColor } from "./signs";
import type { QualityName } from "./pretty";

/** Where the entrance gate stands: on the x=0 road between spawn and the plaza. */
export const GATE_POS = { x: 0, z: 44 };
/** Plaza boxing ring (decorative — real fights run at the stadium ring). */
export const PLAZA_RING = { x: 8, z: 20, r: 3.5 };

const darkMetal = new MeshStandardMaterial({ color: 0x23262e, roughness: 0.45, metalness: 0.75 });
const goldTrim = new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.3, metalness: 0.85, emissive: 0x8a5a10, emissiveIntensity: 0.3 });
const trunkMat = new MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9, metalness: 0 });
const frondMat = new MeshStandardMaterial({ color: 0x2f8a35, roughness: 0.85, metalness: 0 });
const ringMat = new MeshStandardMaterial({
  color: 0xff2ea6,
  emissive: 0xff2ea6,
  emissiveIntensity: 2.2,
  roughness: 0.3,
  metalness: 0.1,
});
const cyanGlowMat = new MeshStandardMaterial({
  color: 0x00e5ff,
  emissive: 0x00e5ff,
  emissiveIntensity: 2.0,
  roughness: 0.3,
  metalness: 0.1,
});

function mesh(geo: BufferGeometry, mat: import("three").Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A street sign: green panel, white bold text, no glow (like ROUTE 12). */
export function makeStreetSign(text: string, width: number): Mesh | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 224;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0a6e3c";
  ctx.fillRect(0, 0, 1024, 224);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 1004, 204);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 110px 'Arial Black', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 512, 118);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const mat = new MeshBasicMaterial({ map: tex, toneMapped: false, side: DoubleSide, depthWrite: false });
  const m = new Mesh(new PlaneGeometry(width, (width * 224) / 1024), mat);
  m.name = `streetsign:${text}`;
  m.castShadow = false;
  m.renderOrder = 3;
  return m;
}

/**
 * The entrance gate (video 03, 1s): two dark-metal pylons with gold
 * trim, a half-torus arch with a cyan neon strip, the giant ORBITX CITY
 * neon above it, WELCOME TO ORBITX CITY hanging banners, ORBITX CITY
 * ENTRANCE side signs, security cameras, and turnstiles. Spans the x=0
 * road so cars and players pass underneath (arch clearance ~9.5u).
 */
export function buildGate(): Group {
  const g = new Group();
  g.name = "orbitx-gate";
  const { x, z } = GATE_POS;
  // Pylons.
  for (const s of [-1, 1]) {
    const pylon = mesh(new CylinderGeometry(1.0, 1.25, 10, 12), darkMetal, x + s * 8.5, 5, z);
    g.add(pylon);
    const band = mesh(new TorusGeometry(1.12, 0.09, 8, 20), goldTrim, x + s * 8.5, 9.4, z);
    band.rotation.x = Math.PI / 2;
    band.castShadow = false;
    g.add(band);
    const strip = mesh(new TorusGeometry(1.05, 0.05, 8, 20), cyanGlowMat, x + s * 8.5, 6.5, z);
    strip.rotation.x = Math.PI / 2;
    strip.castShadow = false;
    g.add(strip);
    // Security camera on a short arm, angled down at the road.
    const arm = mesh(new CylinderGeometry(0.06, 0.06, 1.2, 6), darkMetal, x + s * 7.6, 9.0, z);
    arm.rotation.z = s * 0.9;
    g.add(arm);
    const cam = mesh(new CylinderGeometry(0.16, 0.2, 0.55, 8), darkMetal, x + s * 7.1, 8.6, z);
    cam.rotation.z = s * 1.1;
    g.add(cam);
    const lens = mesh(new CylinderGeometry(0.07, 0.07, 0.1, 8), cyanGlowMat, x + s * 6.9, 8.45, z);
    lens.rotation.z = s * 1.1;
    lens.castShadow = false;
    g.add(lens);
  }
  // Arch: half-torus springing from the pylon tops + cyan neon strip.
  const arch = mesh(new TorusGeometry(8.5, 0.75, 10, 32, Math.PI), darkMetal, x, 10.2, z);
  g.add(arch);
  const archGlow = mesh(new TorusGeometry(8.5, 0.1, 8, 32, Math.PI), cyanGlowMat, x, 10.2, z + 0.85);
  archGlow.castShadow = false;
  g.add(archGlow);
  const archGlowBack = mesh(new TorusGeometry(8.5, 0.1, 8, 32, Math.PI), cyanGlowMat, x, 10.2, z - 0.85);
  archGlowBack.castShadow = false;
  g.add(archGlowBack);
  // Giant ORBITX CITY neon on the arch (double-sided: reads from spawn
  // and from the plaza). No backing panel — letters float on the glass
  // like the splash frames.
  const big = makeNeonSign("ORBITX\nCITY", { width: 11, color: "pink", backing: false, doubleSide: true });
  if (big) {
    big.position.set(x, 14.6, z);
    g.add(big);
  }
  // Hanging WELCOME TO ORBITX CITY banners inside the arch.
  for (const s of [-1, 1]) {
    const banner = makeNeonSign("WELCOME TO\nORBITX CITY", {
      width: 2.4,
      color: "cyan",
      backing: true,
      doubleSide: true,
    });
    if (banner) {
      banner.position.set(x + s * 5.2, 7.2, z);
      g.add(banner);
    }
  }
  // ORBITX CITY ENTRANCE side signs (face the road, toward spawn).
  for (const s of [-1, 1]) {
    const side = makeNeonSign("ORBITX CITY\nENTRANCE", { width: 5.4, color: "pink", backing: true });
    if (side) {
      side.position.set(x + s * 13.2, 4.6, z);
      g.add(side);
    }
  }
  // Turnstiles: three short posts with a crossbar at the gate base.
  for (const tx of [-3, 0, 3]) {
    const post = mesh(new CylinderGeometry(0.16, 0.2, 1.15, 8), darkMetal, x + tx, 0.58, z);
    g.add(post);
    const bar = mesh(new CylinderGeometry(0.05, 0.05, 1.5, 6), goldTrim, x + tx, 1.0, z);
    bar.rotation.x = Math.PI / 2;
    g.add(bar);
  }
  return g;
}

/**
 * Palm trees with neon trunk rings, instanced from city.palms:
 * one InstancedMesh each for trunks, frond crowns, and neon rings —
 * 3 draw calls for the whole city's palms.
 */
export function buildPalms(palms: Array<{ x: number; y: number; z: number }>): Group {
  const g = new Group();
  g.name = "palms";
  if (!palms.length) return g;
  const dummy = new Object3D();
  // Trunks: tapered cylinders.
  const trunkGeo = new CylinderGeometry(0.26, 0.42, 5.4, 8);
  const trunks = new InstancedMesh(trunkGeo, trunkMat, palms.length);
  trunks.castShadow = true;
  // Crowns: 7 drooping frond cones merged into one geometry. Each cone
  // is translated so its BASE sits at the local origin and its tip
  // extends +3, then tilted outward-down and fanned around — a real
  // palm crown, not a spiky ball (the cones used to be centred on the
  // origin, so half of each frond poked out the opposite side).
  const fronds: import("three").BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const cone = new ConeGeometry(0.55, 3.0, 5);
    cone.translate(0, 1.5, 0); // base at origin, tip at +3
    cone.rotateX(Math.PI / 2 + 0.62); // tip outward-down
    cone.rotateY((i / 7) * Math.PI * 2);
    cone.translate(0, -0.35, 0);
    fronds.push(cone);
  }
  const crownGeo = mergeGeometries(fronds) ?? fronds[0]!;
  const crowns = new InstancedMesh(crownGeo, frondMat, palms.length);
  crowns.castShadow = true;
  // Neon trunk rings (pink), two per palm.
  const ringGeo = new TorusGeometry(0.5, 0.055, 8, 20);
  const rings = new InstancedMesh(ringGeo, ringMat, palms.length * 2);
  rings.castShadow = false;
  palms.forEach((p, i) => {
    const rot = (i * 2.39996) % (Math.PI * 2); // golden-angle spread
    dummy.position.set(p.x, p.y + 2.7, p.z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, p.y + 5.5, p.z);
    dummy.rotation.set(0, rot, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    for (const [j, ry] of [0, 1].entries()) {
      dummy.position.set(p.x, p.y + (ry === 0 ? 2.1 : 3.5), p.z);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      rings.setMatrixAt(i * 2 + j, dummy.matrix);
    }
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  rings.instanceMatrix.needsUpdate = true;
  g.add(trunks, crowns, rings);
  return g;
}

/** Market stalls + colorful umbrellas around the plaza (videos 03/04). */
export function buildMarket(): Group {
  const g = new Group();
  g.name = "plaza-market";
  const canopyColors = ["#e0392f", "#f2c200", "#0aa5a0", "#7a4fd0"];
  const stalls: Array<{ x: number; z: number; c: string; label: string }> = [
    { x: -12, z: 25, c: canopyColors[0], label: "STREET\nMARKET" },
    { x: -4, z: 25, c: canopyColors[1], label: "STREET\nFOOD" },
    { x: 4, z: 25, c: canopyColors[2], label: "STREET\nMARKET" },
    { x: 13, z: 25, c: canopyColors[3], label: "STREET\nFOOD" },
  ];
  for (const s of stalls) {
    const canopyMat = new MeshStandardMaterial({ color: s.c, roughness: 0.8, metalness: 0 });
    for (const [px, pz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] as Array<[number, number]>) {
      g.add(mesh(new CylinderGeometry(0.06, 0.06, 2.6, 6), darkMetal, s.x + px, 1.3, s.z + pz));
    }
    const canopy = mesh(new ConeGeometry(2.3, 1.0, 8), canopyMat, s.x, 3.0, s.z);
    g.add(canopy);
    const counter = mesh(new CylinderGeometry(1.1, 1.2, 0.95, 10), trunkMat, s.x, 0.48, s.z);
    g.add(counter);
    const sign = makeNeonSign(s.label, { width: 2.6, color: "amber", backing: true });
    if (sign) {
      sign.position.set(s.x, 2.1, s.z + 1.55);
      g.add(sign);
    }
  }
  // Standalone umbrellas (intro 9s: yellow/purple/teal canopies).
  const umbrellas: Array<{ x: number; z: number; c: string }> = [
    { x: -18, z: 10, c: "#f2c200" },
    { x: 18, z: 10, c: "#7a4fd0" },
  ];
  for (const u of umbrellas) {
    const mat = new MeshStandardMaterial({ color: u.c, roughness: 0.8, metalness: 0 });
    g.add(mesh(new CylinderGeometry(0.05, 0.05, 2.8, 6), darkMetal, u.x, 1.4, u.z));
    g.add(mesh(new ConeGeometry(2.0, 0.8, 8), mat, u.x, 3.1, u.z));
  }
  return g;
}

/**
 * Plaza street boxing ring (video 06): round canvas, 4 posts, rope
 * levels, FIGHT NIGHT banners. Decorative — real fights run at the
 * stadium ring (runtime.ensureBoxingFigures), unchanged.
 */
export function buildPlazaRing(): Group {
  const g = new Group();
  g.name = "plaza-ring";
  const { x, z, r } = PLAZA_RING;
  const canvas = mesh(new CylinderGeometry(r, r, 0.28, 24), new MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.9 }), x, 0.14, z);
  canvas.receiveShadow = true;
  g.add(canvas);
  const skirt = mesh(new TorusGeometry(r, 0.09, 8, 32), ringMat, x, 0.3, z);
  skirt.rotation.x = Math.PI / 2;
  skirt.castShadow = false;
  g.add(skirt);
  const postMat = new MeshStandardMaterial({ color: 0xc1272d, roughness: 0.5, metalness: 0.3 });
  const ropeMat = new MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.6 });
  const corners: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [cx, cz] of corners) {
    g.add(mesh(new CylinderGeometry(0.09, 0.11, 1.7, 8), postMat, x + cx * r * 0.85, 0.85, z + cz * r * 0.85));
  }
  // Rope levels: thin cylinders along each side of the square. The
  // geometry is pre-rotated to lie along +X; rotation.y aims it.
  const ropeGeo = new CylinderGeometry(0.035, 0.035, 1, 6);
  ropeGeo.rotateZ(Math.PI / 2);
  for (const ry of [0.7, 1.15, 1.55]) {
    const half = r * 0.85;
    for (const [ax, az, bx, bz] of [
      [-half, -half, half, -half],
      [half, -half, half, half],
      [half, half, -half, half],
      [-half, half, -half, -half],
    ] as Array<[number, number, number, number]>) {
      const len = Math.hypot(bx - ax, bz - az);
      const rope = new Mesh(ropeGeo, ropeMat);
      rope.position.set(x + (ax + bx) / 2, ry, z + (az + bz) / 2);
      rope.rotation.y = -Math.atan2(bz - az, bx - ax);
      rope.scale.x = len;
      rope.castShadow = false;
      g.add(rope);
    }
  }
  for (const s of [-1, 1]) {
    const banner = makeNeonSign("FIGHT\nNIGHT", { width: 2.2, color: "red", backing: true, doubleSide: true });
    if (banner) {
      banner.position.set(x + s * (r + 1.6), 2.4, z);
      banner.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(banner);
    }
  }
  return g;
}

/**
 * Fountain light (video 01, 9s): purple + cyan point lights over the
 * basin, plus emissive rings on the water tiers. Cheap (2 lights).
 */
export function buildFountainGlow(fountain: { x: number; z: number }): Group {
  const g = new Group();
  g.name = "fountain-glow";
  const purple = new PointLight(0x8a5cf6, 90, 34, 1.8);
  purple.position.set(fountain.x, 5, fountain.z);
  g.add(purple);
  const cyan = new PointLight(0x00e5ff, 45, 22, 1.8);
  cyan.position.set(fountain.x, 2.6, fountain.z);
  g.add(cyan);
  const ring1 = mesh(new TorusGeometry(5.4, 0.07, 8, 40), cyanGlowMat, fountain.x, 1.32, fountain.z);
  ring1.rotation.x = Math.PI / 2;
  ring1.castShadow = false;
  g.add(ring1);
  const ring2 = mesh(new TorusGeometry(3.2, 0.07, 8, 32), ringMat, fountain.x, 2.45, fountain.z);
  ring2.rotation.x = Math.PI / 2;
  ring2.castShadow = false;
  g.add(ring2);
  return g;
}

/**
 * District signage: mount the exact sign list from the frames onto the
 * facades nearest the plaza core, on each facade's street face. The
 * tower gets the giant ORBITX CITY sign; the mall/office get billboards.
 */
const DISTRICT_SIGNS: Array<{ text: string; color: NeonColor; vertical?: boolean; sub?: string }> = [
  { text: "NEON DISTRICT", color: "pink" },
  { text: "ARCADE PALACE", color: "cyan" },
  { text: "FUTURE MALL", color: "cyan" },
  { text: "CLUB NOVA", color: "pink" },
  { text: "CAFÉ GALAXY", color: "amber" },
  { text: "COFFEE HUB", color: "amber" },
  { text: "HOLO-MART", color: "cyan" },
  { text: "ORBITX CAFÉ", color: "pink" },
  { text: "ORBITX LOGISTICS", color: "blue" },
  { text: "NEWS & GOODS\nKIOSK", color: "white" },
  { text: "24/7\nCONVENIENCE", color: "red" },
  { text: "GARAGE\nAUTO REPAIR", color: "red" },
  { text: "LIQUOR MART", color: "purple" },
  { text: "ORBITX\nENTERTAINMENT", color: "pink" },
  { text: "CYBER FIGHTER", color: "cyan" },
  { text: "DANCE CLUB", color: "pink" },
  { text: "DRINKS", color: "amber" },
  { text: "NEON CLUB\nORBITX", color: "pink" },
  { text: "ROOFTOP", color: "cyan" },
  { text: "HOTEL GALAXY", color: "pink", vertical: true },
];

function faceOffset(f: Facade): { x: number; z: number; ry: number } {
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  switch (f.face) {
    case "s":
      return { x: cx, z: f.z + f.d + 0.18, ry: 0 };
    case "n":
      return { x: cx, z: f.z - 0.18, ry: Math.PI };
    case "e":
      return { x: f.x + f.w + 0.18, z: cz, ry: Math.PI / 2 };
    default:
      return { x: f.x - 0.18, z: cz, ry: -Math.PI / 2 };
  }
}

export function mountDistrictSigns(facades: Facade[]): Group {
  const g = new Group();
  g.name = "district-signs";
  // Core facades first (nearest the plaza), skipping homes.
  const core = facades
    .filter((f) => !f.id.startsWith("home-") && f.h >= 6)
    .map((f) => ({ f, d: Math.hypot(f.x + f.w / 2, f.z + f.d / 2) }))
    .sort((a, b) => a.d - b.d);
  const tower = facades.find((f) => f.id === "tower");
  if (tower) {
    // Giant ORBITX CITY on the tower's south face (faces the plaza and
    // spawn), like the splash 1s frame.
    const sign = makeNeonSign("ORBITX\nCITY", { width: 20, color: "pink", backing: false });
    if (sign) {
      sign.position.set(0, 44, -2.6);
      g.add(sign);
    }
    const welcome = makeNeonSign("ORBITX CITY\nWELCOME", { width: 14, color: "cyan", backing: false });
    if (welcome) {
      welcome.position.set(0, 30, -2.6);
      g.add(welcome);
    }
  }
  let si = 0;
  for (const { f } of core) {
    if (f.id === "tower") continue;
    if (si >= DISTRICT_SIGNS.length) break;
    const spec = DISTRICT_SIGNS[si++];
    const off = faceOffset(f);
    const width = spec.vertical ? 2.6 : Math.min(f.w * 0.72, 11);
    const sign = makeNeonSign(spec.text, {
      width,
      color: spec.color,
      backing: true,
      vertical: spec.vertical,
      sub: spec.sub,
    });
    if (!sign) continue;
    sign.position.set(off.x, spec.vertical ? f.h * 0.6 : Math.min(f.h * 0.62, 14), off.z);
    sign.rotation.y = off.ry;
    g.add(sign);
  }
  // Billboards on the two mega buildings (frames show ORBITX
  // ENTERTAINMENT screens on the big blocks).
  const mall = facades.find((f) => f.id === "mall" || f.id.startsWith("mega-mall"));
  const office = facades.find((f) => f.id === "office" || f.id.startsWith("mega-office"));
  if (mall) {
    const b = makeBillboard("ORBITX\nCITY", { width: 16, color: "pink", sub: "FREE FOREVER" });
    if (b) {
      const off = faceOffset(mall);
      b.position.set(off.x, Math.min(mall.h * 0.55, 16), off.z);
      b.rotation.y = off.ry;
      g.add(b);
    }
  }
  if (office) {
    const b = makeBillboard("ORBITX\nENTERTAINMENT", { width: 16, color: "cyan" });
    if (b) {
      const off = faceOffset(office);
      b.position.set(off.x, Math.min(office.h * 0.55, 16), off.z);
      b.rotation.y = off.ry;
      g.add(b);
    }
  }
  return g;
}

/**
 * Light rain streaks for night mode (video 05, optional, cheap):
 * a LineSegments cloud of short vertical streaks in a 70u box; the
 * engine re-centers it on the camera and cycles the fall.
 */
export function makeRain(count = 500): { lines: LineSegments; update: (dt: number, cx: number, cz: number) => void } {
  const positions = new Float32Array(count * 6);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const px = (Math.random() - 0.5) * 70;
    const py = Math.random() * 30;
    const pz = (Math.random() - 0.5) * 70;
    positions[i * 6] = px;
    positions[i * 6 + 1] = py;
    positions[i * 6 + 2] = pz;
    positions[i * 6 + 3] = px;
    positions[i * 6 + 4] = py - 0.55;
    positions[i * 6 + 5] = pz;
    speeds[i] = 18 + Math.random() * 10;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  const mat = new LineBasicMaterial({ color: 0x9db8d8, transparent: true, opacity: 0.35, depthWrite: false });
  const lines = new LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.visible = false;
  const update = (dt: number, cx: number, cz: number) => {
    const pos = geo.attributes.position as BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 6 + 1] -= speeds[i] * dt;
      arr[i * 6 + 4] -= speeds[i] * dt;
      if (arr[i * 6 + 1] < 0) {
        const px = (Math.random() - 0.5) * 70;
        const pz = (Math.random() - 0.5) * 70;
        arr[i * 6] = px;
        arr[i * 6 + 1] = 24 + Math.random() * 6;
        arr[i * 6 + 2] = pz;
        arr[i * 6 + 3] = px;
        arr[i * 6 + 4] = arr[i * 6 + 1] - 0.55;
        arr[i * 6 + 5] = pz;
      }
    }
    pos.needsUpdate = true;
    lines.position.set(cx, 0, cz);
  };
  return { lines, update };
}

/** Mount every landmark into one group (called once per city build). */
export function mountLandmarks(city: City, _quality: QualityName): Group {
  const g = new Group();
  g.name = "landmarks";
  g.add(buildGate());
  g.add(buildPalms(city.palms ?? []));
  g.add(buildMarket());
  g.add(buildPlazaRing());
  g.add(buildFountainGlow(city.fountain));
  const streetSign = makeStreetSign("ROUTE 12  DOWNTOWN", 7);
  if (streetSign) {
    const pole = mesh(new CylinderGeometry(0.09, 0.11, 5.4, 8), darkMetal, 8, 2.7, -30);
    g.add(pole);
    streetSign.position.set(8, 5.6, -30);
    g.add(streetSign);
  }
  g.add(mountDistrictSigns(city.facades));
  return g;
}
