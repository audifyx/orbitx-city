import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  type Material,
  type PerspectiveCamera,
  type Scene,
} from "three";
import type { Anchor, BoardSlot, City, Collider, Zone } from "./city";
import {
  AD_PRICE,
  SHOP,
  type BillboardInfo,
  type CityContent,
  type EventInfo,
  type ShopItem,
  loadContent,
} from "./content";
import { burnAmount, earn, loadWallet, saveWallet, spend } from "./economy";
import { createNet, type ChatLine, type NetAdapter, type NetState } from "./net";
import { dressPerson, loadLooks, lookById, lookName, looksReady } from "./avatar";
import { GOLD, MATERIALS } from "./materials";
import { world } from "./world";
import {
  joinVoice,
  leaveVoice,
  setDeafened as deafenMic,
  setMuted as muteMic,
  setPushToTalk as armTalk,
  setTalking as holdTalk,
  setVolume as volumeFor,
  voiceTick,
} from "./voice";

export interface Body {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vy: number;
  flying: boolean;
  onGround: boolean;
}

export type PanelName = "shop" | "jobs" | "ads" | "events" | "chat" | "menu" | "phone";

export interface PersonCard {
  id: string;
  name: string;
  look: string;
  color: string;
  hat: string;
  speaking: boolean;
  lobby: string;
  x: number;
  z: number;
}

export interface Snap {
  playing: boolean;
  touch: boolean;
  driving: boolean;
  flying: boolean;
  indoors: string;
  prompt: string;
  balance: number;
  burned: number;
  owned: string[];
  color: string;
  hat: string;
  car: string;
  jobTitle: string;
  objective: string;
  notice: string;
  chat: ChatLine[];
  others: number;
  netMode: string;
  name: string;
  projects: CityContent["projects"];
  billboards: BillboardInfo[];
  events: EventInfo[];
  shop: ShopItem[];
  eventLabel: string;
  panel: PanelName | "";
  mission: number;
  board: { name: string; burned: number }[];
  districts: { id: string; name: string; x: number; z: number }[];
  people: PersonCard[];
  friends: { id: string; name: string }[];
  requests: { id: string; name: string }[];
  party: { id: string; name: string }[];
  lobbies: { id: string; name: string; members: { id: string; name: string; speaking: boolean }[] }[];
  lobby: string;
  muted: boolean;
  deafened: boolean;
  pushToTalk: boolean;
  voiceProvider: string;
  voiceError: string;
  quality: string;
  time: string;
  me: { x: number; z: number; yaw: number };
  profile: PersonCard | null;
  server: string;
  chatScope: "global" | "near";
  lookId: string;
  lookName: string;
  cam: string;
  camLabel: string;
  lookHint: string;
}

interface Remote {
  state: NetState;
  seen: number;
  group: Group;
}

