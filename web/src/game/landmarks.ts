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
 * Round-2 (2026-11-24): the same record+render pattern now covers the
 * whole street level — benches, planters, bins, lamps, kiosks, fuel
 * stations, charge points, traffic lights, bollards, beveled curbs,
 * voxel discs (fountain/roulette/pond) and bus-shelter vaults.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
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
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { City, Facade, Mat, ShapedKind, ShapedPart } from "./city";
import { MATERIALS } from "./materials";
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

// ---- round-2 street-prop materials (shaped benches / planters / bins /
// lamps / kiosks / fuel / charge / traffic lights / curbs / discs). ----
const globeMat = new MeshStandardMaterial({ color: 0xffe4b0, emissive: 0xffb347, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0 });
const benchWoodMat = new MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8, metalness: 0.05 });
const planterStoneMat = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.7, metalness: 0.1 });
const shrubMat = new MeshStandardMaterial({ color: 0x37b24a, roughness: 0.8, metalness: 0 });
const shrubDarkMat = new MeshStandardMaterial({ color: 0x2a7a33, roughness: 0.85, metalness: 0 });
const binBodyMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.3 });
const binLidMat = new MeshStandardMaterial({ color: 0x6a7076, roughness: 0.55, metalness: 0.4 });
const kioskWhiteMat = new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.5, metalness: 0.1 });
const fuelWhiteMat = new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.45, metalness: 0.15 });
const curbStoneMat = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.7, metalness: 0.05 });
const waterDiscMat = new MeshStandardMaterial({ color: 0x2fa8cc, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.78 });
const stoneDiscMat = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.7, metalness: 0.05 });
const warmDiscMat = new MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.85, metalness: 0 });
const blackDiscMat = new MeshStandardMaterial({ color: 0x141820, roughness: 0.6, metalness: 0.25 });
const goldDiscMat = new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.35, metalness: 0.7 });
const vaultGoldMat = new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.35, metalness: 0.7, side: DoubleSide });
/** Bin body colours by index (black / grey / green — the old BIN_MATS). */
const BIN_COLORS = [0x141820, 0x6a7076, 0x2a7a33];

