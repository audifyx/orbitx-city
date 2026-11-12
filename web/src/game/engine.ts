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
import { MATERIALS } from "./materials";
import { createRuntime, wantsTouch, type Body, type Runtime } from "./runtime";
import { bridgeGateFor, stateById } from "./states";
import { createMoveSmoother } from "./movement";
import { applyDayNightLighting, applyEnvironment, applyGraphicsPreset, upgradeMaterials, type GraphicsQuality } from "./graphics";
import { mountPretty, setPrettyNight, type QualityName } from "./pretty";
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
  }
}

const RADIUS = 0.28;
const HEIGHT = 1.7;

function makeShip(body: Material, glass: Material, hot: Material) {
  const g = new Group();
  const box = new BoxGeometry(1, 1, 1);
  const hull = new Mesh(box, body);
  hull.scale.set(4.4, 0.7, 1.7);
  const cabin = new Mesh(box, glass);
  cabin.scale.set(2.2, 0.62, 1.25);
  cabin.position.set(-0.2, 0.62, 0);
  const wingL = new Mesh(box, body);
  wingL.scale.set(1.5, 0.18, 2.6);
  wingL.position.set(-0.4, 0, 0);
  const wingR = wingL.clone();
  wingR.position.x = 0.4;
  const engine = new Mesh(box, hot);
  engine.scale.set(0.55, 0.4, 0.55);
  engine.position.set(-2.15, 0, 0);
  const nose = new Mesh(box, hot);
  nose.scale.set(0.35, 0.28, 0.7);
  nose.position.set(2.15, 0.1, 0);
  // Gold pinstripes along the hull sides.
  const stripeL = new Mesh(box, hot);
  stripeL.scale.set(4.0, 0.1, 0.06);
  stripeL.position.set(0, 0.28, 0.88);
  const stripeR = new Mesh(box, hot);
  stripeR.scale.set(4.0, 0.1, 0.06);
  stripeR.position.set(0, 0.28, -0.88);
  g.add(hull, cabin, wingL, wingR, engine, nose, stripeL, stripeR);
  return g;
}

function makeTrain(body: Material, glass: Material, hot: Material, dark: Material) {
  const g = new Group();
  const box = new BoxGeometry(1, 1, 1);
  for (let i = 0; i < 3; i++) {
    const car = new Group();
    const shell = new Mesh(box, i === 0 ? body : dark);
    shell.scale.set(6.2, 2.15, 2.35);
    const stripe = new Mesh(box, glass);
    stripe.scale.set(5.4, 0.7, 2.5);
    stripe.position.y = 0.25;
    const roof = new Mesh(box, dark);
    roof.scale.set(6.4, 0.32, 2.55);
    roof.position.y = 1.2;
    const light = new Mesh(box, hot);
    light.scale.set(0.25, 0.28, 1.4);
    light.position.set(3.15, 0.15, 0);
    car.add(shell, stripe, roof, light);
    car.position.x = (i - 1) * 7.1;
    g.add(car);
  }
  return g;
}

