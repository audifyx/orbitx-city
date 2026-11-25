// ---------------------------------------------------------------------------
// OrbitX City — SEA (Round 7: the sea, made real)
// ---------------------------------------------------------------------------
// The straits used to be flat blue slabs (water.ts "water" boxes): no
// waves, no shore foam, nothing alive in them. This module makes the sea
// real in three parts, all cheap on phones:
//
//   1. WAVES — one animated shader plane per strait (+ a gentle one over
//      the harbor pool). Three summed sine swells displace the surface on
//      the GPU (zero per-frame CPU cost), the fragment shader shades deep
//      blue -> shallow teal by swell height, adds crest foam, animated
//      shore foam at the plane edges, and sun glints. The flat strait
//      surface boxes in water.ts are hidden (hide: true) so this plane IS
//      the surface — one transparent layer, so the animals below stay
//      visible from the ferry, the bridges and the beach. The seabed
//      stays: the water still reads as deep.
//   2. BEACHES — pale sand strips (existing "cream" mat) along every
//      strait shore, clear of the bridge decks (z -12..12 / x -12..12)
//      and the ferry piers, with umbrellas + towels on the main south
//      beach. No colliders: sand is walk-through, swimming out is never
//      blocked.
//   3. SEA ANIMALS — fish schools, dolphins, turtles, a shark or two and
//      drifting jellyfish, all as InstancedMesh (one draw call per
//      species, shared merged geometry, simple elliptical swim loops
//      with surfacing/diving bob). Visible from the ferry docks and
//      bridges, from the beach, and while swimming (they cruise just
//      below the surface, y -1.4..-4.5 over the -6 seabed).
//
// QUALITY TIERS: low = fewer animals + coarser wave mesh, high = full.
// Wiring (engine.ts, same pattern as the sky layer): buildSeaLayer in
// buildMovers, seaLayer.update() once per frame next to skyLayer.
// No gameplay touched: isWater / swim / boats / bridges / docks all
// read the same WATER_REGIONS contract from water.ts.
//
// ECONOMY: City Sol only. No real money, no SOL, no ORBITX, no burn.
// ---------------------------------------------------------------------------

import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Color,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { City } from "./city";
import type { QualityName } from "./pretty";
import { WATER_REGIONS, WATER_SURFACE_Y } from "./water";

export interface SeaLayer {
  group: Group;
  update: (dt: number, t: number, nightF: number, dayF: number, indoors: boolean) => void;
}