interface Spark {
  mesh: Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

const COLORS: Record<string, number> = {
  white: 0xf4f6fa,
  gold: 0xe0b33a,
  cyan: 0x7eefff,
  sunset: 0xff7a3c,
  black: 0x16181f,
};

const BOOK_KEY = "orbitx-demo-ads-v1";

function paint(lines: string[], sub: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new CanvasTexture(canvas);
  ctx.fillStyle = "#07141c";
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = "#7eefff";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 496, 240);
  ctx.fillStyle = "#123";
  for (let i = 0; i < 8; i++) {
    ctx.globalAlpha = 0.35;
    ctx.fillRect(28, 36 + i * 24, 456, 8);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e9fbff";
  ctx.font = "700 42px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(lines[0] ?? "", 256, 110, 460);
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillStyle = "#7eefff";
  ctx.fillText(lines[1] ?? "", 256, 158, 460);
  ctx.font = "500 18px system-ui, sans-serif";
  ctx.fillStyle = "#e0b33a";
  ctx.fillText(sub, 256, 206, 460);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function labelTexture(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new CanvasTexture(canvas);
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(0, 24, 512, 80);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 42px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 256, 78, 480);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeLabel(text: string, person = false) {
  const sprite = new Sprite(new SpriteMaterial({ map: labelTexture(text), transparent: true, depthWrite: false }));
  sprite.scale.set(person ? 1.05 : 4.8, person ? 0.26 : 1.2, 1);
  sprite.renderOrder = 3;
  return sprite;
}

function makePerson(color: string, hat: string) {
  const group = new Group();
  const box = new BoxGeometry(1, 1, 1);
  const cloth = new MeshLambertMaterial({ color: COLORS[color] ?? COLORS.white });
  const body = new Mesh(box, cloth);
  body.scale.set(0.62, 0.95, 0.4);
  body.position.y = 0.85;
  const head = new Mesh(box, MATERIALS.white);
  head.scale.set(0.4, 0.4, 0.4);
  head.position.y = 1.62;
  const legs = new Mesh(box, MATERIALS.black);
  legs.scale.set(0.58, 0.45, 0.36);
  legs.position.y = 0.28;
  const ring = new Mesh(
    new TorusGeometry(0.62, 0.045, 8, 24),
    new MeshStandardMaterial({ color: 0x7ef6ff, emissive: 0x19d8ff, emissiveIntensity: 1.3 }),
  );
  ring.name = "ring";
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  group.add(body, head, legs, ring);
  addHat(group, box, hat);
  return group;
}

function addHat(group: Group, box: BoxGeometry, hat: string) {
  const old = group.getObjectByName("hat");
  if (old) group.remove(old);
  if (hat === "none" || !hat) return;
  const node = new Group();
  node.name = "hat";
  if (hat === "cap") {
    const cap = new Mesh(box, MATERIALS.black);
    cap.scale.set(0.46, 0.16, 0.46);
    cap.position.y = 1.9;
    const brim = new Mesh(box, MATERIALS.black);
    brim.scale.set(0.34, 0.08, 0.22);
    brim.position.set(0, 1.84, 0.28);
    node.add(cap, brim);
  } else if (hat === "antenna") {
    const pole = new Mesh(box, MATERIALS.gray);
    pole.scale.set(0.08, 0.55, 0.08);
    pole.position.y = 2.05;
    const tip = new Mesh(box, MATERIALS.cyanhot);
    tip.scale.set(0.16, 0.16, 0.16);
    tip.position.y = 2.38;
    node.add(pole, tip);
  } else {
    const crown = new Mesh(box, GOLD);
    crown.scale.set(0.5, 0.22, 0.5);
    crown.position.y = 1.92;
    const point = new Mesh(box, GOLD);
    point.scale.set(0.16, 0.22, 0.16);
    point.position.y = 2.12;
    node.add(crown, point);
  }
  group.add(node);
}

function makeCar(skin: string, style: number) {
  const group = new Group();
  group.rotation.order = "YXZ";
  const box = new BoxGeometry(1, 1, 1);
  const paints: MeshStandardMaterial[] = [];
  const paint = () => {
    const material = new MeshStandardMaterial({
      color: COLORS[skin] ?? COLORS.black,
      emissive: 0x12141c,
      emissiveIntensity: 0.28,
      roughness: 0.35,
      metalness: 0.45,
    });
    paints.push(material);
    return material;
  };
  const add = (material: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const mesh = new Mesh(box, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
  };
  const body = paint();
  if (style === 1) {
    add(body, 0.15, 0.42, 0, 3.7, 0.32, 1.72);
    add(body, -0.25, 0.68, 0, 1.55, 0.28, 1.42);
    add(MATERIALS.cyan, -0.05, 0.74, 0, 1.05, 0.18, 1.2);
    add(body, -1.55, 0.86, 0, 0.12, 0.28, 1.55);
  } else if (style === 2) {
    add(body, 0.05, 0.62, 0, 3.35, 0.62, 1.62);
    add(body, -0.2, 1.15, 0, 2.15, 0.52, 1.5);
    add(MATERIALS.cyan, 0.2, 1.18, 0, 1.35, 0.32, 1.32);
    add(GOLD, -0.15, 1.52, 0, 0.55, 0.16, 0.7);
  } else {
    add(body, 0.1, 0.5, 0, 3.45, 0.42, 1.62);
    add(body, -0.2, 0.88, 0, 1.65, 0.36, 1.42);
    add(MATERIALS.cyan, 0.02, 0.92, 0, 1.15, 0.22, 1.22);
  }
  add(body, 1.62, 0.4, 0, 0.62, 0.26, 1.28);
  add(MATERIALS.cyanhot, 1.92, 0.42, 0.46, 0.1, 0.14, 0.32);
  add(MATERIALS.cyanhot, 1.92, 0.42, -0.46, 0.1, 0.14, 0.32);
  const lamp = new MeshStandardMaterial({ color: 0xff4b5c, emissive: 0xaa1830, emissiveIntensity: 0.8, roughness: 0.3 });
  add(lamp, -1.72, 0.46, 0.52, 0.1, 0.16, 0.34);
  add(lamp, -1.72, 0.46, -0.52, 0.1, 0.16, 0.34);
  add(MATERIALS.cyan, 0.05, 0.58, 0.84, 2.5, 0.08, 0.08);
  add(MATERIALS.cyan, 0.05, 0.58, -0.84, 2.5, 0.08, 0.08);
  const wheel = new CylinderGeometry(0.28, 0.28, 0.22, 12);
  const wheelMat = new MeshStandardMaterial({ color: 0x111318, roughness: 0.6, metalness: 0.4 });
  for (const [x, z] of [
    [1.15, 0.78],
    [1.15, -0.78],
    [-1.15, 0.78],
    [-1.15, -0.78],
  ] as Array<[number, number]>) {
    const mesh = new Mesh(wheel, wheelMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 0.28, z);
    mesh.name = "wheel";
    group.add(mesh);
    const glow = new Mesh(box, MATERIALS.cyan);
    glow.position.set(x, 0.08, z);
    glow.scale.set(0.34, 0.06, 0.22);
    group.add(glow);
  }
  add(MATERIALS.cyan, 0.1, 0.05, 0, 2.3, 0.05, 0.28);
  group.userData.paints = paints;
  return group;
}

function retint(group: Group, skin: string) {
  const paints = group.userData.paints as MeshStandardMaterial[] | undefined;
  if (!paints) return;
  const color = COLORS[skin] ?? COLORS.black;
  for (const material of paints) material.color.setHex(color);
}

export function wantsTouch() {
  const params = new URLSearchParams(location.search);
  if (params.get("touch") === "1") return true;
  if (params.get("touch") === "0") return false;
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

export function createRuntime(scene: Scene) {
  const listeners = new Set<(snap: Snap) => void>();
  const params = new URLSearchParams(location.search);
  if (params.get("reset") === "1") {
    localStorage.removeItem("orbitx-demo-wallet-v1");
    localStorage.removeItem(BOOK_KEY);
  }
  let wallet = loadWallet();
  let bootGen = 0;
  if (params.get("name")) {
    wallet.name = params.get("name") || wallet.name;
    saveWallet(wallet);
  }
  let content: CityContent = { projects: [], billboards: [], events: [] };
  let cityCols: Collider[] = [];
  let activeCols: Collider[] = [];
  let anchors: Anchor[] = [];
  let zones: Zone[] = [];
  let insideName = "";
  let driving = false;
  let carIndex = -1;
  let carSpeed = 0;
  let chaseYaw = 0;
  let chasePitch = 0.18;
  let stickX = 0;
  let stickY = 0;
  let lookX = 0;
  let lookY = 0;
  let holdJump = false;
  let holdDown = false;
  let paused = false;
  let typing = false;
  let playing = false;
  let flyFlag = false;
  let prompt = "";
  let notice = "";
  let noticeUntil = 0;
  let job = "";
  let phase = 0;
  let chatScope: "global" | "near" = "global";
  let timeName: "sunset" | "night" | "day" = "sunset";
  let profileId = "";
  const quality = () => localStorage.getItem("orbitx-quality") || (touch ? "low" : "high");
  let bookStamp = "";
  let clock = 0;
  let eventLeft = 0;
  let burstLeft = 0;
  let panel: PanelName | "" = "";
  const CAMS = ["shoulder", "far", "selfie", "first"] as const;
  type CamMode = (typeof CAMS)[number];
  function storedCam(): CamMode {
    const asked = new URLSearchParams(location.search).get("cam");
    if (asked === "first" || asked === "shoulder" || asked === "far" || asked === "selfie") return asked;
    const saved = localStorage.getItem("orbitx-cam");
    if (saved === "first" || saved === "shoulder" || saved === "far" || saved === "selfie") return saved;
    return "shoulder";
  }
  let camMode: CamMode = storedCam();
  let camZoom = Math.min(1.85, Math.max(0.55, Number(localStorage.getItem("orbitx-zoom")) || 1));
  let lookOn = false;
  let lookId = localStorage.getItem("orbitx-look") || "tjr";
  let payAfter = 0;
  const touch = wantsTouch();
  const chat: ChatLine[] = [];
  const remotes = new Map<string, Remote>();
  const boards = new Map<string, { mesh: Mesh; base: BillboardInfo; texture: CanvasTexture }>();
  const cars: { id: string; group: Group; x: number; z: number; yaw: number; lean: number }[] = [];
  let beacon: Mesh | null = null;
  let packageMesh: Mesh | null = null;
  let rider: Group | null = null;
  let riderOn = false;
  let localBody: Group | null = null;
  let root = new Group();
  scene.add(root);
  const handMat = new MeshStandardMaterial({ color: 0xf0c2a0, roughness: 0.6 });
  const hands = new Group();
  const handGeo = new BoxGeometry(1, 1, 1);
  const handL = new Mesh(handGeo, handMat);
  handL.scale.set(0.12, 0.1, 0.22);
  handL.position.set(-0.18, -0.24, -0.42);
  const handR = handL.clone();
  handR.position.x = 0.18;
  hands.add(handL, handR);
  hands.visible = false;
  scene.add(hands);
  const sparks: Spark[] = [];
  const npcs: { group: Group; x: number; z: number; phase: number }[] = [];
  let tourLock = false;
  const box = new BoxGeometry(1, 1, 1);

  const net: NetAdapter = createNet(
    (state) => {
      upsertRemote(state);
      publish();
    },
    (line) => {
      chat.push(line);
      if (chat.length > 24) chat.shift();
      publish();
    },
    (id) => {
      const found = remotes.get(id);
      if (!found) return;
      root.remove(found.group);
      remotes.delete(id);
    },
  );

  function bookings(): Record<string, BillboardInfo> {
    try {
      const raw = localStorage.getItem(BOOK_KEY);
      return raw ? (JSON.parse(raw) as Record<string, BillboardInfo>) : {};
    } catch {
      return {};
    }
  }

  function faceFor(info: BillboardInfo): BillboardInfo {
    const shared = world.bookings.find((item) => item.id === info.id);
    if (shared) return { ...info, project: shared.project, text: shared.text, start: shared.start, end: shared.end };
    return bookings()[info.id] ?? info;
  }

  function redrawBoard(id: string) {
    const board = boards.get(id);
    if (!board) return;
    const face = faceFor(board.base);
    board.texture.dispose();
    const texture = paint([face.project, face.text], `${face.start} → ${face.end}`);
    board.texture = texture;
    (board.mesh.material as MeshLambertMaterial).map = texture;
    (board.mesh.material as MeshLambertMaterial).needsUpdate = true;
  }

  function projectName(slot: number) {
    return content.projects[slot]?.name ?? "Your Project Here";
  }

  function zoneTitle(zone: Zone) {
    if (zone.kind !== "project") return zone.name;
    const project = content.projects[zone.slot];
    return project?.name ?? zone.name;
  }

  function zoneLine(zone: Zone) {
    if (zone.kind === "project") return content.projects[zone.slot]?.line ?? "Community office";
    if (zone.kind === "shop") return "Demo credits only";
    if (zone.kind === "cafe") return "Coffee and a seat";
    if (zone.kind === "bank") return "Demo ledger only";
    if (zone.kind === "garage") return "Hover-cars live here";
    if (zone.kind === "arcade") return "One cabinet is free";
    if (zone.kind === "market") return "Stalls and neon";
    if (zone.kind === "dock") return "Pier is open";
    return "Gather here";
  }

  function mountSign(zone: Zone) {
    const sub =
      zone.kind === "shop" ? "Use the counter" : zone.kind === "cafe" ? "Pull up a seat" : zone.kind === "hall" ? "Stage is open" : zone.kind === "bank" ? "Savings window" : zone.kind === "garage" ? "Cars on the avenue" : zone.kind === "dock" ? "Clock in here" : "Walk in";
    const texture = paint([zoneTitle(zone), zoneLine(zone)], sub);
    const mesh = new Mesh(
      new PlaneGeometry(zone.kind === "hall" ? 5.4 : 4.2, 1.7),
      new MeshLambertMaterial({ map: texture, side: DoubleSide, emissive: 0x062028, emissiveIntensity: 0.35 }),
    );
    mesh.position.set(zone.signX, zone.signY, zone.signZ);
    mesh.rotation.y = zone.signRot;
    root.add(mesh);
  }

  function clearRoot() {
    scene.remove(root);
    root = new Group();
    scene.add(root);
    boards.clear();
    cars.length = 0;
    remotes.clear();
    beacon = null;
    packageMesh = null;
    rider = null;
    localBody = null;
    sparks.length = 0;
  }

  function applyMe() {
    const me = world.me;
    if (!me) return;
    wallet.balance = me.balance;
    wallet.burned = me.burned;
    wallet.owned = [...me.owned];
    wallet.color = me.color;
    wallet.hat = me.hat;
    wallet.car = me.car;
    wallet.name = me.name;
    saveWallet(wallet);
  }

  function upsertRemote(state: NetState) {
    if (!state?.id || state.id === world.id || state.id === net.id) return;
    const found = remotes.get(state.id);
    if (found) {
      found.state = state;
      found.seen = performance.now();
      return;
    }
    const group = new Group();
    group.add(makePerson(state.color, state.hat));
    const tag = makeLabel(state.name, true);
    tag.position.y = 2.35;
    tag.name = "tag";
    group.add(tag);
    root.add(group);
    remotes.set(state.id, { state, seen: performance.now(), group });
  }

  async function begin(next: City, isPlay: boolean) {
    await loadLooks();
    await world.start(wallet.name);
    if (world.online) applyMe();
    const params = new URLSearchParams(location.search);
    lookId = params.get("look") || localStorage.getItem("orbitx-look") || world.me?.look || "tjr";
    if (!lookById(lookId).id) lookId = "tjr";
    lookId = lookById(lookId).id;
    localStorage.setItem("orbitx-look", lookId);
    camMode = storedCam();
    if (world.online && world.me?.look !== lookId) {
      try {
        await world.rename(wallet.name, lookId);
        applyMe();
      } catch {
        // The look still applies on this device if the profile write fails.
      }
    }
    const token = ++bootGen;
    playing = isPlay;
    driving = false;
    carIndex = -1;
    carSpeed = 0;
    insideName = "";
    job = "";
    phase = 0;
    riderOn = false;
    eventLeft = 0;
    burstLeft = 0;
    content = await loadContent();
    if (token !== bootGen) return;
    clearRoot();
    cityCols = next.colliders;
    activeCols = cityCols;
    anchors = next.anchors;
    zones = next.zones;
    npcs.length = 0;
    next.citizens.forEach((citizen, index) => {
      const group = makePerson(citizen.color, index % 2 ? "cap" : "none");
      const tag = makeLabel(citizen.name, true);
      tag.position.y = 2.35;
      group.add(tag);
      group.position.set(citizen.x, 0, citizen.z);
      root.add(group);
      npcs.push({ group, x: citizen.x, z: citizen.z, phase: index });
    });
    void world.loadBoard().then(() => publish());
    for (const anchor of anchors) {
      const title = anchor.kind === "project" ? projectName(anchor.slot) : anchor.name;
      const tag = makeLabel(title);
      tag.position.set(anchor.x, 2.7, anchor.z);
      root.add(tag);
    }
    for (const slot of next.boards) mountBoard(slot);
    const parked = ["black", "white", "cyan", "gold"];
    next.cars.forEach((spawn, index) => {
      const group = makeCar(index === 0 ? wallet.car : parked[index % parked.length], index % 3);
      group.position.set(spawn.x, 0.12, spawn.z);
      group.rotation.y = Math.PI / 2 - spawn.yaw;
      root.add(group);
      cars.push({ id: spawn.id, group, x: spawn.x, z: spawn.z, yaw: spawn.yaw, lean: 0 });
    });
    beacon = new Mesh(box, MATERIALS.cyanhot);
    beacon.scale.set(0.35, 1.4, 0.35);
    beacon.visible = false;
    root.add(beacon);
    packageMesh = new Mesh(box, GOLD);
    packageMesh.scale.set(0.4, 0.4, 0.4);
    packageMesh.visible = false;
    root.add(packageMesh);
    rider = makePerson("cyan", "cap");
    rider.visible = false;
    root.add(rider);
    localBody = makePerson(wallet.color, wallet.hat);
    paintPerson(localBody, true);
    localBody.visible = false;
    const selfTag = makeLabel(wallet.name, true);
    selfTag.position.y = 2.35;
    selfTag.name = "tag";
    localBody.add(selfTag);
    root.add(localBody);
    while (content.projects.length < 4) {
      const index = content.projects.length;
      content.projects.push({ id: `empty-${index}`, name: "Your Project Here", line: "Add it in projects.json" });
    }
    for (const zone of zones) mountSign(zone);
    for (let i = 0; i < 40; i++) {
      const mesh = new Mesh(box, i % 2 ? GOLD : MATERIALS.cyanhot);
      mesh.visible = false;
      root.add(mesh);
      sparks.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0 });
    }
    publish();
  }

  function mountBoard(slot: BoardSlot) {
    const base = content.billboards.find((item) => item.id === slot.id) ?? {
      id: slot.id,
      project: "OrbitX",
      text: "YOUR AD HERE",
      image: "",
      start: "2026-01-01",
      end: "2026-12-31",
    };
    const texture = paint([faceFor(base).project, faceFor(base).text], `${base.start} → ${base.end}`);
    const mesh = new Mesh(
      new PlaneGeometry(6.4, 3.4),
      new MeshLambertMaterial({ map: texture, emissive: 0x062028, emissiveIntensity: 0.6, side: DoubleSide }),
    );
    mesh.position.set(slot.x, slot.y, slot.z);
    mesh.rotation.y = slot.rotY;
    root.add(mesh);
    boards.set(slot.id, { mesh, base, texture });
  }

  function publish() {
    const snap: Snap = {
      playing,
      touch,
      driving,
      flying: flyFlag,
      indoors: insideName,
      prompt,
      balance: wallet.balance,
      burned: wallet.burned,
      owned: [...wallet.owned],
      color: wallet.color,
      hat: wallet.hat,
      car: wallet.car,
      jobTitle: job ? jobTitle(job) : "",
      objective: objectiveText(),
      notice: clock < noticeUntil ? notice : "",
      chat: world.online
        ? world.chat.slice(-12).map((line) => ({
            id: line.id,
            name: line.name,
            text: `${line.scope === "near" ? "(near) " : ""}${line.text}`,
            self: line.id === world.id,
          }))
        : chat.slice(-12),
      others: remotes.size,
      netMode: world.online ? `Main world · ${world.server}` : net.mode,
      name: wallet.name,
      projects: content.projects,
      billboards: content.billboards.map((item) => faceFor(item)),
      events: world.online && world.events.length ? [...content.events, ...world.events] : content.events,
      shop: SHOP,
      eventLabel: eventLeft > 0 ? `Fountain lights in ${Math.ceil(eventLeft)}` : burstLeft > 0 ? "Fountain lights" : "",
      panel,
      people: [...remotes.values()].map((remote) => ({
        id: remote.state.id,
        name: remote.state.name,
        look: lookName(remote.state.look),
        color: remote.state.color,
        hat: remote.state.hat,
        speaking: !!remote.state.speaking,
        lobby: remote.state.lobby || "",
        x: remote.state.x,
        z: remote.state.z,
      })),
      friends: world.me?.friends ?? [],
      requests: world.me?.inbox ?? [],
      party: world.party?.members ?? [],
      lobbies: world.lobbies,
      lobby: world.lobby,
      muted: world.muted,
      deafened: world.deafened,
      pushToTalk: world.pushToTalk,
      voiceProvider: world.provider,
      voiceError: world.voiceError,
      quality: quality(),
      time: timeName,
      me: { x: lastBody?.x ?? 0, z: lastBody?.z ?? 0, yaw: lastBody?.yaw ?? 0 },
      profile: profileCard(),
      server: world.server,
      chatScope,
      lookId,
      lookName: lookById(lookId).displayName,
      cam: camMode,
      camLabel: camTitle(),
      lookHint: playing && !touch && !lookOn && !paused && !panel && !new URLSearchParams(location.search).get("shot")
        ? "Click or drag to look"
        : "",
      mission: world.online ? world.mission : tourStep,
      board: world.board,
      districts: anchors.map((anchor) => ({ id: anchor.id, name: anchor.name, x: anchor.x, z: anchor.z })),
    };
    panel = "";
    for (const listener of listeners) listener(snap);
    window.__ORBITX_SNAP = snap;
  }

  function profileCard(): PersonCard | null {
    const remote = profileId ? remotes.get(profileId) : undefined;
    if (!remote) return null;
    return {
      id: remote.state.id,
      name: remote.state.name,
      look: lookName(remote.state.look),
      color: remote.state.color,
      hat: remote.state.hat,
      speaking: !!remote.state.speaking,
      lobby: remote.state.lobby || "",
      x: remote.state.x,
      z: remote.state.z,
    };
  }

  function jobTitle(id: string) {
    if (id === "courier") return "Courier";
    if (id === "taxi") return "Taxi";
    if (id === "mechanic") return "Mechanic";
    if (id === "photographer") return "Photographer";
    if (id === "promoter") return "Promoter";
    if (id === "dock") return "Dock hand";
    if (id === "dj") return "DJ";
    if (id === "banker") return "Bank teller";
    return "City guide";
  }

  function objectiveText() {
    if (job === "courier" && phase === 0) return "Pick up the glowing package in front of the fountain";
    if (job === "courier") return "Drop the package at OrbitX Shop";
    if (job === "taxi" && phase === 0) return "Pick up the rider on the main road (in a car)";
    if (job === "taxi") return "Drop the rider at Cafe Nova";
    if (job === "guide" && phase === 0) return "Visit the OrbitX Shop door";
    if (job === "guide" && phase === 1) return "Visit the Community Hall door";
    if (job === "guide") return "Visit OrbitX HQ in the Project District";
    if (job === "mechanic") return "Service the hover-car on the east road";
    if (job === "photographer" && phase === 0) return "Photograph the fountain";
    if (job === "photographer") return "Photograph the ORBITX tower";
    if (job === "promoter" && phase === 0) return "Stop by the Community Hall";
    if (job === "promoter") return "Stand at the plaza ad kiosk";
    if (job === "dock") return "Clock in at the harbor office";
    if (job === "dj") return "Play the Community Hall";
    if (job === "banker") return "Open the window at OrbitX Bank";
    const stop = tourStops[world.online ? world.mission : tourStep];
    if (stop) return stop.text;
    return "City tour complete — pick up a job";
  }

  function say(text: string) {
    notice = text;
    noticeUntil = clock + 5;
    publish();
  }

  function nearestAnchor(body: Body, max = 3.2) {
    let best: Anchor | null = null;
    let bestD = max;
    for (const anchor of anchors) {
      const d = Math.hypot(anchor.x - body.x, anchor.z - body.z);
      if (d < bestD && Math.abs(anchor.y - body.y) < 3) {
        best = anchor;
        bestD = d;
      }
    }
    return best;
  }

  function zoneAt(body: Body) {
    if (body.y > 3.2) return null;
    for (const zone of zones) {
      if (body.x > zone.minX && body.x < zone.maxX && body.z > zone.minZ && body.z < zone.maxZ) return zone;
    }
    return null;
  }

  function nearService(body: Body, zone: Zone) {
    return Math.hypot(body.x - zone.serviceX, body.z - zone.serviceZ) < 2.6;
  }

  function stepInside(anchor: Anchor, body: Body) {
    body.x = anchor.x + Math.sin(anchor.yaw) * 3.5;
    body.z = anchor.z - Math.cos(anchor.yaw) * 3.5;
    body.y = 0;
    body.vy = 0;
    body.flying = false;
    body.yaw = anchor.yaw;
    say(anchor.kind === "project" ? projectName(anchor.slot) : anchor.name);
  }

  let lastBody: Body | null = null;

  function interact(body?: Body) {
    const who = body ?? lastBody;
    if (!who || !playing || paused || typing) return;
    body = who;
    if (driving) {
      exitCar(body);
      return;
    }
    const car = nearestCar(body, 7);
    if (car >= 0) {
      enterCar(body, car);
      return;
    }
    const zone = zoneAt(body);
    if (zone && nearService(body, zone)) {
      if (zone.kind === "shop") panel = "shop";
      else say(zoneTitle(zone));
      publish();
      return;
    }
    const anchor = nearestAnchor(body, 3.3);
    if (!anchor) return;
    if (anchor.kind === "shop" || anchor.kind === "cafe" || anchor.kind === "hall" || anchor.kind === "project" || anchor.kind === "bank" || anchor.kind === "garage" || anchor.kind === "arcade" || anchor.kind === "market" || anchor.kind === "dock") {
      stepInside(anchor, body);
      publish();
      return;
    }
    if (anchor.kind === "jobs") panel = "jobs";
    if (anchor.kind === "ads") panel = "ads";
    if (anchor.kind === "events") panel = "events";
    publish();
  }

  function nearestCar(body: Body, max: number) {
    let best = -1;
    let bestD = max;
    cars.forEach((car, index) => {
      const d = Math.hypot(car.x - body.x, car.z - body.z);
      if (d < bestD) {
        best = index;
        bestD = d;
      }
    });
    return best;
  }

  function enterCar(body: Body, index: number) {
    driving = true;
    carIndex = index;
    carSpeed = 0;
    chaseYaw = 0;
    chasePitch = 0.22;
    body.flying = false;
    body.vy = 0;
    const car = cars[index];
    retint(car.group, wallet.car);
    say("Press E to get out.");
  }

  function exitCar(body: Body) {
    const car = cars[carIndex];
    driving = false;
    if (car) {
      body.x = car.x + Math.cos(car.yaw) * 2.6;
      body.z = car.z + Math.sin(car.yaw) * 2.6;
      body.y = 0;
    }
    carIndex = -1;
    carSpeed = 0;
    body.vy = 0;
  }

  function moveAxes(keys: Set<string>) {
    if (Math.hypot(stickX, stickY) > 0.15) return { f: stickY, s: stickX };
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const mag = Math.hypot(forward, strafe) || 1;
    return { f: forward / (forward || strafe ? mag : 1), s: strafe / (forward || strafe ? mag : 1) };
  }

  function drive(dt: number, body: Body, keys: Set<string>, blocked: (x: number, z: number) => boolean) {
    const { f, s } = moveAxes(keys);
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const max = ctrl ? 22 : 12;
    carSpeed += f * 18 * dt;
    carSpeed *= 1 - 1.6 * dt;
    if (carSpeed > max) carSpeed = max;
    if (carSpeed < -6) carSpeed = -6;
    const car = cars[carIndex];
    if (!car) return;
    const moving = Math.abs(carSpeed) > 0.4 ? Math.sign(carSpeed) : 0;
    car.yaw -= s * moving * 1.5 * dt;
    const nx = car.x + Math.sin(car.yaw) * carSpeed * dt;
    const nz = car.z - Math.cos(car.yaw) * carSpeed * dt;
    if (!blocked(nx, nz)) {
      car.x = nx;
      car.z = nz;
    } else carSpeed *= -0.25;
    const steer = s * moving;
    car.lean += (steer * 0.28 - car.lean) * Math.min(1, dt * 8);
    const bob = Math.sin(clock * 5) * 0.05;
    car.group.position.set(car.x, 0.12 + bob, car.z);
    car.group.rotation.y = Math.PI / 2 - car.yaw;
    for (const child of car.group.children) {
      if (child.name === "wheel") child.rotation.z += carSpeed * dt * 1.4;
    }
    car.group.rotation.z = -car.lean;
    body.x = car.x;
    body.y = 0.2;
    body.z = car.z;
    body.yaw = car.yaw;
    body.vy = 0;
  }

  function carBlocks(x: number, y: number, z: number) {
    if (driving || y > 2.2) return false;
    return cars.some((car, index) => index !== carIndex && Math.abs(x - car.x) < 1.55 && Math.abs(z - car.z) < 1.55);
  }

  function consumeLook(body: Body) {
    if (lookX === 0 && lookY === 0) return;
    if (driving) {
      chaseYaw += lookX;
      chasePitch += lookY;
      chasePitch = Math.max(-0.2, Math.min(0.7, chasePitch));
    } else {
      body.yaw += lookX;
      body.pitch -= lookY;
      const limit = Math.PI / 2 - 0.02;
      if (body.pitch > limit) body.pitch = limit;
      if (body.pitch < -limit) body.pitch = -limit;
    }
    lookX = 0;
    lookY = 0;
  }

  function guidePoint() {
    if (phase <= 0) return anchors.find((item) => item.id === "shop");
    if (phase === 1) return anchors.find((item) => item.id === "hall");
    return anchors.find((item) => item.id === "project-0");
  }

  function tickJobs(body: Body) {
    if (!playing) {
      if (beacon) beacon.visible = false;
      return;
    }
    let target: { x: number; z: number } | null = null;
    if (job === "courier" && phase === 0) target = { x: 0, z: 24 };
    if (job === "courier" && phase === 1) target = anchors.find((item) => item.id === "shop") ?? null;
    if (job === "taxi" && phase === 0) target = { x: 0, z: 80 };
    if (job === "taxi" && phase === 1) target = anchors.find((item) => item.id === "cafe") ?? null;
    if (job === "guide") target = guidePoint() ?? null;
    if (job === "mechanic") target = { x: 36, z: 50 };
    if (job === "photographer") target = phase === 0 ? { x: 0, z: 12 } : { x: 0, z: -6 };
    if (job === "promoter") target = phase === 0 ? (anchors.find((item) => item.id === "hall") ?? null) : { x: 8, z: 70 };
    if (job === "dock") target = anchors.find((item) => item.id === "dock") ?? { x: 0, z: 148 };
    if (job === "dj") target = anchors.find((item) => item.id === "hall") ?? null;
    if (job === "banker") target = anchors.find((item) => item.id === "bank") ?? null;
    if (beacon) {
      beacon.visible = !!target && !driving;
      if (target) {
        beacon.position.set(target.x, 1.2 + Math.sin(clock * 3) * 0.2, target.z);
        beacon.rotation.y = clock;
      }
    }
    if (packageMesh) {
      packageMesh.visible = job === "courier";
      if (job === "courier" && phase === 0 && target) packageMesh.position.set(target.x, 0.7, target.z);
      if (job === "courier" && phase === 1) packageMesh.position.set(body.x, body.y + 1.15, body.z + 0.35);
    }
    if (rider) {
      rider.visible = job === "taxi" && !riderOn;
      if (rider.visible) rider.position.set(0, 0, 80);
    }
    if (!target || paused) return;
    const reachDist = job === "courier" && phase === 0 ? 5.2 : job === "courier" ? 6 : driving ? 4.2 : 2.8;
    let reach = Math.hypot(body.x - target.x, body.z - target.z) < reachDist;
    if (job === "courier" && phase === 1 && atShop(body)) reach = true;
    if (!reach) return;
    if (job === "courier" && phase === 0) {
      phase = 1;
      say("Package picked up. Take it to OrbitX Shop.");
    } else if (job === "courier" && phase === 1) {
      void finishJob("courier");
    } else if (job === "taxi" && phase === 0 && driving) {
      phase = 1;
      riderOn = true;
      say("Rider aboard.");
    } else if (job === "taxi" && phase === 1 && driving) {
      riderOn = false;
      void finishJob("taxi");
    } else if (job === "guide") {
      phase += 1;
      if (phase >= 3) void finishJob("guide");
      else say("Checkpoint reached.");
    } else if (job === "mechanic") {
      void finishJob("mechanic");
    } else if (job === "photographer") {
      phase += 1;
      if (phase >= 2) void finishJob("photographer");
      else say("Fountain shot. Now the tower.");
    } else if (job === "promoter") {
      phase += 1;
      if (phase >= 2) void finishJob("promoter");
      else say("Hall visited. Head to the ad kiosk.");
    } else if (job === "dock" || job === "dj" || job === "banker") {
      void finishJob(job);
    }
  }

  function atShop(body: Body) {
    const zone = zoneAt(body);
    if (zone?.kind === "shop") return true;
    const door = anchors.find((item) => item.id === "shop");
    return !!door && Math.hypot(body.x - door.x, body.z - door.z) < 6;
  }

  const tourStops = [
    { x: 0, z: 12, text: "Tour: stand by the fountain" },
    { x: 18, z: 54, text: "Tour: step into OrbitX Shop" },
    { x: -18, z: 54, text: "Tour: step into Cafe Nova" },
    { x: 54, z: 18, text: "Tour: step into the Community Hall" },
    { x: 0, z: -8, text: "Tour: stand under the ORBITX tower" },
    { x: 0, z: 148, text: "Tour: reach the harbor office" },
  ];

  function tickTour(body: Body) {
    const step = world.online ? world.mission : tourStep;
    const stop = tourStops[step];
    if (!stop || tourLock || paused) return;
    if (Math.hypot(body.x - stop.x, body.z - stop.z) > 4) return;
    tourLock = true;
    if (!world.online) {
      tourStep += 1;
      say(earn(wallet, step === tourStops.length - 1 ? 80 : 20, "City tour"));
      tourLock = false;
      return;
    }
    void world.advanceMission(step).then((data) => {
      applyMe();
      say(String(data.message || "Tour stop paid."));
    }).catch((err: unknown) => {
      say(err instanceof Error ? err.message : "The city held that stop.");
    }).finally(() => {
      tourLock = false;
    });
  }

  let tourStep = 0;

  async function pay(id: string) {
    const amounts: Record<string, number> = { courier: 45, taxi: 70, guide: 60, mechanic: 55, photographer: 40, promoter: 50, dock: 65, dj: 55, banker: 50 };
    if (!world.online) {
      say(earn(wallet, amounts[id], jobTitle(id)));
      return true;
    }
    try {
      const data = await world.earn(id);
      applyMe();
      say(String(data.message || "Paid."));
      return true;
    } catch (err) {
      say(err instanceof Error ? err.message : "The city held the pay.");
      return false;
    }
  }

  async function finishJob(id: string) {
    if (performance.now() < payAfter || job !== id) return;
    payAfter = performance.now() + 1500;
    const ok = await pay(id);
    if (!ok || job !== id) return;
    job = "";
    phase = 0;
  }

  function burst(x: number, y: number, z: number) {
    for (const spark of sparks) {
      if (spark.life > 0) continue;
      spark.life = 1.2 + Math.random();
      spark.mesh.visible = true;
      spark.mesh.position.set(x, y, z);
      spark.vx = (Math.random() - 0.5) * 14;
      spark.vy = 6 + Math.random() * 10;
      spark.vz = (Math.random() - 0.5) * 14;
      if (sparks.filter((item) => item.life > 0).length > 8) break;
    }
  }

  function after(dt: number, body: Body, camera: PerspectiveCamera, opts: { orbit: boolean; fountain: { x: number; z: number } }) {
    try {
    clock += dt;
    lastBody = body;
    flyFlag = body.flying;
    consumeLook(body);
    if (!opts.orbit) {
      tickJobs(body);
      tickTour(body);
    }
    for (const npc of npcs) {
      const sway = Math.sin(clock * 0.6 + npc.phase) * 1.4;
      npc.group.position.set(npc.x + sway, 0, npc.z);
      npc.group.rotation.y = clock * 0.2 + npc.phase;
    }
    if (eventLeft > 0) {
      eventLeft -= dt;
      if (eventLeft <= 0) {
        eventLeft = 0;
        burstLeft = 7;
        say("Lights up.");
      }
    }
    if (burstLeft > 0) {
      burstLeft -= dt;
      if (Math.random() > 0.45) burst(opts.fountain.x + (Math.random() - 0.5) * 4, 4, opts.fountain.z);
    }
    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      spark.vy -= 8 * dt;
      spark.mesh.position.x += spark.vx * dt;
      spark.mesh.position.y += spark.vy * dt;
      spark.mesh.position.z += spark.vz * dt;
      const s = Math.max(0.05, spark.life * 0.35);
      spark.mesh.scale.setScalar(s);
      if (spark.life <= 0) spark.mesh.visible = false;
    }
    const now = performance.now();
    for (const [id, remote] of remotes) {
      if (now - remote.seen > 8000) {
        root.remove(remote.group);
        remotes.delete(id);
        continue;
      }
      const person = remote.group.children[0] as Group;
      paintPerson(person, false, remote.state.look || "tjr", remote.state.color, remote.state.hat);
      const blend = Math.min(1, dt * 8);
      remote.group.position.x += (remote.state.x - remote.group.position.x) * blend;
      remote.group.position.y += (remote.state.y - remote.group.position.y) * blend;
      remote.group.position.z += (remote.state.z - remote.group.position.z) * blend;
      remote.group.rotation.y = remote.state.yaw;
      person.rotation.y = Math.PI - 2 * remote.state.yaw;
      const ring = person.getObjectByName("ring");
      if (ring) ring.visible = !!remote.state.speaking;
      let ride = remote.group.getObjectByName("ride");
      if (remote.state.car) {
        if (!ride) {
          ride = makeCar(remote.state.skin || "black", 1);
          ride.name = "ride";
          remote.group.add(ride);
        }
        ride.visible = true;
        person.visible = false;
      } else {
        if (ride) ride.visible = false;
        person.visible = true;
        if (remote.state.emote) person.rotation.y = Math.PI - 2 * remote.state.yaw + Math.sin(clock * 6) * 0.4;
      }
    }
    if (localBody) {
      localBody.visible = camMode !== "first" && !driving;
      localBody.position.set(body.x, body.y, body.z);
      localBody.rotation.y = Math.PI - body.yaw;
      paintPerson(localBody, true);
      const ring = localBody.getObjectByName("ring");
      if (ring) ring.visible = world.speaking;
    }
    prompt = "";
    if (playing && !paused && !opts.orbit) {
      const zone = zoneAt(body);
      insideName = zone?.id ?? "";
      if (driving) prompt = "Press E to get out";
      else if (nearestCar(body, 7) >= 0) prompt = "Press E to drive";
      else if (zone && nearService(body, zone)) prompt = zone.kind === "shop" ? "Press E to open the shop" : zoneTitle(zone);
      else if (zone) prompt = zone.kind === "shop" ? "OrbitX Shop — counter at the back" : zoneTitle(zone);
      else {
        const anchor = nearestAnchor(body, 3.3);
        if (anchor) {
          const title = anchor.kind === "project" ? projectName(anchor.slot) : anchor.name;
          const walkIn = anchor.kind === "shop" || anchor.kind === "cafe" || anchor.kind === "hall" || anchor.kind === "project" || anchor.kind === "bank" || anchor.kind === "garage" || anchor.kind === "arcade" || anchor.kind === "market" || anchor.kind === "dock";
          prompt = walkIn ? `Walk in — ${title}` : `Press E — ${title}`;
        }
      }
    }
    let tookCamera = false;
    if (!opts.orbit && (playing || localBody)) {
      tookCamera = placeCamera(camera, body);
    }
    if (playing && !opts.orbit) {
      const pose = {
        id: world.id || net.id,
        name: wallet.name,
        x: driving ? (cars[carIndex]?.x ?? body.x) : body.x,
        y: body.y,
        z: driving ? (cars[carIndex]?.z ?? body.z) : body.z,
        yaw: driving ? (cars[carIndex]?.yaw ?? body.yaw) : body.yaw,
        color: wallet.color,
        hat: wallet.hat,
        look: lookId,
        car: driving,
        skin: wallet.car,
        speaking: world.speaking,
        emote: Date.now() < world.emoteUntil ? world.emote : "",
        lobby: world.lobby,
      };
      if (world.online) {
        world.push(pose);
        voiceTick();
        for (const person of world.people) {
          if (!person?.id || person.id === world.id || person.id === net.id) continue;
          upsertRemote(person);
        }
        const stamp = JSON.stringify(world.bookings);
        if (stamp !== bookStamp) {
          bookStamp = stamp;
          for (const id of boards.keys()) redrawBoard(id);
        }
      } else net.sendState(pose);
    }
    if (Math.floor(clock * 5) !== Math.floor((clock - dt) * 5)) publish();
    return tookCamera;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      const slot = window as unknown as { __ORBITX_ERR?: string };
      if (!slot.__ORBITX_ERR) slot.__ORBITX_ERR = text;
      return false;
    }
  }

  const dressed = new WeakMap<Group, string>();
  function paintPerson(group: Group, trust: boolean, id = lookId, color = wallet.color, hat = wallet.hat) {
    const key = `${id}|${color}|${hat}|${trust ? wallet.owned.join(",") : ""}|${looksReady()}`;
    if (dressed.get(group) === key) return;
    dressed.set(group, key);
    dressPerson(group, lookById(id), { color, hat, owned: trust ? wallet.owned : [], trustOwned: trust });
  }

  function camTitle() {
    if (driving && camMode === "first") return "Cockpit";
    if (camMode === "first") return "First person";
    if (camMode === "far") return "Far camera";
    if (camMode === "selfie") return "Selfie";
    return "Over the shoulder";
  }

  function cameraBlocked(x: number, y: number, z: number) {
    for (const c of activeCols) {
      if (x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) return true;
    }
    return false;
  }

  function pullCamera(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) {
    const steps = 18;
    let safe = { x: from.x, y: from.y, z: from.z };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      };
      if (cameraBlocked(p.x, p.y, p.z)) return safe;
      safe = p;
    }
    return safe;
  }

  function placeCamera(camera: PerspectiveCamera, body: Body) {
    const focusY = body.y + 1.35;
    hands.visible = false;
    if (!driving && camMode === "first") {
      camera.position.set(body.x, body.y + 1.62, body.z);
      camera.up.set(0, 1, 0);
      const cp = Math.cos(body.pitch);
      const sp = Math.sin(body.pitch);
      camera.lookAt(body.x + Math.sin(body.yaw) * cp, body.y + 1.62 + sp, body.z - Math.cos(body.yaw) * cp);
      handMat.color.set(lookById(lookId).colors.skin);
      hands.visible = true;
      hands.position.copy(camera.position);
      hands.quaternion.copy(camera.quaternion);
      return true;
    }
    if (driving) {
      const car = cars[carIndex];
      if (!car) return false;
      const yaw = car.yaw;
      const fx = Math.sin(yaw);
      const fz = -Math.cos(yaw);
      if (camMode === "first") {
        camera.position.set(car.x - fx * 0.2, 1.15, car.z - fz * 0.2);
        camera.up.set(0, 1, 0);
        camera.lookAt(car.x + fx * 12, 1.15 - chasePitch * 2.2, car.z + fz * 12);
        return true;
      }
      const dist = (camMode === "selfie" ? 5.2 : camMode === "far" ? 11 : 7.2) * camZoom;
      const side = camMode === "shoulder" ? 1.3 : 0;
      const sign = camMode === "selfie" ? 1 : -1;
      const lookYaw = yaw + chaseYaw;
      const desired = {
        x: car.x + Math.sin(lookYaw) * dist * sign + Math.cos(lookYaw) * side,
        y: camMode === "selfie" ? 2.2 : 3.6 + chasePitch * 1.6,
        z: car.z - Math.cos(lookYaw) * dist * sign + Math.sin(lookYaw) * side,
      };
      const pulled = pullCamera({ x: car.x, y: 1.3, z: car.z }, desired);
      camera.position.set(pulled.x, Math.max(1.4, pulled.y), pulled.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(car.x, 0.9, car.z);
      return true;
    }
    const dist = (camMode === "selfie" ? 2.6 : camMode === "far" ? 9.2 : 4.8) * camZoom;
    const side = camMode === "shoulder" ? 0.85 : 0;
    const pitch = Math.max(-0.45, Math.min(0.7, body.pitch));
    const fx = Math.sin(body.yaw);
    const fz = -Math.cos(body.yaw);
    const rx = Math.cos(body.yaw);
    const rz = Math.sin(body.yaw);
    const sign = camMode === "selfie" ? 1 : -1;
    const desired = {
      x: body.x + fx * dist * sign * Math.cos(pitch) + rx * side,
      y: body.y + (camMode === "selfie" ? 1.75 : 1.7) + (camMode === "selfie" ? 0 : Math.sin(pitch) * dist * 0.45),
      z: body.z + fz * dist * sign * Math.cos(pitch) + rz * side,
    };
    const pulled = pullCamera({ x: body.x, y: focusY, z: body.z }, desired);
    camera.position.set(pulled.x, Math.max(body.y + 0.4, pulled.y), pulled.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(body.x, camMode === "selfie" ? body.y + 1.5 : focusY, body.z);
    return true;
  }

  function applyShot(shot: string | null, body: Body) {
    if (!shot || shot === "spawn" || shot === "air") return;
    if (shot === "drive") {
      enterCar(body, 0);
      const car = cars[0];
      if (car) {
        car.x = 0;
        car.z = 52;
        car.yaw = 0;
        carSpeed = 0;
        body.x = 0;
        body.z = 52;
      }
    } else if (shot === "inside") {
      body.x = 14;
      body.y = 0;
      body.z = 54;
      body.yaw = Math.PI / 2;
      body.pitch = 0.02;
    } else if (shot === "cafe") {
      body.x = -14;
      body.y = 0;
      body.z = 54;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.02;
    } else if (shot === "hall") {
      body.x = 50;
      body.y = 0;
      body.z = 18;
      body.yaw = Math.PI / 2;
      body.pitch = 0.04;
    } else if (shot === "shop") {
      panel = "shop";
      body.x = 16;
      body.y = 0;
      body.z = 54;
      body.yaw = Math.PI / 2;
      body.pitch = 0;
      if (!wallet.owned.includes("color-gold")) {
        const result = spend(wallet, 40, "color-gold");
        if (result.ok) wallet.color = "gold";
        say(result.message);
      }
    } else if (shot === "district") {
      body.x = -60;
      body.y = 0;
      body.z = 6;
      body.yaw = -0.95;
      body.pitch = 0.22;
    } else if (shot === "billboard") {
      book("plaza-east", 7, "OrbitX", "BOUGHT WITH A BURN");
      body.x = -2;
      body.y = 0;
      body.z = 50;
      body.yaw = Math.PI / 2.4;
      body.pitch = 0.52;
    } else if (shot === "players") {
      body.x = 4;
      body.y = 0;
      body.z = 20;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "meet") {
      body.x = -3.2;
      body.y = 0;
      body.z = 20;
      body.yaw = Math.PI / 2;
      body.pitch = 0;
    } else if (shot === "courier") {
      job = "courier";
      phase = 0;
      void world.jobStart("courier");
      body.x = 0;
      body.y = 0;
      body.z = 24;
      body.yaw = 0;
      window.setTimeout(() => {
        if (job !== "courier" || !lastBody) return;
        lastBody.x = 16;
        lastBody.y = 0;
        lastBody.z = 54;
      }, 4600);
    } else if (shot === "car") {
      body.x = 4.2;
      body.y = 0;
      body.z = 46;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "sign-back") {
      body.flying = true;
      body.x = 0;
      body.y = 42;
      body.z = -52;
      body.yaw = Math.PI;
      body.pitch = 0.42;
    }
    publish();
  }

  async function book(id: string, days: number, project = wallet.name, text = "NEW CAMPAIGN") {
    if (world.online) {
      try {
        const data = await world.book(id, days, project, text);
        applyMe();
        const message = String(data.message || "Booked.");
        say(message);
        return message;
      } catch (err) {
        const message = err instanceof Error ? err.message : "The city refused the booking.";
        say(message);
        return message;
      }
    }
    const price = AD_PRICE[days] ?? 25;
    const result = spend(wallet, price, `ad-${id}-${Date.now()}`);
    if (!result.ok) {
      say(result.message);
      return result.message;
    }
    const start = new Date();
    const end = new Date(start.getTime() + days * 86400000);
    const info: BillboardInfo = {
      id,
      project,
      text,
      image: "",
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
    const all = bookings();
    all[id] = info;
    localStorage.setItem(BOOK_KEY, JSON.stringify(all));
    redrawBoard(id);
    const message = `${result.message} Billboard ${id} is up for ${days} day${days === 1 ? "" : "s"}.`;
    say(message);
    return message;
  }

  async function buy(id: string) {
    const item = SHOP.find((entry) => entry.id === id);
    if (!item) return "Unknown item.";
    if (world.online) {
      try {
        const data = await world.spend(id);
        applyMe();
        equip(item);
        say(String(data.message || "Bought."));
        return String(data.message || "Bought.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "The city refused the purchase.";
        say(message);
        return message;
      }
    }
    if (wallet.owned.includes(id)) {
      equip(item);
      say("Equipped.");
      return "Equipped.";
    }
    const result = spend(wallet, item.price, id);
    if (result.ok) equip(item);
    say(result.message);
    return result.message;
  }

  function equip(item: ShopItem) {
    if (item.kind === "color") wallet.color = item.value;
    if (item.kind === "hat") wallet.hat = item.value;
    if (item.kind === "car") {
      wallet.car = item.value;
      if (carIndex >= 0) retint(cars[carIndex].group, item.value);
    }
    saveWallet(wallet);
    if (localBody) dressed.delete(localBody);
  }

  return {
    begin,
    cols: () => activeCols,
    blocks: carBlocks,
    driving: () => driving,
    paused: () => paused,
    typing: () => typing,
    stickActive: () => Math.hypot(stickX, stickY) > 0.15,
    jumpHeld: () => holdJump,
    downHeld: () => holdDown,
    indoors: () => "",
    moveAxes,
    drive,
    after,
    interact,
    consumeLook,
    setStick(x: number, y: number) {
      stickX = x;
      stickY = y;
    },
    addLook(dx: number, dy: number) {
      lookX += dx;
      lookY += dy;
    },
    hold(action: "jump" | "down", down: boolean) {
      if (action === "jump") holdJump = down;
      else holdDown = down;
    },
    toggleFly(body?: Body) {
      const who = body ?? lastBody;
      if (!who || driving) return;
      who.flying = !who.flying;
      who.vy = 0;
    },
    setPaused(on: boolean) {
      paused = on;
      if (on) {
        stickX = 0;
        stickY = 0;
      }
    },
    setTyping(on: boolean) {
      typing = on;
    },
    subscribe(fn: (snap: Snap) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    buy,
    book(id: string, days: number, text: string) {
      return book(id, days, wallet.name || "Demo project", text || "NEW CAMPAIGN");
    },
    cycleCamera() {
      const index = CAMS.indexOf(camMode);
      camMode = CAMS[(index + 1) % CAMS.length];
      localStorage.setItem("orbitx-cam", camMode);
      say(camTitle());
    },
    zoomCamera(factor: number) {
      if (camMode === "first") return;
      camZoom = Math.min(1.85, Math.max(0.55, camZoom * factor));
      localStorage.setItem("orbitx-zoom", String(Math.round(camZoom * 100) / 100));
    },
    setLooking(on: boolean) {
      lookOn = on;
    },
    startJob(id: string) {
      job = id;
      phase = 0;
      riderOn = false;
      void world.jobStart(id);
      say(`${jobTitle(id)} started.`);
    },
    startEvent() {
      eventLeft = 8;
      say("Countdown started.");
    },
    sendChat(text: string, scope: "global" | "near" = chatScope) {
      const clean = text.trim().slice(0, 180);
      if (!clean) return;
      chatScope = scope;
      if (world.online) {
        void world.say(clean, scope, lastBody?.x ?? 0, lastBody?.z ?? 0);
      } else {
        chat.push({ id: net.id, name: wallet.name, text: clean, self: true });
        if (chat.length > 24) chat.shift();
        net.sendChat(wallet.name, clean);
      }
      publish();
    },
    setName(name: string) {
      wallet.name = name.trim().slice(0, 18) || wallet.name;
      saveWallet(wallet);
      if (world.online) void world.rename(wallet.name).then(() => applyMe());
      publish();
    },
    setChatScope(scope: "global" | "near") {
      chatScope = scope;
      publish();
    },
    inspect(id: string) {
      profileId = id;
      panel = "phone";
      publish();
    },
    emote(name: string) {
      world.emote = name;
      world.emoteUntil = Date.now() + 1800;
    },
    joinLobby(id: string) {
      void joinVoice(id);
      say(id ? `Voice lobby: ${id}` : "Left the voice lobby.");
    },
    leaveLobby() {
      leaveVoice();
      say("Left the voice lobby.");
    },
    setMuted(on: boolean) {
      muteMic(on);
      publish();
    },
    setDeafened(on: boolean) {
      deafenMic(on);
      publish();
    },
    setPushToTalk(on: boolean) {
      armTalk(on);
      publish();
    },
    setTalking(on: boolean) {
      holdTalk(on);
    },
    setVolume(id: string, value: number) {
      volumeFor(id, value);
    },
    friendAsk(id: string) {
      void world.friendAsk(id).then((data) => say(String(data.message || "Request sent."))).catch((err) => say(err.message));
    },
    friendAccept(id: string) {
      void world.friendAccept(id).then((data) => {
        applyMe();
        say(String(data.message || "Friend added."));
      }).catch((err) => say(err.message));
    },
    partyInvite(id = "") {
      void world.partyInvite(id).then(() => say(id ? "Party invite sent." : "Party started.")).catch((err) => say(err.message));
    },
    addEvent(title: string, where: string, when: string, detail: string) {
      void world.addEvent(title, where, when, detail).then(() => say("Event posted."));
    },
    travel(id: string) {
      const anchor = anchors.find((item) => item.id === id);
      if (!anchor || !lastBody) return;
      lastBody.x = anchor.x;
      lastBody.y = 0;
      lastBody.z = anchor.z;
      lastBody.yaw = anchor.yaw;
      lastBody.pitch = 0.08;
      lastBody.vy = 0;
      paused = false;
      say(anchor.name);
    },
    cycleTime() {
      timeName = timeName === "sunset" ? "night" : timeName === "night" ? "day" : "sunset";
      publish();
    },
    timeOfDay() {
      return timeName;
    },
    setQuality(next: "low" | "medium" | "high") {
      localStorage.setItem("orbitx-quality", next);
      say(`Quality ${next}. Reload to apply shadows and lights.`);
    },
    request(name: PanelName | "close") {
      if (name === "close") {
        paused = false;
        panel = "";
      } else panel = name;
      publish();
    },
    applyShot,
    quote: (price: number) => burnAmount(price),
    destroy() {
      world.stop();
      net.close();
      scene.remove(root);
      listeners.clear();
    },
  };
}

export type Runtime = ReturnType<typeof createRuntime>;

declare global {
  interface Window {
    __ORBITX_SNAP?: Snap;
  }
}
