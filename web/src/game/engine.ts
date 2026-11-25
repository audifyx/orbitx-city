import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Fog,
  PCFSoftShadowMap,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  BackSide,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { buildCity, type City, type Mat, type RailPoint, type ShipPath } from "./city";
import { INTRO_LEN, introPose, type IntroPoseOut } from "./introPath";
import { MATERIALS } from "./materials";
import { createRuntime, wantsTouch, type Body, type Runtime, type TrainPose } from "./runtime";
import { isWater, WATER_SURFACE_Y } from "./water";
import { createMoveSmoother } from "./movement";
import { applyDayNightLighting, applyEnvironment, applyGraphicsPreset, upgradeMaterials, type GraphicsQuality } from "./graphics";
import { mountPretty, setPrettyNight, type QualityName } from "./pretty";
import { makeRain, mountLandmarks } from "./landmarks";
import { setSignGlow } from "./signs";
import { buildSkyLayer, type SkyLayer } from "./sky";
import { buildSeaLayer, type SeaLayer } from "./sea";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { Vector2 } from "three";

export type PlayMode = "orbit" | "play" | "air";

declare global {
  interface Window {
    __ORBITX_READY?: boolean;
    __ORBITX_FPS?: number;
    __ORBITX_DRAWS?: number;
    __ORBITX_BOXES?: number;
    __ORBITX_PLAYER?: { x: number; y: number; z: number; yaw: number; swimming: boolean; flying: boolean };
    __ORBITX_RIDER?: { visible: boolean; kind: string; pose: string; legL: number; armL: number; lean: number };
  }
}

const RADIUS = 0.28;
const HEIGHT = 1.7;

// Swim speed (u/s): slower than the 5.2 walk, fast enough that the
// 230-unit west/east strait takes ~50s and the 330-unit south strait ~75s.
// No drowning — a normal crossing is always survivable (no stamina meter,
// no death); the swimmer just strokes across.
const SWIM_SPEED = 4.5;
/** Sink/rise rate (u/s) easing the player to/from the water surface. */
const SWIM_SINK_RATE = 4;
/** Climb-out rate (u/s) easing the player from the surface back to y=0. */
const SWIM_CLIMB_RATE = 3.5;

function makeShip(body: Material, glass: Material, hot: Material) {
  const g = new Group();
  const box = new BoxGeometry(1, 1, 1);
  const hull = new Mesh(box, body);
  hull.scale.set(4.6, 0.68, 1.75);
  const belly = new Mesh(box, body);
  belly.scale.set(3.6, 0.24, 1.35);
  belly.position.set(-0.1, -0.4, 0);
  const hoverCore = new Mesh(box, hot);
  hoverCore.scale.set(1.8, 0.08, 0.85);
  hoverCore.position.set(-0.1, -0.53, 0);
  const cabin = new Mesh(box, glass);
  cabin.scale.set(2.35, 0.62, 1.28);
  cabin.position.set(0.05, 0.58, 0);
  const canopySpine = new Mesh(box, body);
  canopySpine.scale.set(2.4, 0.1, 0.14);
  canopySpine.position.set(0.05, 0.9, 0);
  const wingL = new Mesh(box, body);
  wingL.scale.set(1.65, 0.16, 3.1);
  wingL.position.set(-0.35, -0.02, 0);
  const wingTipL = new Mesh(box, hot);
  wingTipL.scale.set(1.1, 0.38, 0.12);
  wingTipL.position.set(-0.5, 0.14, 1.56);
  const wingTipR = new Mesh(box, hot);
  wingTipR.scale.set(1.1, 0.38, 0.12);
  wingTipR.position.set(-0.5, 0.14, -1.56);
  const tailFinL = new Mesh(box, body);
  tailFinL.scale.set(0.85, 0.72, 0.12);
  tailFinL.position.set(-1.85, 0.55, 0.58);
  const tailFinR = new Mesh(box, body);
  tailFinR.scale.set(0.85, 0.72, 0.12);
  tailFinR.position.set(-1.85, 0.55, -0.58);
  const engineL = new Mesh(box, hot);
  engineL.scale.set(0.75, 0.36, 0.48);
  engineL.position.set(-2.28, 0.04, 0.52);
  const engineR = new Mesh(box, hot);
  engineR.scale.set(0.75, 0.36, 0.48);
  engineR.position.set(-2.28, 0.04, -0.52);
  const nose = new Mesh(box, hot);
  nose.scale.set(0.45, 0.26, 0.88);
  nose.position.set(2.32, 0.06, 0);
  // Gold/cyan pinstripes along the hull sides.
  const stripeL = new Mesh(box, hot);
  stripeL.scale.set(4.2, 0.1, 0.06);
  stripeL.position.set(0, 0.24, 0.9);
  const stripeR = new Mesh(box, hot);
  stripeR.scale.set(4.2, 0.1, 0.06);
  stripeR.position.set(0, 0.24, -0.9);
  g.add(
    hull,
    belly,
    hoverCore,
    cabin,
    canopySpine,
    wingL,
    wingTipL,
    wingTipR,
    tailFinL,
    tailFinR,
    engineL,
    engineR,
    nose,
    stripeL,
    stripeR,
  );
  return g;
}

function makeTrain(body: Material, glass: Material, hot: Material, dark: Material) {
  const g = new Group();
  const box = new BoxGeometry(1, 1, 1);
  for (let i = 0; i < 3; i++) {
    const car = new Group();
    const shell = new Mesh(box, i === 0 ? body : dark);
    shell.scale.set(6.2, 2.15, 2.35);
    const skirt = new Mesh(box, dark);
    skirt.scale.set(6.0, 0.38, 2.42);
    skirt.position.y = -1.05;
    const stripe = new Mesh(box, glass);
    stripe.scale.set(5.5, 0.74, 2.48);
    stripe.position.y = 0.26;
    const accentBand = new Mesh(box, hot);
    accentBand.scale.set(6.24, 0.11, 2.42);
    accentBand.position.y = -0.22;
    // Window mullions + sliding door frames along each car side.
    for (const mx of [-1.85, -0.65, 0.65, 1.85]) {
      const mullion = new Mesh(box, dark);
      mullion.scale.set(0.16, 0.78, 2.52);
      mullion.position.set(mx, 0.26, 0);
      car.add(mullion);
    }
    const roof = new Mesh(box, dark);
    roof.scale.set(6.4, 0.32, 2.55);
    roof.position.y = 1.2;
    const hvac = new Mesh(box, body);
    hvac.scale.set(2.2, 0.22, 1.35);
    hvac.position.set(0, 1.44, 0);
    const light = new Mesh(box, hot);
    light.scale.set(0.28, 0.3, 1.55);
    light.position.set(3.15, 0.12, 0);
    const tailLight = new Mesh(box, hot);
    tailLight.scale.set(0.18, 0.22, 1.4);
    tailLight.position.set(-3.14, 0.12, 0);
    car.add(shell, skirt, stripe, accentBand, roof, hvac, light, tailLight);
    if (i < 2) {
      const coupler = new Mesh(box, dark);
      coupler.scale.set(0.95, 1.65, 1.85);
      coupler.position.set(3.55, -0.05, 0);
      car.add(coupler);
    }
    car.position.x = (i - 1) * 7.1;
    g.add(car);
  }
  return g;
}

export interface Game {
  start: (seed: number, mode: PlayMode) => void;
  dispose: () => void;
  runtime: Runtime;
  // Intro scene: drives the orbit camera through the scripted 30s
  // flyover (see INTRO_KEYS below). The React overlay owns the timer
  // and the title cards; the engine only moves the camera.
  setIntro: (on: boolean) => void;
  seekIntro?: (t: number, paused?: boolean) => void;
  // PHOTO MODE: render one frame with the current camera and hand back
  // the canvas as a PNG blob. Needed because the drawing buffer is not
  // preserved outside shot mode — a bare canvas.toBlob would come back
  // blank; rendering synchronously in the same task keeps it valid.
  capturePhoto: () => Promise<Blob | null>;
}