export interface Game {
  start: (seed: number, mode: PlayMode) => void;
  dispose: () => void;
  runtime: Runtime;
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
  renderer.setClearColor(0xf09158, 1);
  renderer.shadowMap.enabled = quality !== "low";
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const baseFog = new Fog(0xf09158, touch ? 100 : 170, touch ? 2000 : 2800);
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
      uniforms: { uNight: { value: 0 }, uDay: { value: 0 } },
      fragmentShader: `
        varying vec3 vDir;
        uniform float uNight;
        uniform float uDay;
        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 zenith = vec3(0.13, 0.10, 0.28);
          vec3 high = vec3(0.45, 0.20, 0.36);
          vec3 mid = vec3(0.95, 0.42, 0.16);
          vec3 hor = vec3(1.0, 0.70, 0.32);
          vec3 below = vec3(0.42, 0.16, 0.09);
          vec3 col = mix(below, hor, smoothstep(-0.2, 0.02, h));
          col = mix(col, mid, smoothstep(0.0, 0.16, h));
          col = mix(col, high, smoothstep(0.16, 0.48, h));
          col = mix(col, zenith, smoothstep(0.48, 0.95, h));
          vec3 sunDir = normalize(vec3(0.72, 0.18, 0.28));
          float sunDisk = pow(max(dot(dir, sunDir), 0.0), 90.0);
          float glow = pow(max(dot(dir, sunDir), 0.0), 5.0);
          col += vec3(1.0, 0.9, 0.55) * sunDisk * 1.5;
          col += vec3(1.0, 0.42, 0.12) * glow * 0.5;
          if (h > 0.02) {
            vec2 uv = dir.xz / max(h, 0.12);
            float w1 = sin(uv.x * 0.85 + uv.y * 0.35);
            float w2 = sin(uv.x * 1.7 - uv.y * 1.15 + 1.7);
            float cloud = smoothstep(0.25, 0.95, w1 * 0.65 + w2 * 0.35);
            cloud *= smoothstep(0.02, 0.28, h);
            vec3 cloudCol = mix(vec3(1.0, 0.58, 0.30), vec3(1.0, 0.90, 0.74), smoothstep(0.04, 0.5, h));
            col = mix(col, cloudCol, cloud * 0.55);
          }
          col = mix(col, vec3(0.03, 0.05, 0.12), uNight);
          col = mix(col, vec3(0.45, 0.72, 0.95), uDay * 0.65);
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
  composer.addPass(new UnrealBloomPass(new Vector2(1024, 1024), 0.32, 0.45, 0.86));

  const unit = new BoxGeometry(1, 1, 1);
  const dummy = new Object3D();
  let staticRoot = new Group();
  scene.add(staticRoot);

  const trains: Group[] = [];
  const ships: Group[] = [];
  const jets: Mesh[] = [];
  let rail: RailPoint[] = [];
  let railDist: number[] = [];
  let railLen = 1;
  let shipPaths: ShipPath[] = [];
  let boot = 0;
  let fountain = { x: 0, z: 12 };
  let seed = 1;
  let mode: PlayMode = "orbit";
  let playing = false;

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
  // Magic-bridge hop state: per-gate cooldown + the arrival line shown in
  // the status line for 5s after a hop.
  const lastBridgeHop = new Map<string, number>();
  let bridgeNotice = "";
  let bridgeNoticeUntil = 0;
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
        const floor = groundY(player.x, player.z, player.y);
        if (!overlaps(player.x, floor, player.z)) player.y = floor;
        player.vy = 0;
        player.onGround = true;
      } else {
        player.vy = 0;
      }
    }
    if (dx !== 0) {
      if (!overlaps(player.x + dx, player.y, player.z)) player.x += dx;
      else if (!player.flying && !overlaps(player.x + dx, player.y + 0.5, player.z)) {
        player.x += dx;
        player.y += 0.5;
      }
    }
    if (dz !== 0) {
      if (!overlaps(player.x, player.y, player.z + dz)) player.z += dz;
      else if (!player.flying && !overlaps(player.x, player.y + 0.5, player.z + dz)) {
        player.z += dz;
        player.y += 0.5;
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
    // FOOD: hunger that matters — well fed you run fast, starving you
    // crawl; stamina adds up to +10%. On foot only, never while flying
    // (a flying body has no legs to be tired).
    // CRIB: energy moves the legs — Rested (>= 70) runs 15% faster,
    // Exhausted (0) walks at 65%. Flying is untouched.
    const baseSpeed = player.flying ? (ctrl ? 28 : 14) : shift ? 1.6 : ctrl ? 8.5 : 5.2;
    const speed = player.flying ? baseSpeed : baseSpeed * runtime.speedMult() * runtime.energyFactor();
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    if (player.flying) {
      const pitchSin = Math.sin(player.pitch);
      const pitchCos = Math.cos(player.pitch);
      player.vy = pitchSin * f * speed + (space ? 12 : 0) - (shift ? 12 : 0);
      move((sin * pitchCos * f + cos * s) * speed * dt, player.vy * dt, (-cos * pitchCos * f + sin * s) * speed * dt);
    } else {
      if (space && player.onGround) {
        player.vy = 8.6;
        player.onGround = false;
      }
      player.vy = Math.max(-50, player.vy - 28 * dt);
      player.onGround = false;
      move((sin * f + cos * s) * speed * dt, player.vy * dt, (-cos * f + sin * s) * speed * dt);
      player.onGround = overlaps(player.x, player.y - 0.04, player.z) || player.y <= 0.001;
    }
    // Magic bridge hop (states.ts): stepping into a gate rect teleports on
    // foot to the paired landing, facing onward. Landings sit outside the
    // far gate rect so a crossing can never immediately re-trigger; the
    // 1.5s per-gate cooldown is belt-and-braces against double-firing on a
    // slow frame. Driving players do not hop here — tick() never runs while
    // driving and the car is owned by runtime.drive (no clean car hook in
    // engine), so a driver steps out (E) and walks through.
    const gate = bridgeGateFor(player.x, player.z);
    if (gate) {
      const gateKey = `${gate.bridgeId}:${gate.side}`;
      if (clock - (lastBridgeHop.get(gateKey) ?? -10) > 1.5) {
        lastBridgeHop.set(gateKey, clock);
        player.x = gate.landing.x;
        player.z = gate.landing.z;
        player.y = 0;
        player.vy = 0;
        player.yaw = gate.landing.yaw;
        moveSmoother.reset();
        bridgeNotice =
          gate.to === "home"
            ? "OrbitX City — back home."
            : `${stateById(gate.to).name} — ${stateById(gate.to).tagline}`;
        bridgeNoticeUntil = clock + 5;
      }
    }
    if (!runtime.indoors() && (player.y < -4 || player.y > 220)) {
      player.x = spawn.x;
      player.y = spawn.y;
      player.z = spawn.z;
      player.vy = 0;
      player.flying = false;
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
    for (const [mat, list] of buckets) {
      if (!list.length) continue;
      const mesh = new InstancedMesh(unit, MATERIALS[mat], list.length);
      mesh.frustumCulled = false;
      mesh.castShadow = quality !== "low" && mat !== "lane" && mat !== "asphalt";
      mesh.receiveShadow = quality !== "low";
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
      if (event.code === "Escape") runtime.request("close");
      return;
    }
    keys.add(event.code);
    if (!playing) return;
    if (event.code === "KeyF" && !event.repeat) runtime.toggleFly(player);
    if (event.code === "KeyE" && !event.repeat) runtime.interact(player);
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
    if (event.code === "KeyV") runtime.setTalking(true);
    if (event.code === "Digit1") runtime.emote("wave");
    if (event.code === "Digit2") runtime.emote("dance");
    if (event.code === "Digit3") runtime.emote("cheer");
    if (event.code === "Digit4") runtime.emote("sit");
    if (event.code === "Digit5") runtime.emote("spin");
    if (event.code === "Digit6") runtime.emote("bow");
    if (event.code === "Digit7") runtime.emote("clap");
    if (event.code === "Digit8") runtime.emote("robot");
    if (event.code === "KeyZ" && !event.repeat) {
      wheelX = 0;
      wheelY = 0;
      runtime.setWheel(true);
    }
    if (event.code === "KeyX" && !event.repeat) runtime.toggleDecor();
    if (event.code === "KeyO" && !event.repeat) runtime.toggleSpectator();
    if (event.code === "KeyU" && !event.repeat) runtime.toggleHud();
    if (event.code === "KeyI" && !event.repeat) runtime.toggleNames();
    if (event.code === "KeyL" && !event.repeat) runtime.toggleOrbit();
    if (event.code === "Escape") runtime.request("close");
    if (event.code === "Space") event.preventDefault();
  }
  function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code);
    if (event.code === "KeyV") runtime.setTalking(false);
    if (event.code === "KeyZ") runtime.commitWheel();
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
    if (target?.closest(".panel, .chat-log, input, textarea")) return;
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

  // Status line: for 5s after a bridge hop it shows the arrival line
  // instead of the coords (the engine cannot reach runtime's say() toast —
  // say is not on the Runtime return — so the status line is the visible
  // channel until the client agent exposes it).
  function statusFor(label: string) {
    if (bridgeNotice && clock < bridgeNoticeUntil) return bridgeNotice;
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
      const yawKeys = runtime.decorating()
        ? (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0)
        : (keys.has("ArrowRight") || keys.has("KeyR") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyQ") ? 1 : 0);
      if (runtime.decorating() && (keys.has("KeyQ") || keys.has("KeyR"))) runtime.spinDecor((keys.has("KeyR") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0));
      const pitchKeys = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
      if (yawKeys || pitchKeys) runtime.addLook(yawKeys * 1.7 * dt, pitchKeys * 1.15 * dt);
      let left = dt;
      while (left > 0.0001) {
        const step = Math.min(0.05, left);
        if (runtime.driving()) runtime.drive(step, player, keys, carHit);
        else tick(step);
        left -= step;
      }
    }

    MATERIALS.cyanhot.emissiveIntensity = 1.35 + Math.sin(clock * 2.4) * 0.22;

    const travel = clock * 18;
    if (trains[0]) placeTrain(trains[0], travel);
    if (trains[1]) placeTrain(trains[1], travel + railLen * 0.5);
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
      baseFog.color.setHex(0xf09158);
      setPrettyNight(0.5);
    }
    scene.fog = runtime.indoors() ? null : baseFog;
    const tookCamera = runtime.after(dt, player, camera, { orbit: mode === "orbit", fountain });
    if (mode === "orbit") {
      const t = clock * 0.07;
      camera.position.set(Math.sin(t) * 190, 78, Math.cos(t) * 132 + 10);
      camera.lookAt(0, 26, 20);
    } else if (!tookCamera) {
      const cp = Math.cos(player.pitch);
      const sp = Math.sin(player.pitch);
      const sy = Math.sin(player.yaw);
      const cy = Math.cos(player.yaw);
      camera.position.set(player.x, player.y + 1.62, player.z);
      look.set(player.x + sy * cp, player.y + 1.62 + sp, player.z - cy * cp);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      const label = runtime.driving() ? "DRIVING" : player.flying ? "FLYING" : "WALKING";
      pushStatus(statusFor(label), now);
    } else {
      const label = runtime.driving() ? "DRIVING" : "WALKING";
      pushStatus(statusFor(label), now);
    }

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
    runtime,
  };
}
