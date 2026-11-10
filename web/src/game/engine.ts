import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
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
import { buildCity, type City, type Collider, type Mat, type RailPoint, type ShipPath } from "./city";

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

interface Player {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vy: number;
  flying: boolean;
  onGround: boolean;
}

function styledMaterial(opts: {
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  grid?: number;
  polygonOffset?: boolean;
}) {
  const mat = new MeshLambertMaterial({
    color: opts.color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    polygonOffset: opts.polygonOffset ?? false,
    polygonOffsetFactor: opts.polygonOffset ? -2 : 0,
    polygonOffsetUnits: opts.polygonOffset ? -4 : 0,
  });
  const grid = opts.grid ?? 0;
  if (grid > 0) {
    const g = grid.toFixed(3);
    mat.customProgramCacheKey = () => `voxel-${g}`;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "varying vec3 vBlockWorld;\nvarying vec3 vBlockNormal;\n" +
        shader.vertexShader.replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          vec3 blockN = objectNormal;
          vec4 blockW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mat3 bMat = mat3(instanceMatrix);
            blockN /= vec3(dot(bMat[0], bMat[0]), dot(bMat[1], bMat[1]), dot(bMat[2], bMat[2]));
            blockN = bMat * blockN;
            blockW = instanceMatrix * blockW;
          #endif
          blockW = modelMatrix * blockW;
          blockN = mat3(modelMatrix) * blockN;
          vBlockWorld = blockW.xyz;
          vBlockNormal = normalize(blockN);
          `,
        );
      shader.fragmentShader =
        "varying vec3 vBlockWorld;\nvarying vec3 vBlockNormal;\n" +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          vec3 bDist = min(fract(vBlockWorld), 1.0 - fract(vBlockWorld));
          vec3 aN = abs(normalize(vBlockNormal));
          float edgeDist = aN.x > aN.y && aN.x > aN.z ? min(bDist.y, bDist.z) : (aN.y > aN.z ? min(bDist.x, bDist.z) : min(bDist.x, bDist.y));
          float crack = 1.0 - smoothstep(0.012, 0.085, edgeDist);
          float n = fract(sin(dot(floor(vBlockWorld + aN * 0.5), vec3(127.1, 311.7, 74.7))) * 43758.5453);
          diffuseColor.rgb *= mix(1.0, 0.55, crack * ${g});
          diffuseColor.rgb *= 0.9 + 0.1 * n;
          `,
        );
    };
  }
  return mat;
}

const MATERIALS: Record<Mat, MeshLambertMaterial> = {
  asphalt: styledMaterial({ color: 0x171a22 }),
  sidewalk: styledMaterial({ color: 0xc5c9d1, grid: 0.35 }),
  plaza: styledMaterial({ color: 0xe4e7ee, grid: 0.45 }),
  grass: styledMaterial({ color: 0x3c9a3a, grid: 0.4 }),
  hedge: styledMaterial({ color: 0x1d6e32, grid: 0.7 }),
  leaves: styledMaterial({ color: 0x37b24a, grid: 0.55 }),
  leavesDark: styledMaterial({ color: 0x1f8a34, grid: 0.55 }),
  trunk: styledMaterial({ color: 0x6b4a2e, grid: 0.4 }),
  black: styledMaterial({ color: 0x12151c, grid: 0.85 }),
  white: styledMaterial({ color: 0xf4f6fa, grid: 0.75 }),
  gray: styledMaterial({ color: 0x3a404c, grid: 0.7 }),
  cyan: styledMaterial({
    color: 0x7eefff,
    emissive: 0x19d8ff,
    emissiveIntensity: 0.95,
    grid: 0.25,
  }),
  cyanhot: styledMaterial({
    color: 0xe9fbff,
    emissive: 0x5ef3ff,
    emissiveIntensity: 1.15,
  }),
  water: styledMaterial({
    color: 0x1a74ff,
    emissive: 0x0a3ec8,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.82,
  }),
  stone: styledMaterial({ color: 0xd5dae2, grid: 0.65 }),
  lane: styledMaterial({ color: 0xf7f7f2, polygonOffset: true }),
  hill: styledMaterial({ color: 0x6a3b2c, grid: 0.25 }),
  track: styledMaterial({ color: 0x1c212b, grid: 0.2 }),
};
MATERIALS.water.depthWrite = false;

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
  g.add(hull, cabin, wingL, wingR, engine, nose);
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
}