// ---- round-7 street-clutter materials (hydrants / mailboxes / meters /
// dumpsters / newsboxes / cones / manholes + leafy oak canopies). ----
const hydrantMat = new MeshStandardMaterial({ color: 0xc1272d, roughness: 0.5, metalness: 0.25 });
const hydrantCapMat = new MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.7 });
const mailboxMat = new MeshStandardMaterial({ color: 0x1f3a5f, roughness: 0.55, metalness: 0.4 });
const meterMat = new MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.5, metalness: 0.6 });
const meterHeadMat = new MeshStandardMaterial({ color: 0x3a4048, roughness: 0.4, metalness: 0.7 });
const dumpsterMat = new MeshStandardMaterial({ color: 0x2a5a34, roughness: 0.75, metalness: 0.2 });
const dumpsterLidMat = new MeshStandardMaterial({ color: 0x1f4526, roughness: 0.8, metalness: 0.15 });
const coneMat = new MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6, metalness: 0 });
const coneBandMat = new MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.6, metalness: 0 });
const manholeMat = new MeshStandardMaterial({ color: 0x23272e, roughness: 0.55, metalness: 0.5 });
const oakFoliageMat = new MeshStandardMaterial({ color: 0x2f7a33, roughness: 0.85, metalness: 0 });
/** Newspaper-box body colours by index (red / yellow / teal). */
const NEWSBOX_COLORS = [0xc1272d, 0xf2c200, 0x0aa5a0];

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
export function buildPalms(palms: Array<{ x: number; y: number; z: number; kind?: "palm" | "oak" }>): Group {
  const g = new Group();
  g.name = "palms";
  if (!palms.length) return g;
  const dummy = new Object3D();
  // Round 7: every 4th tree is a leafy oak (city.ts records kind) —
  // palms keep the neon-ring look from the videos, oaks get a trunk +
  // foliage canopy and no rings, so the avenues stop being a
  // monoculture of identical palms.
  const palmList = palms.filter((p) => p.kind !== "oak");
  const oakList = palms.filter((p) => p.kind === "oak");
  // Trunks: tapered cylinders.
  const trunkGeo = new CylinderGeometry(0.26, 0.42, 5.4, 8);
  const trunks = new InstancedMesh(trunkGeo, trunkMat, palmList.length);
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
  const crowns = new InstancedMesh(crownGeo, frondMat, palmList.length);
  crowns.castShadow = true;
  // Neon trunk rings (pink), two per palm.
  const ringGeo = new TorusGeometry(0.5, 0.055, 8, 20);
  const rings = new InstancedMesh(ringGeo, ringMat, palmList.length * 2);
  rings.castShadow = false;
  palmList.forEach((p, i) => {
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
  // Leafy oaks: shorter, thicker trunk + two squashed foliage
  // spheres (main canopy + top tuft), deterministic size variety by
  // index. No neon rings — the oaks are the quiet green contrast to
  // the pink-ringed palms.
  if (oakList.length) {
    const oakTrunks = new InstancedMesh(new CylinderGeometry(0.3, 0.46, 3.4, 8), trunkMat, oakList.length);
    const oakCanopy = new InstancedMesh(new SphereGeometry(1.15, 10, 8), oakFoliageMat, oakList.length);
    const oakTops = new InstancedMesh(new SphereGeometry(0.7, 8, 6), shrubDarkMat, oakList.length);
    oakTrunks.castShadow = true;
    oakCanopy.castShadow = true;
    oakList.forEach((p, i) => {
      const s = 0.9 + (((i * 53) % 25) / 100); // deterministic 0.9..1.14 variety
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(p.x, p.y + 1.7, p.z);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      oakTrunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, p.y + 4.1 * s, p.z);
      dummy.scale.set(s * 1.15, s * 0.85, s * 1.15);
      dummy.updateMatrix();
      oakCanopy.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x + 0.4 * s, p.y + 4.9 * s, p.z - 0.2 * s);
      dummy.scale.setScalar(s * 0.9);
      dummy.updateMatrix();
      oakTops.setMatrixAt(i, dummy.matrix);
    });
    oakTrunks.instanceMatrix.needsUpdate = true;
    oakCanopy.instanceMatrix.needsUpdate = true;
    oakTops.instanceMatrix.needsUpdate = true;
    g.add(oakTrunks, oakCanopy, oakTops);
  }
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

/**
 * Round-4 shaped parts: the record+render half of city.ts's `shaped`
 * list. Unit geometries scaled per instance, bucketed by (kind, mat) so
 * each bucket is a single InstancedMesh draw call — the whole city's
 * shaped furniture costs a handful of draw calls. Materials are the
 * shared MATERIALS buckets, so textures + night glow apply as usual.
 * `arch` is a half-torus (upper half, XY plane): scale (r, r, 1) and
 * rotate Y to face the room. `taper4` is a square frustum (top 0.64x
 * the base, flat faces on the axes) — the shaped sofa / pot / plinth.
 */
const SHAPED_GEOS: Record<ShapedKind, BufferGeometry> = {
  cyl: new CylinderGeometry(0.5, 0.5, 1, 12),
  sphere: new SphereGeometry(0.5, 12, 8),
  cone: new ConeGeometry(0.5, 1, 12),
  torus: new TorusGeometry(0.5, 0.09, 8, 20),
  taper4: (() => {
    const geo = new CylinderGeometry(0.32, 0.5, 1, 4);
    geo.rotateY(Math.PI / 4);
    return geo;
  })(),
  arch: new TorusGeometry(1, 0.1, 8, 24, Math.PI),
};

export function buildShaped(parts: ShapedPart[]): Group {
  const g = new Group();
  g.name = "shaped-parts";
  if (!parts.length) return g;
  const dummy = new Object3D();
  const buckets = new Map<string, ShapedPart[]>();
  for (const p of parts) {
    const k = `${p.kind}|${p.mat}`;
    let list = buckets.get(k);
    if (!list) {
      list = [];
      buckets.set(k, list);
    }
    list.push(p);
  }
  for (const [key, list] of buckets) {
    const [kind, mat] = key.split("|") as [ShapedKind, Mat];
    const mesh = new InstancedMesh(SHAPED_GEOS[kind], MATERIALS[mat], list.length);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    g.add(mesh);
  }
  return g;
}

/**
 * Round-2 street props: shaped benches / planters / bins / lamps /
 * kiosks / fuel stations / charge points / traffic lights / bollards,
 * instanced from the positions city.ts records. The old box puts are
 * gone — colliders still live in city.ts, so gameplay is unchanged.
 */
export function buildStreetProps(city: City): Group {
  const g = new Group();
  g.name = "street-props";
  const dummy = new Object3D();

  // Lamps: tapered cylinder pole + warm globe.
  const lamps = city.lamps ?? [];
  if (lamps.length) {
    const poles = new InstancedMesh(new CylinderGeometry(0.07, 0.12, 4.3, 8), darkMetal, lamps.length);
    const globes = new InstancedMesh(new SphereGeometry(0.3, 10, 8), globeMat, lamps.length);
    lamps.forEach((l, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(l.x, l.y0 + 2.15, l.z);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(l.x, l.y0 + 4.45, l.z);
      dummy.updateMatrix();
      globes.setMatrixAt(i, dummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    globes.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    g.add(poles, globes);

    // Round 4: warm spill pools under every lamp globe — the wet-asphalt
    // reflection fake, extended from the shopfront spills (pretty.ts).
    // One instanced additive disc per lamp, at sidewalk-top + 0.01 so it
    // never z-fights the pavement (sidewalk top is y 0.16).
    const lampSpills = new InstancedMesh(
      new CircleGeometry(1, 20),
      new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.13, blending: AdditiveBlending, depthWrite: false }),
      lamps.length,
    );
    lamps.forEach((l, i) => {
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(2.6, 2.6, 1);
      dummy.position.set(l.x, l.y0 + 0.17, l.z);
      dummy.updateMatrix();
      lampSpills.setMatrixAt(i, dummy.matrix);
    });
    lampSpills.instanceMatrix.needsUpdate = true;
    lampSpills.renderOrder = 1;
    g.add(lampSpills);
  }

  // Benches: sloped wood seat + tilted backrest + cylinder legs.
  const benches = city.benches ?? [];
  if (benches.length) {
    // Seat pre-tilted so the front edge dips; backrest pre-tilted back.
    const seatGeo = new BoxGeometry(1.7, 0.12, 0.55);
    seatGeo.rotateX(0.12);
    const seats = new InstancedMesh(seatGeo, benchWoodMat, benches.length);
    const backGeo = new BoxGeometry(1.7, 0.55, 0.1);
    backGeo.rotateX(-0.28);
    const backs = new InstancedMesh(backGeo, benchWoodMat, benches.length);
    const legs = new InstancedMesh(new CylinderGeometry(0.05, 0.06, 0.48, 8), darkMetal, benches.length * 2);
    benches.forEach((b, i) => {
      const ry = b.alongX ? 0 : Math.PI / 2;
      dummy.rotation.set(0, ry, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(b.x, 0.48, b.z);
      dummy.updateMatrix();
      seats.setMatrixAt(i, dummy.matrix);
      // Backrest at the seat's rear edge (local -Z).
      dummy.position.set(b.alongX ? b.x : b.x - 0.26, 0.82, b.alongX ? b.z - 0.26 : b.z);
      dummy.updateMatrix();
      backs.setMatrixAt(i, dummy.matrix);
      for (let j = 0; j < 2; j++) {
        const off = j === 0 ? -0.7 : 0.7;
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(b.alongX ? b.x + off : b.x, 0.24, b.alongX ? b.z : b.z + off);
        dummy.updateMatrix();
        legs.setMatrixAt(i * 2 + j, dummy.matrix);
      }
    });
    seats.instanceMatrix.needsUpdate = true;
    backs.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
    seats.castShadow = true;
    backs.castShadow = true;
    g.add(seats, backs, legs);
  }

  // Planters: tapered cylinder tub + squashed sphere shrub + top tuft.
  const planters = city.planters ?? [];
  if (planters.length) {
    const tubs = new InstancedMesh(new CylinderGeometry(0.55, 0.42, 0.7, 10), planterStoneMat, planters.length);
    const shrubs = new InstancedMesh(new SphereGeometry(0.5, 8, 6), shrubMat, planters.length);
    const tops = new InstancedMesh(new SphereGeometry(0.32, 8, 6), shrubDarkMat, planters.length);
    planters.forEach((p, i) => {
      const s = 0.9 + (((i * 37) % 20) / 100); // deterministic 0.9..1.09 variety
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(p.x, 0.35, p.z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      tubs.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, 0.95, p.z);
      dummy.scale.set(s, s * 0.75, s);
      dummy.updateMatrix();
      shrubs.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x + 0.15 * s, 1.28, p.z);
      dummy.scale.setScalar(s * 0.9);
      dummy.updateMatrix();
      tops.setMatrixAt(i, dummy.matrix);
    });
    tubs.instanceMatrix.needsUpdate = true;
    shrubs.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    tubs.castShadow = true;
    g.add(tubs, shrubs, tops);
  }

  // Bins: cylinder body (colour by index) + lid.
  const bins = city.bins ?? [];
  if (bins.length) {
    const bodies = new InstancedMesh(new CylinderGeometry(0.34, 0.3, 1.0, 10), binBodyMat, bins.length);
    const lids = new InstancedMesh(new CylinderGeometry(0.38, 0.38, 0.1, 10), binLidMat, bins.length);
    bins.forEach((b, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(b.x, 0.5, b.z);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, new Color(BIN_COLORS[((b.i % 3) + 3) % 3]));
      dummy.position.set(b.x, 1.05, b.z);
      dummy.updateMatrix();
      lids.setMatrixAt(i, dummy.matrix);
    });
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    bodies.instanceMatrix.needsUpdate = true;
    lids.instanceMatrix.needsUpdate = true;
    bodies.castShadow = true;
    g.add(bodies, lids);
  }

  // Kiosks: cylinder base + curved cone roof + cyan beacon.
  for (const k of city.kiosks ?? []) {
    const kg = new Group();
    kg.add(mesh(new CylinderGeometry(0.85, 0.9, 1.5, 12), darkMetal, k.x, 0.75, k.z));
    const roofMat = k.top === "cyan" ? cyanGlowMat : kioskWhiteMat;
    kg.add(mesh(new ConeGeometry(1.15, 0.55, 12), roofMat, k.x, 1.78, k.z));
    const beaconK = mesh(new CylinderGeometry(0.16, 0.2, 0.5, 8), cyanGlowMat, k.x, 2.3, k.z);
    beaconK.castShadow = false;
    kg.add(beaconK);
    g.add(kg);
  }

  // Fuel stations: round canopy + gold rim + sign disc, cylinder posts
  // and pumps.
  for (const st of city.fuelStations ?? []) {
    const fg = new Group();
    fg.add(mesh(new CylinderGeometry(5.2, 5.2, 0.28, 24), fuelWhiteMat, st.x, 3.55, st.z));
    const rimF = mesh(new TorusGeometry(5.2, 0.09, 8, 32), goldTrim, st.x, 3.68, st.z);
    rimF.rotation.x = Math.PI / 2;
    rimF.castShadow = false;
    fg.add(rimF);
    fg.add(mesh(new CylinderGeometry(1.0, 1.0, 0.5, 16), goldTrim, st.x, 3.95, st.z));
    const dot = mesh(new CylinderGeometry(0.3, 0.3, 0.12, 12), cyanGlowMat, st.x, 4.25, st.z);
    dot.castShadow = false;
    fg.add(dot);
    for (const dx of [-3.5, 3.5]) {
      for (const dz of [-3, 3]) {
        const p = st.axis === "ew" ? { x: st.x + dx, z: st.z + dz } : { x: st.x + dz, z: st.z + dx };
        fg.add(mesh(new CylinderGeometry(0.14, 0.16, 3.4, 8), darkMetal, p.x, 1.7, p.z));
      }
    }
    for (const d of [-2, 2]) {
      const p = st.axis === "ew" ? { x: st.x + d, z: st.z } : { x: st.x, z: st.z + d };
      fg.add(mesh(new CylinderGeometry(0.32, 0.36, 1.4, 10), fuelWhiteMat, p.x, 0.7, p.z));
      fg.add(mesh(new CylinderGeometry(0.36, 0.36, 0.15, 10), goldTrim, p.x, 1.48, p.z));
    }
    g.add(fg);
  }

  // EV charge points: cylinder posts + cyan glow rings.
  for (const cp of city.chargePoints ?? []) {
    const cg = new Group();
    for (const d of [-1, 1.4]) {
      const px = cp.axis === "ew" ? cp.x + d : cp.x;
      const pz = cp.axis === "ew" ? cp.z : cp.z + d;
      cg.add(mesh(new CylinderGeometry(0.2, 0.24, 1.2, 10), darkMetal, px, 0.6, pz));
      const ring = mesh(new TorusGeometry(0.24, 0.05, 8, 16), cyanGlowMat, px, 1.28, pz);
      ring.rotation.x = Math.PI / 2;
      ring.castShadow = false;
      cg.add(ring);
      cg.add(mesh(new CylinderGeometry(0.24, 0.24, 0.1, 10), darkMetal, px, 1.32, pz));
    }
    g.add(cg);
  }

  // Round 4: cyan spill pools under the charge points, same fake as the
  // lamps above — the forecourt reads wet after dark.
  const cps = city.chargePoints ?? [];
  if (cps.length) {
    const cpSpills = new InstancedMesh(
      new CircleGeometry(1, 20),
      new MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false }),
      cps.length,
    );
    const dummyCp = new Object3D();
    cps.forEach((cp, i) => {
      dummyCp.rotation.set(-Math.PI / 2, 0, 0);
      dummyCp.scale.set(2.2, 2.2, 1);
      dummyCp.position.set(cp.x, 0.17, cp.z);
      dummyCp.updateMatrix();
      cpSpills.setMatrixAt(i, dummyCp.matrix);
    });
    cpSpills.instanceMatrix.needsUpdate = true;
    cpSpills.renderOrder = 1;
    g.add(cpSpills);
  }

  // Traffic lights: cylinder pole + head + glowing lenses (red/amber/green).
  const lights = city.trafficLights ?? [];
  if (lights.length) {
    const tlPoles = new InstancedMesh(new CylinderGeometry(0.09, 0.13, 3.8, 8), darkMetal, lights.length);
    const heads = new InstancedMesh(new CylinderGeometry(0.26, 0.26, 1.1, 10), darkMetal, lights.length);
    const lenses = new InstancedMesh(
      new SphereGeometry(0.13, 8, 6),
      new MeshBasicMaterial({ color: 0xffffff }),
      lights.length * 3,
    );
    const LENS_COLORS = [0xff2a2a, 0xffb347, 0x37b24a];
    const LENS_Y = [4.3, 3.95, 3.6];
    lights.forEach((t, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(t.x, 1.9, t.z);
      dummy.updateMatrix();
      tlPoles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, 3.95, t.z);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      for (let j = 0; j < 3; j++) {
        dummy.position.set(t.x, LENS_Y[j], t.z + 0.26);
        dummy.updateMatrix();
        lenses.setMatrixAt(i * 3 + j, dummy.matrix);
        lenses.setColorAt(i * 3 + j, new Color(LENS_COLORS[j]));
      }
    });
    if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
    tlPoles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    lenses.instanceMatrix.needsUpdate = true;
    tlPoles.castShadow = true;
    g.add(tlPoles, heads, lenses);
  }

  // Plaza bollards: gold cylinders with a dome cap.
  const bollards = city.bollards ?? [];
  if (bollards.length) {
    const bols = new InstancedMesh(new CylinderGeometry(0.26, 0.3, 0.7, 10), goldTrim, bollards.length);
    const caps = new InstancedMesh(new SphereGeometry(0.26, 10, 6), goldTrim, bollards.length);
    bollards.forEach((b, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(b.x, 0.35, b.z);
      dummy.updateMatrix();
      bols.setMatrixAt(i, dummy.matrix);
      dummy.position.set(b.x, 0.72, b.z);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    });
    bols.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    bols.castShadow = true;
    g.add(bols, caps);
  }

  // Round 7: street clutter (city.ts records these) — hydrants,
  // mailboxes, parking meters, dumpsters, newspaper boxes, traffic
  // cones, manholes. One instanced mesh per part, shared geometry /
  // materials, so the whole clutter layer costs ~14 draw calls.
  // Hydrants: red body + dome + two side caps facing the road.
  const hydrants = city.hydrants ?? [];
  if (hydrants.length) {
    const bodies = new InstancedMesh(new CylinderGeometry(0.2, 0.23, 0.75, 10), hydrantMat, hydrants.length);
    const domes = new InstancedMesh(new SphereGeometry(0.2, 10, 8), hydrantMat, hydrants.length);
    const capGeo = new CylinderGeometry(0.09, 0.09, 0.14, 8);
    capGeo.rotateZ(Math.PI / 2); // caps stick out sideways (local X)
    const caps = new InstancedMesh(capGeo, hydrantCapMat, hydrants.length * 2);
    hydrants.forEach((h, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(h.x, 0.375, h.z);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      dummy.position.set(h.x, 0.78, h.z);
      dummy.scale.set(1, 0.8, 1);
      dummy.updateMatrix();
      domes.setMatrixAt(i, dummy.matrix);
      // Caps face the road: alongX props face ±Z, the rest face ±X.
      const ry = h.alongX ? Math.PI / 2 : 0;
      for (let j = 0; j < 2; j++) {
        const s = j === 0 ? -1 : 1;
        dummy.rotation.set(0, ry, 0);
        dummy.scale.setScalar(1);
        dummy.position.set(h.alongX ? h.x : h.x + s * 0.24, 0.55, h.alongX ? h.z + s * 0.24 : h.z);
        dummy.updateMatrix();
        caps.setMatrixAt(i * 2 + j, dummy.matrix);
      }
    });
    bodies.instanceMatrix.needsUpdate = true;
    domes.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    bodies.castShadow = true;
    g.add(bodies, domes, caps);
  }

  // Mailboxes: dark-blue rounded body on a post, long axis along the street.
  const mailboxes = city.mailboxes ?? [];
  if (mailboxes.length) {
    const posts = new InstancedMesh(new CylinderGeometry(0.06, 0.07, 0.95, 8), darkMetal, mailboxes.length);
    const bodyGeo = new CapsuleGeometry(0.28, 0.5, 4, 8);
    bodyGeo.rotateZ(Math.PI / 2); // capsule lies along local X
    const bodies = new InstancedMesh(bodyGeo, mailboxMat, mailboxes.length);
    mailboxes.forEach((m, i) => {
      dummy.rotation.set(0, m.alongX ? 0 : Math.PI / 2, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(m.x, 0.475, m.z);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      dummy.position.set(m.x, 1.12, m.z);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
    });
    posts.instanceMatrix.needsUpdate = true;
    bodies.instanceMatrix.needsUpdate = true;
    bodies.castShadow = true;
    g.add(posts, bodies);
  }

  // Parking meters: thin post + domed head.
  const meters = city.meters ?? [];
  if (meters.length) {
    const posts = new InstancedMesh(new CylinderGeometry(0.05, 0.06, 1.05, 8), meterMat, meters.length);
    const heads = new InstancedMesh(new SphereGeometry(0.14, 8, 6), meterHeadMat, meters.length);
    meters.forEach((m, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(m.x, 0.525, m.z);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      dummy.position.set(m.x, 1.18, m.z);
      dummy.scale.set(1, 1.35, 0.8);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
    });
    posts.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    g.add(posts, heads);
  }

  // Dumpsters: dark-green square frustum (4-sided cylinder) + lid,
  // long side along the street.
  const dumpsters = city.dumpsters ?? [];
  if (dumpsters.length) {
    const bodyGeo = new CylinderGeometry(0.8, 0.72, 1.15, 4);
    bodyGeo.rotateY(Math.PI / 4); // flat faces to the street, not a diamond
    const bodies = new InstancedMesh(bodyGeo, dumpsterMat, dumpsters.length);
    const lidGeo = new CylinderGeometry(0.84, 0.84, 0.1, 4);
    lidGeo.rotateY(Math.PI / 4);
    const lids = new InstancedMesh(lidGeo, dumpsterLidMat, dumpsters.length);
    dumpsters.forEach((d, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(d.alongX ? 1.5 : 0.85, 1, d.alongX ? 0.85 : 1.5);
      dummy.position.set(d.x, 0.575, d.z);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      dummy.position.set(d.x, 1.2, d.z);
      dummy.updateMatrix();
      lids.setMatrixAt(i, dummy.matrix);
    });
    bodies.instanceMatrix.needsUpdate = true;
    lids.instanceMatrix.needsUpdate = true;
    bodies.castShadow = true;
    g.add(bodies, lids);
  }

  // Newspaper boxes: small square vending boxes, coloured by index
  // (red / yellow / teal — the market-stall palette).
  const newsboxes = city.newsboxes ?? [];
  if (newsboxes.length) {
    const bodyGeo = new CylinderGeometry(0.34, 0.34, 0.85, 4);
    bodyGeo.rotateY(Math.PI / 4);
    const bodies = new InstancedMesh(bodyGeo, binBodyMat, newsboxes.length);
    const lidGeo = new CylinderGeometry(0.37, 0.37, 0.08, 4);
    lidGeo.rotateY(Math.PI / 4);
    const lids = new InstancedMesh(lidGeo, binLidMat, newsboxes.length);
    newsboxes.forEach((n, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(n.alongX ? 1.1 : 0.75, 1, n.alongX ? 0.75 : 1.1);
      dummy.position.set(n.x, 0.425, n.z);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, new Color(NEWSBOX_COLORS[i % NEWSBOX_COLORS.length] as number));
      dummy.position.set(n.x, 0.9, n.z);
      dummy.updateMatrix();
      lids.setMatrixAt(i, dummy.matrix);
    });
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    bodies.instanceMatrix.needsUpdate = true;
    lids.instanceMatrix.needsUpdate = true;
    bodies.castShadow = true;
    g.add(bodies, lids);
  }

  // Traffic cones: orange cone + white band (visual only, no collider).
  const cones = city.cones ?? [];
  if (cones.length) {
    const coneMesh = new InstancedMesh(new ConeGeometry(0.24, 0.65, 10), coneMat, cones.length);
    const bands = new InstancedMesh(new CylinderGeometry(0.13, 0.155, 0.12, 10), coneBandMat, cones.length);
    cones.forEach((c, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(c.x, 0.325, c.z);
      dummy.updateMatrix();
      coneMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(c.x, 0.25, c.z);
      dummy.updateMatrix();
      bands.setMatrixAt(i, dummy.matrix);
    });
    coneMesh.instanceMatrix.needsUpdate = true;
    bands.instanceMatrix.needsUpdate = true;
    g.add(coneMesh, bands);
  }

  // Manholes: flat dark discs on the road centre (y 0.13 sits just
  // above the lane markings at 0.12, so no z-fight with the dashes).
  const manholes = city.manholes ?? [];
  if (manholes.length) {
    const discs = new InstancedMesh(new CircleGeometry(0.55, 20), manholeMat, manholes.length);
    manholes.forEach((m, i) => {
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(m.x, 0.13, m.z);
      dummy.updateMatrix();
      discs.setMatrixAt(i, dummy.matrix);
    });
    discs.instanceMatrix.needsUpdate = true;
    g.add(discs);
  }

  return g;
}