export function createGame(
  canvas: HTMLCanvasElement,
  onStatus: (text: string) => void,
  preserveDrawingBuffer: boolean,
): Game {
  const touch = wantsTouch();
  const renderer = new WebGLRenderer({
    canvas,
    antialias: !touch,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer,
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const qualityParam = new URLSearchParams(location.search).get("quality");
  const savedQuality = qualityParam || localStorage.getItem("orbitx-quality");
  const quality: QualityName =
    savedQuality === "low" || savedQuality === "medium" || savedQuality === "high" ? savedQuality : touch ? "low" : "high";
  // Graphics preset quality: the engine's own quality stays low/medium/high
  // (pretty.ts QualityName), but the graphics module also knows "ultra" —
  // the parse accepts it for the graphics calls below, never as a default.
  const graphicsQuality: GraphicsQuality = savedQuality === "ultra" ? "ultra" : quality;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "low" ? 1 : quality === "medium" ? 1.25 : 1.5));
  renderer.setClearColor(0x7a5578, 1);
  renderer.shadowMap.enabled = quality !== "low";
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  // Dusk fog is mauve-purple (realistic overhaul) — the indigo/pink
  // dusk of the splash frames, not the old orange sunset haze.
  const baseFog = new Fog(0x7a5578, touch ? 100 : 170, touch ? 2000 : 2800);
  scene.fog = baseFog;
  const runtime = createRuntime(scene);

  const camera = new PerspectiveCamera(62, 1, 0.08, 2600);

  const hemi = new HemisphereLight(0xffc9a2, 0x2a221c, 0.78);
  const sun = new DirectionalLight(0xffd0a2, 1.9);
  sun.position.set(110, 42, 30);
  sun.castShadow = quality !== "low";
  sun.shadow.mapSize.set(quality === "high" ? 2048 : 1024, quality === "high" ? 2048 : 1024);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 420;
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  const fill = new DirectionalLight(0x93a4ff, 0.32);
  fill.position.set(-60, 28, -40);
  const ambient = new AmbientLight(0xffb080, 0.16);
  scene.add(hemi, sun, sun.target, fill, ambient);

  const sky = new Mesh(
    new SphereGeometry(1, 28, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      uniforms: { uNight: { value: 0 }, uDay: { value: 0 }, uTime: { value: 0 } },
      fragmentShader: `
        varying vec3 vDir;
        uniform float uNight;
        uniform float uDay;
        uniform float uTime;
        // Value-noise clouds (2026-11-17, textures upgrade): the old sky
        // used sine-wave bands for clouds, which read as flat stripes, and
        // day mode mixed the whole sky to ONE flat blue, killing the
        // gradient. Real clouds are soft fbm billows, and day keeps a real
        // gradient (deep blue zenith -> pale horizon) with white clouds.
        float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
                     mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * vnoise(p);
            p = p * 2.03 + vec2(11.3, 7.9);
            a *= 0.5;
          }
          return v;
        }
        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          // Sunset palette, lerped toward a real day palette (gradient
          // kept — deep blue zenith, pale horizon — never a flat blue).
          vec3 zenith = mix(vec3(0.13, 0.10, 0.28), vec3(0.08, 0.32, 0.72), uDay);
          vec3 high = mix(vec3(0.45, 0.20, 0.36), vec3(0.22, 0.52, 0.88), uDay);
          vec3 mid = mix(vec3(0.95, 0.42, 0.16), vec3(0.52, 0.74, 0.95), uDay);
          vec3 hor = mix(vec3(1.0, 0.70, 0.32), vec3(0.84, 0.91, 0.98), uDay);
          vec3 below = mix(vec3(0.42, 0.16, 0.09), vec3(0.55, 0.68, 0.78), uDay);
          vec3 col = mix(below, hor, smoothstep(-0.2, 0.02, h));
          col = mix(col, mid, smoothstep(0.0, 0.16, h));
          col = mix(col, high, smoothstep(0.16, 0.48, h));
          col = mix(col, zenith, smoothstep(0.48, 0.95, h));
          vec3 sunDir = normalize(vec3(0.72, 0.18, 0.28));
          float sunDisk = pow(max(dot(dir, sunDir), 0.0), 90.0);
          float glow = pow(max(dot(dir, sunDir), 0.0), 5.0);
          vec3 sunCol = mix(vec3(1.0, 0.9, 0.55), vec3(1.0, 1.0, 0.95), uDay);
          vec3 glowCol = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.95, 0.85), uDay);
          col += sunCol * sunDisk * 1.5;
          col += glowCol * glow * 0.5;
          float cloudVal = 0.0;
          if (h > 0.02) {
            vec2 uv = dir.xz / max(h, 0.15);
            // Clouds drift slowly with time (round 2): the sky is alive,
            // not a painted backdrop.
            vec2 drift = vec2(uTime * 0.004, uTime * 0.0015);
            float c = fbm(uv * 0.45 + vec2(3.7, 1.3) + drift);
            float c2 = fbm(uv * 1.15 + vec2(9.1, 4.7) + drift * 1.7);
            float cloud = smoothstep(0.52, 0.78, c * 0.65 + c2 * 0.35);
            cloud *= smoothstep(0.02, 0.22, h);
            cloud *= 1.0 - smoothstep(0.6, 0.95, h) * 0.45;
            cloudVal = cloud;
            vec3 cloudCol = mix(vec3(1.0, 0.60, 0.34), vec3(1.0, 1.0, 1.0), uDay);
            col = mix(col, cloudCol, cloud * 0.6);
          }
          // Dusk haze band (round 2): warm mauve smog-glow hugging the
          // horizon at dusk, pale at day, deep blue at night — the haze
          // of the splash frames. Plus the purple band between the
          // orange horizon and the deep-blue zenith (dusk only).
          vec3 hazeCol = mix(vec3(0.62, 0.32, 0.38), vec3(0.78, 0.86, 0.94), uDay);
          hazeCol = mix(hazeCol, vec3(0.05, 0.08, 0.18), uNight);
          float haze = (1.0 - smoothstep(0.0, 0.16, h)) * step(0.0, h);
          col = mix(col, hazeCol, haze * 0.5);
          float duskF = (1.0 - uDay) * (1.0 - uNight);
          float band = smoothstep(0.14, 0.28, h) * (1.0 - smoothstep(0.28, 0.52, h));
          col = mix(col, vec3(0.42, 0.20, 0.50), band * 0.45 * duskF);
          // Night sky gradient + stars + moon glow.
          vec3 nightZenith = vec3(0.015, 0.024, 0.065);
          vec3 nightHor = vec3(0.055, 0.105, 0.21);
          vec3 nightCol = mix(nightHor, nightZenith, smoothstep(0.0, 0.75, max(0.0, h)));
          if (h > 0.06 && uNight > 0.05) {
            vec2 suv = floor(dir.xz / (h + 0.35) * 190.0);
            float sh = hash21(suv);
            float star = step(0.9945, sh) * (0.55 + 0.45 * hash21(suv + 17.3)) * (1.0 - cloudVal * 0.85);
            nightCol += vec3(0.82, 0.92, 1.0) * star * smoothstep(0.06, 0.28, h);
          }
          vec3 moonDir = normalize(vec3(-0.55, 0.48, -0.42));
          float moonDisk = pow(max(dot(dir, moonDir), 0.0), 220.0);
          float moonHalo = pow(max(dot(dir, moonDir), 0.0), 12.0);
          nightCol += vec3(0.78, 0.92, 1.0) * (moonDisk * 1.1 + moonHalo * 0.16);
          nightCol = mix(nightCol, vec3(0.08, 0.13, 0.24), cloudVal * 0.35);
          col = mix(col, nightCol, uNight);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.scale.setScalar(2600);
  scene.add(sky);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Bloom strength follows the time of day (realistic overhaul): the
  // neon only blooms hard after dark — 0.55 at night, 0.32 at dusk,
  // 0.18 in daylight. Driven per frame in frame() via the sky uniforms.
  const bloomPass = new UnrealBloomPass(new Vector2(1024, 1024), 0.32, 0.45, 0.86);
  composer.addPass(bloomPass);

  const unit = new BoxGeometry(1, 1, 1);
  const dummy = new Object3D();
  // Night rain (realistic overhaul): light streaks around the camera,
  // visible only at night — driven per frame in frame().
  const rain = makeRain(500);
  scene.add(rain.lines);
  let staticRoot = new Group();
  scene.add(staticRoot);

  const trains: Group[] = [];
  const ships: Group[] = [];
  const jets: Mesh[] = [];
  // Round 2 AIR layer (sky.ts): flying cars, drones, holograms, beams,
  // crowds. Rebuilt per city in buildMovers, like trains/ships.
  let skyLayer: SkyLayer | null = null;
  // Round 7 SEA layer (sea.ts): wave planes + sea animals. Same pattern
  // as the sky layer — rebuilt per city in buildMovers.
  let seaLayer: SeaLayer | null = null;
  let rail: RailPoint[] = [];
  let railDist: number[] = [];
  let railLen = 1;
  let trainDist: number[] = [0, 0];
  let trainSpeed: number[] = [18, 18];
  let trainDwell: number[] = [0, 0];
  let stationDist = 0;
  const STATION_POINT = { x: 0, z: 110 };
  const TRAIN_CRUISE = 18;
  const TRAIN_DWELL = 6;
  let shipPaths: ShipPath[] = [];
  let boot = 0;
  let fountain = { x: 0, z: 12 };
  let seed = 1;
  let mode: PlayMode = "orbit";
  let playing = false;

  // Intro flyover path (see introPath.ts): 30s, 5 acts, Catmull-Rom
  // spline through the keys — continuous velocity inside an act, hard
  // cuts between acts, Act 1 dives through the ORBITX CITY gate into
  // the plaza (video 03). The React overlay owns the timer; the
  // engine only consumes the pose. INTRO_LEN is imported, not local,
  // so the overlay (Intro.tsx) and the engine can never drift apart.
  let introOn = false;
  let introPaused = false;
  let introT = 0;
  let orbitClockOffset = 0;
  // Plain-array pose from introPath.ts, copied into introState below.
  const introPoseOut: IntroPoseOut = { pos: [0, 0, 0], look: [0, 0, 0], fov: 62, roll: 0 };
  const introState = { pos: new Vector3(), look: new Vector3(), fov: 62, roll: 0 };

  const player: Body = {
    x: 0,
    y: 0,
    z: 80,
    yaw: 0,
    pitch: 0.2,
    vy: 0,
    flying: false,
    onGround: false,
  };

  const keys = new Set<string>();
  // On-foot movement easing (movement.ts): ~0.25s in, ~0.15s out. Module
  // scope in createGame, NOT inside tick().
  const moveSmoother = createMoveSmoother();
  const nose = new Vector3(1, 0, 0);
  const dir = new Vector3();
  const look = new Vector3();

  function clearGroup(group: Group) {
    group.clear();
  }

  function overlaps(x: number, y: number, z: number) {
    const minX = x - RADIUS;
    const maxX = x + RADIUS;
    const minY = y;
    const maxY = y + HEIGHT;
    const minZ = z - RADIUS;
    const maxZ = z + RADIUS;
    // Grid query (runtime.colsNear): the old full-list scan ran 3x per tick
    // over ~4,500 colliders. The candidates are exactly the ones whose XZ
    // footprint overlaps this AABB, so the 3D test below gives identical
    // results.
    const list = runtime.colsNear(minX, minZ, maxX, maxZ);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (maxX > c.minX && minX < c.maxX && maxY > c.minY && minY < c.maxY && maxZ > c.minZ && minZ < c.maxZ) {
        return true;
      }
    }
    return runtime.blocks(x, y, z);
  }

  function groundY(x: number, z: number, maxY: number) {
    let top = runtime.indoors() ? -200 : 0;
    const list = runtime.colsNear(x - RADIUS, z - RADIUS, x + RADIUS, z + RADIUS);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (x + RADIUS <= c.minX || x - RADIUS >= c.maxX || z + RADIUS <= c.minZ || z - RADIUS >= c.maxZ) continue;
      if (c.maxY <= maxY + 0.08 && c.maxY > top) top = c.maxY;
    }
    return top;
  }

  // Smooth step-up (walk-fix 2026-11-17): the old code teleported the
  // player +0.5 in one frame whenever a curb blocked them — curbs are
  // only ~0.125 high, so every road/sidewalk crossing popped the player
  // (and the camera) up four times the curb height, then gravity dropped
  // them back. Now move() only *starts* a step (recording the real top
  // of the obstacle) and tick() eases y up to it over ~0.1 s.
  let stepEase: number | null = null;

  function move(dx: number, dy: number, dz: number) {
    if (dy !== 0) {
      const ny = player.y + dy;
      if (!runtime.indoors() && ny < 0) {
        player.y = 0;
        player.vy = 0;
        player.onGround = true;
      } else if (!overlaps(player.x, ny, player.z)) {
        player.y = ny;
        if (dy < 0) player.onGround = false;
      } else if (dy < 0) {
        if (stepEase != null) {
          // Mid step-up: the ease in tick() owns y — don't snap back
          // down to the old floor underneath the step.
          player.vy = 0;
          player.onGround = true;
        } else {
          const floor = groundY(player.x, player.z, player.y);
          if (!overlaps(player.x, floor, player.z)) player.y = floor;
          player.vy = 0;
          player.onGround = true;
        }
      } else {
        player.vy = 0;
      }
    }
    if (dx !== 0) {
      if (!overlaps(player.x + dx, player.y, player.z)) player.x += dx;
      else if (!player.flying) {
        // Step onto the obstacle's REAL top (a curb is ~0.125), not a
        // flat +0.5 — and ease up to it instead of teleporting.
        const top = groundY(player.x + dx, player.z, player.y + 0.55);
        if (top > player.y + 0.02 && top - player.y <= 0.5 && !overlaps(player.x + dx, top, player.z)) {
          player.x += dx;
          stepEase = top;
          player.vy = 0;
        }
      }
    }
    if (dz !== 0) {
      if (!overlaps(player.x, player.y, player.z + dz)) player.z += dz;
      else if (!player.flying) {
        const top = groundY(player.x, player.z + dz, player.y + 0.55);
        if (top > player.y + 0.02 && top - player.y <= 0.5 && !overlaps(player.x, top, player.z + dz)) {
          player.z += dz;
          stepEase = top;
          player.vy = 0;
        }
      }
    }
  }

  function carHit(x: number, z: number) {
    // Grid query: the linear test below is equivalent to the box
    // (x-1.7, z-1.25)-(x+1.7, z+1.25) intersecting the collider's XZ
    // footprint, so the query box is exactly that box.
    const list = runtime.colsNear(x - 1.7, z - 1.25, x + 1.7, z + 1.25);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxY < 0.5) continue;
      if (x > c.minX - 1.7 && x < c.maxX + 1.7 && z > c.minZ - 1.25 && z < c.maxZ + 1.25) return true;
    }
    return false;
  }

  function tick(dt: number) {
    const rawAxes = runtime.moveAxes(keys);
    const { f, s } = moveSmoother.update(rawAxes.f, rawAxes.s, dt);
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight") || runtime.downHeld();
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const space = keys.has("Space") || runtime.jumpHeld();
    // Swimming (water.ts): on foot, not flying, and x/z over a strait.
    // Driving never swims — tick() never runs while driving — and flying
    // above the water never swims either. The swimmer sinks to the surface
    // (feet at WATER_SURFACE_Y, head above water) and strokes at swim speed
    // using the same WASD / touch-stick input as walking.
    const swimming = !player.flying && isWater(player.x, player.z);
    // FOOD: hunger that matters — well fed you run fast, starving you
    // crawl; stamina adds up to +10%. On foot only, never while flying
    // (a flying body has no legs to be tired).
    // CRIB: energy moves the legs — Rested (>= 70) runs 15% faster,
    // Exhausted (0) walks at 65%. Flying is untouched.
    const baseSpeed = player.flying ? (ctrl ? 28 : 14) : swimming ? SWIM_SPEED : shift ? 1.6 : ctrl ? 8.5 : 5.2;
    const speed = player.flying ? baseSpeed : baseSpeed * runtime.speedMult() * runtime.energyFactor();
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    if (player.flying) {
      const pitchSin = Math.sin(player.pitch);
      const pitchCos = Math.cos(player.pitch);
      player.vy = pitchSin * f * speed + (space ? 12 : 0) - (shift ? 12 : 0);
      move((sin * pitchCos * f + cos * s) * speed * dt, player.vy * dt, (-cos * pitchCos * f + sin * s) * speed * dt);
    } else if (swimming) {
      // No gravity, no jump, no fall: ease y to the surface and move
      // horizontally with dy=0 so move()'s "ny < 0 → y = 0" ground clamp
      // never fires. Colliders still apply (the bridge-deck rails at
      // z=±11.4 block; the deck slab itself is visual-only, so the swimmer
      // passes under it — steer around a rail if you hit one).
      player.vy = 0;
      const dy = WATER_SURFACE_Y - player.y;
      player.y += Math.max(-SWIM_SINK_RATE * dt, Math.min(SWIM_SINK_RATE * dt, dy));
      move((sin * f + cos * s) * speed * dt, 0, (-cos * f + sin * s) * speed * dt);
      player.onGround = true;
    } else {
      // Climbing out: for a few frames after the x/z leaves the water the
      // player is still below y=0. Ease up to shore level instead of
      // letting the ground clamp pop them 1 unit — smooth, no teleport.
      // (Indoors the ground is -200, so only ease outdoors.)
      if (player.y < 0 && !runtime.indoors()) {
        player.vy = 0;
        player.y = Math.min(0, player.y + SWIM_CLIMB_RATE * dt);
        player.onGround = player.y >= 0;
        move((sin * f + cos * s) * speed * dt, 0, (-cos * f + sin * s) * speed * dt);
        if (player.y >= 0) player.onGround = overlaps(player.x, player.y - 0.04, player.z) || player.y <= 0.001;
      } else {
        if (space && player.onGround) {
          player.vy = 8.6;
          player.onGround = false;
          stepEase = null;
        }
        player.vy = Math.max(-50, player.vy - 28 * dt);
        player.onGround = false;
        move((sin * f + cos * s) * speed * dt, player.vy * dt, (-cos * f + sin * s) * speed * dt);
        player.onGround = overlaps(player.x, player.y - 0.04, player.z) || player.y <= 0.001;
      }
    }
    // Smooth step-up, continued: ease y up to the step top recorded by
    // move() (~0.1 s) instead of the old instant +0.5 teleport.
    if (stepEase != null) {
      if (player.flying) {
        stepEase = null;
      } else {
        // Walked off the step mid-ease (floor underfoot dropped below
        // the step top)? Stop easing and let gravity settle the player
        // instead of lifting them to a step they are no longer on.
        const floorHere = groundY(player.x, player.z, player.y + 0.55);
        if (floorHere < stepEase - 0.02) {
          stepEase = null;
        } else {
          player.y += (stepEase - player.y) * Math.min(1, dt * 14);
          player.vy = 0;
          if (Math.abs(stepEase - player.y) < 0.02) {
            player.y = stepEase;
            stepEase = null;
          }
        }
      }
    }
    // Bridges are real decks now (states.ts) — walking or driving across
    // them just moves you; there is no gate hop any more.
    if (!runtime.indoors() && (player.y < -4 || player.y > 220)) {
      player.x = spawn.x;
      player.y = spawn.y;
      player.z = spawn.z;
      player.vy = 0;
      player.flying = false;
      stepEase = null;
    }
    // The sun rides with the player so the ±150 shadow box stays crisp in
    // every state. Never widen the shadow box to cover the whole world —
    // the 2048 shadow map would go blurry.
    sun.position.set(player.x + 110, 42, player.z + 30);
    sun.target.position.set(player.x, 0, player.z);
    sun.target.updateMatrixWorld();
  }

  let spawn = { x: 0, y: 0, z: 100, yaw: 0, pitch: 0.2 };
  let focus = { x: 0, y: 40, z: -10 };

  function pointAt(distance: number) {
    let d = distance % railLen;
    if (d < 0) d += railLen;
    let i = 0;
    while (i < railDist.length - 1 && railDist[i + 1] < d) i++;
    const span = (railDist[i + 1] ?? railLen) - railDist[i] || 1;
    const t = (d - railDist[i]) / span;
    const a = rail[i];
    const b = rail[(i + 1) % rail.length];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      dx: b.x - a.x,
      dz: b.z - a.z,
    };
  }

  function buildMeshes(city: City) {
    clearGroup(staticRoot);
    scene.remove(staticRoot);
    staticRoot = new Group();
    const buckets = new Map<Mat, City["boxes"]>();
    for (const box of city.boxes) {
      if (box.hide) continue;
      let list = buckets.get(box.mat);
      if (!list) {
        list = [];
        buckets.set(box.mat, list);
      }
      list.push(box);
    }
    const FLAT_MATS = new Set<Mat>([
      "lane",
      "asphalt",
      "sidewalk",
      "sidewalkField",
      "plaza",
      "plazaField",
      "grass",
      "grassField",
      "water",
      "ceil",
    ]);
    for (const [mat, list] of buckets) {
      if (!list.length) continue;
      const mesh = new InstancedMesh(unit, MATERIALS[mat], list.length);
      mesh.frustumCulled = false;
      mesh.castShadow = quality !== "low" && !FLAT_MATS.has(mat);
      mesh.receiveShadow = quality !== "low" && mat !== "water" && mat !== "ceil";
      if (mat === "water") {
        mesh.renderOrder = 2;
      }
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(0, b.ry, 0);
        dummy.scale.set(b.sx, b.sy, b.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      staticRoot.add(mesh);
    }
    staticRoot.add(mountPretty(city.facades, quality));
    // Landmarks: gate, palms, market, ring, fountain light, street
    // sign, district neon (realistic overhaul, landmarks.ts).
    staticRoot.add(mountLandmarks(city, quality));
    scene.add(staticRoot);
    window.__ORBITX_BOXES = city.boxes.length;
  }

  function buildMovers(city: City) {
    for (const train of trains) scene.remove(train);
    for (const ship of ships) scene.remove(ship);
    for (const jet of jets) scene.remove(jet);
    trains.length = 0;
    ships.length = 0;
    jets.length = 0;
    rail = city.rail;
    railDist = [0];
    for (let i = 0; i < rail.length; i++) {
      const a = rail[i];
      const b = rail[(i + 1) % rail.length];
      railDist.push(railDist[i] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    railLen = Math.max(1, railDist[railDist.length - 1] || 1);
    // The station stop: the rail distance whose point sits closest to the
    // Loop Station platform. Scanned once per build (arcs are chorded, so
    // the analytic distance would be a few units off).
    stationDist = 0;
    {
      let best = Infinity;
      for (let d = 0; d < railLen; d += 0.25) {
        const p = pointAt(d);
        const dd = Math.hypot(p.x - STATION_POINT.x, p.z - STATION_POINT.z);
        if (dd < best) {
          best = dd;
          stationDist = d;
        }
      }
    }
    trainDist = [0, railLen * 0.5];
    trainSpeed = [TRAIN_CRUISE, TRAIN_CRUISE];
    trainDwell = [0, 0];
    if (rail.length > 2) {
      trains.push(makeTrain(MATERIALS.white, MATERIALS.cyan, MATERIALS.cyanhot, MATERIALS.black));
      trains.push(makeTrain(MATERIALS.white, MATERIALS.cyan, MATERIALS.cyanhot, MATERIALS.black));
      for (const train of trains) {
      train.scale.setScalar(1.35);
      scene.add(train);
    }
    }
    shipPaths = city.ships;
    for (let i = 0; i < shipPaths.length; i++) {
      const ship = makeShip(MATERIALS.white, MATERIALS.cyan, MATERIALS.gold);
      ship.scale.setScalar(1.7);
      ships.push(ship);
      scene.add(ship);
    }
    fountain = city.fountain;
    for (let i = 0; i < 7; i++) {
      const jet = new Mesh(unit, MATERIALS.cyanhot);
      jets.push(jet);
      scene.add(jet);
    }
    // AIR layer: rebuild with the city (facades/roads are read-only data
    // for it). The old group comes off the scene first.
    if (skyLayer) scene.remove(skyLayer.group);
    skyLayer = buildSkyLayer(city, quality);
    scene.add(skyLayer.group);
    // SEA layer: wave planes + sea animals, same rebuild pattern.
    if (seaLayer) scene.remove(seaLayer.group);
    seaLayer = buildSeaLayer(city, quality);
    scene.add(seaLayer.group);
  }

  function placeTrain(group: Group, distance: number) {
    const p = pointAt(distance);
    group.position.set(p.x, p.y + 1.55, p.z);
    dir.set(p.dx, 0, p.dz);
    if (dir.lengthSq() > 0.0001) {
      dir.normalize();
      group.quaternion.setFromUnitVectors(nose, dir);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (runtime.typing() || runtime.paused()) {
      if (event.code === "Escape") {
        // Esc closes the emote wheel first; panels keep their close.
        if (runtime.wheeling()) runtime.setWheel(false);
        else runtime.request("close");
      }
      return;
    }
    keys.add(event.code);
    if (!playing) return;
    // BOXING: while a fight is armed, J/K/L/Space are the fight keys —
    // no jobs panel, no train hijack, no orbit cam, no jump.
    if (runtime.boxingActive()) {
      if (event.code === "KeyJ" && !event.repeat) runtime.boxingHit("jab");
      if (event.code === "KeyK" && !event.repeat) runtime.boxingHit("heavy");
      if (event.code === "KeyL") runtime.boxingBlock(true);
      if (event.code === "Space") {
        if (!event.repeat) runtime.boxingDodge();
        keys.delete("Space");
        event.preventDefault();
      }
      if (event.code === "KeyJ" || event.code === "KeyK" || event.code === "KeyL" || event.code === "Space") return;
    }
    if (event.code === "KeyF" && !event.repeat) runtime.toggleFly(player);
    if (event.code === "KeyE" && !event.repeat) runtime.interact(player);
    // K takes the driver's seat of the loop train dwelling at the Loop
    // Station (the Drive button does the same on a phone). Silent unless
    // the player is on the platform — see runtime.driveLoopTrain.
    if (event.code === "KeyK" && !event.repeat) runtime.driveLoopTrain();
    // R unsticks the car while driving (round 3): the Unstuck button
    // does the same on a phone. R also turns the camera while held, but
    // a tap's swing is a few degrees and the car moves anyway — the
    // recovery wins over the camera nudge.
    if (event.code === "KeyR" && !event.repeat && runtime.driving()) runtime.unstuckCar();
    if (event.code === "KeyB" && !event.repeat) runtime.request("shop");
    if (event.code === "KeyJ" && !event.repeat) runtime.request("jobs");
    if (event.code === "KeyC" && !event.repeat) runtime.cycleCamera();
    if (event.code === "KeyT" && !event.repeat) runtime.request("chat");
    if (playing && (event.code.startsWith("Arrow") || event.code === "Space")) event.preventDefault();
    if (event.code === "KeyG" && !event.repeat) runtime.request("ads");
    if (event.code === "KeyH" && !event.repeat) runtime.request("events");
    if (event.code === "KeyM" && !event.repeat) runtime.request("menu");
    if (event.code === "KeyP" && !event.repeat) runtime.request("phone");
    if (event.code === "KeyN" && !event.repeat) runtime.cycleTime();
    if (event.code === "KeyY" && !event.repeat) runtime.powerPress();
    if (event.code === "KeyV") runtime.setTalking(true);
    if (event.code === "Digit1") runtime.emote("wave");
    if (event.code === "Digit2") runtime.emote("dance");
    if (event.code === "Digit3") runtime.emote("laugh");
    if (event.code === "Digit4") runtime.emote("cheer");
    if (event.code === "Digit5") runtime.emote("point");
    if (event.code === "Digit6") runtime.emote("flex");
    if (event.code === "Digit7") runtime.emote("sit");
    if (event.code === "Digit8") runtime.emote("facepalm");
    if (event.code === "KeyZ" && !event.repeat) {
      // Tap-to-open / tap-again-to-close (the wheel is tap-to-pick
      // now, not hold-and-release).
      wheelX = 0;
      wheelY = 0;
      runtime.setWheel(!runtime.wheeling());
    }
    if (event.code === "KeyX" && !event.repeat) runtime.editHome();
    if (event.code === "KeyO" && !event.repeat) runtime.toggleSpectator();
    if (event.code === "KeyH" && !event.repeat) runtime.pullOver();
    if (event.code === "KeyJ" && !event.repeat) runtime.hijack();
    if (event.code === "KeyU" && !event.repeat) runtime.toggleHud();
    if (event.code === "KeyI" && !event.repeat) runtime.toggleNames();
    if (event.code === "KeyL" && !event.repeat) runtime.toggleOrbit();
    if (event.code === "Escape") {
      // Esc closes the emote wheel first; panels keep their close.
      if (runtime.wheeling()) runtime.setWheel(false);
      else runtime.request("close");
    }
    if (event.code === "Space") event.preventDefault();
  }
  function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code);
    if (event.code === "KeyY") runtime.powerRelease();
    if (event.code === "KeyV") runtime.setTalking(false);
    if (event.code === "KeyL") runtime.boxingBlock(false);
  }
  let wheelX = 0;
  let wheelY = 0;
  function onMouseMove(event: MouseEvent) {
    if (runtime.wheeling()) {
      if (document.pointerLockElement === canvas) {
        wheelX += event.movementX;
        wheelY += event.movementY;
        runtime.aimWheel(wheelX, wheelY);
      } else {
        runtime.aimWheel(event.clientX - window.innerWidth / 2, event.clientY - window.innerHeight / 2);
      }
    }
    if (touch || document.pointerLockElement !== canvas) return;
    runtime.addLook(event.movementX * 0.0022, event.movementY * 0.0022);
  }
  let dragging = false;
  let dragX = 0;
  let dragY = 0;
  let pinchDist = 0;
  function lookLocked() {
    return document.pointerLockElement === canvas;
  }
  function onPointerDown(event: PointerEvent) {
    if (touch || event.button !== 0 || !playing || runtime.paused() || runtime.typing()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, .panel, .menu")) return;
    // Emote wheel open (desktop, pointer-locked aim): a canvas click
    // commits the aimed slice instead of starting a camera drag. The
    // wheel's own DOM buttons are caught by the guard above.
    if (runtime.wheeling()) {
      runtime.commitWheel();
      return;
    }
    dragging = true;
    dragX = event.clientX;
    dragY = event.clientY;
    runtime.setLooking(true);
    if (!lookLocked()) {
      try {
        canvas.requestPointerLock();
      } catch {
        // Drag look still works when the browser refuses the lock.
      }
    }
  }
  function onPointerMove(event: PointerEvent) {
    if (!dragging || lookLocked()) return;
    const dx = event.clientX - dragX;
    const dy = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    runtime.addLook(dx * 0.005, dy * 0.005);
  }
  function onPointerUp() {
    dragging = false;
    runtime.setLooking(lookLocked());
  }
  function onLockChange() {
    runtime.setLooking(lookLocked() || dragging);
  }
  function onWheel(event: WheelEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".panel, .menu, .chat-log, input, textarea")) return;
    if (!playing || runtime.paused()) return;
    runtime.zoomCamera(event.deltaY > 0 ? 1.08 : 0.92);
  }
  function onPinchMove(event: TouchEvent) {
    if (event.touches.length !== 2) {
      pinchDist = 0;
      return;
    }
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    const dist = Math.hypot(dx, dy) || 1;
    if (pinchDist) runtime.zoomCamera(pinchDist / dist);
    pinchDist = dist;
  }
  function onBlur() {
    keys.clear();
    dragging = false;
    runtime.setLooking(false);
  }
  function blockScroll(event: TouchEvent) {
    const target = event.target as HTMLElement | null;
    // The top actions strip (.actions) is a horizontally scrolling
    // overflow container — its touchmoves must NOT be preventDefaulted,
    // or a real finger swipe can never pan it (the browser cancels the
    // native scroll). Same allowlist as .panel / .chat-log. The character
    // grid (.char-grid) scrolls the same way with 72 looks in it. The
    // phone (.ph-overlay) is a fixed overlay whose home grid and app
    // views scroll the same way — without it here, no finger scroll
    // inside the phone ever lands (found on a real phone, 2026-11-20).
    if (target?.closest(".panel, .chat-log, .actions, .char-grid, .ph-overlay, input, textarea")) return;
    event.preventDefault();
  }
  function onResize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("pointerlockerror", onLockChange);
  window.addEventListener("wheel", onWheel, { passive: true });
  function onTouchEnd() {
    pinchDist = 0;
  }
  // One-finger drag to look on touch: pointer drag is gated off for touch
  // devices, and pinch only zooms — without this, dragging on a phone does
  // nothing at all. Same pitch direction as mouse drag (drag up = look up).
  let lookTouch: number | null = null;
  let lookTouchX = 0;
  let lookTouchY = 0;
  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return;
    if (!playing || runtime.paused() || runtime.typing()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, .panel, .menu")) return;
    const t = event.touches[0];
    lookTouch = t.identifier;
    lookTouchX = t.clientX;
    lookTouchY = t.clientY;
    runtime.setLooking(true);
  }
  function onTouchMove(event: TouchEvent) {
    if (lookTouch === null) return;
    for (let i = 0; i < event.touches.length; i++) {
      const t = event.touches[i];
      if (t.identifier !== lookTouch) continue;
      const dx = t.clientX - lookTouchX;
      const dy = t.clientY - lookTouchY;
      lookTouchX = t.clientX;
      lookTouchY = t.clientY;
      runtime.addLook(dx * 0.006, dy * 0.006);
    }
  }
  function onTouchEndLook(event: TouchEvent) {
    if (lookTouch === null) return;
    let alive = false;
    for (let i = 0; i < event.touches.length; i++) {
      if (event.touches[i].identifier === lookTouch) alive = true;
    }
    if (!alive) {
      lookTouch = null;
      runtime.setLooking(false);
    }
  }
  canvas.addEventListener("touchmove", onPinchMove, { passive: true });
  canvas.addEventListener("touchend", onTouchEnd);
  canvas.addEventListener("touchstart", onTouchStart, { passive: true });
  canvas.addEventListener("touchmove", onTouchMove, { passive: true });
  canvas.addEventListener("touchend", onTouchEndLook);
  canvas.addEventListener("touchcancel", onTouchEndLook);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  document.addEventListener("touchmove", blockScroll, { passive: false });
  document.addEventListener("gesturestart", (event) => event.preventDefault());
  onResize();

  let raf = 0;
  let last = performance.now();
  let frames = 0;
  let fpsStamp = performance.now();
  let clock = 0;

  // The status line is a hidden debug-only element, but onStatus() is React
  // setStatus — calling it every frame re-renders the whole App while the
  // player moves (the rounded coords change almost every frame). 5 Hz is
  // plenty for a debug line nobody sees; this kills ~55 React renders/sec.
  let lastStatusText = "";
  let lastStatusAt = 0;
  function pushStatus(text: string, now: number) {
    if (text === lastStatusText) return;
    if (now - lastStatusAt < 200) return;
    lastStatusText = text;
    lastStatusAt = now;
    onStatus(text);
  }

  // Status line: coords (seed included) for the debug line.
  function statusFor(label: string) {
    return `${label}  ${Math.round(player.x)} ${Math.round(player.y)} ${Math.round(player.z)}  seed ${seed}`;
  }

  function frame(now: number) {
    try {
    let real = (now - last) / 1000;
    last = now;
    if (!(real > 0)) real = 0;
    if (real > 0.25) real = 0.25;
    const dt = real;
    clock += dt;
    if (runtime.paused()) keys.clear();
    if (playing && mode !== "orbit" && !runtime.paused() && !runtime.typing() && !runtime.frozen()) {
      // While driving a car the arrows steer it, so they must not also
      // swing the camera. While driving the loop train the arrows are the
      // throttle (Up = Gas, Down = Brake), so they must not pitch the
      // camera either — but Left / Right still turn it, since a train
      // has no steering to fight over. Same for the bus and the OrbitX
      // Line: arrows are the throttle while the player has the wheel /
      // the controls.
      const trainDriving = runtime.drivingTrain() >= 0 || runtime.drivingBus() || runtime.drivingLine();
      // Throttle for the bus + the OrbitX Line (the loop train reads the
      // keys directly): W / Up / Gas is the throttle, S / Down / Brake
      // slows it down. Set every frame, before after() steps the vehicles.
      runtime.setVehicleThrottle(
        keys.has("KeyW") || keys.has("ArrowUp") || runtime.gasHeld(),
        keys.has("KeyS") || keys.has("ArrowDown") || runtime.brakeHeld(),
      );
      const yawKeys = runtime.decorating()
        ? (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0)
        : runtime.driving()
          ? (keys.has("KeyR") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0)
          : (keys.has("ArrowRight") || keys.has("KeyR") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyQ") ? 1 : 0);
      if (runtime.decorating() && (keys.has("KeyQ") || keys.has("KeyR"))) runtime.spinDecor((keys.has("KeyR") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0));
      const pitchKeys = runtime.driving() || trainDriving ? 0 : (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
      if (yawKeys || pitchKeys) runtime.addLook(yawKeys * 1.7 * dt, pitchKeys * 1.15 * dt);
      let left = dt;
      while (left > 0.0001) {
        const step = Math.min(0.05, left);
        if (runtime.driving()) runtime.drive(step, player, keys, carHit);
        else if (runtime.ridingTrain()) runtime.rideTrain(step, player);
        else if (runtime.ridingBus()) runtime.rideBus(step, player);
        // A rider is carried by the train — runtime.after() snaps the body
        // to the train pose each frame, so the walk physics must not run
        // (it would drop the rider through the car floor to the street).
        // Same for the driver: after() snaps them to the front car.
        else if (!runtime.riding() && runtime.drivingTrain() < 0) tick(step);
        left -= step;
      }
    }

    MATERIALS.cyanhot.emissiveIntensity = 1.35 + Math.sin(clock * 2.4) * 0.22;

    // Loop trains: brake into the station stop, dwell, roll on. The brake
    // profile is a function of the distance ahead (sqrt curve, 90-unit
    // braking zone), so the stop is smooth and lands on the mark; the
    // stop check runs before the move so a slow frame can never jump the
    // station and sail past it. One train can be player-driven
    // (runtime.drivingTrain()): Gas / Brake set its speed, it auto-brakes
    // into the Loop Station stop and waits there for Gas to depart, and
    // it never closes within 25 units of the other train. The automatic
    // train follows the same rule in reverse — it holds short of a driven
    // train ahead of it — so the two can never meet on the loop.
    const driven = runtime.drivingTrain();
    const trainPoses: TrainPose[] = [];
    for (let i = 0; i < trains.length; i++) {
      if (i === driven) {
        // Player-driven: W / ArrowUp / the Gas hold button is the
        // throttle, S / ArrowDown / Brake slows it down, coasting decays.
        const gas = keys.has("KeyW") || keys.has("ArrowUp") || runtime.gasHeld();
        const brake = keys.has("KeyS") || keys.has("ArrowDown") || runtime.brakeHeld();
        if (trainDwell[i] > 0) {
          // Dwelling at the Loop Station: the driver decides when to
          // leave — Gas departs at once, otherwise the train waits with
          // its doors open so a passenger could still board.
          trainSpeed[i] = 0;
          if (gas) {
            trainDwell[i] = 0;
            trainDist[i] = (stationDist + 1) % railLen;
            trainSpeed[i] = 2;
          }
        } else {
          const ahead = (((stationDist - trainDist[i]) % railLen) + railLen) % railLen;
          // The station stop cap, same sqrt profile as the automatic
          // trains — the driver can never sail past the only station.
          const stopCap = TRAIN_CRUISE * Math.sqrt(Math.min(1, ahead / 90));
          // The other train ahead is a moving wall: never close within
          // 25 units of it, never outrun it inside 60. This cap is
          // approached with a brake (22 u/s^2), never a teleport down —
          // the gap only ever shrinks gradually, so there is room.
          let followCap = TRAIN_CRUISE;
          if (trains.length > 1) {
            const other = 1 - i;
            const gap = (((trainDist[other] - trainDist[i]) % railLen) + railLen) % railLen;
            if (gap < 25) followCap = 0;
            else if (gap < 60) followCap = trainSpeed[other];
          }
          if (trainSpeed[i] > followCap) trainSpeed[i] = Math.max(followCap, trainSpeed[i] - 22 * dt);
          else if (brake) trainSpeed[i] = Math.max(0, trainSpeed[i] - 22 * dt);
          else if (gas) trainSpeed[i] = Math.min(trainSpeed[i] + 14 * dt, stopCap);
          else {
            trainSpeed[i] *= 1 - 0.5 * dt;
            if (trainSpeed[i] < 0.3) trainSpeed[i] = 0;
            trainSpeed[i] = Math.min(trainSpeed[i], stopCap);
          }
          const step = trainSpeed[i] * dt;
          if (ahead <= step + 0.15) {
            trainDist[i] = stationDist;
            trainSpeed[i] = 0;
            trainDwell[i] = TRAIN_DWELL;
          } else {
            trainDist[i] = (trainDist[i] + step) % railLen;
          }
        }
      } else if (trainDwell[i] > 0) {
        trainDwell[i] -= dt;
        trainSpeed[i] = 0;
        if (trainDwell[i] <= 0) {
          trainDwell[i] = 0;
          trainDist[i] = (stationDist + 1) % railLen;
          trainSpeed[i] = 2;
        }
      } else {
        const ahead = (((stationDist - trainDist[i]) % railLen) + railLen) % railLen;
        const target = Math.min(TRAIN_CRUISE, TRAIN_CRUISE * Math.sqrt(Math.min(1, ahead / 90)));
        trainSpeed[i] = Math.min(target, trainSpeed[i] + 14 * dt);
        // A driven train ahead is a moving wall: hold short of it (brake
        // smoothly inside 25 units, match its speed inside 60) so the
        // automatic train never runs into the one the player is driving.
        if (driven >= 0) {
          const gap = (((trainDist[driven] - trainDist[i]) % railLen) + railLen) % railLen;
          if (gap < 25) trainSpeed[i] = Math.max(0, trainSpeed[i] - 22 * dt);
          else if (gap < 60) {
            const cap = trainSpeed[driven];
            if (trainSpeed[i] > cap) trainSpeed[i] = Math.max(cap, trainSpeed[i] - 22 * dt);
          }
        }
        const step = trainSpeed[i] * dt;
        if (ahead <= step + 0.15) {
          trainDist[i] = stationDist;
          trainSpeed[i] = 0;
          trainDwell[i] = TRAIN_DWELL;
        } else {
          trainDist[i] = (trainDist[i] + step) % railLen;
        }
      }
      placeTrain(trains[i], trainDist[i]);
      const p = pointAt(trainDist[i]);
      const dl = Math.hypot(p.dx, p.dz) || 1;
      trainPoses.push({
        x: p.x,
        y: p.y + 1.55,
        z: p.z,
        dx: p.dx / dl,
        dz: p.dz / dl,
        dwelling: trainDwell[i] > 0,
      });
    }
    (window as unknown as { __ORBITX_TRAIN?: { dist: number[]; dwell: number[]; speed: number[]; station: number; driving: number } }).__ORBITX_TRAIN = {
      dist: [...trainDist],
      dwell: [...trainDwell],
      speed: [...trainSpeed],
      station: stationDist,
      driving: driven,
    };
    for (let i = 0; i < ships.length; i++) {
      const path = shipPaths[i];
      const a = clock * path.speed + path.phase;
      const x = Math.cos(a) * path.radiusX;
      const z = Math.sin(a) * path.radiusZ;
      const dx = -Math.sin(a) * path.radiusX;
      const dz = Math.cos(a) * path.radiusZ;
      ships[i].position.set(x, path.y + Math.sin(clock * 1.3 + path.phase) * 1.4, z);
      dir.set(dx, 0, dz);
      if (dir.lengthSq() > 0.001) {
        dir.normalize();
        ships[i].quaternion.setFromUnitVectors(nose, dir);
      }
    }
    for (let i = 0; i < jets.length; i++) {
      const a = (i / jets.length) * Math.PI * 2;
      const h = (clock * 2.8 + i * 0.45) % 3.4;
      jets[i].position.set(fountain.x + Math.cos(a) * 0.45, 3.5 + h, fountain.z + Math.sin(a) * 0.45);
      const s = 0.42 * (1 - h / 3.6);
      jets[i].scale.setScalar(Math.max(0.08, s));
    }

    sky.position.copy(camera.position);
    const clockName = runtime.timeOfDay();
    const skyMat = sky.material as ShaderMaterial;
    if (mode === "orbit" && introOn) {
      // Dynamic time-of-day showcase during the 30s splash flyover:
      // 0..6s: Golden Sunset over the Plaza & OrbitX Tower
      // 6..13s: Crisp Daylight across NY, LA & FL
      // 13..18s: Golden Dusk along the downtown avenues
      // 18..24.5s: Electric Neon Night alongside the Loop Train & skyline
      // 24.5..30s: Smooth blend back to the user's selected timeOfDay
      let introDay = 0;
      let introNight = 0;
      if (introT >= 5.5 && introT < 14) {
        introDay = introT < 7 ? (introT - 5.5) / 1.5 : introT > 12 ? 1 - (introT - 12) / 2 : 0.92;
      }
      if (introT >= 17.5 && introT < 25.5) {
        introNight = introT < 19.2 ? (introT - 17.5) / 1.7 : introT > 23.8 ? 1 - (introT - 23.8) / 1.7 : 0.88;
      }
      skyMat.uniforms.uDay.value = Math.max(0, Math.min(1, introDay));
      skyMat.uniforms.uNight.value = Math.max(0, Math.min(1, introNight));
      const introClock = introNight > 0.45 ? "night" : introDay > 0.45 ? "day" : "sunset";
      applyDayNightLighting({ sun, hemi, fill, ambient }, introClock, graphicsQuality);
      if (introClock === "night") {
        baseFog.color.setHex(0x0c1220);
        setPrettyNight(0.95);
      } else if (introClock === "day") {
        baseFog.color.setHex(0xb7d4ea);
        setPrettyNight(0.2);
      } else {
        baseFog.color.setHex(0x7a5578);
        setPrettyNight(0.6);
      }
    } else {
      skyMat.uniforms.uNight.value = clockName === "night" ? 1 : 0;
      skyMat.uniforms.uDay.value = clockName === "day" ? 1 : 0;
      // Light intensities come from the graphics module so the preset and the
      // day/night cycle agree (sunset values are unchanged; day/night are
      // slightly richer than the old literals, and fill now varies too).
      applyDayNightLighting({ sun, hemi, fill, ambient }, clockName, graphicsQuality);
      if (clockName === "night") {
        baseFog.color.setHex(0x0c1220);
        setPrettyNight(1);
      } else if (clockName === "day") {
        baseFog.color.setHex(0xb7d4ea);
        setPrettyNight(0.15);
      } else {
        baseFog.color.setHex(0x7a5578);
        setPrettyNight(0.5);
      }
    }
    // Bloom + sign glow + rain follow the same time-of-day drive
    // (uNight/uDay were just set by the branch above): bloom 0.55 at
    // night, 0.32 at dusk, 0.18 in daylight; signs blaze at dusk/night
    // and rest in daylight; rain falls only at night.
    const nightF = skyMat.uniforms.uNight.value as number;
    const dayF = skyMat.uniforms.uDay.value as number;
    bloomPass.strength = 0.18 + 0.37 * nightF + 0.14 * (1 - nightF - dayF);
    setSignGlow(Math.max(nightF, 1 - dayF));
    rain.lines.visible = nightF > 0.4 && !runtime.indoors();
    if (rain.lines.visible) rain.update(dt, camera.position.x, camera.position.z);
    // Sky shader time + AIR layer (flying cars, drones, hologram,
    // beams, crowds) follow the same time-of-day drive.
    skyMat.uniforms.uTime.value = clock;
    skyLayer?.update(dt, clock, nightF, dayF, !!runtime.indoors());
    seaLayer?.update(dt, clock, nightF, dayF, !!runtime.indoors());
    scene.fog = runtime.indoors() ? null : baseFog;
    const tookCamera = runtime.after(dt, player, camera, { orbit: mode === "orbit", fountain, trains: trainPoses });
    if (mode === "orbit") {
      if (introOn) {
        // Intro flyover: the scripted path runs 30s, then holds the final
        // frame (the slow-orbit circle) until the overlay dismisses it.
        if (!introPaused) introT = Math.min(INTRO_LEN, introT + dt);
        introPose(introT, introPoseOut);
        introState.pos.set(introPoseOut.pos[0], introPoseOut.pos[1], introPoseOut.pos[2]);
        introState.look.set(introPoseOut.look[0], introPoseOut.look[1], introPoseOut.look[2]);
        introState.fov = introPoseOut.fov;
        introState.roll = introPoseOut.roll;
        camera.position.copy(introState.pos);
        if (Math.abs(camera.fov - introState.fov) > 0.05) {
          camera.fov = introState.fov;
          camera.updateProjectionMatrix();
        }
        camera.up.set(Math.sin(introState.roll), Math.cos(introState.roll), 0);
        camera.lookAt(introState.look);
      } else {
        if (Math.abs(camera.fov - 62) > 0.05) {
          camera.fov = 62;
          camera.updateProjectionMatrix();
        }
        camera.up.set(0, 1, 0);
        const t = (clock - orbitClockOffset) * 0.07 + Math.PI / 2;
        camera.position.set(Math.sin(t) * 190, 78, Math.cos(t) * 132 + 10);
        camera.lookAt(0, 26, 20);
      }
    } else if (!tookCamera) {
      if (Math.abs(camera.fov - 62) > 0.05) {
        camera.fov = 62;
        camera.updateProjectionMatrix();
      }
      const cp = Math.cos(player.pitch);
      const sp = Math.sin(player.pitch);
      const sy = Math.sin(player.yaw);
      const cy = Math.cos(player.yaw);
      camera.position.set(player.x, player.y + 1.62, player.z);
      look.set(player.x + sy * cp, player.y + 1.62 + sp, player.z - cy * cp);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      const label = runtime.driving() ? "DRIVING" : runtime.ridingTrain() ? "RIDING" : player.flying ? "FLYING" : isWater(player.x, player.z) ? "SWIMMING" : "WALKING";
      pushStatus(statusFor(label), now);
    } else {
      const label = runtime.driving() ? "DRIVING" : runtime.ridingTrain() ? "RIDING" : "WALKING";
      pushStatus(statusFor(label), now);
    }
    // Debug hook (same family as __ORBITX_READY / __ORBITX_SNAP): live
    // player position + swim state for the test rig and the merge check.
    window.__ORBITX_PLAYER = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, swimming: isWater(player.x, player.z) && !player.flying && !runtime.driving(), flying: player.flying };

    if (quality === "high") composer.render();
    else renderer.render(scene, camera);
    window.__ORBITX_READY = true;
    window.__ORBITX_DRAWS = renderer.info.render.calls;
    frames++;
    if (now - fpsStamp > 500) {
      window.__ORBITX_FPS = Math.round((frames * 1000) / (now - fpsStamp));
      frames = 0;
      fpsStamp = now;
    }
    } catch (err) {
      const slot = window as unknown as { __FRAME_ERR?: string };
      if (!slot.__FRAME_ERR) slot.__FRAME_ERR = err instanceof Error ? err.stack ?? err.message : String(err);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // Graphics presets (graphics.ts), at the end of createGame — after the
  // composer, lights, fog and sky exist, before the return. The day/night
  // block in frame() calls applyDayNightLighting(), so the intensities set
  // here are not stomped on the next frame.
  applyGraphicsPreset(renderer, scene, graphicsQuality, { sun, hemi, fill, ambient });
  upgradeMaterials(graphicsQuality);
  applyEnvironment(renderer, scene, graphicsQuality);

  return {
    start(nextSeed: number, nextMode: PlayMode) {
      seed = nextSeed;
      mode = nextMode;
      const token = ++boot;
      const city = buildCity(seed);
      spawn = city.spawn;
      focus = city.focus;
      buildMeshes(city);
      buildMovers(city);
      player.vy = 0;
      player.onGround = true;
      if (nextMode === "air") {
        player.flying = true;
        player.x = 70;
        player.y = 72;
        player.z = 205;
        const dx = focus.x - player.x;
        const dz = focus.z - player.z;
        const dy = focus.y - (player.y + 1.62);
        const h = Math.hypot(dx, dz) || 1;
        player.yaw = Math.atan2(dx, -dz);
        player.pitch = Math.atan2(dy, h);
        playing = true;
      } else if (nextMode === "play") {
        player.flying = false;
        player.x = spawn.x;
        player.y = spawn.y;
        player.z = spawn.z;
        player.yaw = spawn.yaw;
        player.pitch = spawn.pitch;
        playing = true;
      } else {
        playing = false;
        player.flying = false;
      }
      void runtime.begin(city, nextMode !== "orbit").then(() => {
        if (token !== boot) return;
        const params = new URLSearchParams(location.search);
        runtime.applyShot(params.get("shot"), player);
        if (params.has("phone")) runtime.request("phone");
        const lobby = params.get("lobby");
        if (lobby) runtime.joinLobby(lobby);
        const go = params.get("go");
        if (go) runtime.travel(go);
      });
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockChange);
      window.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchmove", onPinchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEndLook);
      canvas.removeEventListener("touchcancel", onTouchEndLook);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      document.removeEventListener("touchmove", blockScroll);
      runtime.destroy();
      clearGroup(staticRoot);
      unit.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
    setIntro(on: boolean) {
      introOn = on;
      introPaused = false;
      if (on) {
        introT = 0;
        (window as unknown as { __ORBITX_INTRO_SEEK?: (t: number, paused?: boolean) => void }).__ORBITX_INTRO_SEEK = (
          t: number,
          paused?: boolean,
        ) => {
          introT = Math.max(0, Math.min(INTRO_LEN, t));
          if (typeof paused === "boolean") introPaused = paused;
        };
      } else {
        orbitClockOffset = clock;
      }
    },
    seekIntro(t: number, paused?: boolean) {
      introT = Math.max(0, Math.min(INTRO_LEN, t));
      if (typeof paused === "boolean") introPaused = paused;
    },
    capturePhoto() {
      // Same render path as frame(): composer on high, plain renderer
      // otherwise — then read the buffer back in the same task.
      if (quality === "high") composer.render();
      else renderer.render(scene, camera);
      return new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((blob) => resolve(blob), "image/png");
        } catch {
          resolve(null);
        }
      });
    },
    runtime,
  };
}