export function createGame(
  canvas: HTMLCanvasElement,
  onStatus: (text: string) => void,
  preserveDrawingBuffer: boolean,
): Game {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer,
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setClearColor(0xf09158, 1);

  const scene = new Scene();
  scene.fog = new Fog(0xf09158, 170, 460);

  const camera = new PerspectiveCamera(62, 1, 0.08, 520);

  const hemi = new HemisphereLight(0xffc9a2, 0x2a221c, 0.78);
  const sun = new DirectionalLight(0xffd0a2, 1.9);
  sun.position.set(110, 42, 30);
  const fill = new DirectionalLight(0x93a4ff, 0.32);
  fill.position.set(-60, 28, -40);
  const ambient = new AmbientLight(0xffb080, 0.16);
  scene.add(hemi, sun, fill, ambient);

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
      fragmentShader: `
        varying vec3 vDir;
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
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.scale.setScalar(420);
  scene.add(sky);

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
  let colliders: Collider[] = [];
  let fountain = { x: 0, z: 12 };
  let seed = 1;
  let mode: PlayMode = "orbit";
  let playing = false;

  const player: Player = {
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
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (maxX > c.minX && minX < c.maxX && maxY > c.minY && minY < c.maxY && maxZ > c.minZ && minZ < c.maxZ) {
        return true;
      }
    }
    return false;
  }

  function groundY(x: number, z: number, maxY: number) {
    let top = 0;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (x + RADIUS <= c.minX || x - RADIUS >= c.maxX || z + RADIUS <= c.minZ || z - RADIUS >= c.maxZ) continue;
      if (c.maxY <= maxY + 0.08 && c.maxY > top) top = c.maxY;
    }
    return top;
  }

  function move(dx: number, dy: number, dz: number) {
    if (dy !== 0) {
      const ny = player.y + dy;
      if (ny < 0) {
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

  function tick(dt: number) {
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const mag = Math.hypot(forward, strafe);
    const f = mag > 0 ? forward / mag : 0;
    const s = mag > 0 ? strafe / mag : 0;
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const space = keys.has("Space");
    const speed = player.flying ? (ctrl ? 28 : 14) : shift ? 1.6 : ctrl ? 8.5 : 5.2;
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
    if (player.y < -4 || player.y > 220) {
      player.x = spawn.x;
      player.y = spawn.y;
      player.z = spawn.z;
      player.vy = 0;
      player.flying = false;
    }
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
      let list = buckets.get(box.mat);
      if (!list) {
        list = [];
        buckets.set(box.mat, list);
      }
      list.push(box);
    }
    for (const [mat, list] of buckets) {
      const mesh = new InstancedMesh(unit, MATERIALS[mat], list.length);
      mesh.frustumCulled = false;
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
      const ship = makeShip(MATERIALS.black, MATERIALS.cyan, MATERIALS.cyanhot);
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
    keys.add(event.code);
    if (!playing) return;
    if (event.code === "KeyF" && !event.repeat) {
      player.flying = !player.flying;
      player.vy = 0;
    }
    if (event.code === "Space") event.preventDefault();
  }
  function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code);
  }
  function onMouseMove(event: MouseEvent) {
    if (document.pointerLockElement !== canvas) return;
    player.yaw += event.movementX * 0.0022;
    player.pitch -= event.movementY * 0.0022;
    const limit = Math.PI / 2 - 0.02;
    if (player.pitch > limit) player.pitch = limit;
    if (player.pitch < -limit) player.pitch = -limit;
  }
  function onClick() {
    if (playing && document.pointerLockElement !== canvas) canvas.requestPointerLock();
  }
  function onResize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("click", onClick);
  window.addEventListener("resize", onResize);
  onResize();

  let raf = 0;
  let last = performance.now();
  let frames = 0;
  let fpsStamp = performance.now();
  let clock = 0;

  function frame(now: number) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    clock += dt;
    if (playing && mode !== "orbit" && document.pointerLockElement === canvas) tick(dt);
    else if (playing && mode === "air" && keys.size > 0) tick(dt);
    else if (playing && mode === "play" && keys.size > 0 && document.pointerLockElement !== canvas) tick(dt);

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
    if (mode === "orbit") {
      const t = clock * 0.07;
      camera.position.set(Math.sin(t) * 150, 64, Math.cos(t) * 132 + 10);
      camera.lookAt(0, 24, -8);
    } else {
      const cp = Math.cos(player.pitch);
      const sp = Math.sin(player.pitch);
      const sy = Math.sin(player.yaw);
      const cy = Math.cos(player.yaw);
      camera.position.set(player.x, player.y + 1.62, player.z);
      look.set(player.x + sy * cp, player.y + 1.62 + sp, player.z - cy * cp);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      const label = player.flying ? "FLYING" : "WALKING";
      onStatus(`${label}  ${Math.round(player.x)} ${Math.round(player.y)} ${Math.round(player.z)}  seed ${seed}`);
    }

    renderer.render(scene, camera);
    window.__ORBITX_READY = true;
    window.__ORBITX_DRAWS = renderer.info.render.calls;
    frames++;
    if (now - fpsStamp > 500) {
      window.__ORBITX_FPS = Math.round((frames * 1000) / (now - fpsStamp));
      frames = 0;
      fpsStamp = now;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    start(nextSeed: number, nextMode: PlayMode) {
      seed = nextSeed;
      mode = nextMode;
      const city = buildCity(seed);
      colliders = city.colliders;
      spawn = city.spawn;
      focus = city.focus;
      buildMeshes(city);
      buildMovers(city);
      player.vy = 0;
      player.onGround = true;
      if (nextMode === "air") {
        player.flying = true;
        player.x = 86;
        player.y = 52;
        player.z = 108;
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
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      clearGroup(staticRoot);
      unit.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