/** Beveled curbs: trapezoid-profile prisms along the road edges, with
 * rounded end caps at each run's ends (the sidewalk corners). */
export function buildCurbs(curbs: Array<{ x: number; z: number; len: number; alongX: boolean }>): Group {
  const g = new Group();
  g.name = "curbs";
  if (!curbs.length) return g;
  // Trapezoid cross-section: 0.6 wide at the base, 0.32 at the top, 0.18 high.
  const shape = new Shape();
  shape.moveTo(-0.3, 0);
  shape.lineTo(0.3, 0);
  shape.lineTo(0.16, 0.18);
  shape.lineTo(-0.16, 0.18);
  shape.closePath();
  const prismGeo = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  prismGeo.translate(0, 0, -0.5);
  const prisms = new InstancedMesh(prismGeo, curbStoneMat, curbs.length);
  const caps = new InstancedMesh(new CylinderGeometry(0.3, 0.3, 0.2, 10), curbStoneMat, curbs.length * 2);
  const dummy = new Object3D();
  curbs.forEach((c, i) => {
    dummy.position.set(c.x, 0.04, c.z);
    dummy.rotation.set(0, c.alongX ? Math.PI / 2 : 0, 0);
    dummy.scale.set(1, 1, c.len);
    dummy.updateMatrix();
    prisms.setMatrixAt(i, dummy.matrix);
    for (let j = 0; j < 2; j++) {
      const s = j === 0 ? -1 : 1;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.position.set(
        c.alongX ? c.x + (s * c.len) / 2 : c.x,
        0.13,
        c.alongX ? c.z : c.z + (s * c.len) / 2,
      );
      dummy.updateMatrix();
      caps.setMatrixAt(i * 2 + j, dummy.matrix);
    }
  });
  prisms.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  prisms.receiveShadow = true;
  caps.receiveShadow = true;
  g.add(prisms, caps);
  return g;
}