/** Counts per quality tier — the whole sea stays under ~40 instances. */
export const SEA_ANIMAL_COUNTS: Record<QualityName, { fish: number; dolphins: number; turtles: number; sharks: number; jellies: number }> = {
  low: { fish: 12, dolphins: 3, turtles: 2, sharks: 1, jellies: 2 },
  medium: { fish: 18, dolphins: 4, turtles: 3, sharks: 2, jellies: 3 },
  high: { fish: 24, dolphins: 6, turtles: 4, sharks: 2, jellies: 4 },
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Beaches (static boxes — called from buildAllRegions, after the water)
// ---------------------------------------------------------------------------

function sandStrip(city: City, x: number, z: number, w: number, d: number): void {
  city.boxes.push({ x, y: 0.03, z, sx: w, sy: 0.06, sz: d, mat: "cream", ry: 0 });
}

function beachUmbrella(city: City, x: number, z: number, top: "red" | "white" | "cyan", ry: number): void {
  city.boxes.push({ x, y: 1.2, z, sx: 0.18, sy: 2.4, sz: 0.18, mat: "wood", ry: 0 });
  city.boxes.push({ x, y: 2.45, z, sx: 3.6, sy: 0.16, sz: 3.6, mat: top, ry });
}

function beachTowel(city: City, x: number, z: number, mat: "cyan" | "warm" | "gold", ry: number): void {
  city.boxes.push({ x, y: 0.1, z, sx: 2.4, sy: 0.08, sz: 1.1, mat, ry });
}

/**
 * Sand + umbrellas + towels along every strait shore.
 * Segments dodge the bridge decks (west/east z -12..12, south x -12..12)
 * and the ferry piers (west/east z 15.5..18.5, south x 15.5..18.5).
 * No colliders — the shore stays walkable and swimmable.
 */
export function buildSeaBeach(city: City): void {
  // South strait shores — the main beaches (home south edge z 372..380,
  // FL north edge z 710..718), 8 deep, two segments each side of the
  // Palms Span / south docks.
  for (const z of [376, 714]) {
    sandStrip(city, -200, z, 320, 8);
    sandStrip(city, 200, z, 320, 8);
  }
  // West strait shores (home west edge x -380..-372, NY east edge
  // x -610..-602) and east strait shores (home east 372..380, LA west
  // 602..610), two segments each side of the Empire/Sunset spans.
  for (const x of [-376, -606, 376, 606]) {
    sandStrip(city, x, -200, 8, 320);
    sandStrip(city, x, 200, 8, 320);
  }
  // Umbrellas + towels: the south home beach is the sunbathing beach.
  const tops: Array<"red" | "white" | "cyan"> = ["red", "white", "cyan", "red", "white", "cyan"];
  const spots: Array<[number, number]> = [
    [-320, 375.5], [-200, 375.5], [-120, 375.5], [80, 375.5], [180, 375.5], [300, 375.5],
  ];
  spots.forEach(([x, z], i) => {
    beachUmbrella(city, x, z, tops[i % tops.length] as "red" | "white" | "cyan", (i % 2) * Math.PI / 4);
    beachTowel(city, x + 2.6, z + 1.2, (["cyan", "warm", "gold"] as const)[i % 3], (i % 3) * 0.5);
  });
  // A few umbrellas on the FL beach + the west/east home beaches.
  beachUmbrella(city, -240, 714.5, "cyan", 0);
  beachUmbrella(city, -80, 714.5, "red", Math.PI / 4);
  beachUmbrella(city, 120, 714.5, "white", 0);
  beachUmbrella(city, 260, 714.5, "red", Math.PI / 4);
  beachTowel(city, -237, 715.8, "gold", 0.4);
  beachTowel(city, 123, 715.8, "cyan", -0.3);
  beachUmbrella(city, -376, -200, "white", Math.PI / 4);
  beachUmbrella(city, -376, 200, "red", 0);
  beachUmbrella(city, 376, -160, "cyan", 0);
  beachUmbrella(city, 376, 200, "white", Math.PI / 4);
}

// ---------------------------------------------------------------------------
// Wave surface (shader planes over the straits + harbor pool)
// ---------------------------------------------------------------------------

const WAVE_VERTEX = `
  uniform float uTime;
  uniform float uAmp;
  varying float vWave;
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vUv = uv;
    vec3 p = position;
    float w = 0.0;
    w += sin(p.x * 0.11 + uTime * 1.1) * 0.55;
    w += sin(p.z * 0.09 - uTime * 0.8) * 0.45;
    w += sin((p.x + p.z) * 0.05 + uTime * 0.5) * 0.6;
    p.y += w * uAmp;
    vWave = w / 1.6 * 0.5 + 0.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const WAVE_FRAGMENT = `
  uniform float uTime;
  uniform float uNight;
  uniform float uDay;
  varying float vWave;
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vec3 deep = vec3(0.03, 0.20, 0.55);
    vec3 shallow = vec3(0.05, 0.55, 0.75);
    vec3 col = mix(deep, shallow, vWave);
    float glint = smoothstep(0.82, 0.98, vWave) * 0.35;
    float edge = max(max(vUv.x, 1.0 - vUv.x), max(vUv.y, 1.0 - vUv.y));
    float foamBand = smoothstep(0.94, 1.0, edge);
    float foamAnim = 0.5 + 0.5 * sin(uTime * 1.6 + edge * 40.0 + vUv.x * 20.0);
    float foam = foamBand * (0.45 + 0.45 * foamAnim);
    float crest = smoothstep(0.78, 0.95, vWave) * 0.5;
    col = mix(col, vec3(0.9, 0.97, 1.0), clamp(foam + crest * 0.6, 0.0, 0.85));
    col += vec3(1.0, 0.95, 0.8) * glint * (1.0 - uNight);
    col = mix(col, col * vec3(0.25, 0.35, 0.6) + vec3(0.0, 0.02, 0.06), uNight * 0.85);
    col *= 1.0 + uDay * 0.12;
    float alpha = 0.66 + foam * 0.25 + crest * 0.1;
    alpha *= 1.0 - smoothstep(480.0, 900.0, vDist);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

interface WavePlane {
  mat: ShaderMaterial;
}

function makeWavePlane(
  group: Group,
  cx: number,
  cz: number,
  w: number,
  d: number,
  segX: number,
  segZ: number,
  amp: number,
  y: number = WATER_SURFACE_Y + 0.03,
): WavePlane {
  const geo = new PlaneGeometry(w, d, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const mat = new ShaderMaterial({
    vertexShader: WAVE_VERTEX,
    fragmentShader: WAVE_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uDay: { value: 0 },
      uAmp: { value: amp },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.position.set(cx, y, cz);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  group.add(mesh);
  return { mat };
}

// ---------------------------------------------------------------------------
// Sea animals (InstancedMesh, merged geometry, elliptical swim loops)
// ---------------------------------------------------------------------------

function buildFishGeometry(): ReturnType<typeof mergeGeometries> {
  const body = new SphereGeometry(0.5, 10, 8);
  body.scale(1.6, 0.5, 0.32);
  const tail = new ConeGeometry(0.32, 0.55, 4);
  tail.rotateZ(Math.PI / 2); // point -X (behind the body)
  tail.scale(1, 1, 0.25);
  tail.translate(-1.0, 0, 0);
  const dorsal = new ConeGeometry(0.22, 0.4, 4);
  dorsal.scale(1, 1, 0.2);
  dorsal.translate(0.1, 0.35, 0);
  return mergeGeometries([body, tail, dorsal]);
}

function buildDolphinGeometry(): ReturnType<typeof mergeGeometries> {
  const body = new CapsuleGeometry(0.5, 2.0, 4, 10);
  body.rotateZ(Math.PI / 2); // capsule axis -> X, forward +X
  const snout = new ConeGeometry(0.22, 0.7, 8);
  snout.rotateZ(-Math.PI / 2); // point +X
  snout.translate(1.7, -0.05, 0);
  const dorsal = new ConeGeometry(0.3, 0.7, 4);
  dorsal.scale(1, 1, 0.25);
  dorsal.translate(-0.2, 0.55, 0);
  const fluke = new SphereGeometry(0.5, 10, 8);
  fluke.scale(0.7, 0.12, 1.1);
  fluke.translate(-1.7, 0, 0);
  const finL = new SphereGeometry(0.3, 8, 6);
  finL.scale(0.9, 0.12, 0.35);
  finL.rotateY(0.5);
  finL.translate(0.5, -0.35, -0.45);
  const finR = new SphereGeometry(0.3, 8, 6);
  finR.scale(0.9, 0.12, 0.35);
  finR.rotateY(-0.5);
  finR.translate(0.5, -0.35, 0.45);
  return mergeGeometries([body, snout, dorsal, fluke, finL, finR]);
}

function buildTurtleGeometry(): ReturnType<typeof mergeGeometries> {
  const shell = new SphereGeometry(0.6, 12, 8);
  shell.scale(1.5, 0.5, 1.1);
  const head = new SphereGeometry(0.22, 8, 6);
  head.translate(1.05, 0, 0);
  const flippers: Array<ReturnType<typeof mergeGeometries>> = [];
  for (const [fx, fz, ry] of [
    [0.5, -0.75, 0.5],
    [0.5, 0.75, -0.5],
    [-0.55, -0.7, -0.4],
    [-0.55, 0.7, 0.4],
  ] as const) {
    const f = new BoxGeometry(0.7, 0.08, 0.35);
    f.rotateY(ry);
    f.translate(fx, -0.1, fz);
    flippers.push(f as unknown as ReturnType<typeof mergeGeometries>);
  }
  return mergeGeometries([shell, head, ...flippers]);
}

function buildSharkGeometry(): ReturnType<typeof mergeGeometries> {
  const body = new CapsuleGeometry(0.45, 2.2, 4, 10);
  body.rotateZ(Math.PI / 2);
  const snout = new ConeGeometry(0.3, 0.6, 8);
  snout.rotateZ(-Math.PI / 2);
  snout.translate(1.65, 0, 0);
  const dorsal = new ConeGeometry(0.34, 0.9, 4);
  dorsal.scale(1, 1, 0.22);
  dorsal.translate(-0.2, 0.6, 0);
  const tail = new ConeGeometry(0.4, 0.8, 4);
  tail.rotateZ(Math.PI / 2); // point -X, vertical fin
  tail.scale(1, 1, 0.2);
  tail.translate(-1.8, 0.15, 0);
  return mergeGeometries([body, snout, dorsal, tail]);
}

function buildJellyGeometry(): ReturnType<typeof mergeGeometries> {
  const dome = new SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.7, 1);
  const parts: Array<ReturnType<typeof mergeGeometries>> = [dome as unknown as ReturnType<typeof mergeGeometries>];
  for (const [tx, tz] of [[0.2, 0], [-0.2, 0.15], [0, -0.2]] as const) {
    const t = new ConeGeometry(0.06, 0.8, 6);
    t.rotateZ(Math.PI); // point down
    t.translate(tx, -0.55, tz);
    parts.push(t as unknown as ReturnType<typeof mergeGeometries>);
  }
  return mergeGeometries(parts);
}

interface Animal {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  y: number;
  speed: number;
  phase: number;
  size: number;
  bobAmp: number;
  bobFreq: number;
  wiggle: number;
}

const FISH_COLORS = [0xff8c42, 0xffd23f, 0x3aa7ff, 0xff7fa8, 0x7ee081];

/** Elliptical swim-loop plan for one species, deterministic per seed. */
function planAnimals(
  rng: () => number,
  count: number,
  centers: Array<{ cx: number; cz: number; rx: number; rz: number }>,
  yMin: number,
  yMax: number,
  speedMin: number,
  speedMax: number,
  sizeMin: number,
  sizeMax: number,
  bobAmp: number,
  bobFreq: number,
  wiggle: number,
): Animal[] {
  const out: Animal[] = [];
  for (let i = 0; i < count; i++) {
    const c = centers[i % centers.length] as { cx: number; cz: number; rx: number; rz: number };
    const jitter = 0.75 + rng() * 0.5;
    out.push({
      cx: c.cx + (rng() - 0.5) * 30,
      cz: c.cz + (rng() - 0.5) * 30,
      rx: c.rx * jitter,
      rz: c.rz * jitter,
      y: yMin + rng() * (yMax - yMin),
      speed: (speedMin + rng() * (speedMax - speedMin)) * (rng() > 0.5 ? 1 : -1),
      phase: rng() * Math.PI * 2,
      size: sizeMin + rng() * (sizeMax - sizeMin),
      bobAmp,
      bobFreq: bobFreq * (0.8 + rng() * 0.4),
      wiggle,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layer build
// ---------------------------------------------------------------------------

export function buildSeaLayer(city: City, quality: QualityName): SeaLayer {
  const rng = mulberry32(0x5ea5);
  const group = new Group();
  group.name = "sea-layer";
  void city;

  // ---- wave planes: one per strait + a gentle ripple over the harbor ----
  const seg = quality === "low" ? 0.5 : 1;
  const planes: WavePlane[] = [];
  for (const r of WATER_REGIONS) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    planes.push(
      makeWavePlane(group, cx, cz, w, d, Math.max(8, Math.round(24 * seg * (w / 230))), Math.max(8, Math.round(24 * seg * (d / 230))), 0.22),
    );
  }
  // Harbor pool (city.ts addHarbor: x -50..50, z 198..246, top y 0.08):
  // a low ripple just above it so the pier water moves too. Its own y:
  // the harbor is a shallow sheet on the y=0 slab, NOT a strait.
  planes.push(makeWavePlane(group, 0, 222, 100, 48, 12, 6, 0.05, 0.1));

  // ---- animals -----------------------------------------------------------
  const counts = SEA_ANIMAL_COUNTS[quality];
  const dummy = new Object3D();
  const color = new Color();

  const fishSchools = [
    { cx: -495, cz: 60, rx: 60, rz: 90 }, // west strait, by the west-home dock
    { cx: 495, cz: -80, rx: 60, rz: 90 }, // east strait
    { cx: -140, cz: 545, rx: 90, rz: 55 }, // south strait, off the main beach
    { cx: 180, cz: 545, rx: 90, rz: 55 }, // south strait, east side
  ];
  const fish = planAnimals(rng, counts.fish, fishSchools, -3.2, -1.8, 0.04, 0.1, 0.5, 0.9, 0.25, 0.9, 0.14);
  const fishGeo = buildFishGeometry();
  const fishMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.05 });
  const fishMesh = new InstancedMesh(fishGeo, fishMat, Math.max(1, fish.length));
  fishMesh.frustumCulled = false;
  fish.forEach((a, i) => {
    color.setHex(FISH_COLORS[i % FISH_COLORS.length] as number);
    fishMesh.setColorAt(i, color);
  });
  if (fishMesh.instanceColor) fishMesh.instanceColor.needsUpdate = true;
  group.add(fishMesh);

  const dolphinCenters = [
    { cx: -495, cz: -120, rx: 110, rz: 140 },
    { cx: 495, cz: 120, rx: 110, rz: 140 },
    { cx: 0, cz: 545, rx: 160, rz: 70 },
    { cx: -495, cz: 200, rx: 90, rz: 110 },
    { cx: 495, cz: -220, rx: 90, rz: 110 },
    { cx: 150, cz: 545, rx: 120, rz: 60 },
  ];
  const dolphins = planAnimals(rng, counts.dolphins, dolphinCenters, -2.4, -2.0, 0.05, 0.09, 1.0, 1.4, 1.15, 0.55, 0.1);
  const dolphinMesh = new InstancedMesh(
    buildDolphinGeometry(),
    new MeshStandardMaterial({ color: 0x7fa8c9, roughness: 0.55, metalness: 0.05 }),
    Math.max(1, dolphins.length),
  );
  dolphinMesh.frustumCulled = false;
  group.add(dolphinMesh);

  const turtleCenters = [
    { cx: -300, cz: 400, rx: 60, rz: 40 }, // off the south home beach
    { cx: 250, cz: 690, rx: 60, rz: 40 }, // off the FL beach
    { cx: -420, cz: -200, rx: 50, rz: 60 },
    { cx: 420, cz: 200, rx: 50, rz: 60 },
  ];
  const turtles = planAnimals(rng, counts.turtles, turtleCenters, -1.8, -1.5, 0.02, 0.03, 0.9, 1.2, 0.2, 0.4, 0.05);
  const turtleMesh = new InstancedMesh(
    buildTurtleGeometry(),
    new MeshStandardMaterial({ color: 0x5a7a3a, roughness: 0.7, metalness: 0.0 }),
    Math.max(1, turtles.length),
  );
  turtleMesh.frustumCulled = false;
  group.add(turtleMesh);

  const sharkCenters = [
    { cx: -495, cz: 0, rx: 100, rz: 160 },
    { cx: 0, cz: 545, rx: 150, rz: 70 },
  ];
  const sharks = planAnimals(rng, counts.sharks, sharkCenters, -4.5, -4.0, 0.025, 0.035, 1.3, 1.6, 0.3, 0.5, 0.08);
  const sharkMesh = new InstancedMesh(
    buildSharkGeometry(),
    new MeshStandardMaterial({ color: 0x6b7f92, roughness: 0.6, metalness: 0.05 }),
    Math.max(1, sharks.length),
  );
  sharkMesh.frustumCulled = false;
  group.add(sharkMesh);

  const jellyCenters = [
    { cx: -430, cz: 40, rx: 10, rz: 12 }, // drifting by the west-home dock
    { cx: 430, cz: -40, rx: 10, rz: 12 }, // by the east-home dock
    { cx: 40, cz: 430, rx: 12, rz: 10 }, // by the south-home dock
    { cx: -40, cz: 680, rx: 10, rz: 12 },
  ];
  const jellies = planAnimals(rng, counts.jellies, jellyCenters, -1.5, -1.3, 0.04, 0.06, 0.8, 1.2, 0.25, 0.8, 0.03);
  const jellyMesh = new InstancedMesh(
    buildJellyGeometry(),
    new MeshStandardMaterial({ color: 0xffc9dd, roughness: 0.4, metalness: 0.0, transparent: true, opacity: 0.75 }),
    Math.max(1, jellies.length),
  );
  jellyMesh.frustumCulled = false;
  group.add(jellyMesh);

  const species: Array<{ mesh: InstancedMesh; animals: Animal[] }> = [
    { mesh: fishMesh, animals: fish },
    { mesh: dolphinMesh, animals: dolphins },
    { mesh: turtleMesh, animals: turtles },
    { mesh: sharkMesh, animals: sharks },
    { mesh: jellyMesh, animals: jellies },
  ];

  (window as unknown as { __ORBITX_SEA?: unknown }).__ORBITX_SEA = {
    fish: fish.length,
    dolphins: dolphins.length,
    turtles: turtles.length,
    sharks: sharks.length,
    jellies: jellies.length,
    planes: planes.length,
  };

  function update(_dt: number, t: number, nightF: number, dayF: number, indoors: boolean): void {
    group.visible = !indoors;
    if (indoors) return;
    for (const p of planes) {
      p.mat.uniforms.uTime.value = t;
      p.mat.uniforms.uNight.value = nightF;
      p.mat.uniforms.uDay.value = dayF;
    }
    for (const { mesh, animals } of species) {
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i] as Animal;
        const ang = a.phase + t * a.speed;
        const x = a.cx + Math.cos(ang) * a.rx;
        const z = a.cz + Math.sin(ang) * a.rz;
        const dx = -Math.sin(ang) * a.rx * a.speed;
        const dz = Math.cos(ang) * a.rz * a.speed;
        const yaw = Math.atan2(-dz, dx);
        const y = a.y + Math.sin(t * a.bobFreq + a.phase) * a.bobAmp;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, yaw, Math.sin(t * 2.5 + a.phase) * a.wiggle);
        dummy.scale.setScalar(a.size);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, update };
}