/** Shaped discs: the old 1x1-box discs (fountain tiers, roulette table,
 * pond, rope coil) as real cylinders; holed discs as flat water rings. */
export function buildDiscs(
  discs: Array<{ x: number; y: number; z: number; r: number; h: number; mat: Mat; hole: number }>,
): Group {
  const g = new Group();
  g.name = "discs";
  if (!discs.length) return g;
  const dummy = new Object3D();
  const byMat = new Map<string, typeof discs>();
  for (const d of discs) {
    if (d.hole > 0) continue; // rings handled below
    const list = byMat.get(d.mat) ?? [];
    list.push(d);
    byMat.set(d.mat, list);
  }
  const unitCyl = new CylinderGeometry(1, 1, 1, 20);
  const matFor: Record<string, MeshStandardMaterial> = {
    stone: stoneDiscMat,
    water: waterDiscMat,
    gold: goldDiscMat,
    black: blackDiscMat,
    warm: warmDiscMat,
  };
  for (const [matName, list] of byMat) {
    const mat = matFor[matName] ?? stoneDiscMat;
    const inst = new InstancedMesh(unitCyl, mat, list.length);
    list.forEach((d, i) => {
      dummy.position.set(d.x, d.y, d.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(d.r, d.h, d.r);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    g.add(inst);
  }
  // Holed discs: flat rings at the water's top surface (the basin wall
  // hides the missing side — the water reads as a surface, as before).
  for (const d of discs) {
    if (d.hole <= 0) continue;
    const ring = new Mesh(new RingGeometry(d.hole, d.r, 32), waterDiscMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(d.x, d.y + d.h / 2 + 0.01, d.z);
    g.add(ring);
  }
  return g;
}

/** Bus shelter canopies as barrel vaults (gold half-cylinder shells),
 * replacing the flat gold slabs. The vault's length runs along the
 * shelter's long axis; the arch springs from the post tops. */
export function buildShelterVaults(
  shelters: Array<{ x: number; z: number; axis: "ns" | "ew"; rw: number; rd: number; y: number }>,
): Group {
  const g = new Group();
  g.name = "shelter-vaults";
  for (const s of shelters) {
    const r = Math.min(s.rw, s.rd) / 2 + 0.3;
    const len = Math.max(s.rw, s.rd) + 0.4;
    const geo = new CylinderGeometry(r, r, len, 16, 1, true, 0, Math.PI);
    geo.rotateZ(Math.PI / 2); // axis along X, shell arches upward
    const vault = new Mesh(geo, vaultGoldMat);
    vault.position.set(s.x, s.y, s.z);
    if (s.axis === "ns") vault.rotation.y = Math.PI / 2;
    vault.castShadow = true;
    g.add(vault);
  }
  return g;
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
  g.add(buildStreetProps(city));
  g.add(buildShaped(city.shaped ?? []));
  g.add(buildCurbs(city.curbs ?? []));
  g.add(buildDiscs(city.discs ?? []));
  g.add(buildShelterVaults(city.shelters ?? []));
  return g;
}
