import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type Material,
  type PerspectiveCamera,
  type Scene,
} from "three";
import type { Anchor, Art, BoardSlot, City, Collider, Lift, Zone } from "./city";
import {
  BUSK_BASE,
  BUSK_BEATS,
  BUSK_BEAT_MS,
  BUSK_PER_HIT,
  BUSK_SPOT,
  CASINO_COST,
  CASINO_TABLE,
  CLUB_DANCE_SPOT,
  DANCE_BEAT_MS,
  DANCE_BEATS,
  DANCE_SPOT,
  DEMO_AD_PRICE,
  HOTEL_COST,
  HOTEL_REST_MIN,
  MUSEUM_BONUS,
  MUSEUM_EXHIBITS,
  MUSEUM_REWARD,
  NPC_DEFAULT_LINES,
  NPC_DEFAULT_PATROL,
  NPC_LINES,
  PARCEL_DELIVER,
  PARCEL_PICKUP,
  PARCEL_REWARD,
  PHOTO_REWARD,
  PHOTO_SPOTS,
  STADIUM_BASE,
  STADIUM_FINISH_X,
  STADIUM_MIN,
  STADIUM_PER_SEC,
  STADIUM_START,
  WASH_COOLDOWN_MS,
  WASH_MS,
  WASH_PAY,
  WASH_SPOT,
  WISH_SPOT,
  type BillboardInfo,
  type CityContent,
  type EventInfo,
  type MuseumExhibit,
  type PhotoSpot,
  loadContent,
} from "./content";
import { burnAmount, earn, loadWallet, saveWallet, spend } from "./economy";
import { createNet, type ChatLine, type NetAdapter, type NetState } from "./net";
import { allLooks, dressPerson, loadLooks, lookById, lookName, looksReady } from "./avatar";
import { GOLD, MATERIALS } from "./materials";
import { accountToken, readAccount } from "../auth";
import { world, type CityMe } from "./world";
import {
  buildVehicle,
  driveParamsFor,
  getVehicle,
  FLY_CONTROLS,
  VEHICLE_COLORS,
  type DriveParams,
  type OwnedVehicle,
} from "./vehicles";
import { ensureWalker, animateWalk, makeCameraSmoother } from "./movement";
import { triggerHaptic, isHapticsEnabled, setHapticsEnabled } from "./haptics";
import { emergencyJobById, jobObjective, jobTargetFor } from "./emergency";
import {
  buyHomeLocal,
  freshHomesSave,
  homeById,
  type OwnedHome,
  type PlayerHomesSave,
} from "./homes";
import {
  isUniverseId,
  universeDisplayName,
  universeJoin,
  universeTravel,
  type UniverseId,
} from "./multiverse";
import { bridgeGateFor, stateById } from "./states";
import {
  EMOTES,
  FURNITURE,
  GATES,
  type DailyCard,
  type Leaders,
  type LotCard,
  type MarketCard,
  type NoteCard,
  type RaceCard,
} from "./life";
import { createLifeView } from "./lifeview";
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

export type PanelName = "shop" | "jobs" | "ads" | "events" | "chat" | "menu" | "phone" | "daily" | "wallet" | "leaders" | "arcade" | "hq" | "race" | "home" | "lift" | "talk" | "radio" | "offices" | "garage" | "multiverse" | "emergency" | "district-offices" | "missions" | "myprops";

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

// One office lease as the server returns it for "my-properties" (the
// publicOfficeClaim shape). The client resolves the suite's tower, floor
// and display name from its own catalogs.
export interface MyPropertyClaim {
  suite: string;
  server: number;
  owner_id: string;
  owner_name: string;
  project: string;
  logo: string;
  site: string;
  term_days: number;
  start: string;
  until: string;
  price: number;
  claimed_at: string;
}

export interface AdOrder {
  id: string;
  board: string;
  days: number;
  project: string;
  text: string;
  status: string;
  priceSol: number;
  orbitxAmount: string;
  swapSignature: string;
  burnSignature: string;
  swapUrl: string;
  burnUrl: string;
  error: string;
  expiresAt: string;
}

// A track on the public radio. Playback is personal: the file plays on the
// device that pressed play and is never broadcast to other players.
export interface RadioTrack {
  id: string;
  name: string;
  uploader: string;
  uploaderId: string;
  path: string;
  url: string;
  createdAt: string;
}

export interface MissionCard {
  id: string;
  name: string;
  desc: string;
  reward: number;
  steps: string[];
  step: number;
  done: boolean;
  unlocked: boolean;
}

// Shop catalog item — same shape as content.ts ShopItem, plus the "trail"
// kind the server sells (a glowing ring under the avatar). The canonical
// 22-item catalog lives in SHOP_CATALOG below (fix-client); it mirrors
// api/city.js CATALOG, which is the price authority.
export interface ShopCatalogItem {
  id: string;
  kind: "color" | "car" | "hat" | "trail";
  name: string;
  value: string;
  price: number;
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
  shop: ShopCatalogItem[];
  eventLabel: string;
  panel: PanelName | "";
  lift: { name: string; floors: number[]; stops: string[]; current: number } | null;
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
  lots: LotCard[];
  leaders: Leaders;
  daily: DailyCard | null;
  race: RaceCard;
  notes: NoteCard[];
  market: MarketCard | null;
  mintSet: boolean;
  walletKey: string;
  walletNote: string;
  holder: boolean;
  account: boolean;
  email: string;
  avatar: string;
  chainAddress: string;
  chainSol: number | null;
  chainOrbitx: number | null;
  chainNetwork: string;
  chainHistory: { id: string; status: string; amount: string; destination: string; signature: string }[];
  chainQr: string;
  meId: string;
  jobStreak: number;
  business: { kind: string; started: number; lastCollect: number } | null;
  spectator: boolean;
  hideHud: boolean;
  hideNames: boolean;
  hideChat: boolean;
  orbit: boolean;
  clean: boolean;
  wheel: boolean;
  wheelIndex: number;
  decorate: boolean;
  decorKind: string;
  hqIndex: number;
  banner: string;
  talk: { name: string; role: string; line: string; index: number; total: number; jobId: string; jobName: string; offerLabel: string } | null;
  photos: { taken: number; spots: string[] };
  wishes: number;
  // Mission chain + new earning (fix-client): server is the authority.
  missions: MissionCard[];
  missionMsg: string;
  missionsLoaded: boolean;
  // Busk: epoch ms when the 60s server cooldown ends (0 = ready).
  buskReadyAt: number;
  // Photo Safari: server place ids photographed today (max 120/day).
  photosToday: string[];
  photoMsg: string;
  // Trail the player owns ("none" | "neon" | "gold") — renders as the
  // avatar ground ring.
  trail: string;
  // GTA expansion: garage / multiverse / emergency / district panels.
  vehicles: OwnedVehicle[];
  activeVehicle: string | null;
  universe: { id: number; name: string; isHome: boolean } | null;
  haptics: boolean;
  emergency: { kind: string; name: string } | null;
  districtOffice: string;
}

interface Remote {
  state: NetState;
  seen: number;
  group: Group;
  prevX: number;
  prevZ: number;
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
  red: 0xd43a2e,
  silver: 0xc9ced6,
};

// City tour — CANONICAL pay schedule, per step, in order (api/city.js
// MISSIONS is the authority): plaza 15, shop 20, cafe 20, hall 25,
// tower 30, dock 80. The offline path must pay this exact schedule,
// never a flat 20/step.
const TOUR_PAY = [15, 20, 20, 25, 30, 80];

// Shop — the canonical 22 items, City Sol, mirroring api/city.js CATALOG
// (the server is the price authority; this list is display + the offline
// price check). content.ts SHOP only carries 13 of these and has
// hat-visor's value wrong ("cap" — the server grants "visor"), so the
// panel and the offline buy must read this catalog, not SHOP.
const SHOP_CATALOG: ShopCatalogItem[] = [
  { id: "color-white", kind: "color", name: "Cloud suit", value: "white", price: 20 },
  { id: "color-gold", kind: "color", name: "Gold suit", value: "gold", price: 40 },
  { id: "color-cyan", kind: "color", name: "Cyan suit", value: "cyan", price: 30 },
  { id: "color-sunset", kind: "color", name: "Sunset suit", value: "sunset", price: 35 },
  { id: "color-black", kind: "color", name: "Night suit", value: "black", price: 25 },
  { id: "color-red", kind: "color", name: "Ember suit", value: "red", price: 25 },
  { id: "color-silver", kind: "color", name: "Silver suit", value: "silver", price: 30 },
  { id: "car-black", kind: "car", name: "Night hover", value: "black", price: 50 },
  { id: "car-white", kind: "car", name: "Pearl hover", value: "white", price: 50 },
  { id: "car-gold", kind: "car", name: "Gold hover", value: "gold", price: 80 },
  { id: "car-cyan", kind: "car", name: "Cyan hover", value: "cyan", price: 60 },
  { id: "car-red", kind: "car", name: "Ember hover", value: "red", price: 55 },
  { id: "car-silver", kind: "car", name: "Silver hover", value: "silver", price: 55 },
  { id: "hat-cap", kind: "hat", name: "Cap", value: "cap", price: 15 },
  { id: "hat-antenna", kind: "hat", name: "Antenna", value: "antenna", price: 25 },
  { id: "hat-crown", kind: "hat", name: "Crown", value: "crown", price: 100 },
  { id: "hat-visor", kind: "hat", name: "Visor", value: "visor", price: 20 },
  { id: "hat-tophat", kind: "hat", name: "Top Hat", value: "tophat", price: 60 },
  { id: "hat-beanie", kind: "hat", name: "Beanie", value: "beanie", price: 30 },
  { id: "hat-headphones", kind: "hat", name: "Headphones", value: "headphones", price: 45 },
  { id: "trail-neon", kind: "trail", name: "Neon trail", value: "neon", price: 50 },
  { id: "trail-gold", kind: "trail", name: "Gold trail", value: "gold", price: 75 },
];

// Photo Safari landmarks (server place ids) — the 8 spots the photo op
// pays for, 15 City Sol each, once per landmark per day. Coords are the
// door/spot the player stands at; the radius is generous so the panel's
// "Take photo" works from the approach, not only dead-centre.
export const PHOTO_LANDMARKS: { id: string; name: string; x: number; z: number }[] = [
  { id: "plaza", name: "Plaza fountain", x: 0, z: 12 },
  { id: "tower", name: "ORBITX Tower", x: -30, z: 8 },
  { id: "dock", name: "Harbor pier", x: 0, z: 232 },
  { id: "hall", name: "Community Hall", x: 41.6, z: 90 },
  { id: "cafe", name: "Cafe Nova", x: -5.6, z: 54 },
  { id: "shop", name: "OrbitX Shop", x: 5.6, z: 54 },
  { id: "market", name: "Night Market", x: -18, z: 77.6 },
  { id: "museum", name: "OrbitX Museum", x: -99, z: 176 },
];
// How the client recognises the mission "visit" places. Tour-stop coords
// and door anchors disagree by a few units (the hall door is at 41.6, 90,
// the tour stop at 54, 18), so each place lists every point that counts.
const MISSION_PLACE_POINTS: { id: string; x: number; z: number; r: number }[] = [
  { id: "plaza", x: 0, z: 12, r: 6 },
  { id: "shop", x: 18, z: 54, r: 6 },
  { id: "shop", x: 5.6, z: 54, r: 6 },
  { id: "cafe", x: -18, z: 54, r: 6 },
  { id: "cafe", x: -5.6, z: 54, r: 6 },
  { id: "hall", x: 54, z: 18, r: 6 },
  { id: "hall", x: 41.6, z: 90, r: 6 },
  { id: "tower", x: 0, z: -8, r: 6 },
  { id: "dock", x: 0, z: 148, r: 6 },
  { id: "dock", x: 0, z: 210.6, r: 6 },
  { id: "market", x: -18, z: 77.6, r: 6 },
];

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

function paintBillboard(face: BillboardInfo) {
  if (!face.image) return paint([face.project, face.text], `${face.start} → ${face.end}`);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  if (ctx) {
    // Text board first so the sign is never blank while the image loads.
    ctx.drawImage(paint([face.project, face.text], `${face.start} → ${face.end}`).image, 0, 0);
  }
  const img = new Image();
  img.onload = () => {
    if (!ctx) return;
    // Black field (the banner is a space scene on black) then the whole
    // banner, contain-fit — no crop, no stretch, logo and links intact.
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 512, 256);
    const scale = Math.min(512 / img.width, 256 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (512 - w) / 2, (256 - h) / 2, w, h);
    texture.needsUpdate = true;
  };
  img.src = face.image;
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
  } else if (hat === "visor") {
    // Open-top sun visor: a band across the forehead + a brim forward.
    // (Was falling through to the crown — the server grants "visor".)
    const band = new Mesh(box, MATERIALS.black);
    band.scale.set(0.46, 0.1, 0.46);
    band.position.y = 1.88;
    const brim = new Mesh(box, MATERIALS.black);
    brim.scale.set(0.4, 0.06, 0.26);
    brim.position.set(0, 1.84, 0.3);
    node.add(band, brim);
  } else if (hat === "tophat") {
    const crownTop = new Mesh(box, MATERIALS.black);
    crownTop.scale.set(0.36, 0.52, 0.36);
    crownTop.position.y = 2.1;
    const brim = new Mesh(box, MATERIALS.black);
    brim.scale.set(0.56, 0.07, 0.56);
    brim.position.y = 1.84;
    const band = new Mesh(box, GOLD);
    band.scale.set(0.38, 0.1, 0.38);
    band.position.y = 1.9;
    node.add(crownTop, brim, band);
  } else if (hat === "beanie") {
    const cap = new Mesh(box, MATERIALS.black);
    cap.scale.set(0.46, 0.2, 0.46);
    cap.position.y = 1.88;
    const fold = new Mesh(box, MATERIALS.gray);
    fold.scale.set(0.48, 0.08, 0.48);
    fold.position.y = 1.8;
    const pom = new Mesh(box, MATERIALS.gray);
    pom.scale.set(0.14, 0.12, 0.14);
    pom.position.y = 2.02;
    node.add(cap, fold, pom);
  } else if (hat === "headphones") {
    const band = new Mesh(box, MATERIALS.black);
    band.scale.set(0.5, 0.07, 0.14);
    band.position.y = 1.92;
    const cupL = new Mesh(box, MATERIALS.gray);
    cupL.scale.set(0.1, 0.2, 0.16);
    cupL.position.set(-0.24, 1.7, 0);
    const cupR = new Mesh(box, MATERIALS.gray);
    cupR.scale.set(0.1, 0.2, 0.16);
    cupR.position.set(0.24, 1.7, 0);
    node.add(band, cupL, cupR);
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

// Shared unit box for paintPerson's shop-hat post-process (visor /
// tophat / headphones are not branches in avatar.ts dressPerson, so the
// local player would otherwise render no hat at all for them).
const HAT_BOX = new BoxGeometry(1, 1, 1);

function makeCar(skin: string, style: number, vehicleId?: string) {
  // Catalog car — buildVehicle already returns rotation.order YXZ, named
  // "wheel" children and userData.paints, so retint() and the wheel-spin
  // loop in drive() keep working unchanged.
  if (vehicleId) return buildVehicle(vehicleId, skin);
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
  // Brighter glass canopy (not flat cyan) + dark grille + silver bumpers.
  const glass = new MeshStandardMaterial({
    color: 0xbfe6ff,
    emissive: 0x3d7fa8,
    emissiveIntensity: 0.55,
    roughness: 0.12,
    metalness: 0.35,
    transparent: true,
    opacity: 0.85,
  });
  const grille = new MeshStandardMaterial({ color: 0x111318, roughness: 0.5, metalness: 0.5 });
  const chrome = new MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.8 });
  if (style === 1) {
    // Low coupe: stepped hood lid, spoiler blade on the trunk.
    add(body, 0.15, 0.42, 0, 3.7, 0.32, 1.72);
    add(body, 0.3, 0.56, 0, 1.1, 0.1, 1.5);
    add(body, -0.25, 0.68, 0, 1.55, 0.28, 1.42);
    add(glass, -0.05, 0.74, 0, 1.05, 0.18, 1.2);
    add(body, -1.55, 0.86, 0, 0.12, 0.28, 1.55);
    add(body, -1.78, 1.02, 0, 0.5, 0.07, 1.5);
  } else if (style === 2) {
    // Tall wagon: roof rails.
    add(body, 0.05, 0.62, 0, 3.35, 0.62, 1.62);
    add(body, -0.2, 1.15, 0, 2.15, 0.52, 1.5);
    add(glass, 0.2, 1.18, 0, 1.35, 0.32, 1.32);
    add(GOLD, -0.15, 1.52, 0, 0.55, 0.16, 0.7);
    add(chrome, -0.2, 1.46, 0.62, 2.0, 0.06, 0.08);
    add(chrome, -0.2, 1.46, -0.62, 2.0, 0.06, 0.08);
  } else {
    add(body, 0.1, 0.5, 0, 3.45, 0.42, 1.62);
    add(body, 0.3, 0.64, 0, 1.0, 0.1, 1.45);
    add(body, -0.2, 0.88, 0, 1.65, 0.36, 1.42);
    add(glass, 0.02, 0.92, 0, 1.15, 0.22, 1.22);
  }
  // Stepped hood lid + dark grille + silver bumpers.
  add(body, 1.62, 0.4, 0, 0.62, 0.26, 1.28);
  add(grille, 1.94, 0.42, 0, 0.08, 0.18, 0.9);
  add(chrome, 1.96, 0.3, 0, 0.06, 0.1, 1.3);
  add(chrome, -1.96, 0.34, 0, 0.06, 0.1, 1.3);
  // White headlight lenses (red taillights stay).
  const headlamp = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 1.4, roughness: 0.2 });
  add(headlamp, 1.92, 0.46, 0.52, 0.1, 0.14, 0.34);
  add(headlamp, 1.92, 0.46, -0.52, 0.1, 0.14, 0.34);
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
    // Silver hubcap.
    const hub = new Mesh(new CylinderGeometry(0.13, 0.13, 0.24, 10), chrome);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, 0.28, z);
    group.add(hub);
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
  const color = COLORS[skin] ?? VEHICLE_COLORS[skin] ?? COLORS.black;
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
  // GTA vehicles — per-(player, universe) ownership. The Wallet shape in
  // economy.ts is shared, so owned cars live in their own localStorage key
  // (offline) and mirror world.me.vehicles whenever the server returns it.
  const VEHICLES_KEY = "orbitx-demo-vehicles-v1";
  const HOMES_KEY = "orbitx-demo-homes-v1";
  function loadLocalVehicles(): { vehicles: OwnedVehicle[]; activeVehicle: string | null } {
    try {
      const parsed = JSON.parse(localStorage.getItem(VEHICLES_KEY) || "null") as { vehicles?: OwnedVehicle[]; activeVehicle?: string | null } | null;
      return {
        vehicles: Array.isArray(parsed?.vehicles) ? parsed.vehicles.filter((v) => typeof v?.id === "string") : [],
        activeVehicle: typeof parsed?.activeVehicle === "string" ? parsed.activeVehicle : null,
      };
    } catch {
      return { vehicles: [], activeVehicle: null };
    }
  }
  const loadedVehicles = loadLocalVehicles();
  let localVehicles = loadedVehicles.vehicles;
  let localActiveVehicle = loadedVehicles.activeVehicle;
  function saveLocalVehicles() {
    try {
      localStorage.setItem(VEHICLES_KEY, JSON.stringify({ vehicles: localVehicles, activeVehicle: localActiveVehicle }));
    } catch {
      // The offline garage still works for this session.
    }
  }
  function loadLocalHomes(): PlayerHomesSave {
    try {
      const parsed = JSON.parse(localStorage.getItem(HOMES_KEY) || "null") as PlayerHomesSave | null;
      if (parsed && Array.isArray(parsed.homes)) return { homeServer: parsed.homeServer ?? 0, homes: parsed.homes };
    } catch {
      // Fall through to a fresh save.
    }
    return freshHomesSave();
  }
  let localHomes = loadLocalHomes();
  function saveLocalHomes() {
    try {
      localStorage.setItem(HOMES_KEY, JSON.stringify(localHomes));
    } catch {
      // The offline home still counts for this session.
    }
  }
  // Universe picked on the menu (servers 1-5). Persisted so a reload keeps
  // the pick; the server id rides on every per-server op.
  let currentUniverse: number | null = (() => {
    const saved = Number(localStorage.getItem("orbitx-universe") || "");
    return saved >= 1 && saved <= 5 ? saved : null;
  })();
  let universeIsHome = false;
  // Owned-car spawn bookkeeping: index in `cars` of the spawned active car.
  let ownedCarIndex = -1;
  // Per-vehicle drive params, cached on enterCar.
  let driveParams: DriveParams | null = null;
  let prevW = false;
  // Steering input, smoothed (drive() eases toward the target instead of
  // taking the raw binary stick/key value).
  let steerSm = 0;
  // Walk-cycle displacement: previous local position, for real speed.
  let prevLocal = { x: 0, z: 0, set: false };
  // Camera glide (walking + driving chase only, never first-person).
  const camSmoother = makeCameraSmoother();
  let snapCamNext = false;
  // Emergency panel context (which department the player walked into).
  let emergencyDept: { kind: string; name: string } | null = null;
  // District-offices panel: which district directory is open.
  let districtOfficeSel = "harbor";
  // Zone-enter haptic: the zone id the player was in last frame.
  let prevInsideName = "";
  let bootGen = 0;
  if (params.get("name")) {
    wallet.name = params.get("name") || wallet.name;
    saveWallet(wallet);
  }
  let content: CityContent = { projects: [], billboards: [], events: [] };
  let cityCols: Collider[] = [];
  let activeCols: Collider[] = [];
  // Spatial index over activeCols: a uniform XZ grid (cell 16u) so the
  // per-frame collision queries (overlaps / groundY / carHit / cameraBlocked)
  // stop scanning all ~4,500 colliders. Measured on seed 1: one on-foot
  // frame did ~233,000 AABB checks (3x overlaps + 1x groundY + the 48-step
  // pullCamera alone is 48 x 4,481) — ~0.8 ms on this VM's Node, several ms
  // on a phone CPU, and it multiplies under the tick substep loop when a
  // frame runs long (up to 5 substeps at the 0.25s dt clamp — a death
  // spiral: slow frame -> more scans -> slower frame). After: each query
  // touches only the colliders whose XZ footprint overlaps the query box —
  // a handful. Rebuilt in refreshActiveCols(), the only place activeCols
  // changes (begin + lift doors), so it costs nothing per frame.
  const COL_CELL = 16;
  const colGrid = new Map<string, Collider[]>();
  const colGridSeen = new Map<Collider, number>();
  let colGridGen = 0;
  const colQueryOut: Collider[] = [];
  function rebuildColGrid() {
    colGrid.clear();
    colGridSeen.clear();
    for (const c of activeCols) {
      const x0 = Math.floor(c.minX / COL_CELL);
      const x1 = Math.floor(c.maxX / COL_CELL);
      const z0 = Math.floor(c.minZ / COL_CELL);
      const z1 = Math.floor(c.maxZ / COL_CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = cx + "," + cz;
          let list = colGrid.get(key);
          if (!list) {
            list = [];
            colGrid.set(key, list);
          }
          list.push(c);
        }
      }
    }
  }
  // Candidates whose XZ footprint overlaps the query box. The caller's
  // narrow 3D test still runs on each candidate, so results are identical
  // to the old linear scan — just far fewer of them. A collider is
  // registered in every cell its footprint touches, so any collider that
  // would pass the narrow test shares a cell with the query box and is
  // returned. Returns a scratch array: use it immediately, do not hold it
  // across another colsNear() call.
  function colsNear(minX: number, minZ: number, maxX: number, maxZ: number): Collider[] {
    colQueryOut.length = 0;
    colGridGen++;
    const x0 = Math.floor(minX / COL_CELL);
    const x1 = Math.floor(maxX / COL_CELL);
    const z0 = Math.floor(minZ / COL_CELL);
    const z1 = Math.floor(maxZ / COL_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = colGrid.get(cx + "," + cz);
        if (!list) continue;
        for (const c of list) {
          if (colGridSeen.get(c) === colGridGen) continue;
          colGridSeen.set(c, colGridGen);
          colQueryOut.push(c);
        }
      }
    }
    return colQueryOut;
  }
  let anchors: Anchor[] = [];
  let zones: Zone[] = [];
  let lifts: Lift[] = [];
  let liftPanel: { name: string; floors: number[]; stops: string[]; current: number } | null = null;
  let liftRide: { liftId: string; from: number; to: number; t: number; dur: number; body: Body } | null = null;
  let liftOpen: { liftId: string; floor: number } | null = null;
  interface LiftCab {
    group: Group;
    door: Mesh;
    doorPos: number;
    doorTarget: number;
    baseX: number;
    baseZ: number;
    slideX: number;
    slideZ: number;
  }
  const liftCabs = new Map<string, LiftCab>();
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
  // Touch Gas / Brake hold buttons (right thumb, shown while driving) —
  // the left stick alone had to do gas AND steer, and its circular clamp
  // capped a diagonal gas+steer push at 0.707 on both axes.
  let holdGas = false;
  let holdBrake = false;
  let paused = false;
  let typing = false;
  let playing = false;
  let flyFlag = false;
  let prompt = "";
  let notice = "";
  let noticeUntil = 0;
  let job = "";
  let phase = 0;
  // Dwell jobs (lifeguard scan, cleaner sweep): seconds held at the target.
  let dwell = 0;
  // One-line prompt while holding still / waiting on a game, shown by the
  // prompt chain in after(). Set fresh every frame by tickJobs/tickGames.
  let holdPrompt = "";
  // Mail route, resolved when the job starts: depot, then homes, then an
  // office. Homes come from the live anchors, so the route follows the
  // seed layout instead of hard-coding house positions.
  let mailStops: Array<{ x: number; z: number; label: string }> = [];
  // Lifeguard: three posts along the harbor pier, south to north.
  const LIFEGUARD_POSTS = [
    { x: 0, z: 206, label: "Scan the water at the south post" },
    { x: 0, z: 222, label: "Scan the water at the middle post" },
    { x: 0, z: 238, label: "Scan the water at the end of the pier" },
  ] as const;
  // Cleaner: five litter spots around the plaza, clear of trees/benches.
  const LITTER_SPOTS = [
    { x: 14, z: -16 },
    { x: -14, z: -16 },
    { x: 20, z: 0 },
    { x: -20, z: 0 },
    { x: 0, z: -22 },
  ] as const;
  const LITTER_DONE = 5;
  // Mini-games. A game and a job never run together: starting one while
  // the other is active is refused, so the server-side job slot
  // (job-start/earn) is never clobbered mid-job.
  let miniGame: "" | "coinhunt" | "fishing" | "shootout" | "treasure" = "";
  const COIN_SPOTS = [
    { x: 0, z: -20 },
    { x: 20, z: -8 },
    { x: -20, z: -8 },
    { x: 16, z: 20 },
    { x: -16, z: 20 },
    { x: 0, z: 26 },
  ] as const;
  const COIN_TOTAL = 6;
  const COIN_TIME_MS = 90000;
  let coinTaken: boolean[] = [];
  let coinEndsAt = 0;
  let coinMeshes: Mesh[] = [];
  let litterMeshes: Mesh[] = [];
  const FISH_CATCHES = 3;
  const FISH_MISSES = 3;
  const FISH_TIME_MS = 120000;
  let fishState: "off" | "waiting" | "bite" = "off";
  let fishBiteAt = 0;
  let fishBiteUntil = 0;
  let fishCatches = 0;
  let fishMisses = 0;
  let fishEndsAt = 0;
  let fishBobber: Mesh | null = null;
  // Batch 2 jobs. Bus: a 4-stop route with a 2s boarding dwell at each
  // stop. Fire: three smoke reports, a 3s dwell at each fire. Doctor: a
  // 3-patient clinic at the Community Hall, a 3s dwell per patient.
  // Teacher: a 3-stop field trip (library, park, fountain), instant stops.
  const BUS_STOPS = [
    { x: 10, z: 17.6, label: "Board riders at the Jobs board" },
    { x: 0, z: 46, label: "Board riders at the north stop" },
    { x: 41.6, z: 90, label: "Board riders at the hall stop" },
    { x: 0, z: 210.6, label: "Drop the last riders at the harbor" },
  ] as const;
  const FIRE_SPOTS = [
    { x: 18, z: 72, label: "Put out the fire at the north avenue" },
    { x: -18, z: -72, label: "Put out the fire at the south avenue" },
    { x: 72, z: 90, label: "Put out the fire at the east avenue" },
  ] as const;
  const TEACHER_STOPS = [
    { x: -77.6, z: 163, label: "Meet the class at the Library" },
    { x: 121, z: 217, label: "Outdoor lesson in Sunset Park" },
    { x: 0, z: 12, label: "Dismiss the class at the fountain" },
  ] as const;
  let fireMeshes: Mesh[] = [];
  // Basketball shootout: a permanent hoop on the north edge of Sunset
  // Park, free-throw line 8 units south of it. 5 shots; the aim meter
  // pings 0-100 and E shoots — land it in the green (40-60) to score.
  // 3 makes of 5 pays.
  const HOOP = { x: 121, z: 207 };
  const SHOOT_SPOT = { x: 121, z: 215 };
  const SHOOT_SHOTS = 5;
  const SHOOT_WIN = 3;
  const SHOOT_GREEN_LO = 40;
  const SHOOT_GREEN_HI = 60;
  let shootState: "off" | "aim" = "off";
  let shootMeter = 0;
  let shootMade = 0;
  let shootTaken = 0;
  // Treasure hunt: 5 chests at landmarks, 2 minutes, beacon to the
  // nearest. Each chest found drops a clue to the next one.
  const TREASURE_SPOTS = [
    { x: 0, z: 240, clue: "Next: where the grass meets the water, under the park lights." },
    { x: 121, z: 217, clue: "Next: where the quiet shelves are — the Library door." },
    { x: -77.6, z: 163, clue: "Next: behind the big screen — the Cinema door." },
    { x: -77.6, z: -161, clue: "Next: at the feet of the tower that says ORBITX." },
    { x: 0, z: -8, clue: "" },
  ] as const;
  const TREASURE_TOTAL = 5;
  const TREASURE_TIME_MS = 120000;
  let treasureTaken: boolean[] = [];
  let treasureEndsAt = 0;
  let treasureMeshes: Mesh[] = [];
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
  let life: ReturnType<typeof createLifeView> | null = null;
  let spectator = false;
  let hideHud = false;
  let hideNames = false;
  let hideChat = false;
  let orbitOn = false;
  let clean = false;
  let wheelOpen = false;
  let wheelIndex = 0;
  let decorating = false;
  let decorKind: (typeof FURNITURE)[number] = "couch";
  let decorRot = 0;
  let raceHoldUntil = 0;
  let raceNext = -1;
  let hitting = false;
  let visitedHq = false;
  let droveQuest = false;
  let hqIndex = 0;
  const touch = wantsTouch();
  const chat: ChatLine[] = [];
  const remotes = new Map<string, Remote>();
  const boards = new Map<string, { mesh: Mesh; base: BillboardInfo; texture: CanvasTexture }>();
  const cars: { id: string; group: Group; x: number; z: number; yaw: number; lean: number; vehicleId?: string; alt: number }[] = [];
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
  interface Npc {
    group: Group;
    name: string;
    homeX: number;
    homeZ: number;
    x: number;
    z: number;
    prevX: number;
    prevZ: number;
    yaw: number;
    waypoints: Array<{ x: number; z: number }>;
    wp: number;
    waitUntil: number;
  }
  const npcs: Npc[] = [];
  // Talk state: the open dialogue (null when no chat is open). Lives outside
  // `panel` so the Talk panel can keep its lines across publishes.
  let talk: Snap["talk"] = null;
  let talkLines: string[] = [];
  let talkNpc = -1;
  // Activity collections (localStorage so they survive a reload).
  const PHOTOS_KEY = "orbitx-city-photos-v1";
  const WISHES_KEY = "orbitx-city-wishes-v1";
  function loadPhotos(): { taken: number; spots: string[] } {
    try {
      const raw = localStorage.getItem(PHOTOS_KEY);
      if (!raw) return { taken: 0, spots: [] };
      const parsed = JSON.parse(raw) as { taken?: number; spots?: string[] };
      return { taken: parsed.taken ?? 0, spots: Array.isArray(parsed.spots) ? parsed.spots : [] };
    } catch {
      return { taken: 0, spots: [] };
    }
  }
  let photosTaken = loadPhotos().taken;
  let photoSpots: string[] = loadPhotos().spots;
  function savePhotos() {
    try {
      localStorage.setItem(PHOTOS_KEY, JSON.stringify({ taken: photosTaken, spots: photoSpots }));
    } catch {
      // Photos still count for this session if storage is unavailable.
    }
  }
  let wishes = 0;
  try {
    wishes = Number(localStorage.getItem(WISHES_KEY)) || 0;
  } catch {
    wishes = 0;
  }
  function saveWishes() {
    try {
      localStorage.setItem(WISHES_KEY, String(wishes));
    } catch {
      // Wish count still shows for this session.
    }
  }
  // Museum exhibits viewed (first view of each pays). Same storage pattern
  // as photos — a persisted id list, so a revisit never pays twice.
  const MUSEUM_KEY = "orbitx-city-museum-v1";
  let museumSeen: string[] = [];
  try {
    const raw = localStorage.getItem(MUSEUM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { exhibits?: string[] };
      museumSeen = Array.isArray(parsed.exhibits) ? parsed.exhibits : [];
    }
  } catch {
    museumSeen = [];
  }
  function saveMuseum() {
    try {
      localStorage.setItem(MUSEUM_KEY, JSON.stringify({ exhibits: museumSeen }));
    } catch {
      // Exhibits still count for this session if storage is unavailable.
    }
  }
  // Hotel rest: a night at the hotel rests the player until this epoch-ms
  // timestamp; job pay is +10% while rested.
  const REST_KEY = "orbitx-city-rested-v1";
  let restedUntil = 0;
  try {
    restedUntil = Number(localStorage.getItem(REST_KEY)) || 0;
  } catch {
    restedUntil = 0;
  }
  function saveRest() {
    try {
      localStorage.setItem(REST_KEY, String(restedUntil));
    } catch {
      // Rest still counts for this session if storage is unavailable.
    }
  }
  function isRested() {
    return Date.now() < restedUntil;
  }
  // Stadium sprint state: null when no sprint is running.
  interface Sprint {
    startAt: number;
  }
  let sprint: Sprint | null = null;
  // Dance set state: null when no set is running.
  interface DanceSet {
    startAt: number;
    nextBeatAt: number;
    lastBeatAt: number;
    endAt: number;
    beat: number;
    hits: number;
    beatHit: boolean;
  }
  let dance: DanceSet | null = null;
  // One-time NPC quests, completed (localStorage so they survive a reload).
  const QUESTS_KEY = "orbitx-city-quests-v1";
  function loadQuestsDone(): string[] {
    try {
      const raw = localStorage.getItem(QUESTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  let questsDone: string[] = loadQuestsDone();
  function saveQuestsDone() {
    try {
      localStorage.setItem(QUESTS_KEY, JSON.stringify(questsDone));
    } catch {
      // Quest completion still counts for this session.
    }
  }
  // Busking: a plaza rhythm set, same shape as the dance set.
  interface BuskSet {
    startAt: number;
    nextBeatAt: number;
    lastBeatAt: number;
    endAt: number;
    beat: number;
    hits: number;
    beatHit: boolean;
  }
  let busk: BuskSet | null = null;
  // Parcel run: "" = no parcel, "carried" = holding the library parcel.
  let parcel: "" | "carried" = "";
  // Car wash: 0 when idle, otherwise the timestamp the wash finishes.
  let washEndsAt = 0;
  let washReadyAt = 0;
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
    // A paid booking is a text ad — it clears the house image so the
    // buyer's own creative shows, not our banner.
    if (shared) return { ...info, project: shared.project, text: shared.text, start: shared.start, end: shared.end, image: "" };
    return bookings()[info.id] ?? info;
  }

  function redrawBoard(id: string) {
    const board = boards.get(id);
    if (!board) return;
    const face = faceFor(board.base);
    board.texture.dispose();
    const texture = paintBillboard(face);
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
    if (zone.kind === "arcade") return "Ten cabinets, one high score";
    if (zone.kind === "market") return "Stalls and neon";
    if (zone.kind === "dock") return "Pier is open";
    if (zone.kind === "mall") return "Shops · food court · mezzanine";
    if (zone.kind === "office") return "OrbitX HQ — walk in";
    if (zone.kind === "cinema") return "Now showing nightly";
    if (zone.kind === "library") return "Read in peace";
    if (zone.kind === "gym") return "Lift by the harbor";
    if (zone.kind === "park") return "Pond · paths · benches";
    if (zone.kind === "museum") return "Four exhibits · +10 City Sol each";
    if (zone.kind === "hotel") return "Stay the night · 20 City Sol";
    if (zone.kind === "casino") return "Slots · 5 City Sol a pull";
    if (zone.kind === "nightclub") return "Dance sets at the DJ booth";
    if (zone.kind === "stadium") return "Sprint the track";
    return "Gather here";
  }

  function mountSign(zone: Zone) {
    const sub =
      zone.id.startsWith("home-") ? "Welcome home" : zone.kind === "shop" ? "Use the counter" : zone.kind === "cafe" ? "Pull up a seat" : zone.kind === "hall" ? "Stage is open" : zone.kind === "bank" ? "Savings window" : zone.kind === "garage" ? "Cars on the avenue" : zone.kind === "dock" ? "Clock in here" : "Walk in";
    const texture = paint([zoneTitle(zone), zoneLine(zone)], sub);
    const mesh = new Mesh(
      new PlaneGeometry(zone.kind === "hall" ? 5.4 : 4.2, 1.7),
      new MeshLambertMaterial({ map: texture, side: DoubleSide, emissive: 0x062028, emissiveIntensity: 0.35 }),
    );
    mesh.position.set(zone.signX, zone.signY, zone.signZ);
    mesh.rotation.y = zone.signRot;
    root.add(mesh);
  }

  // Wall art (paintings, room signs, the gold ORBITX logo wall): canvas planes
  // registered by the city builder, mounted next to the zone signs.
  function mountArt(item: Art) {
    const texture = paint(item.lines, item.sub);
    const mesh = new Mesh(
      new PlaneGeometry(item.w, item.h),
      new MeshLambertMaterial({ map: texture, side: DoubleSide, emissive: 0x062028, emissiveIntensity: 0.35 }),
    );
    mesh.position.set(item.x, item.y, item.z);
    mesh.rotation.y = item.rotY;
    root.add(mesh);
  }

  // The colliders the engine walks on: the city's full set minus the one lift
  // door blocker that is currently open (so the rider can step out of the cab).
  function refreshActiveCols() {
    if (!liftOpen) {
      activeCols = cityCols;
    } else {
      const tag = `lift-door:${liftOpen.liftId}:${liftOpen.floor}`;
      activeCols = cityCols.filter((c) => c.tag !== tag);
    }
    rebuildColGrid();
  }

  // One glass cab per lift: gold platform, glass walls, a sliding gold door
  // on the landing face. The cab group rides the shaft; its y is the floor.
  function buildLiftCabs() {
    liftCabs.clear();
    for (const lift of lifts) {
      const group = new Group();
      const glassMat = new MeshLambertMaterial({ color: 0x66d9e8, transparent: true, opacity: 0.35, side: DoubleSide });
      const platform = new Mesh(box, GOLD);
      platform.scale.set(lift.w - 0.6, 0.15, lift.d - 0.6);
      platform.position.y = 0.08;
      group.add(platform);
      const roof = new Mesh(box, glassMat);
      roof.scale.set(lift.w - 0.4, 0.1, lift.d - 0.4);
      roof.position.y = 2.85;
      group.add(roof);
      const hw = lift.w / 2;
      const hd = lift.d / 2;
      const wall = (x: number, z: number, sx: number, sz: number) => {
        const m = new Mesh(box, glassMat);
        m.scale.set(sx, 2.8, sz);
        m.position.set(x, 1.42, z);
        group.add(m);
      };
      const header = (x: number, z: number, sx: number, sz: number) => {
        const m = new Mesh(box, glassMat);
        m.scale.set(sx, 0.2, sz);
        m.position.set(x, 2.7, z);
        group.add(m);
      };
      const doorW = 2.4;
      const side = (lift.w - doorW) / 2;
      // The landing face gets two glass columns flanking the door opening
      // plus a header above it; the other three faces are full glass walls.
      if (lift.landing === "w") {
        wall(hw, 0, 0.12, lift.d);
        wall(0, -hd, lift.w, 0.12);
        wall(0, hd, lift.w, 0.12);
        wall(-hw, -hd + side / 2, 0.12, side);
        wall(-hw, hd - side / 2, 0.12, side);
        header(-hw, 0, 0.12, doorW);
      } else if (lift.landing === "e") {
        wall(-hw, 0, 0.12, lift.d);
        wall(0, -hd, lift.w, 0.12);
        wall(0, hd, lift.w, 0.12);
        wall(hw, -hd + side / 2, 0.12, side);
        wall(hw, hd - side / 2, 0.12, side);
        header(hw, 0, 0.12, doorW);
      } else if (lift.landing === "n") {
        wall(-hw, 0, 0.12, lift.d);
        wall(hw, 0, 0.12, lift.d);
        wall(0, hd, lift.w, 0.12);
        wall(-hw + side / 2, -hd, side, 0.12);
        wall(hw - side / 2, -hd, side, 0.12);
        header(0, -hd, doorW, 0.12);
      } else {
        wall(-hw, 0, 0.12, lift.d);
        wall(hw, 0, 0.12, lift.d);
        wall(0, -hd, lift.w, 0.12);
        wall(-hw + side / 2, hd, side, 0.12);
        wall(hw - side / 2, hd, side, 0.12);
        header(0, hd, doorW, 0.12);
      }
      const door = new Mesh(box, GOLD);
      door.scale.set(lift.landing === "w" || lift.landing === "e" ? 0.12 : doorW, 2.6, lift.landing === "w" || lift.landing === "e" ? doorW : 0.12);
      const baseX = lift.landing === "w" ? -hw : lift.landing === "e" ? hw : 0;
      const baseZ = lift.landing === "n" ? -hd : lift.landing === "s" ? hd : 0;
      door.position.set(baseX, 1.3, baseZ);
      group.add(door);
      group.position.set(lift.x, lift.floors[0], lift.z);
      root.add(group);
      liftCabs.set(lift.id, {
        group,
        door,
        doorPos: 0,
        doorTarget: 0,
        baseX,
        baseZ,
        slideX: lift.landing === "w" || lift.landing === "e" ? 0 : doorW,
        slideZ: lift.landing === "w" || lift.landing === "e" ? doorW : 0,
      });
    }
  }

  // E at a lift call button: step into the cab, close the door, pick a floor.
  function openLift(anchor: Anchor) {
    const lift = lifts.find((item) => item.id === anchor.liftId);
    if (!lift || !lastBody) return;
    const current = Math.max(0, lift.floors.indexOf(anchor.liftFloor ?? lift.floors[0]));
    liftPanel = { name: lift.name, floors: lift.floors, stops: lift.stops, current };
    const cab = liftCabs.get(lift.id);
    if (cab) {
      cab.group.position.set(lift.x, lift.floors[current], lift.z);
      cab.doorTarget = 0;
    }
    lastBody.x = lift.x;
    lastBody.z = lift.z;
    lastBody.y = lift.floors[current];
    lastBody.vy = 0;
    panel = "lift";
    publish();
  }

  // Pick a floor from the lift panel: close the panel, ride the cab.
  function rideLift(index: number) {
    if (!liftPanel) return;
    const lift = lifts.find((item) => item.name === liftPanel!.name);
    if (!lift || !lastBody) return;
    const to = lift.floors[index];
    const from = lift.floors[liftPanel.current];
    panel = "";
    liftPanel = null;
    if (to === from || to === undefined) {
      publish();
      return;
    }
    const body = lastBody;
    body.x = lift.x;
    body.z = lift.z;
    body.y = from;
    body.vy = 0;
    body.flying = true;
    liftRide = { liftId: lift.id, from, to, t: 0, dur: Math.abs(to - from) * 0.35 + 0.9, body };
    publish();
  }

  function clearRoot() {
    scene.remove(root);
    root = new Group();
    scene.add(root);
    boards.clear();
    cars.length = 0;
    ownedCarIndex = -1;
    remotes.clear();
    beacon = null;
    packageMesh = null;
    rider = null;
    localBody = null;
    sparks.length = 0;
    liftCabs.clear();
    liftRide = null;
    liftOpen = null;
    liftPanel = null;
    refreshActiveCols();
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
    // Trail comes back on me (publicPlayer) — the server is the authority,
    // the local copy is only the offline fallback.
    const nextTrail = (me as CityMe & { trail?: string }).trail;
    if (nextTrail === "neon" || nextTrail === "gold" || nextTrail === "none") {
      if (trail !== nextTrail) {
        trail = nextTrail;
        saveTrail();
      }
    }
    if (Array.isArray(me.vehicles)) {
      localVehicles = [...me.vehicles];
      saveLocalVehicles();
    }
    if (typeof me.activeVehicle === "string" || me.activeVehicle === null) {
      localActiveVehicle = me.activeVehicle;
    }
    if (me.homes) {
      localHomes = { homeServer: (me.homes.homeServer ?? 0) as PlayerHomesSave["homeServer"], homes: [...(me.homes.homes ?? [])] };
      saveLocalHomes();
    }
    wallet.name = me.name;
    saveWallet(wallet);
  }

  // The player's active car for THIS universe's save, spawned at the
  // garage-row spot (72, 54). Replaces whatever ambient car sits there.
  function activeVehicleEntry(): OwnedVehicle | null {
    if (!localActiveVehicle) return null;
    return localVehicles.find((v) => v.id === localActiveVehicle) ?? { id: localActiveVehicle, color: wallet.car };
  }

  function spawnActiveCar() {
    if (ownedCarIndex >= 0) {
      const old = cars[ownedCarIndex];
      if (old) root.remove(old.group);
      cars.splice(ownedCarIndex, 1);
      ownedCarIndex = -1;
    }
    const entry = activeVehicleEntry();
    if (!entry) return;
    let group: Group;
    try {
      group = buildVehicle(entry.id, entry.color);
    } catch {
      return;
    }
    let x = 72;
    let z = 54;
    let yaw = 0;
    const spot = cars.findIndex((car) => car.id === "garage-row");
    if (spot >= 0) {
      const old = cars[spot];
      root.remove(old.group);
      x = old.x;
      z = old.z;
      yaw = old.yaw;
      cars.splice(spot, 1);
    }
    group.position.set(x, 0.12, z);
    group.rotation.y = Math.PI / 2 - yaw;
    root.add(group);
    cars.push({ id: "garage-row", group, x, z, yaw, lean: 0, vehicleId: entry.id, alt: 0 });
    ownedCarIndex = cars.length - 1;
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
    remotes.set(state.id, { state, seen: performance.now(), group, prevX: state.x, prevZ: state.z });
  }

  async function begin(next: City, isPlay: boolean) {
    await loadLooks();
    // Config-fetch failure guard: if /config/characters.json failed,
    // avatar.ts silently falls back to a one-character roster (TJR).
    // Say so visibly instead of letting the player wonder where the
    // twelve characters went. (loadContent's project/billboard/event
    // fetch already falls back to built-in defaults, which are the same
    // data — nothing to guard there. App.tsx shows the same warning on
    // the menu, before the player picks.)
    if (allLooks().length <= 1) {
      say("Character list failed to load — only TJR is available. Check your connection and reload.");
    }
    world.stop();
    if (isPlay) await world.start(readAccount()?.name || wallet.name);
    if (world.online) applyMe();
    // Load the mission chain up front (not only when the panel opens) so
    // the chat / drive / job / daily / buy hooks can advance it.
    if (world.online) void loadMissions();
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
    holdGas = false;
    holdBrake = false;
    ownedCarIndex = -1;
    driveParams = null;
    prevW = false;
    prevLocal = { x: 0, z: 0, set: false };
    prevInsideName = "";
    insideName = "";
    job = "";
    phase = 0;
    dwell = 0;
    mailStops = [];
    miniGame = "";
    coinTaken = [];
    fishState = "off";
    riderOn = false;
    eventLeft = 0;
    burstLeft = 0;
    content = await loadContent();
    if (token !== bootGen) return;
    clearRoot();
    cityCols = next.colliders;
    refreshActiveCols();
    anchors = next.anchors;
    zones = next.zones;
    lifts = next.lifts;
    npcs.length = 0;
    talk = null;
    talkLines = [];
    talkNpc = -1;
    next.citizens.forEach((citizen, index) => {
      const group = makePerson(citizen.color, index % 2 ? "cap" : "none");
      const tag = makeLabel(citizen.name, true);
      tag.position.y = 2.35;
      group.add(tag);
      group.position.set(citizen.x, 0, citizen.z);
      root.add(group);
      // Patrol loop: home plus the small offsets from content.ts, so the
      // NPC walks the block instead of swaying in place.
      const info = NPC_LINES[citizen.name];
      const patrol = info?.patrol ?? NPC_DEFAULT_PATROL;
      const waypoints = patrol.map(([dx, dz]) => ({ x: citizen.x + dx, z: citizen.z + dz }));
      npcs.push({ group, name: citizen.name, homeX: citizen.x, homeZ: citizen.z, x: citizen.x, z: citizen.z, prevX: citizen.x, prevZ: citizen.z, yaw: index, waypoints, wp: 1 % waypoints.length, waitUntil: 0 });
    });
    // Activity markers (labels only — no new geometry): the dance floor in
    // the hall and the three photo spots.
    const danceTag = makeLabel("Dance floor", true);
    danceTag.position.set(DANCE_SPOT.x, 2.6, DANCE_SPOT.z);
    root.add(danceTag);
    for (const spot of PHOTO_SPOTS) {
      const tag = makeLabel("Photo spot", true);
      tag.position.set(spot.x, 2.2, spot.z);
      root.add(tag);
    }
    void world.loadBoard().then(() => publish());
    for (const anchor of anchors) {
      const title = anchor.kind === "project" ? projectName(anchor.slot) : anchor.name;
      const tag = makeLabel(title);
      tag.position.set(anchor.x, anchor.y + 2.7, anchor.z);
      root.add(tag);
    }
    // The current universe's active car spawns at the garage-row spot.
    spawnActiveCar();
    for (const slot of next.boards) mountBoard(slot);
    for (const item of next.art) mountArt(item);
    buildLiftCabs();
    const parked = ["black", "white", "cyan", "gold", "red", "silver"];
    next.cars.forEach((spawn, index) => {
      const group = makeCar(index === 0 ? wallet.car : parked[index % parked.length], index % 3);
      group.position.set(spawn.x, 0.12, spawn.z);
      group.rotation.y = Math.PI / 2 - spawn.yaw;
      root.add(group);
      cars.push({ id: spawn.id, group, x: spawn.x, z: spawn.z, yaw: spawn.yaw, lean: 0, alt: 0 });
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
    coinMeshes = COIN_SPOTS.map(() => {
      const mesh = new Mesh(box, GOLD);
      mesh.scale.set(0.35, 0.35, 0.1);
      mesh.visible = false;
      root.add(mesh);
      return mesh;
    });
    litterMeshes = LITTER_SPOTS.map(() => {
      const mesh = new Mesh(box, MATERIALS.black);
      mesh.scale.set(0.55, 0.12, 0.55);
      mesh.visible = false;
      root.add(mesh);
      return mesh;
    });
    // Fire spots are positioned every frame in tickJobs (unlike the litter
    // meshes, which never get a position) so each fire burns at its report.
    fireMeshes = FIRE_SPOTS.map(() => {
      const mesh = new Mesh(box, MATERIALS.red);
      mesh.scale.set(0.7, 1.1, 0.7);
      mesh.visible = false;
      root.add(mesh);
      return mesh;
    });
    treasureMeshes = TREASURE_SPOTS.map(() => {
      const mesh = new Mesh(box, GOLD);
      mesh.scale.set(0.55, 0.35, 0.55);
      mesh.visible = false;
      root.add(mesh);
      return mesh;
    });
    fishBobber = new Mesh(box, MATERIALS.cyanhot);
    fishBobber.scale.set(0.3, 0.3, 0.3);
    fishBobber.visible = false;
    root.add(fishBobber);
    // Basketball court: a permanent hoop at the north edge of Sunset Park
    // plus the free-throw line. The shootout plays here, E to shoot.
    const hoopPole = new Mesh(box, MATERIALS.black);
    hoopPole.scale.set(0.3, 3.6, 0.3);
    hoopPole.position.set(HOOP.x, 1.8, HOOP.z);
    root.add(hoopPole);
    const hoopBoard = new Mesh(box, MATERIALS.white);
    hoopBoard.scale.set(1.8, 1.2, 0.12);
    hoopBoard.position.set(HOOP.x, 3.2, HOOP.z);
    root.add(hoopBoard);
    const hoopRim = new Mesh(box, GOLD);
    hoopRim.scale.set(0.9, 0.08, 0.9);
    hoopRim.position.set(HOOP.x, 2.9, HOOP.z + 0.6);
    root.add(hoopRim);
    const ftLine = new Mesh(box, MATERIALS.white);
    ftLine.scale.set(2.4, 0.03, 0.3);
    ftLine.position.set(SHOOT_SPOT.x, 0.03, SHOOT_SPOT.z);
    root.add(ftLine);
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
    for (const zone of zones) {
      if (zone.kind === "project") continue;
      mountSign(zone);
    }
    life = createLifeView(root, zones, anchors);
    for (let i = 0; i < 40; i++) {
      const mesh = new Mesh(box, i % 2 ? GOLD : MATERIALS.cyanhot);
      mesh.visible = false;
      root.add(mesh);
      sparks.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0 });
    }
    publish();
    // Menu universe pick: join that universe now that the session is live,
    // so the save (balance, cars, homes) is this universe's own. If the
    // server op is not live yet the join fails silently and the game plays
    // on with the session save.
    if (isPlay && currentUniverse) {
      void joinUniverse(currentUniverse).catch(() => {});
    }
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
    const texture = paintBillboard(faceFor(base));
    // Two single-sided planes back to back: a DoubleSide plane shows the
    // texture mirrored from behind, so roadside boards read reversed from
    // one side of the street. Both faces read correctly now.
    const material = new MeshLambertMaterial({
      map: texture,
      emissive: 0x062028,
      emissiveIntensity: 0.6,
      side: FrontSide,
    });
    const mesh = new Mesh(new PlaneGeometry(6.4, 3.4), material);
    mesh.position.set(slot.x, slot.y, slot.z);
    mesh.rotation.y = slot.rotY;
    root.add(mesh);
    const nx = Math.sin(slot.rotY);
    const nz = Math.cos(slot.rotY);
    const back = new Mesh(new PlaneGeometry(6.4, 3.4), material);
    back.position.set(slot.x + nx * 0.06, slot.y, slot.z + nz * 0.06);
    back.rotation.y = slot.rotY + Math.PI;
    root.add(back);
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
      shop: SHOP_CATALOG,
      eventLabel: eventLeft > 0 ? `Fountain lights in ${Math.ceil(eventLeft)}` : burstLeft > 0 ? "Fountain lights" : "",
      panel,
      lift: liftPanel,
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
      lookHint: playing && !touch && !lookOn && !paused && !panel && !spectator && !new URLSearchParams(location.search).get("shot")
        ? "Click or drag to look"
        : "",
      mission: world.online ? world.mission : tourStep,
      board: world.board,
      districts: anchors.map((anchor) => ({ id: anchor.id, name: anchor.name, x: anchor.x, z: anchor.z })),
      lots: world.lots,
      leaders: world.leaders,
      daily: world.daily,
      race: world.raceInfo,
      notes: world.notes,
      market: world.market,
      mintSet: world.mintSet,
      walletKey: world.me?.wallet || "",
      walletNote: world.walletNote,
      holder: !!world.me?.holder,
      account: !!world.me?.account,
      email: world.me?.email || "",
      avatar: world.me?.avatar || "",
      chainAddress: world.chain?.address || world.me?.address || "",
      chainSol: world.chain?.sol ?? null,
      chainOrbitx: world.chain?.orbitx ?? null,
      chainNetwork: world.chain?.network || "",
      chainHistory: world.chain?.history || [],
      chainQr: world.chain?.qr || "",
      meId: world.id,
      jobStreak: world.me?.jobStreak ?? 0,
      business: world.me?.business ?? null,
      spectator,
      hideHud,
      hideNames,
      hideChat,
      orbit: orbitOn,
      clean,
      wheel: wheelOpen,
      wheelIndex,
      decorate: decorating,
      decorKind,
      hqIndex,
      banner: raceHoldUntil > Date.now()
        ? `Race starts in ${Math.ceil((raceHoldUntil - Date.now()) / 1000)}`
        : raceNext >= 0
          ? `Gate ${raceNext + 1} of ${GATES.length}`
          : "",
      talk,
      photos: { taken: photosTaken, spots: [...photoSpots] },
      wishes,
      missions: missions.map((item) => ({ ...item, steps: [...item.steps] })),
      missionMsg,
      missionsLoaded,
      buskReadyAt,
      photosToday: [...photosToday],
      photoMsg,
      trail,
      vehicles: [...localVehicles],
      activeVehicle: localActiveVehicle,
      universe: currentUniverse
        ? { id: currentUniverse, name: universeDisplayName(currentUniverse as UniverseId), isHome: universeIsHome }
        : null,
      haptics: isHapticsEnabled(),
      emergency: emergencyDept ? { ...emergencyDept } : null,
      districtOffice: districtOfficeSel,
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
    if (id === "barista") return "Barista";
    if (id === "vendor") return "Market vendor";
    if (id === "security") return "Security";
    if (id === "mail") return "Mail carrier";
    if (id === "lifeguard") return "Lifeguard";
    if (id === "cleaner") return "Street cleaner";
    if (id === "bus") return "Bus driver";
    if (id === "fire") return "Firefighter";
    if (id === "doctor") return "Doctor";
    if (id === "cop") return "Police Officer";
    if (id === "paramedic") return "Paramedic";
    if (id === "teacher") return "Teacher";
    if (id === "shootout") return "Basketball shootout";
    if (id === "treasure") return "Treasure hunt";
    return "City guide";
  }

  // Taxi loop: three fares, each a pickup + a drop. The rider waits at a
  // different curb each fare, and the drop moves around the city.
  const TAXI_PICKUPS = [
    { x: 0, z: 80 },
    { x: 0, z: -80 },
    { x: 72, z: 0 },
  ] as const;
  const TAXI_DROPS = ["cafe", "hall", "bank"] as const;

  function taxiDropName(fare: number) {
    const drop = TAXI_DROPS[Math.min(fare - 1, 2)];
    if (drop === "hall") return "the Community Hall";
    if (drop === "bank") return "OrbitX Bank";
    return "Cafe Nova";
  }

  function objectiveText() {
    if (miniGame === "coinhunt") {
      const left = Math.max(0, Math.ceil((coinEndsAt - Date.now()) / 1000));
      const got = coinTaken.filter(Boolean).length;
      return `Coin hunt — ${got} of ${COIN_TOTAL} coins · ${left}s left`;
    }
    if (miniGame === "fishing") {
      if (fishState === "bite") return "Fishing — BITE! Press E to strike";
      return `Fishing — ${fishCatches} of ${FISH_CATCHES} catches · ${fishMisses} miss${fishMisses === 1 ? "" : "es"}`;
    }
    if (miniGame === "shootout") {
      if (shootState !== "aim") return "Basketball — press E to shoot";
      return `Basketball — ${shootMade} made · shot ${Math.min(shootTaken + 1, SHOOT_SHOTS)} of ${SHOOT_SHOTS} · aim ${Math.round(shootMeter)}`;
    }
    if (miniGame === "treasure") {
      const left = Math.max(0, Math.ceil((treasureEndsAt - Date.now()) / 1000));
      const got = treasureTaken.filter(Boolean).length;
      return `Treasure hunt — ${got} of ${TREASURE_TOTAL} chests · ${left}s left`;
    }
    if (job === "courier" && phase === 0) return "Pick up the glowing package in front of the fountain";
    if (job === "courier") return "Drop the package at OrbitX Shop";
    if (job === "taxi") {
      const fare = Math.floor(phase / 2) + 1;
      if (phase % 2 === 0) return `Fare ${fare} of 3 — pick up the rider (in a car)`;
      return `Fare ${fare} of 3 — drop the rider at ${taxiDropName(fare)}`;
    }
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
    if (job === "barista") return "Serve the shift at Cafe Nova";
    if (job === "vendor") return "Open the stall at the Night Market";
    if (job === "security" && phase === 0) return "Patrol the fountain";
    if (job === "security" && phase === 1) return "Patrol the Community Hall";
    if (job === "security") return "Patrol OrbitX HQ in the Project District";
    if (job === "mail") {
      resolveMailStops();
      return mailStops[phase]?.label ?? "Deliver the mail";
    }
    if (job === "lifeguard") return LIFEGUARD_POSTS[Math.min(phase, 2)].label;
    if (job === "cleaner") {
      const left = LITTER_DONE - phase;
      return left > 1 ? `Sweep the plaza — ${left} litter spots left` : "Sweep the plaza — one litter spot left";
    }
    if (job === "bus") return BUS_STOPS[Math.min(phase, BUS_STOPS.length - 1)].label;
    // Emergency jobs (cop / paramedic / fire / doctor): per-phase lines
    // verbatim from EMERGENCY_JOBS in emergency.ts.
    const emSpec = emergencyJobById(job);
    if (emSpec) return jobObjective(emSpec, phase);
    if (job === "teacher") return TEACHER_STOPS[Math.min(phase, TEACHER_STOPS.length - 1)].label;
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
    for (const zone of zones) {
      if (body.x > zone.minX && body.x < zone.maxX && body.z > zone.minZ && body.z < zone.maxZ) {
        if (zone.minY !== undefined) {
          if (body.y < zone.minY || body.y > (zone.maxY ?? 99)) continue;
        } else if (body.y > 3.2) {
          continue;
        }
        return zone;
      }
    }
    return null;
  }

  function nearService(body: Body, zone: Zone) {
    return Math.hypot(body.x - zone.serviceX, body.z - zone.serviceZ) < 2.6;
  }

  function stepInside(anchor: Anchor, body: Body) {
    if (anchor.id === "orbitx-hq") {
      // Tower door: land inside the lobby by the front desk, facing it and
      // the ORBITX logo wall — not just inside the door.
      body.x = -72;
      body.z = 8.5;
      body.y = 0;
      body.vy = 0;
      body.flying = false;
      body.yaw = 0;
      say(anchor.name);
      return;
    }
    body.x = anchor.x + Math.sin(anchor.yaw) * 3.5;
    body.z = anchor.z - Math.cos(anchor.yaw) * 3.5;
    body.y = 0;
    body.vy = 0;
    body.flying = false;
    body.yaw = anchor.yaw;
    say(anchor.kind === "project" ? projectName(anchor.slot) : anchor.name);
  }

  let lastBody: Body | null = null;

  function applyEmote(group: Group, emote: string, baseYaw: number) {
    group.rotation.x = 0;
    group.rotation.z = 0;
    group.rotation.y = baseYaw;
    if (emote === "wave") group.rotation.z = Math.sin(clock * 8) * 0.35;
    else if (emote === "dance") group.rotation.y = baseYaw + Math.sin(clock * 6) * 0.6;
    else if (emote === "cheer") group.rotation.x = -0.25 + Math.sin(clock * 10) * 0.15;
    else if (emote === "sit") group.rotation.x = 0.7;
    else if (emote === "spin") group.rotation.y = clock * 4;
    else if (emote === "bow") group.rotation.x = 0.9;
    else if (emote === "clap") group.rotation.z = Math.sin(clock * 14) * 0.22;
    else if (emote === "robot") group.rotation.y = baseYaw + (Math.sin(clock * 3) > 0 ? 0.5 : -0.5);
    if (emote === "dance") return Math.abs(Math.sin(clock * 8)) * 0.3;
    if (emote === "sit") return -0.4;
    if (emote === "cheer") return Math.abs(Math.sin(clock * 10)) * 0.12;
    return 0;
  }

  function nearGate(body: Body, index: number, radius: number) {
    const gate = GATES[index];
    if (!gate) return false;
    return Math.hypot(body.x - gate.x, body.z - gate.z) < radius;
  }

  function currentLot() {
    return world.lots.find((lot) => lot.zone === insideName) || null;
  }

  async function startRace(kind: "street" | "hover") {
    if (!world.online) {
      say("The race needs the city server.");
      return;
    }
    if (kind === "hover" && !driving) {
      say("Get in a hover-car for the time trial.");
      return;
    }
    try {
      const data = await world.raceGo(kind);
      raceHoldUntil = Number(world.raceInfo.startedAt || Date.now() + 5000);
      raceNext = world.raceInfo.next;
      say(String(data.message || "Race armed."));
      publish();
    } catch (err) {
      say(err instanceof Error ? err.message : "The race did not start.");
    }
  }

  // ---- NPCs + activities ----
  function nearestNpc(body: Body, max: number) {
    let best = -1;
    let bestD = max;
    npcs.forEach((npc, index) => {
      const d = Math.hypot(npc.x - body.x, npc.z - body.z);
      if (d < bestD) {
        best = index;
        bestD = d;
      }
    });
    return best;
  }

  function nearestPhotoSpot(body: Body, max: number): PhotoSpot | null {
    let best: PhotoSpot | null = null;
    let bestD = max;
    for (const spot of PHOTO_SPOTS) {
      const d = Math.hypot(spot.x - body.x, spot.z - body.z);
      if (d < bestD) {
        best = spot;
        bestD = d;
      }
    }
    return best;
  }

  function nearestExhibit(body: Body, max: number): MuseumExhibit | null {
    let best: MuseumExhibit | null = null;
    let bestD = max;
    for (const exhibit of MUSEUM_EXHIBITS) {
      const d = Math.hypot(exhibit.x - body.x, exhibit.z - body.z);
      if (d < bestD) {
        best = exhibit;
        bestD = d;
      }
    }
    return best;
  }

  function openTalk(index: number) {
    const npc = npcs[index];
    if (!npc) return;
    const info = NPC_LINES[npc.name];
    talkLines = info?.lines ?? NPC_DEFAULT_LINES;
    talkNpc = index;
    const jobId = info?.jobId ?? "";
    talk = {
      name: npc.name,
      role: info?.role ?? "Citizen",
      line: talkLines[0],
      index: 0,
      total: talkLines.length,
      jobId,
      jobName: jobId ? jobTitle(jobId) : "",
      offerLabel: info?.offer?.label ?? "",
    };
    panel = "talk";
    publish();
  }

  function takePhoto(spot: PhotoSpot) {
    photosTaken += 1;
    const first = !photoSpots.includes(spot.id);
    if (first) photoSpots.push(spot.id);
    savePhotos();
    if (world.online) {
      // Online a photo pays through the server op (15 City Sol per
      // landmark, once a day) — never the local wallet as well. The
      // E-spots map onto the server's landmark ids: fountain → plaza,
      // pier → dock; tower is already "tower".
      const place = spot.id === "fountain" ? "plaza" : spot.id === "pier" ? "dock" : spot.id;
      if (place === "plaza" || place === "tower" || place === "dock") {
        void sendPhoto(place, spot.x, spot.z);
        publish();
        return;
      }
    }
    if (first) {
      earn(wallet, PHOTO_REWARD, `Photo — ${spot.name}`);
      triggerHaptic("jobPay");
    }
    burst(spot.x, 2.2, spot.z);
    say(
      first
        ? `Photo ${photoSpots.length}/${PHOTO_SPOTS.length} — ${spot.name}! +${PHOTO_REWARD} City Sol. (${photosTaken} taken)`
        : `Photo taken at ${spot.name}. (${photosTaken} taken, ${photoSpots.length}/${PHOTO_SPOTS.length} spots)`,
    );
    publish();
  }

  function makeWish() {
    if (wallet.balance < WISH_SPOT.cost) {
      triggerHaptic("error");
      say(`A wish costs ${WISH_SPOT.cost} City Sol — come back richer.`);
      return;
    }
    wallet.balance -= WISH_SPOT.cost;
    const roll = Math.random();
    const reward = roll < 0.4 ? 0 : roll < 0.7 ? 5 : roll < 0.9 ? 10 : 25;
    wallet.balance += reward;
    wishes += 1;
    saveWishes();
    saveWallet(wallet);
    burst(WISH_SPOT.x, 2.2, WISH_SPOT.z);
    say(
      reward > 0
        ? `Wish #${wishes}: the fountain returns ${reward} City Sol!`
        : `Wish #${wishes}: the fountain keeps your coin this time.`,
    );
    publish();
  }

  function viewExhibit(exhibit: MuseumExhibit) {
    const first = !museumSeen.includes(exhibit.id);
    const completed = first && museumSeen.length + 1 >= MUSEUM_EXHIBITS.length;
    if (first) {
      museumSeen.push(exhibit.id);
      earn(wallet, MUSEUM_REWARD, `Exhibit — ${exhibit.name}`);
      if (completed) earn(wallet, MUSEUM_BONUS, "Museum tour complete");
      triggerHaptic("jobPay");
    }
    saveMuseum();
    burst(exhibit.x, 2.2, exhibit.z);
    say(
      first
        ? completed
          ? `Exhibit ${museumSeen.length}/${MUSEUM_EXHIBITS.length} — ${exhibit.name}! +${MUSEUM_REWARD} City Sol, tour complete +${MUSEUM_BONUS}.`
          : `Exhibit ${museumSeen.length}/${MUSEUM_EXHIBITS.length} — ${exhibit.name}! +${MUSEUM_REWARD} City Sol.`
        : `${exhibit.name} — already viewed. (${museumSeen.length}/${MUSEUM_EXHIBITS.length} exhibits)`,
    );
    publish();
  }

  function pullLever() {
    if (wallet.balance < CASINO_COST) {
      triggerHaptic("error");
      say(`One pull costs ${CASINO_COST} City Sol — come back richer.`);
      return;
    }
    wallet.balance -= CASINO_COST;
    // Same payout table as the fountain wish (0 / 5 / 10 / 25).
    const roll = Math.random();
    const reward = roll < 0.4 ? 0 : roll < 0.7 ? 5 : roll < 0.9 ? 10 : 25;
    wallet.balance += reward;
    saveWallet(wallet);
    burst(CASINO_TABLE.x, 2.2, CASINO_TABLE.z);
    say(
      reward > 0
        ? `Slots: the reels land on ${reward} City Sol!`
        : "Slots: no match this pull — the house keeps your coin.",
    );
    publish();
  }

  function stayNight() {
    if (isRested()) {
      const mins = Math.max(1, Math.ceil((restedUntil - Date.now()) / 60000));
      say(`Already rested — job pay +10% for ${mins} more min.`);
      return;
    }
    if (wallet.balance < HOTEL_COST) {
      triggerHaptic("error");
      say(`A night costs ${HOTEL_COST} City Sol — come back richer.`);
      return;
    }
    wallet.balance -= HOTEL_COST;
    restedUntil = Date.now() + HOTEL_REST_MIN * 60 * 1000;
    saveRest();
    saveWallet(wallet);
    say(`Checked in — rested for ${HOTEL_REST_MIN} minutes. Job pay +10% while rested.`);
    publish();
  }

  function startSprint() {
    if (sprint) return;
    sprint = { startAt: performance.now() };
    say("Sprint! Run east to the gold line — faster is worth more.");
    publish();
  }

  function tickSprint(body: Body) {
    if (!sprint) return;
    // Leaving the stadium abandons the sprint — no pay for a sprint you
    // quit, same rule as the dance floor.
    if (zoneAt(body)?.id !== "stadium" || body.x < STADIUM_START.x - 4) {
      sprint = null;
      say("Left the track — sprint over.");
      publish();
      return;
    }
    if (body.x >= STADIUM_FINISH_X) {
      const secs = (performance.now() - sprint.startAt) / 1000;
      const amount = Math.max(STADIUM_MIN, Math.round(STADIUM_BASE - secs * STADIUM_PER_SEC));
      sprint = null;
      say(earn(wallet, amount, `Stadium sprint (${secs.toFixed(1)}s)`));
      triggerHaptic("jobPay");
      publish();
    }
  }

  function startDance() {
    if (dance) return;
    const now = performance.now();
    dance = {
      startAt: now,
      nextBeatAt: now + DANCE_BEAT_MS,
      lastBeatAt: 0,
      endAt: now + DANCE_BEAT_MS * DANCE_BEATS + 600,
      beat: 0,
      hits: 0,
      beatHit: false,
    };
    world.emote = "dance";
    world.emoteUntil = Date.now() + DANCE_BEAT_MS * DANCE_BEATS + 1200;
    say(`Dance set — ${DANCE_BEATS} beats. Press E right on each beat!`);
    publish();
  }

  function registerBeat() {
    if (!dance) return;
    const now = performance.now();
    const near = [dance.nextBeatAt, dance.lastBeatAt || dance.nextBeatAt].reduce(
      (best, t) => Math.min(best, Math.abs(now - t)),
      Infinity,
    );
    if (near <= 300 && !dance.beatHit) {
      dance.hits += 1;
      dance.beatHit = true;
    }
    publish();
  }

  function tickDance(body: Body) {
    if (!dance) return;
    // Walking off the floor ends the set — no pay for a set you abandon.
    // The hall and the nightclub both host sets.
    if (zoneAt(body)?.id !== "hall" && zoneAt(body)?.id !== "nightclub") {
      dance = null;
      world.emote = "";
      world.emoteUntil = 0;
      say("Left the dance floor — set over.");
      publish();
      return;
    }
    const now = performance.now();
    if (dance.beat < DANCE_BEATS && now >= dance.nextBeatAt) {
      dance.beat += 1;
      dance.lastBeatAt = dance.nextBeatAt;
      dance.nextBeatAt += DANCE_BEAT_MS;
      dance.beatHit = false;
      publish();
    }
    if (now >= dance.endAt) {
      const amount = dance.hits * 2 + 4;
      const hits = dance.hits;
      dance = null;
      say(earn(wallet, amount, `Dance set (${hits}/${DANCE_BEATS} on the beat)`));
      triggerHaptic("jobPay");
      publish();
    }
  }

  // ---- Busking: a plaza rhythm set, same shape as the dance set ----
  function startBusk() {
    if (busk) return;
    const now = performance.now();
    busk = {
      startAt: now,
      nextBeatAt: now + BUSK_BEAT_MS,
      lastBeatAt: 0,
      endAt: now + BUSK_BEAT_MS * BUSK_BEATS + 600,
      beat: 0,
      hits: 0,
      beatHit: false,
    };
    world.emote = "dance";
    world.emoteUntil = Date.now() + BUSK_BEAT_MS * BUSK_BEATS + 1200;
    say(`Busking — ${BUSK_BEATS} beats. Press E right on each beat!`);
    publish();
  }

  function registerBuskBeat() {
    if (!busk) return;
    const now = performance.now();
    const near = [busk.nextBeatAt, busk.lastBeatAt || busk.nextBeatAt].reduce(
      (best, t) => Math.min(best, Math.abs(now - t)),
      Infinity,
    );
    if (near <= 300 && !busk.beatHit) {
      busk.hits += 1;
      busk.beatHit = true;
    }
    publish();
  }

  function tickBusk(body: Body) {
    if (!busk) return;
    // Walking off the corner ends the set — no pay for a set you abandon.
    if (Math.hypot(body.x - BUSK_SPOT.x, body.z - BUSK_SPOT.z) > 4) {
      busk = null;
      world.emote = "";
      world.emoteUntil = 0;
      say("Walked off the corner — set over.");
      publish();
      return;
    }
    const now = performance.now();
    if (busk.beat < BUSK_BEATS && now >= busk.nextBeatAt) {
      busk.beat += 1;
      busk.lastBeatAt = busk.nextBeatAt;
      busk.nextBeatAt += BUSK_BEAT_MS;
      busk.beatHit = false;
      publish();
    }
    if (now >= busk.endAt) {
      const hits = busk.hits;
      busk = null;
      if (world.online) {
        // Online the set pays through the server op: flat 20 City Sol,
        // 60s cooldown per universe. A cooldown rejection still says so.
        void cityOp("busk", { server: serverId() })
          .then((data) => {
            if (data.me) applySaveMe(data.me);
            say(String(data.message || `Busked for the crowd — paid 20 City Sol.`));
            triggerHaptic("jobPay");
            publish();
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : "The city held that busk.";
            const wait = /(\d+)s/.exec(message);
            if (wait) buskReadyAt = Date.now() + Number(wait[1]) * 1000;
            say(message);
            publish();
          });
        return;
      }
      const amount = BUSK_BASE + hits * BUSK_PER_HIT;
      say(earn(wallet, amount, `Busking (${hits}/${BUSK_BEATS} on the beat)`));
      triggerHaptic("jobPay");
      publish();
    }
  }

  // ---- Car wash: hold still at the garage corner, 4 seconds, 12 City Sol ----
  function startWash() {
    if (washEndsAt > 0) return;
    if (Date.now() < washReadyAt) {
      say(`The hose needs a breather — ${Math.ceil((washReadyAt - Date.now()) / 1000)}s left.`);
      return;
    }
    washEndsAt = Date.now() + WASH_MS;
    say("Washing the hover-car… hold still, four seconds.");
    publish();
  }

  function tickWash(body: Body) {
    if (!washEndsAt) return;
    if (Math.hypot(body.x - WASH_SPOT.x, body.z - WASH_SPOT.z) > 3.5) {
      washEndsAt = 0;
      say("Stepped away — the wash is off. The car stays dirty.");
      publish();
      return;
    }
    if (Date.now() >= washEndsAt) {
      washEndsAt = 0;
      washReadyAt = Date.now() + WASH_COOLDOWN_MS;
      burst(WASH_SPOT.x, 2.2, WASH_SPOT.z);
      say(earn(wallet, WASH_PAY, "Hover-car wash"));
      triggerHaptic("jobPay");
      publish();
    }
  }

  // Department kinds (fire / police / hospital / emergency) live in the
  // city.ts unions once the world agent adds them; until then the casts
  // below keep the routing working without a type error.
  function isDeptKind(kind: string) {
    return kind === "fire" || kind === "police" || kind === "hospital" || kind === "emergency";
  }

  function openEmergency(kind: string, name: string) {
    emergencyDept = { kind, name };
    panel = "emergency";
  }

  function interact(body?: Body) {
    const who = body ?? lastBody;
    if (!who || !playing || paused || typing) return;
    body = who;
    if (driving) {
      if (raceNext < 0 && nearGate(body, 0, 8)) {
        void startRace("hover");
        return;
      }
      exitCar(body);
      return;
    }
    // A running dance set eats E as a beat hit — the player is on the floor,
    // not opening doors, until the set ends or they leave the hall or club.
    if (dance && (zoneAt(body)?.id === "hall" || zoneAt(body)?.id === "nightclub")) {
      registerBeat();
      return;
    }
    // Same for a running busk set — E is a beat hit while the player is on
    // the corner; walking off ends the set.
    if (busk) {
      if (Math.hypot(body.x - BUSK_SPOT.x, body.z - BUSK_SPOT.z) < 4) registerBuskBeat();
      else {
        busk = null;
        world.emote = "";
        world.emoteUntil = 0;
        say("Walked off the corner — set over.");
      }
      publish();
      return;
    }
    // Order matters: a door / zone service point / lift call wins over a car
    // parked nearby. The car used to be checked first, so pressing E at the
    // shop door (with a car parked within 7 units) teleported the player
    // back into the car instead of walking in. The car is the fallback —
    // only when nothing nearer answers E.
    const zone = zoneAt(body);
    if (zone && nearService(body, zone)) {
      if (zone.kind === "shop") panel = "shop";
      else if (zone.kind === "garage") panel = "garage";
      else if (isDeptKind(zone.kind as string)) openEmergency(zone.kind as string, zone.name);
      else if (zone.kind === "arcade") panel = "arcade";
      else if (zone.kind === "project") {
        hqIndex = zone.slot;
        panel = "hq";
      } else if (zone.kind === "hall" || zone.kind === "market" || zone.kind === "dock") panel = "home";
      else if (zone.kind === "casino") pullLever();
      else if (zone.kind === "hotel") stayNight();
      else if (zone.kind === "nightclub") startDance();
      else if (zone.kind === "stadium") startSprint();
      else if (zone.kind === "museum") say("OrbitX Museum — four exhibits, +10 City Sol for each first view.");
      else say(zoneTitle(zone));
      publish();
      return;
    }
    // A close door / lift / board beats the race gate: the mall door sits
    // 5.6 units from the street-race start gate, inside its 8-unit radius,
    // so pressing E at the door used to start the race instead of walking
    // in. A player at the gate itself is 5.6 units from the door — outside
    // the 3.3-unit anchor radius — so the gate still fires there.
    const anchor = nearestAnchor(body, 3.3);
    if (anchor) {
      if (anchor.kind === "lift") {
        openLift(anchor);
        return;
      }
      // Hover Garage: E opens the garage panel (buy / select cars), it does
      // not walk the player into the lobby.
      if (anchor.kind === "garage") {
        panel = "garage";
        publish();
        return;
      }
      if (anchor.kind === "shop" || anchor.kind === "cafe" || anchor.kind === "hall" || anchor.kind === "project" || anchor.kind === "bank" || anchor.kind === "arcade" || anchor.kind === "market" || anchor.kind === "dock" || anchor.kind === "mall" || anchor.kind === "office" || anchor.kind === "cinema" || anchor.kind === "library" || anchor.kind === "gym" || anchor.kind === "park" || anchor.kind === "stadium" || anchor.kind === "museum" || anchor.kind === "casino" || anchor.kind === "nightclub" || anchor.kind === "hotel") {
        stepInside(anchor, body);
        publish();
        return;
      }
      if (isDeptKind(anchor.kind as string)) openEmergency(anchor.kind as string, anchor.name);
      else if (anchor.kind === "jobs") panel = "jobs";
      else if (anchor.kind === "ads") panel = "ads";
      else if (anchor.kind === "events") panel = "events";
      else if (anchor.kind === "offices") {
        // HQ directory opens the HQ offices; a district tower's directory
        // board (tower-{district}-directory) opens that district's panel.
        if (anchor.id === "hq-directory") panel = "offices";
        else if (anchor.id.endsWith("-directory")) {
          const district = anchor.id.replace(/^tower-/, "").replace(/-directory$/, "");
          districtOfficeSel = district === "harbor" || district === "north" || district === "east" || district === "west" ? district : "harbor";
          panel = "district-offices";
        } else panel = "offices";
      }
      publish();
      return;
    }
    // Fishing: E on the pier casts, and E during a bite strikes. A game
    // in progress answers E before the race gate or a car does.
    if (miniGame === "fishing") {
      fishPress();
      return;
    }
    if (miniGame === "shootout") {
      shootPress();
      return;
    }
    if (!job && !miniGame && onPier(body)) {
      startFishing();
      return;
    }
    if (!job && !miniGame && nearCourt(body)) {
      startShootout();
      return;
    }
    if (raceNext < 0 && nearGate(body, 0, 8)) {
      void startRace("street");
      return;
    }
    // NPC talk: an NPC within 3 units answers E — but only after a door /
    // zone service point has had its say, so E at a door still walks in
    // even when an NPC patrols past it.
    const npcIndex = nearestNpc(body, 3);
    if (npcIndex >= 0) {
      openTalk(npcIndex);
      return;
    }
    // Parcel run: pick up at the bank steps, deliver at the Library door.
    if (!parcel && Math.hypot(body.x - PARCEL_PICKUP.x, body.z - PARCEL_PICKUP.z) < 2.5) {
      parcel = "carried";
      triggerHaptic("pickup");
      say("Parcel collected — take it to the Library door.");
      publish();
      return;
    }
    if (parcel === "carried" && Math.hypot(body.x - PARCEL_DELIVER.x, body.z - PARCEL_DELIVER.z) < 2.5) {
      parcel = "";
      burst(PARCEL_DELIVER.x, 2.2, PARCEL_DELIVER.z);
      say(earn(wallet, PARCEL_REWARD, "Parcel run (Bank → Library)"));
      triggerHaptic("jobPay");
      publish();
      return;
    }
    // Busking at the plaza corner, then the car wash at the garage.
    if (Math.hypot(body.x - BUSK_SPOT.x, body.z - BUSK_SPOT.z) < 2.5) {
      startBusk();
      return;
    }
    if (Math.hypot(body.x - WASH_SPOT.x, body.z - WASH_SPOT.z) < 2.5) {
      startWash();
      return;
    }
    // Photo spots, then museum exhibits, then the fountain wish, then the
    // dance floor — each with a real state change (collection, balance,
    // or pay).
    const photo = nearestPhotoSpot(body, 2.5);
    if (photo) {
      takePhoto(photo);
      return;
    }
    const exhibit = nearestExhibit(body, 2.5);
    if (exhibit) {
      viewExhibit(exhibit);
      return;
    }
    if (Math.hypot(body.x - WISH_SPOT.x, body.z - WISH_SPOT.z) < WISH_SPOT.radius) {
      makeWish();
      return;
    }
    if (zone?.id === "hall" && Math.hypot(body.x - DANCE_SPOT.x, body.z - DANCE_SPOT.z) < 2.5) {
      startDance();
      return;
    }
    if (zone?.id === "nightclub" && Math.hypot(body.x - CLUB_DANCE_SPOT.x, body.z - CLUB_DANCE_SPOT.z) < 2.5) {
      startDance();
      return;
    }
    // No door, zone, or board answered: a car within 7 units is the last
    // resort, re-checked at press time (never from a stale prompt).
    const car = nearestCar(body, 7);
    if (car >= 0) {
      enterCar(body, car);
      return;
    }
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
    steerSm = 0;
    chaseYaw = 0;
    chasePitch = 0.22;
    body.flying = false;
    body.vy = 0;
    const car = cars[index];
    if (!car) return;
    car.alt = 0;
    try {
      driveParams = driveParamsFor(car.vehicleId ?? "city-sedan");
    } catch {
      driveParams = null;
    }
    // Catalog cars wear their owned paint, not the repaint-only wallet color.
    const owned = car.vehicleId ? localVehicles.find((v) => v.id === car.vehicleId) : undefined;
    retint(car.group, owned?.color ?? wallet.car);
    const kind = (car.group.userData.kind as string) || "car";
    if (driveParams && driveParams.climb > 0) say(FLY_CONTROLS.note);
    else if (kind === "skateboard") say("Tap W to push.");
    else say("Press E to get out.");
    if (!droveQuest && world.online) {
      droveQuest = true;
      void world.questPing("drive").then(() => applyMe()).catch(() => {});
    }
    // Mission chain: entering a car is the "drive" step (client-attested;
    // the server enforces order/cooldown/one-time).
    void attemptMission();
  }

  function exitCar(body: Body) {
    const car = cars[carIndex];
    driving = false;
    // A held Gas/Brake button can unmount while held (panel opens, car
    // exits) and its pointerup never fires — clear the holds here or the
    // next car would drive itself.
    holdGas = false;
    holdBrake = false;
    if (car) {
      // Flying cars land first — the player steps out on the ground, never
      // mid-air. Boards are small: step off 1.2 units, not 2.6.
      if (car.alt > 0) {
        car.alt = 0;
        car.group.position.y = driveParams?.hover ?? 0.12;
      }
      const drop = (car.group.userData.kind as string) === "skateboard" ? 1.2 : 2.6;
      body.x = car.x + Math.cos(car.yaw) * drop;
      body.z = car.z + Math.sin(car.yaw) * drop;
      body.y = 0;
    }
    carIndex = -1;
    carSpeed = 0;
    driveParams = null;
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
    if (Date.now() < raceHoldUntil) {
      carSpeed = 0;
      return;
    }
    let { f, s } = moveAxes(keys);
    // Touch Gas / Brake buttons override the stick's forward axis: the
    // right thumb holds the throttle while the left thumb steers with a
    // pure sideways push, so gas and full steer work at the same time.
    // (The stick's up-push still works as gas for players who prefer it.)
    if (holdGas) f = Math.max(f, 1);
    if (holdBrake) f = Math.min(f, -1);
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const car = cars[carIndex];
    if (!car) return;
    // Per-vehicle physics (cached on enterCar; ambient cars fall back to
    // the city sedan's numbers, which match the old hard-coded constants).
    const params: DriveParams = driveParams ?? {
      maxSpeed: 12, accel: 18, steer: 1.5, reverse: -6, lean: 0.28, drag: 1.6,
      climb: 0, maxAltitude: 0, offroad: false, pushToGo: false, hover: 0.12,
    };
    // Ctrl is boost: it scales the ACCEL as well as the cap. The old code
    // only raised the cap (maxSpeed * 1.6) while the drag equilibrium
    // (accel / drag = 18 / 1.6 = 11.25 u/s) sat below it, so boost never
    // engaged — top speed was 11.25, barely faster than walking (5.2).
    // With boost the equilibrium is 11.25 * 1.6 = 18 u/s.
    const boost = ctrl ? 1.6 : 1;
    // "W" for boards is any push: keyboard W, the Gas button, or the stick
    // pushed up. (Before, only KeyW pushed a board, so boards were
    // unrideable on a phone — the stick's up-push did nothing.)
    const stickActive = Math.hypot(stickX, stickY) > 0.15;
    const wNow = keys.has("KeyW") || holdGas || (stickActive && stickY > 0.5);
    if (params.pushToGo) {
      // Skateboard: W is a tap-to-push impulse, not held throttle.
      if (wNow && !prevW) carSpeed = Math.min(carSpeed + 3, params.maxSpeed);
    } else if (f < 0 && carSpeed > 0.5) {
      // S brakes while rolling forward — strong decel toward a stop, and
      // reverse only engages once the car is nearly stopped. (Before, S
      // reversed straight away, so there was no brake at all.)
      carSpeed = Math.max(0, carSpeed - params.accel * 2.2 * dt);
    } else {
      carSpeed += f * params.accel * boost * dt;
    }
    prevW = wNow;
    carSpeed *= 1 - params.drag * dt;
    // Coasting ends: extra drag with no throttle, and a full stop below
    // 0.3 u/s instead of a crawl that never dies. (Boards keep their
    // push-and-glide feel — the snap only kills the sub-0.3 creep.)
    if (f === 0 && !params.pushToGo) carSpeed *= 1 - params.drag * 1.5 * dt;
    if (Math.abs(carSpeed) < 0.3) carSpeed = 0;
    const max = params.maxSpeed * boost;
    if (carSpeed > max) carSpeed = max;
    if (carSpeed < params.reverse) carSpeed = params.reverse;
    const moving = Math.abs(carSpeed) > 0.4 ? Math.sign(carSpeed) : 0;
    // Steering: smoothed (no more binary full-lock) and a bicycle model —
    // full lock turns a CONSTANT radius, so the car corners the same arc
    // at any speed instead of plowing straight at cruise speed. The old
    // 1/(1+|v|*0.055) falloff gave a 13-unit radius at 12 u/s and 24 at
    // boost on the 10-unit roads — wider than the road, so corners needed
    // a crawl. Radius comes from the vehicle's steer stat (sedan 1.5 ->
    // 6 units, heavy 0.8 -> ~11, nimble 2.4 -> 3.75); yaw rate caps at
    // 2.4 rad/s so boost does not spin the car, and the low-speed turn is
    // gentle (no spinning while creeping). steerSm already carries the
    // moving sign, so reverse steers the same way as before.
    const steerTarget = s * moving;
    steerSm += (steerTarget - steerSm) * Math.min(1, dt * 7);
    const turnRadius = 9 / params.steer;
    car.yaw += steerSm * Math.min(Math.abs(carSpeed) / turnRadius, 2.4) * dt;
    // The chase camera recentres behind the car: when the player is not
    // actively looking around, chaseYaw decays back to 0.
    if (lookX === 0) chaseYaw *= Math.exp(-dt * 0.9);
    // Flying: Space climbs (the touch Jump button too), Shift/C descends.
    if (params.climb > 0) {
      if (keys.has("Space") || holdJump) car.alt = Math.min(car.alt + params.climb * dt, params.maxAltitude);
      if (keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyC") || holdDown) car.alt = Math.max(car.alt - params.climb * dt, 0);
    }
    const nx = car.x + Math.sin(car.yaw) * carSpeed * dt;
    const nz = car.z - Math.cos(car.yaw) * carSpeed * dt;
    // Above 2 units the car is over the colliders — skip collision entirely.
    // Parked cars are solid too (otherCarHit): before, the `blocked`
    // callback only covered world colliders, so parked cars were ghosts.
    const blockedAt = (x: number, z: number) => blocked(x, z) || otherCarHit(x, z);
    if (car.alt > 2 || !blockedAt(nx, nz)) {
      car.x = nx;
      car.z = nz;
    } else {
      // Slide along the wall instead of stopping dead: try each axis alone.
      const canX = !blockedAt(nx, car.z);
      const canZ = !blockedAt(car.x, nz);
      if (canX && !canZ) {
        car.x = nx;
        carSpeed *= 0.6;
      } else if (canZ && !canX) {
        car.z = nz;
        carSpeed *= 0.6;
      } else {
        // Soft stop, not a bounce: keep the direction, kill most of the
        // speed. (The old code flipped the car into reverse at -0.25x.)
        carSpeed *= 0.2;
        triggerHaptic("carHit");
      }
    }
    // Bridge gates: the car crosses WITH the driver — same landing (x/z/yaw)
    // as the walking hop in engine tick. Rects are 4 units deep on the travel
    // axis and a substep moves at most ~1 unit, so the car cannot tunnel
    // through; landings sit 2 units clear of the opposite gate, so no
    // ping-pong. Flying cars above the colliders skip it (they fly over).
    if (car.alt <= 2) {
      const gate = bridgeGateFor(car.x, car.z);
      if (gate) {
        car.x = gate.landing.x;
        car.z = gate.landing.z;
        car.yaw = gate.landing.yaw;
        triggerHaptic("door");
        // Drivers get the same arrival line the walking hop shows (engine
        // tick's bridgeNotice) — tick() never runs while driving, so
        // without this the hop is silent. Wording reused verbatim.
        say(
          gate.to === "home"
            ? "OrbitX City — back home."
            : `${stateById(gate.to).name} — ${stateById(gate.to).tagline}`,
        );
      }
    }
    const steer = steerSm;
    car.lean += (steer * params.lean - car.lean) * Math.min(1, dt * 8);
    const bob = Math.sin(clock * 5) * 0.05;
    car.group.position.set(car.x, params.hover + car.alt + bob, car.z);
    car.group.rotation.y = Math.PI / 2 - car.yaw;
    for (const child of car.group.children) {
      if (child.name === "wheel") child.rotation.z += carSpeed * dt * 1.4;
    }
    car.group.rotation.z = -car.lean;
    body.x = car.x;
    body.y = 0.2 + car.alt;
    body.z = car.z;
    body.yaw = car.yaw;
    body.vy = 0;
  }

  function carBlocks(x: number, y: number, z: number) {
    if (driving || y > 2.2) return false;
    // Scaled from the car's own length/width (buildVehicle sets them):
    // half-length + 0.4 along the forward axis, half-width + 0.4 across.
    return cars.some((car, index) => {
      if (index === carIndex) return false;
      const len = (car.group.userData.length as number) || 3.45;
      const wid = (car.group.userData.width as number) || 1.62;
      const dx = x - car.x;
      const dz = z - car.z;
      const fx = Math.sin(car.yaw);
      const fz = -Math.cos(car.yaw);
      const along = dx * fx + dz * fz;
      const side = dx * -fz + dz * fx;
      return Math.abs(along) < len / 2 + 0.4 && Math.abs(side) < wid / 2 + 0.4;
    });
  }

  // Parked cars are solid while driving: the driven car's footprint
  // (half-length ~1.8, half-width ~1.0, sedan-sized with margin) tested
  // against each parked car's oriented box. drive() passes this in
  // through blockedAt alongside the world's `blocked` callback.
  function otherCarHit(x: number, z: number) {
    return cars.some((other, index) => {
      if (index === carIndex) return false;
      const len = (other.group.userData.length as number) || 3.45;
      const wid = (other.group.userData.width as number) || 1.62;
      const dx = x - other.x;
      const dz = z - other.z;
      const fx = Math.sin(other.yaw);
      const fz = -Math.cos(other.yaw);
      const along = dx * fx + dz * fz;
      const side = dx * -fz + dz * fx;
      return Math.abs(along) < len / 2 + 1.8 && Math.abs(side) < wid / 2 + 1.0;
    });
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

  // Mail route: depot (Jobs board), then the first two homes on the map,
  // then a project office. Falls back to project offices if the seed
  // built fewer than two homes. Resolved lazily so shots that set the job
  // directly get the same route as startJob.
  function resolveMailStops() {
    if (mailStops.length) return;
    const stops: Array<{ x: number; z: number; label: string }> = [];
    const depot = anchors.find((item) => item.id === "jobs");
    stops.push({ x: depot?.x ?? 10, z: depot?.z ?? 17.6, label: "Collect the mailbag at the Jobs board" });
    const homes = anchors.filter((item) => item.id.startsWith("home-")).slice(0, 2);
    for (const home of homes) {
      stops.push({ x: home.x, z: home.z, label: `Deliver the mail to ${home.name}` });
    }
    const office = anchors.find((item) => item.id === "project-1") ?? anchors.find((item) => item.id === "project-0");
    if (office) stops.push({ x: office.x, z: office.z, label: `Deliver the mail to ${projectName(office.slot)}` });
    else stops.push({ x: stops[0].x, z: stops[0].z, label: "Return the mailbag to the Jobs board" });
    while (stops.length < 4) stops.push({ x: stops[0].x, z: stops[0].z, label: "Return the mailbag to the Jobs board" });
    mailStops = stops;
  }

  function tickJobs(body: Body, dt: number) {
    holdPrompt = "";
    if (!playing) {
      if (beacon) beacon.visible = false;
      return;
    }
    let target: { x: number; z: number } | null = null;
    const emSpec = emergencyJobById(job);
    if (job === "courier" && phase === 0) target = { x: 0, z: 24 };
    if (job === "courier" && phase === 1) target = anchors.find((item) => item.id === "shop") ?? null;
    if (job === "taxi") {
      const fare = Math.min(Math.floor(phase / 2), 2);
      if (phase % 2 === 0) target = TAXI_PICKUPS[fare];
      else target = anchors.find((item) => item.id === TAXI_DROPS[fare]) ?? null;
    }
    if (job === "barista") target = anchors.find((item) => item.id === "cafe") ?? null;
    if (job === "vendor") target = anchors.find((item) => item.id === "market") ?? null;
    if (job === "security") {
      if (phase === 0) target = { x: 0, z: 12 };
      else if (phase === 1) target = anchors.find((item) => item.id === "hall") ?? null;
      else target = anchors.find((item) => item.id === "project-0") ?? null;
    }
    if (job === "guide") target = guidePoint() ?? null;
    if (job === "mechanic") target = { x: 36, z: 50 };
    if (job === "photographer") target = phase === 0 ? { x: 0, z: 12 } : { x: -30, z: 8 };
    if (job === "promoter") target = phase === 0 ? (anchors.find((item) => item.id === "hall") ?? null) : { x: 8, z: 70 };
    if (job === "dock") target = anchors.find((item) => item.id === "dock") ?? { x: 0, z: 148 };
    if (job === "dj") target = anchors.find((item) => item.id === "hall") ?? null;
    if (job === "banker") target = anchors.find((item) => item.id === "bank") ?? null;
    if (job === "mail") {
      resolveMailStops();
      target = mailStops[Math.min(phase, mailStops.length - 1)] ?? null;
    }
    if (job === "lifeguard") target = LIFEGUARD_POSTS[Math.min(phase, 2)];
    if (job === "cleaner") target = LITTER_SPOTS[Math.min(phase, LITTER_SPOTS.length - 1)];
    if (job === "bus") target = BUS_STOPS[Math.min(phase, BUS_STOPS.length - 1)];
    // Emergency jobs: phase targets resolve through EMERGENCY_JOBS — dept
    // targets go to the NEAREST department anchor of that kind.
    if (emSpec) target = jobTargetFor(emSpec, phase, body.x, body.z, anchors);
    if (job === "teacher") target = TEACHER_STOPS[Math.min(phase, TEACHER_STOPS.length - 1)];
    // Parcel run (no job): the beacon points at the Library door while
    // the player carries the parcel — same beacon as the jobs use.
    if (!job && parcel === "carried") target = { x: PARCEL_DELIVER.x, z: PARCEL_DELIVER.z };
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
      if (rider.visible) {
        const pickup = TAXI_PICKUPS[Math.min(Math.floor(phase / 2), 2)];
        rider.position.set(pickup.x, 0, pickup.z);
      }
    }
    // Litter is only on the ground while the cleaner job runs; swept spots
    // stay gone until the next shift.
    for (let i = 0; i < litterMeshes.length; i++) {
      litterMeshes[i].visible = job === "cleaner" && i >= phase;
    }
    // Fires burn only while the firefighter job runs; put-out fires stay
    // out until the next shift. Each fire is positioned at its report
    // (and flickers) while it burns.
    for (let i = 0; i < fireMeshes.length; i++) {
      fireMeshes[i].visible = job === "fire" && i >= phase - 1;
      if (fireMeshes[i].visible) {
        fireMeshes[i].position.set(FIRE_SPOTS[i].x, 0.6 + Math.sin(clock * 6 + i * 2) * 0.12, FIRE_SPOTS[i].z);
      }
    }
    if (!target || paused) return;
    const reachDist = job === "courier" && phase === 0 ? 5.2 : job === "courier" ? 6 : driving ? 4.2 : 2.8;
    let reach = Math.hypot(body.x - target.x, body.z - target.z) < reachDist;
    if (job === "courier" && phase === 1 && atShop(body)) reach = true;
    // Dwell jobs: leaving the spot resets the hold. Standing still inside
    // the radius counts up; the prompt shows the seconds left.
    const dwellJob = job === "lifeguard" || job === "cleaner" || job === "bus";
    if (dwellJob && !reach) dwell = 0;
    if (!reach) return;
    // Emergency jobs: dwell phases hold still for dwellSeconds, arrival
    // phases advance on reach — both follow the security/guide pattern.
    if (emSpec) {
      const emPhase = emSpec.phases[phase];
      if (!emPhase) return;
      const need = emPhase.dwellSeconds ?? 0;
      if (need > 0) {
        dwell += dt;
        const left = Math.max(0, need - dwell);
        holdPrompt = `${emPhase.label}… hold still (${Math.ceil(left)}s)`;
        if (dwell < need) return;
        dwell = 0;
      }
      if (job === "fire" && phase >= 1) burst(target.x, 1, target.z);
      phase += 1;
      if (phase >= emSpec.phases.length) void finishJob(job);
      else say(emSpec.phases[phase].label);
      return;
    }
    if (dwellJob) {
      dwell += dt;
      const need = job === "bus" ? 2 : job === "cleaner" ? 2.5 : 3;
      const left = Math.max(0, need - dwell);
      holdPrompt =
        job === "lifeguard" ? `Scanning the water… hold still (${Math.ceil(left)}s)`
        : job === "cleaner" ? `Sweeping… hold still (${Math.ceil(left)}s)`
        : `Boarding riders… hold still (${Math.ceil(left)}s)`;
      if (dwell < need) return;
      dwell = 0;
      if (job === "lifeguard") {
        phase += 1;
        if (phase >= 3) void finishJob("lifeguard");
        else say("Post scanned. Next post up the pier.");
      } else if (job === "cleaner") {
        phase += 1;
        if (phase >= LITTER_DONE) void finishJob("cleaner");
        else say(`Spot swept. ${LITTER_DONE - phase} to go.`);
      } else if (job === "bus") {
        phase += 1;
        if (phase >= BUS_STOPS.length) void finishJob("bus");
        else say("Riders aboard. Next stop.");
      }
      return;
    }
    if (job === "courier" && phase === 0) {
      phase = 1;
      say("Package picked up. Take it to OrbitX Shop.");
    } else if (job === "courier" && phase === 1) {
      void finishJob("courier");
    } else if (job === "taxi" && driving) {
      if (phase % 2 === 0) {
        phase += 1;
        riderOn = true;
        triggerHaptic("pickup");
        say("Rider aboard.");
      } else if (phase >= 5) {
        riderOn = false;
        void finishJob("taxi");
      } else {
        phase += 1;
        riderOn = false;
        say(`Fare ${Math.floor(phase / 2) + 1} of 3 — next rider is waiting.`);
      }
    } else if (job === "guide") {
      phase += 1;
      if (phase >= 3) void finishJob("guide");
      else say("Checkpoint reached.");
    } else if (job === "teacher") {
      phase += 1;
      if (phase >= 3) void finishJob("teacher");
      else say("Stop done. Next stop on the trip.");
    } else if (job === "barista" || job === "vendor") {
      void finishJob(job);
    } else if (job === "security") {
      phase += 1;
      if (phase >= 3) void finishJob("security");
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
    } else if (job === "mail") {
      phase += 1;
      resolveMailStops();
      if (phase >= mailStops.length) void finishJob("mail");
      else say(phase === 1 ? "Mailbag collected. First delivery is a home." : "Delivered. Next stop.");
    } else if (job === "dock" || job === "dj" || job === "banker") {
      void finishJob(job);
    }
  }

  // ---- Mini-games: coin hunt + fishing. Both pay City Sol through the
  // same earn op as jobs (server JOBS map holds coinhunt/fishing), and both
  // have a real fail state: the clock running out, or too many misses. ----
  function onPier(body: Body) {
    return Math.abs(body.x) < 4 && body.z > 198 && body.z < 246;
  }

  function startCoinHunt() {
    if (job) {
      say("Finish your job first — one gig at a time.");
      return;
    }
    if (miniGame) return;
    miniGame = "coinhunt";
    coinTaken = COIN_SPOTS.map(() => false);
    coinEndsAt = Date.now() + COIN_TIME_MS;
    panel = "";
    void world.jobStart("coinhunt").catch((err: unknown) => say(err instanceof Error ? err.message : "The city held the hunt."));
    say("Coin hunt — 6 gold coins around the plaza, 90 seconds. Follow the beacon.");
    publish();
  }

  function startFishing(at?: Body) {
    if (job) {
      say("Finish your job first — one gig at a time.");
      return;
    }
    if (miniGame) return;
    const body = at ?? lastBody;
    if (!body || !onPier(body)) {
      say("Stand on the harbor pier to fish, then press E to cast.");
      return;
    }
    miniGame = "fishing";
    fishState = "waiting";
    fishCatches = 0;
    fishMisses = 0;
    fishEndsAt = Date.now() + FISH_TIME_MS;
    fishBiteAt = Date.now() + 3000 + Math.random() * 5000;
    panel = "";
    void world.jobStart("fishing").catch((err: unknown) => say(err instanceof Error ? err.message : "The city held the line."));
    say("Line cast. Wait for a bite — press E the moment it hits.");
    publish();
  }

  function nearCourt(body: Body) {
    return Math.hypot(body.x - SHOOT_SPOT.x, body.z - SHOOT_SPOT.z) < 12;
  }

  // Basketball shootout: 5 shots from the free-throw line. The aim meter
  // sweeps 0-100; E shoots, and a shot in the green (40-60) scores. 3
  // makes of 5 pays — fewer than 3 and the rim wins, no pay.
  function startShootout(at?: Body) {
    if (job) {
      say("Finish your job first — one gig at a time.");
      return;
    }
    if (miniGame) return;
    const body = at ?? lastBody;
    if (!body || !nearCourt(body)) {
      say("Head to the Sunset Park court, then press E to shoot.");
      return;
    }
    miniGame = "shootout";
    shootState = "aim";
    shootMeter = 0;
    shootMade = 0;
    shootTaken = 0;
    panel = "";
    void world.jobStart("shootout").catch((err: unknown) => say(err instanceof Error ? err.message : "The city held the ball."));
    say("Shootout — 5 shots. Press E when the meter is in the green.");
    publish();
  }

  function shootPress() {
    if (miniGame !== "shootout" || shootState !== "aim") return;
    shootTaken += 1;
    const made = shootMeter >= SHOOT_GREEN_LO && shootMeter <= SHOOT_GREEN_HI;
    if (made) {
      shootMade += 1;
      burst(HOOP.x, 3, HOOP.z + 0.6);
      say(`Swish! ${shootMade} of ${SHOOT_SHOTS} made.`);
    } else {
      say(`Off the rim — ${shootMade} of ${SHOOT_SHOTS} made.`);
    }
    publish();
    if (shootTaken >= SHOOT_SHOTS) {
      shootState = "off";
      if (shootMade >= SHOOT_WIN) {
        say(`${shootMade} of ${SHOOT_SHOTS} — the shootout pays ${world.online ? "through the city" : "50 City Sol"}.`);
        void finishGame("shootout");
      } else {
        miniGame = "";
        say(`${shootMade} of ${SHOOT_SHOTS} — the rim wins. No pay this time.`);
        publish();
      }
    }
  }

  // Treasure hunt: 5 chests at landmarks, 2 minutes, beacon to the
  // nearest. Each chest found drops a clue to the next one.
  function startTreasureHunt() {
    if (job) {
      say("Finish your job first — one gig at a time.");
      return;
    }
    if (miniGame) return;
    miniGame = "treasure";
    treasureTaken = TREASURE_SPOTS.map(() => false);
    treasureEndsAt = Date.now() + TREASURE_TIME_MS;
    panel = "";
    void world.jobStart("treasure").catch((err: unknown) => say(err instanceof Error ? err.message : "The city held the map."));
    say("Treasure hunt — 5 chests, 2 minutes. First clue: buried where ships dock, at the end of the pier.");
    publish();
  }

  function recast() {
    fishState = "waiting";
    fishBiteAt = Date.now() + 3000 + Math.random() * 5000;
  }

  function endFishing(win: boolean, reason: string) {
    fishState = "off";
    if (fishBobber) fishBobber.visible = false;
    if (!win) {
      miniGame = "";
      say(reason);
      publish();
      return;
    }
    void finishGame("fishing");
  }

  async function finishGame(id: string) {
    if (performance.now() < payAfter || !miniGame) return;
    payAfter = performance.now() + 1500;
    miniGame = "";
    if (fishBobber) fishBobber.visible = false;
    for (const mesh of coinMeshes) mesh.visible = false;
    for (const mesh of treasureMeshes) mesh.visible = false;
    shootState = "off";
    const ok = await pay(id);
    if (!ok) say("The city held the prize — try the game again.");
    publish();
  }

  // One E press while fishing: too early scares the fish, on time lands it.
  function fishPress() {
    if (miniGame !== "fishing") return;
    if (fishState === "waiting") {
      fishMisses += 1;
      if (fishMisses >= FISH_MISSES) {
        endFishing(false, "Too soon, three times — the fish stopped biting. No pay.");
      } else {
        say(`Too soon — you scared it off. ${FISH_MISSES - fishMisses} miss${FISH_MISSES - fishMisses === 1 ? "" : "es"} left.`);
        recast();
      }
      publish();
      return;
    }
    if (fishState === "bite") {
      fishCatches += 1;
      burst(0, 1, 228);
      if (fishCatches >= FISH_CATCHES) {
        say(`Third catch! The haul pays ${world.online ? "through the city" : "45 City Sol"}.`);
        endFishing(true, "");
      } else {
        say(`Caught one! ${fishCatches} of ${FISH_CATCHES}. Cast again.`);
        recast();
      }
      publish();
    }
  }

  function tickGames(body: Body) {
    if (miniGame === "coinhunt") {
      let nearest: { x: number; z: number } | null = null;
      let nearestD = Infinity;
      for (let i = 0; i < COIN_SPOTS.length; i++) {
        const spot = COIN_SPOTS[i];
        const mesh = coinMeshes[i];
        if (!mesh) continue;
        mesh.visible = !coinTaken[i];
        mesh.position.set(spot.x, 0.9 + Math.sin(clock * 2 + i) * 0.15, spot.z);
        mesh.rotation.y = clock * 1.5;
        if (coinTaken[i]) continue;
        const d = Math.hypot(body.x - spot.x, body.z - spot.z);
        if (d < nearestD) {
          nearestD = d;
          nearest = spot;
        }
        if (d < 2.8 && !paused) {
          coinTaken[i] = true;
          mesh.visible = false;
          burst(spot.x, 1, spot.z);
          triggerHaptic("pickup");
          const got = coinTaken.filter(Boolean).length;
          if (got >= COIN_TOTAL) {
            say("Last coin! The hunt pays.");
            void finishGame("coinhunt");
            return;
          }
          say(`Coin ${got} of ${COIN_TOTAL}.`);
          publish();
        }
      }
      if (Date.now() > coinEndsAt) {
        for (const mesh of coinMeshes) mesh.visible = false;
        miniGame = "";
        say("Time up — the coins vanished. No pay this time.");
        publish();
        return;
      }
      if (beacon && nearest && !paused) {
        beacon.visible = true;
        beacon.position.set(nearest.x, 1.2 + Math.sin(clock * 3) * 0.2, nearest.z);
        beacon.rotation.y = clock;
      }
      return;
    }
    if (miniGame === "fishing") {
      const now = Date.now();
      if (fishBobber) {
        fishBobber.visible = true;
        fishBobber.position.set(5, 0.35 + Math.sin(clock * 2) * 0.08, 228);
      }
      if (now > fishEndsAt) {
        endFishing(false, "The fish stopped biting — two minutes, no haul. No pay.");
        return;
      }
      if (fishState === "waiting" && now >= fishBiteAt) {
        fishState = "bite";
        fishBiteUntil = now + 1600;
        holdPrompt = "BITE! Press E to strike";
        say("Bite! Strike now!");
        publish();
        return;
      }
      if (fishState === "bite") {
        holdPrompt = "BITE! Press E to strike";
        if (now > fishBiteUntil) {
          fishMisses += 1;
          if (fishMisses >= FISH_MISSES) {
            endFishing(false, "Three bites missed — the fish won. No pay.");
          } else {
            say(`It got away. ${FISH_MISSES - fishMisses} miss${FISH_MISSES - fishMisses === 1 ? "" : "es"} left.`);
            recast();
          }
          publish();
        }
        return;
      }
      holdPrompt = "Waiting for a bite…";
      return;
    }
    if (miniGame === "treasure") {
      let nearest: { x: number; z: number } | null = null;
      let nearestD = Infinity;
      for (let i = 0; i < TREASURE_SPOTS.length; i++) {
        const spot = TREASURE_SPOTS[i];
        const mesh = treasureMeshes[i];
        if (!mesh) continue;
        mesh.visible = !treasureTaken[i];
        mesh.position.set(spot.x, 0.35, spot.z);
        if (treasureTaken[i]) continue;
        const d = Math.hypot(body.x - spot.x, body.z - spot.z);
        if (d < nearestD) {
          nearestD = d;
          nearest = spot;
        }
        if (d < 2.8 && !paused) {
          treasureTaken[i] = true;
          mesh.visible = false;
          burst(spot.x, 1, spot.z);
          triggerHaptic("pickup");
          const got = treasureTaken.filter(Boolean).length;
          if (got >= TREASURE_TOTAL) {
            say("Last chest! The hunt pays.");
            void finishGame("treasure");
            return;
          }
          const clue = TREASURE_SPOTS[i].clue;
          say(clue ? `Chest ${got} of ${TREASURE_TOTAL}. Clue: ${clue}` : `Chest ${got} of ${TREASURE_TOTAL}.`);
          publish();
        }
      }
      if (Date.now() > treasureEndsAt) {
        for (const mesh of treasureMeshes) mesh.visible = false;
        miniGame = "";
        say("Time up — the treasure stays buried. No pay this time.");
        publish();
        return;
      }
      if (beacon && nearest && !paused) {
        beacon.visible = true;
        beacon.position.set(nearest.x, 1.2 + Math.sin(clock * 3) * 0.2, nearest.z);
        beacon.rotation.y = clock;
      }
      return;
    }
    if (miniGame === "shootout" && shootState === "aim") {
      // The meter sweeps 0-100 on a sine — no extra state to track, and
      // the green window (40-60) passes twice per sweep.
      shootMeter = 50 + 50 * Math.sin(clock * 1.6);
      const inGreen = shootMeter >= SHOOT_GREEN_LO && shootMeter <= SHOOT_GREEN_HI;
      holdPrompt = inGreen
        ? `GREEN — press E to shoot! (${Math.round(shootMeter)})`
        : `Aim ${Math.round(shootMeter)} — press E in the green (40–60)`;
      return;
    }
    // No game running: leave holdPrompt alone — tickJobs may have set a
    // dwell prompt (scan/sweep) for the active job.
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
      // Offline pays the same schedule the server pays (TOUR_PAY), never
      // a flat 20/step — online and offline must agree.
      say(earn(wallet, TOUR_PAY[step] ?? 20, "City tour"));
      triggerHaptic("jobPay");
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

  // Mission chain + new earning (fix-client). The server is the authority:
  // mission-list / mission-step / busk / photo all pay the per-server save
  // (me comes back on each response); the client only tracks what to show.
  let missions: MissionCard[] = [];
  let missionMsg = "";
  let missionsLoaded = false;
  // Client-side throttle for mission-step attempts — the server enforces a
  // 3s step cooldown; attempting faster only earns rejections.
  let lastMissionTry = 0;
  // Last mission "visit" place the player stood at — attempts fire on
  // place CHANGE only, never every frame.
  let lastPlace = "";
  // Busk: epoch ms when the server's 60s cooldown ends (0 = ready).
  let buskReadyAt = 0;
  // Photo Safari: server place ids photographed today.
  let photosToday: string[] = [];
  let photoMsg = "";
  // Trail the player owns ("none" | "neon" | "gold"). The wallet in
  // economy.ts has no trail field, so it persists in localStorage and is
  // refreshed from the server's me whenever one arrives.
  const TRAIL_KEY = "orbitx-city-trail-v1";
  let trail = (() => {
    try {
      const saved = localStorage.getItem(TRAIL_KEY) || "none";
      return saved === "neon" || saved === "gold" ? saved : "none";
    } catch {
      return "none";
    }
  })();
  function saveTrail() {
    try {
      localStorage.setItem(TRAIL_KEY, trail);
    } catch {
      // The trail still applies for this session if storage is unavailable.
    }
  }

  // --- Mission chain + busk + photo safari (server ops, per-server saves)
  // world.ts is not this agent's file, so these call /api/city directly
  // with the same bearer pattern world.call uses (account token first,
  // guest player token second).
  function serverId() {
    return currentUniverse ?? 1;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  async function cityOp(op: string, extra: Record<string, unknown> = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = accountToken() || world.token || localStorage.getItem("orbitx-token") || "";
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch("/api/city", {
      method: "POST",
      headers,
      body: JSON.stringify({ op, ...extra }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || data.ok === false) throw new Error(String(data.message || "City server said no."));
    return data;
  }

  // The save's me (per-server ledger) — same pattern as the garage/homes
  // wiring: the op's me replaces world.me and applyMe() refreshes the
  // displayed balance from it. Cosmetics are synced from the global player
  // server-side, so only balance/earned actually change ledgers.
  function applySaveMe(me: unknown) {
    if (!me || typeof me !== "object") return;
    world.me = me as CityMe;
    applyMe();
    applyServerDaily(me);
  }

  // Daily blob on a save me: photos done today + the busk cooldown.
  function applyServerDaily(me: unknown) {
    const daily = (me as { daily?: { photos?: Record<string, string>; buskAt?: number } })?.daily;
    if (!daily || typeof daily !== "object") return;
    if (daily.photos && typeof daily.photos === "object") {
      const today = todayISO();
      photosToday = Object.entries(daily.photos)
        .filter(([, day]) => day === today)
        .map(([place]) => place);
    }
    if (daily.buskAt) buskReadyAt = Number(daily.buskAt) + 60000;
  }

  // Which mission "visit" place the player is standing at, if any. Zone
  // interiors first (the shop/cafe/hall/market/museum rooms), then the
  // outdoor points (plaza fountain, tower, harbor).
  function placeAt(body: Body): string {
    const zone = zoneAt(body);
    if (zone && ["plaza", "shop", "cafe", "hall", "tower", "dock", "market", "museum"].includes(zone.id)) return zone.id;
    for (const point of MISSION_PLACE_POINTS) {
      if (Math.hypot(body.x - point.x, body.z - point.z) <= point.r) return point.id;
    }
    return "";
  }

  async function loadMissions() {
    if (!world.online) {
      missionMsg = "Missions need the city server — playing on this device only.";
      publish();
      return;
    }
    try {
      const data = await cityOp("mission-list", { server: serverId() });
      if (Array.isArray(data.missions)) missions = data.missions as MissionCard[];
      missionsLoaded = true;
      missionMsg = "";
      if (data.me) applySaveMe(data.me);
      publish();
    } catch (err) {
      missionMsg = err instanceof Error ? err.message : "Could not load missions.";
      publish();
    }
  }

  // Attempt the current step of a mission; the server validates kind,
  // order, cooldown and one-time completion, so a wrong attempt just
  // fails silently. Returns true when a step (or the mission) completed.
  async function attemptMission(missionId = "") {
    if (!world.online || !missionsLoaded) return false;
    if (Date.now() - lastMissionTry < 3000) return false;
    const target = missionId
      ? missions.find((item) => item.id === missionId)
      : missions.find((item) => item.unlocked && !item.done);
    if (!target || target.done || !target.unlocked) return false;
    lastMissionTry = Date.now();
    try {
      const data = await cityOp("mission-step", {
        server: serverId(),
        mission: target.id,
        step: target.step,
        place: lastBody ? placeAt(lastBody) : "",
      });
      if (data.mission && typeof data.mission === "object") {
        const updated = data.mission as MissionCard;
        const index = missions.findIndex((item) => item.id === updated.id);
        if (index >= 0) missions[index] = updated;
        else missions.push(updated);
      }
      if (data.me) applySaveMe(data.me);
      if (data.paid || data.done) {
        say(String(data.message || "Mission step done."));
        triggerHaptic("jobPay");
      }
      publish();
      return true;
    } catch {
      // Wrong step / wrong place / cooldown — the server said no; the
      // panel shows progress, not the rejection.
      return false;
    }
  }

  // Visit steps fire on place CHANGE only — never every frame.
  function tickMissionPlace(body: Body) {
    if (!world.online || !missionsLoaded) return;
    const place = placeAt(body);
    if (!place || place === lastPlace) return;
    lastPlace = place;
    void attemptMission();
  }

  // Busk action: start the plaza rhythm set (the same set E starts at the
  // corner). The set's pay now comes from the server op when online.
  function buskNow() {
    if (busk) {
      say("Already busking — keep the beat!");
      return;
    }
    if (Date.now() < buskReadyAt) {
      say(`Take a breather — busk again in ${Math.ceil((buskReadyAt - Date.now()) / 1000)}s.`);
      return;
    }
    if (!lastBody || Math.hypot(lastBody.x - BUSK_SPOT.x, lastBody.z - BUSK_SPOT.z) > 4) {
      say("Busk at the plaza corner — stand by the fountain's east edge.");
      return;
    }
    startBusk();
  }

  // Photo Safari: 15 City Sol per landmark, once per landmark per day.
  async function sendPhoto(place: string, x: number, z: number) {
    if (!world.online) return;
    try {
      const data = await cityOp("photo", { server: serverId(), place });
      if (data.me) applySaveMe(data.me);
      if (!photosToday.includes(place)) photosToday.push(place);
      burst(x, 2.2, z);
      say(String(data.message || `Photo of ${place} — paid 15 City Sol.`));
      triggerHaptic("jobPay");
    } catch (err) {
      const message = err instanceof Error ? err.message : "The city held that photo.";
      // "Already photographed X today" still tells us the spot is done.
      if (/Already photographed/.test(message) && !photosToday.includes(place)) photosToday.push(place);
      say(message);
    }
    publish();
  }

  // Panel entry point: checks the player is actually at the landmark.
  function takeSafariPhoto(place: string) {
    const spot = PHOTO_LANDMARKS.find((item) => item.id === place);
    if (!spot) return;
    if (photosToday.includes(place)) {
      photoMsg = `Already photographed ${spot.name} today — come back tomorrow.`;
      say(photoMsg);
      publish();
      return;
    }
    if (!lastBody || Math.hypot(lastBody.x - spot.x, lastBody.z - spot.z) > 8) {
      photoMsg = `Get closer to ${spot.name} to photograph it.`;
      say(photoMsg);
      publish();
      return;
    }
    void sendPhoto(place, spot.x, spot.z);
  }

  async function pay(id: string) {
    const amounts: Record<string, number> = { courier: 45, taxi: 90, guide: 60, mechanic: 55, photographer: 40, promoter: 50, dock: 65, dj: 55, banker: 50, barista: 45, vendor: 55, security: 75, mail: 70, lifeguard: 65, cleaner: 55, bus: 80, fire: 75, doctor: 70, cop: 85, paramedic: 80, teacher: 60, coinhunt: 40, fishing: 45, shootout: 50, treasure: 45 };
    // A hotel rest pays +10% on top of the job (min 1 City Sol) — the
    // same bonus whether the pay comes from the local wallet or the server.
    const base = amounts[id] ?? 0;
    const restedBonus = isRested() && base > 0 ? Math.max(1, Math.round(base * 0.1)) : 0;
    if (!world.online) {
      say(earn(wallet, amounts[id] + restedBonus, jobTitle(id) + (restedBonus ? " · rested +10%" : "")));
      triggerHaptic("jobPay");
      return true;
    }
    try {
      const data = await world.earn(id);
      applyMe();
      triggerHaptic("jobPay");
      let msg = String(data.message || "Paid.");
      if (restedBonus) msg += " " + earn(wallet, restedBonus, "Rested bonus (+10% job pay)");
      say(msg);
      // Mission chain: a completed job is the "job" step (server-verified
      // against the job streak snapshot).
      void attemptMission();
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
      tickJobs(body, dt);
      tickGames(body);
      tickTour(body);
      tickMissionPlace(body);
      tickDance(body);
      tickSprint(body);
      tickBusk(body);
      tickWash(body);
    }
    // NPC patrol: walk the loop of waypoints around the home spot, pausing
    // at each stop; face the player while talking.
    for (const [index, npc] of npcs.entries()) {
      // Walk-cycle speed from real displacement (same rule as the player).
      const npcSpeed = Math.min(30, Math.hypot(npc.x - npc.prevX, npc.z - npc.prevZ) / Math.max(dt, 0.001));
      const npcMoving = npcSpeed > 0.05;
      npc.prevX = npc.x;
      npc.prevZ = npc.z;
      const walkNpc = () => {
        const npcWalker = ensureWalker(npc.group);
        if (npcWalker) animateWalk(npcWalker, npcSpeed, dt, npcMoving, false);
      };
      if (talkNpc === index && lastBody) {
        npc.yaw = Math.atan2(lastBody.x - npc.x, lastBody.z - npc.z);
        npc.group.position.set(npc.x, 0, npc.z);
        npc.group.rotation.y = npc.yaw;
        walkNpc();
        continue;
      }
      const target = npc.waypoints[npc.wp % npc.waypoints.length];
      if (clock < npc.waitUntil) {
        npc.group.position.set(npc.x, 0, npc.z);
        npc.group.rotation.y = npc.yaw;
        walkNpc();
        continue;
      }
      const dx = target.x - npc.x;
      const dz = target.z - npc.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) {
        npc.wp = (npc.wp + 1) % npc.waypoints.length;
        npc.waitUntil = clock + 1.5 + (index % 3) * 0.9;
        continue;
      }
      const step = Math.min(dist, 1.1 * dt);
      npc.x += (dx / dist) * step;
      npc.z += (dz / dist) * step;
      npc.yaw = Math.atan2(dx, dz);
      npc.group.position.set(npc.x, 0, npc.z);
      npc.group.rotation.y = npc.yaw;
      walkNpc();
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
    // Elevator doors slide toward their target every frame.
    for (const cab of liftCabs.values()) {
      cab.doorPos += (cab.doorTarget - cab.doorPos) * Math.min(1, dt * 6);
      cab.door.position.set(cab.baseX + cab.slideX * cab.doorPos, 1.3, cab.baseZ + cab.slideZ * cab.doorPos);
    }
    // Elevator ride: ease the cab + rider between floors, then open the door
    // (which also opens the shaft's door blocker for that floor so the rider
    // can step out). The blocker closes again once the rider walks away.
    if (liftRide) {
      const ride = liftRide;
      ride.t += dt;
      const k = Math.min(1, ride.t / ride.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const y = ride.from + (ride.to - ride.from) * e;
      const lift = lifts.find((item) => item.id === ride.liftId);
      if (lift) {
        ride.body.x = lift.x;
        ride.body.z = lift.z;
      }
      ride.body.y = y;
      ride.body.vy = 0;
      const cab = liftCabs.get(ride.liftId);
      if (cab) {
        cab.group.position.y = y;
        cab.doorTarget = 0;
      }
      if (k >= 1) {
        // Deposit the rider at the destination floor's landing anchor —
        // outside the shaft, on solid floor. Without this the rider is left
        // standing in the open shaft (the cab platform is a mesh, not a
        // collider) and falls through it back to the lobby.
        ride.body.y = ride.to;
        if (lift) {
          const floorIndex = lift.floors.indexOf(ride.to);
          const landing = anchors.find((a) => a.kind === "lift" && a.liftId === lift.id && a.liftFloor === floorIndex);
          if (landing) {
            ride.body.x = landing.x;
            ride.body.z = landing.z;
            ride.body.y = landing.y;
          }
          liftOpen = { liftId: lift.id, floor: floorIndex };
          refreshActiveCols();
          say(`${lift.stops[floorIndex] ?? "Floor"} — ${lift.name}`);
        }
        ride.body.vy = 0;
        ride.body.flying = false;
        liftRide = null;
        if (cab) cab.doorTarget = 1;
        triggerHaptic("door");
      }
    } else if (liftOpen) {
      const lift = lifts.find((item) => item.id === liftOpen!.liftId);
      if (lift && Math.hypot(body.x - lift.x, body.z - lift.z) > 3) {
        liftOpen = null;
        refreshActiveCols();
        const cab = liftCabs.get(lift.id);
        if (cab) cab.doorTarget = 0;
      }
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
      const remoteTag = remote.group.getObjectByName("tag");
      if (remoteTag) remoteTag.visible = !hideNames;
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
        const lift = applyEmote(person, remote.state.emote || "", Math.PI - 2 * remote.state.yaw);
        person.position.y = lift;
      }
      // Walk cycle from the remote's real displacement this frame.
      if (!remote.state.car) {
        const remoteSpeed = Math.min(30, Math.hypot(remote.group.position.x - remote.prevX, remote.group.position.z - remote.prevZ) / Math.max(dt, 0.001));
        const remoteWalker = ensureWalker(person);
        if (remoteWalker) animateWalk(remoteWalker, remoteSpeed, dt, remoteSpeed > 0.05, false);
      }
      remote.prevX = remote.group.position.x;
      remote.prevZ = remote.group.position.z;
    }
    const emoteNow = Date.now() < world.emoteUntil ? world.emote : "";
    if (localBody) {
      localBody.visible = camMode !== "first" && !driving && !spectator;
      const lift = applyEmote(localBody, emoteNow, Math.PI - body.yaw);
      localBody.position.set(body.x, body.y + lift, body.z);
      paintPerson(localBody, true);
      // Walk cycle: real displacement per frame (never the target speed —
      // the legs must stop when a wall stops the player). ensureWalker runs
      // every frame because dressPerson wipes pivots on a re-dress.
      // animateWalk runs AFTER position.set, so its bob/lean survive.
      const horizontalSpeed = prevLocal.set
        ? Math.min(30, Math.hypot(body.x - prevLocal.x, body.z - prevLocal.z) / Math.max(dt, 0.001))
        : 0;
      prevLocal = { x: body.x, z: body.z, set: true };
      const localWalker = ensureWalker(localBody);
      if (localWalker && !driving) {
        const stickMoving = Math.hypot(stickX, stickY) > 0.15;
        // Blocked against a wall: stick held but no displacement — bump.
        if (playing && stickMoving && horizontalSpeed < 0.05 && body.onGround) triggerHaptic("bump");
        animateWalk(localWalker, horizontalSpeed, dt, (horizontalSpeed > 0.3 || stickMoving) && body.onGround, body.flying);
      }
      const ring = localBody.getObjectByName("ring");
      if (ring) {
        // The ground ring does double duty: the bought trail renders as a
        // permanent ring in its colour; with no trail it is the speaking
        // indicator (cyan, only while talking).
        const ringMat = (ring as Mesh).material as MeshStandardMaterial;
        if (trail === "neon") {
          ring.visible = true;
          ringMat.color.set(0x7ef6ff);
          ringMat.emissive.set(0x19d8ff);
        } else if (trail === "gold") {
          ring.visible = true;
          ringMat.color.set(0xe0b33a);
          ringMat.emissive.set(0xe0b33a);
        } else {
          ring.visible = world.speaking;
          ringMat.color.set(0x7ef6ff);
          ringMat.emissive.set(0x19d8ff);
        }
      }
      const selfTag = localBody.getObjectByName("tag");
      if (selfTag) selfTag.visible = !hideNames && !spectator;
    }
    prompt = "";
    if (playing && !paused && !opts.orbit && !spectator) {
      const zone = zoneAt(body);
      insideName = zone?.id ?? "";
      if (insideName && insideName !== prevInsideName) triggerHaptic("door");
      prevInsideName = insideName;
      if (zone?.id === "project-0" && world.mintSet && !world.me?.holder && !driving) {
        const limit = zone.minX + 5;
        if (body.x < limit) {
          body.x = limit + 0.2;
          triggerHaptic("error");
          say("Holders only. Connect a wallet that holds $ORBITX.");
        }
      }
      if (zone?.kind === "project" && !visitedHq && world.online) {
        visitedHq = true;
        void world.questPing("visit").then(() => applyMe()).catch(() => {});
      }
      if (world.raceInfo.next !== raceNext && world.raceInfo.startedAt) {
        raceNext = world.raceInfo.next;
        raceHoldUntil = world.raceInfo.startedAt;
      }
      if (raceNext >= 0 && Date.now() >= raceHoldUntil && !hitting) {
        const gate = GATES[raceNext];
        const px = driving ? (cars[carIndex]?.x ?? body.x) : body.x;
        const pz = driving ? (cars[carIndex]?.z ?? body.z) : body.z;
        if (gate && Math.hypot(px - gate.x, pz - gate.z) < 8) {
          hitting = true;
          void world
            .raceHit(px, pz, driving)
            .then((data) => {
              applyMe();
              raceNext = world.raceInfo.next;
              say(String(data.message || "Gate"));
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : "";
              if (message && !/too fast|countdown|not the next/i.test(message)) say(message);
            })
            .finally(() => {
              hitting = false;
            });
        }
      }
      const lot = currentLot();
      if (Date.now() < raceHoldUntil) prompt = "Countdown — hold still";
      else if (raceNext >= 0) prompt = `Next gate ${raceNext + 1} of ${GATES.length}`;
      else if (holdPrompt) prompt = holdPrompt;
      else if (decorating && lot) prompt = "Decorate — place, rotate, or remove. X closes it.";
      else if (driving && nearGate(body, 0, 8)) prompt = "Press E — hover time trial";
      else if (driving) prompt = "Press E to get out";
      else if (zone && nearService(body, zone)) {
        prompt = zone.kind === "shop" ? "Press E to open the shop" : zone.kind === "garage" ? "Press E to open the garage" : isDeptKind(zone.kind as string) ? `Press E — ${zoneTitle(zone)}` : zone.kind === "arcade" ? "Press E — arcade, play money" : zone.kind === "project" ? "Press E — HQ screen" : zone.kind === "casino" ? `Press E — pull the lever (${CASINO_COST} City Sol)` : zone.kind === "hotel" ? (isRested() ? "Press E — hotel desk (already rested)" : `Press E — stay the night (${HOTEL_COST} City Sol)`) : zone.kind === "nightclub" ? "Press E — DJ booth, start a dance set" : zone.kind === "stadium" ? "Press E — start the sprint" : zone.kind === "museum" ? "Press E — museum info" : zoneTitle(zone);
      } else if (nearestAnchor(body, 3.3)) {
        // A close door / lift / board beats the race gate, same as
        // interact(): the mall door sits 5.6 units from the street-race
        // start gate, inside its 8-unit radius, so the prompt used to say
        // "street race" at the door instead of "Walk in".
        const anchor = nearestAnchor(body, 3.3)!;
        const title = anchor.kind === "project" ? projectName(anchor.slot) : anchor.name;
        const walkIn = anchor.kind === "shop" || anchor.kind === "cafe" || anchor.kind === "hall" || anchor.kind === "project" || anchor.kind === "bank" || anchor.kind === "arcade" || anchor.kind === "market" || anchor.kind === "dock" || anchor.kind === "mall" || anchor.kind === "office" || anchor.kind === "cinema" || anchor.kind === "library" || anchor.kind === "gym" || anchor.kind === "park" || anchor.kind === "stadium" || anchor.kind === "museum" || anchor.kind === "casino" || anchor.kind === "nightclub" || anchor.kind === "hotel";
        // The tower door announces itself as an office entrance, never as a
        // photo spot — the anchor branch already runs before the photo check
        // below, so the door wins wherever the two ranges meet.
        prompt = anchor.kind === "garage" ? "Press E — Hover Garage" : anchor.kind === "office" ? "Press E — Enter office" : walkIn ? `Walk in — ${title}` : `Press E — ${title}`;
      } else if (nearGate(body, 0, 8)) prompt = "Press E — street race";
      else if (sprint) prompt = `Sprint! Reach the gold line — ${((performance.now() - sprint.startAt) / 1000).toFixed(1)}s`;
      else if (dance) prompt = `Dance! Press E on the beat — ${dance.hits}/${DANCE_BEATS} hits, beat ${Math.min(dance.beat + 1, DANCE_BEATS)} of ${DANCE_BEATS}`;
    else if (busk) prompt = `Busk! Press E on the beat — ${busk.hits}/${BUSK_BEATS} hits, beat ${Math.min(busk.beat + 1, BUSK_BEATS)} of ${BUSK_BEATS}`;
    else if (washEndsAt > 0) prompt = "Washing the hover-car… hold still";
    else if (!parcel && Math.hypot(body.x - PARCEL_PICKUP.x, body.z - PARCEL_PICKUP.z) < 2.5) prompt = "Press E — pick up a parcel for the Library";
    else if (parcel === "carried" && Math.hypot(body.x - PARCEL_DELIVER.x, body.z - PARCEL_DELIVER.z) < 2.5) prompt = `Press E — deliver the parcel (+${PARCEL_REWARD} City Sol)`;
    else if (Math.hypot(body.x - BUSK_SPOT.x, body.z - BUSK_SPOT.z) < 2.5) prompt = "Press E — busk at the plaza corner";
    else if (Math.hypot(body.x - WASH_SPOT.x, body.z - WASH_SPOT.z) < 2.5) prompt = `Press E — wash a hover-car (+${WASH_PAY} City Sol)`;
      else if (nearestNpc(body, 3) >= 0) {
        const npc = npcs[nearestNpc(body, 3)];
        prompt = npc ? `Press E — talk to ${npc.name}` : "";
      } else if (nearestPhotoSpot(body, 2.5)) {
        const spot = nearestPhotoSpot(body, 2.5)!;
        prompt = `Press E — take a photo (${spot.name})`;
      } else if (nearestExhibit(body, 2.5)) {
        const exhibit = nearestExhibit(body, 2.5)!;
        prompt = museumSeen.includes(exhibit.id) ? `Viewed — ${exhibit.name}` : `Press E — view exhibit (${exhibit.name}, +${MUSEUM_REWARD} City Sol)`;
      } else if (Math.hypot(body.x - WISH_SPOT.x, body.z - WISH_SPOT.z) < WISH_SPOT.radius) prompt = `Press E — make a wish (${WISH_SPOT.cost} City Sol)`;
      else if (zone?.id === "hall" && Math.hypot(body.x - DANCE_SPOT.x, body.z - DANCE_SPOT.z) < 2.5) prompt = "Press E — dance floor";
      else if (zone?.id === "nightclub" && Math.hypot(body.x - CLUB_DANCE_SPOT.x, body.z - CLUB_DANCE_SPOT.z) < 2.5) prompt = "Press E — dance floor";
      else {
        // The anchor was already checked above (it beats the gate); here
        // only the car fallback and the zone title remain. Nothing in
        // range: clear the prompt (leaving it untouched kept "Press E to
        // drive" on screen 30-40 m after the player walked away).
        if (nearestCar(body, 7) >= 0) prompt = "Press E to drive";
        else if (zone) prompt = zone.kind === "shop" ? "OrbitX Shop — counter at the back" : lot?.ownerId === world.id ? `${lot.name} — press X to decorate` : zoneTitle(zone);
        else prompt = "";
      }
    }
    life?.sync({
      lots: world.lots,
      leaders: world.leaders,
      projects: content.projects,
      notes: world.notes,
      market: world.market,
      raceNext,
    });
    let tookCamera = false;
    if (!opts.orbit && (playing || localBody)) {
      tookCamera = placeCamera(camera, body, dt);
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
        holder: !!world.me?.holder,
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
    // Shop hats visor / tophat / headphones have no branch in avatar.ts
    // dressPerson, so the player (and remotes) would render no hat at all
    // for them — addHat renders them here instead. Beanie already has a
    // dressPerson branch; cap / antenna / crown do too.
    if (hat === "visor" || hat === "tophat" || hat === "headphones") {
      addHat(group, HAT_BOX, hat);
    }
  }

  function camTitle() {
    if (driving && camMode === "first") return "Cockpit";
    if (camMode === "first") return "First person";
    if (camMode === "far") return "Far camera";
    if (camMode === "selfie") return "Selfie";
    return "Over the shoulder";
  }

  function cameraBlocked(x: number, y: number, z: number) {
    // Grid query, not a full-list scan: pullCamera calls this 48x per
    // frame, and the old linear scan was ~92% of all per-frame collider
    // work. The point query returns exactly the colliders whose XZ
    // footprint contains the point.
    for (const c of colsNear(x, z, x, z)) {
      if (x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) return true;
    }
    return false;
  }

  function pullCamera(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) {
    // 48 samples, not 18: the pulled point used to snap between sample
    // points in ~0.5u jumps as the car moved past a wall; at 48 the
    // steps are ~0.2u and the camera smoother below hides the rest.
    const steps = 48;
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

  // Camera glide: smooths the walking + driving chase branches only
  // (never first-person / spectator). Snaps on teleports / shot changes —
  // past 14 units the smoother snaps on its own; snapCamNext is belt-and-
  // braces for camera-mode changes and applyShot.
  function smoothCamera(desired: Vector3, dt: number) {
    if (snapCamNext) {
      camSmoother.snapTo(desired);
      snapCamNext = false;
    }
    return camSmoother.update(desired, dt);
  }

  function placeCamera(camera: PerspectiveCamera, body: Body, dt: number) {
    if (spectator) {
      hands.visible = false;
      if (orbitOn) {
        const t = clock * 0.12;
        camera.position.set(Math.cos(t) * 26, 10, 12 + Math.sin(t) * 26);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 2, 12);
        return true;
      }
      camera.position.set(body.x, body.y + 1.62, body.z);
      camera.up.set(0, 1, 0);
      const cp = Math.cos(body.pitch);
      const sp = Math.sin(body.pitch);
      camera.lookAt(body.x + Math.sin(body.yaw) * cp, body.y + 1.62 + sp, body.z - Math.cos(body.yaw) * cp);
      return true;
    }
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
      // Chase distance scales with the car: 6 + length (limo ≈ 12.4,
      // board ≈ 6.9). Flying cars lift the camera with their altitude.
      const carLen = (car.group.userData.length as number) || 3.45;
      const dist = (camMode === "selfie" ? 5.2 : camMode === "far" ? 11 : 6 + carLen) * camZoom;
      const side = camMode === "shoulder" ? 1.3 : 0;
      const sign = camMode === "selfie" ? 1 : -1;
      const lookYaw = yaw + chaseYaw;
      const desired = {
        x: car.x + Math.sin(lookYaw) * dist * sign + Math.cos(lookYaw) * side,
        y: (camMode === "selfie" ? 2.2 : 3.6 + chasePitch * 1.6) + car.alt,
        z: car.z - Math.cos(lookYaw) * dist * sign + Math.sin(lookYaw) * side,
      };
      const pulled = pullCamera({ x: car.x, y: 1.3 + car.alt, z: car.z }, desired);
      const smoothed = smoothCamera(new Vector3(pulled.x, Math.max(1.4, pulled.y), pulled.z), dt);
      camera.position.copy(smoothed);
      camera.up.set(0, 1, 0);
      camera.lookAt(car.x, 0.9 + car.alt, car.z);
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
      // Drag up = look up: a higher pitch must DROP the camera (so it looks
      // up at the player), not raise it. The old "+" raised the camera on a
      // drag-up and swung the view down to the ground — inverted in the
      // default shoulder cam (first-person and the driving chase cam already
      // had the correct sign).
      y: body.y + (camMode === "selfie" ? 1.75 : 1.7) - (camMode === "selfie" ? 0 : Math.sin(pitch) * dist * 0.45),
      z: body.z + fz * dist * sign * Math.cos(pitch) + rz * side,
    };
    const pulled = pullCamera({ x: body.x, y: focusY, z: body.z }, desired);
    const smoothed = smoothCamera(new Vector3(pulled.x, Math.max(body.y + 0.4, pulled.y), pulled.z), dt);
    camera.position.copy(smoothed);
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
      body.z = 90;
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
      // Screenshot rig: a local demo booking only — never a real buy.
      const start = new Date();
      const end = new Date(start.getTime() + 7 * 86400000);
      const demo = bookings();
      demo["plaza-east"] = {
        id: "plaza-east",
        project: "OrbitX",
        text: "BOUGHT WITH A BURN",
        image: "",
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
      localStorage.setItem(BOOK_KEY, JSON.stringify(demo));
      redrawBoard("plaza-east");
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
    } else if (shot === "mail") {
      job = "mail";
      phase = 0;
      resolveMailStops();
      void world.jobStart("mail");
      body.x = 10;
      body.y = 0;
      body.z = 17.6;
      body.yaw = Math.PI;
      body.pitch = 0.05;
    } else if (shot === "lifeguard") {
      job = "lifeguard";
      phase = 0;
      void world.jobStart("lifeguard");
      body.x = 0;
      body.y = 0;
      body.z = 206;
      body.yaw = 0;
      body.pitch = 0.05;
    } else if (shot === "cleaner") {
      job = "cleaner";
      phase = 0;
      void world.jobStart("cleaner");
      body.x = 14;
      body.y = 0;
      body.z = -16;
      body.yaw = 0;
      body.pitch = 0.1;
    } else if (shot === "bus") {
      job = "bus";
      phase = 0;
      void world.jobStart("bus");
      body.x = 10;
      body.y = 0;
      body.z = 17.6;
      body.yaw = 0;
      body.pitch = 0.05;
    } else if (shot === "fire") {
      job = "fire";
      phase = 0;
      void world.jobStart("fire");
      body.x = 18;
      body.y = 0;
      body.z = 72;
      body.yaw = 0;
      body.pitch = 0.05;
    } else if (shot === "doctor") {
      job = "doctor";
      phase = 0;
      void world.jobStart("doctor");
      body.x = 41.6;
      body.y = 0;
      body.z = 90;
      body.yaw = Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "teacher") {
      job = "teacher";
      phase = 0;
      void world.jobStart("teacher");
      body.x = -77.6;
      body.y = 0;
      body.z = 163;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "shootout") {
      body.x = 121;
      body.y = 0;
      body.z = 215;
      body.yaw = Math.PI;
      body.pitch = 0.05;
      startShootout(body);
    } else if (shot === "treasure") {
      startTreasureHunt();
      body.x = 0;
      body.y = 0;
      body.z = 240;
      body.yaw = 0;
      body.pitch = 0.05;
    } else if (shot === "coinhunt") {
      startCoinHunt();
      body.x = 0;
      body.y = 0;
      body.z = -17;
      body.yaw = Math.PI;
      body.pitch = 0.08;
    } else if (shot === "fishing") {
      body.x = 0;
      body.y = 0;
      body.z = 222;
      body.yaw = 0;
      body.pitch = 0.1;
      startFishing(body);
      // Hold a bite open for the screenshot instead of the 1.6s window.
      window.setTimeout(() => {
        if (miniGame !== "fishing") return;
        fishState = "bite";
        fishBiteUntil = Date.now() + 30000;
        say("Bite! Strike now!");
        publish();
      }, 4000);
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
    } else if (shot === "property" || shot === "sale" || shot === "decorate") {
      void showProperty(shot, body);
    } else if (shot === "hq" || shot === "hq-edit") {
      const zone = zones.find((item) => item.id === "project-0");
      if (zone) {
        body.x = (zone.minX + zone.maxX) / 2;
        body.y = 0;
        body.z = (zone.minZ + zone.maxZ) / 2;
        body.yaw = Math.atan2(zone.signX - body.x, -(zone.signZ - body.z));
        body.pitch = 0.05;
        hqIndex = 0;
      }
      if (shot === "hq-edit") {
        panel = "hq";
        void world.buyLot("hq-0").then(() => {
          applyMe();
          publish();
        }).catch(() => publish());
      }
    } else if (shot === "board" || shot === "leaders") {
      body.flying = false;
      body.x = 0;
      body.y = 0;
      body.z = 19.2;
      body.yaw = Math.PI;
      body.pitch = 0.2;
      camMode = "first";
      if (shot === "leaders") panel = "leaders";
    } else if (shot === "board-s") {
      // Plaza board from the south (spawn) side — the back face. Same board,
      // opposite side: the text must read correctly here too.
      body.flying = false;
      body.x = 0;
      body.y = 0;
      body.z = 38;
      body.yaw = 0;
      body.pitch = 0.15;
      camMode = "first";
    } else if (shot === "road") {
      // Street-level road view: the crosswalk at (0, 61.5) ahead, the road
      // running north to the plaza. Checks asphalt tone + stripe size.
      body.flying = false;
      body.x = 0;
      body.y = 0;
      body.z = 56;
      body.yaw = 0;
      body.pitch = 0.08;
      camMode = "first";
    } else if (shot === "garage") {
      // E-priority probe: the garage door anchor (77.6, 54) is 5.6 units
      // from the garage-row car (72, 54), inside the car's 7-unit entry
      // radius. Pressing E here must walk into the garage, not enter the car.
      body.flying = false;
      body.x = 77.6;
      body.y = 0;
      body.z = 54;
      body.yaw = Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "race" || shot === "race-run") {
      body.x = 36;
      body.y = 0;
      body.z = -14;
      body.yaw = Math.PI;
      body.pitch = 0.1;
      if (shot === "race-run") {
        void (async () => {
          await world.raceLeave().catch(() => {});
          await startRace("street");
          await new Promise((resolve) => setTimeout(resolve, 6000));
          for (const gate of GATES) {
            await new Promise((resolve) => setTimeout(resolve, 800));
            try {
              const data = await world.raceHit(gate.x, gate.z, false);
              say(String(data.message || "Gate"));
            } catch (err) {
              say(err instanceof Error ? err.message : "Missed a gate");
            }
          }
          publish();
        })();
      } else {
        void startRace("street");
      }
    } else if (shot === "hover") {
      const car = cars[2] || cars[0];
      if (car) {
        car.x = 36;
        car.z = -14;
        car.yaw = Math.PI;
        car.group.position.set(36, 0.12, -14);
        body.x = 36;
        body.z = -14;
        enterCar(body, cars.indexOf(car));
      }
      void world.raceLeave().then(() => startRace("hover")).catch(() => startRace("hover"));
    } else if (shot === "arcade") {
      const zone = zones.find((item) => item.id === "arcade");
      if (zone) {
        body.x = zone.serviceX;
        body.y = 0;
        body.z = zone.serviceZ + 1.2;
        body.yaw = Math.atan2(zone.serviceX - body.x, -(zone.serviceZ - body.z));
      }
      panel = "arcade";
    } else if (shot === "daily" || shot === "wallet") {
      void world.refresh().then(() => {
        panel = shot === "daily" ? "daily" : "wallet";
        if (shot === "wallet" && !world.me?.account) {
          world.walletNote = "Sign in to open the in-app wallet. This shot is still a guest.";
        }
        publish();
      });
    } else if (shot === "emote") {
      void world.raceLeave().catch(() => {});
      raceNext = -1;
      raceHoldUntil = 0;
      body.x = 14;
      body.y = 0;
      body.z = 12;
      body.yaw = -Math.PI / 2;
      body.pitch = 0;
      camMode = "selfie";
      wheelOpen = true;
      wheelIndex = 1;
      world.emote = "dance";
      world.emoteUntil = Date.now() + 20000;
    } else if (shot === "spectate" || shot === "spectate-ui") {
      void world.raceLeave().catch(() => {});
      raceNext = -1;
      raceHoldUntil = 0;
      spectator = true;
      orbitOn = true;
      body.flying = true;
      clean = shot === "spectate";
      hideHud = shot === "spectate";
      hideNames = true;
      hideChat = true;
    } else if (shot === "mall") {
      body.x = 50;
      body.y = 0;
      body.z = 0;
      body.yaw = Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "mall2") {
      body.x = 72;
      body.y = 5; // mall mezzanine floor — on the ring (z 20), NOT over
      body.z = 20; // the atrium void (x 63..81, z -9..9), which drops the
      body.yaw = 0; // player to the ground floor.
      body.pitch = 0.12;
    } else if (shot === "mallk") {
      // Mall directory kiosk by the west door, facing east into the mall.
      body.x = 56;
      body.y = 0;
      body.z = 0;
      body.yaw = Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "malln") {
      // Mall ground-floor north strip seating, facing north from the atrium.
      body.x = 72;
      body.y = 0;
      body.z = 6;
      body.yaw = Math.PI;
      body.pitch = 0.08;
    } else if (shot === "office") {
      body.x = -84;
      body.y = 0;
      body.z = 2;
      body.yaw = 1.5; // face east at the reception desk (-72, 3.4)
      body.pitch = 0.05;
    } else if (shot === "office2") {
      body.x = -70; // Floor 3: stand by the desk rows, face west at them.
      body.y = 12;
      body.z = -2;
      body.yaw = -1.1;
      body.pitch = 0.05;
    } else if (shot === "roof") {
      body.x = -80;
      body.y = 20;
      body.z = 0;
      body.yaw = Math.PI / 2;
      body.pitch = 0.15;
    } else if (shot === "home") {
      const zone = zones.find((item) => item.id.startsWith("home-"));
      if (zone) {
        body.x = (zone.minX + zone.maxX) / 2;
        body.y = 0;
        body.z = (zone.minZ + zone.maxZ) / 2;
        body.yaw = Math.atan2(zone.serviceX - body.x, -(zone.serviceZ - body.z));
        body.pitch = 0.05;
      }
    } else if (shot === "yard") {
      const anchor = anchors.find((item) => item.id.startsWith("home-"));
      if (anchor) {
        body.x = anchor.x - Math.sin(anchor.yaw) * 5;
        body.y = 0;
        body.z = anchor.z + Math.cos(anchor.yaw) * 5;
        body.yaw = anchor.yaw;
        body.pitch = 0.08;
      }
    } else if (shot === "street") {
      // Residential street: 9 units back from the first home's door, on the
      // road (the road is only 10 wide — 16 would land inside the next lot),
      // so the house plus its neighbours fill the frame.
      const anchor = anchors.find((item) => item.id.startsWith("home-"));
      if (anchor) {
        body.x = anchor.x - Math.sin(anchor.yaw) * 9;
        body.y = 0;
        body.z = anchor.z + Math.cos(anchor.yaw) * 9;
        body.yaw = anchor.yaw;
        body.pitch = 0.1;
      }
    } else if (shot === "stores") {
      // The avenue looking north into downtown: storefronts on both sides,
      // towers behind. Shop (east) and cafe (west) flank the road.
      body.flying = false;
      body.x = 0;
      body.y = 0;
      body.z = 88;
      body.yaw = 0;
      body.pitch = 0.1;
      camMode = "first";
    } else if (shot === "malldoor") {
      // Outside the mall's west door, 1.5 units from the door anchor
      // (41.6, 0) — inside the 3.3-unit E range. Pressing E must walk in.
      body.flying = false;
      body.x = 40.1;
      body.y = 0;
      body.z = 0;
      body.yaw = Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "officedoor") {
      // Outside the HQ's east door, 1.5 units from the door anchor
      // (-41.6, 0). Pressing E must walk in.
      body.flying = false;
      body.x = -40.1;
      body.y = 0;
      body.z = 0;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "homedoor") {
      // Outside home-0's east door, 1.5 units from the door anchor
      // (-149.6, -53.5). Pressing E must walk in.
      body.flying = false;
      body.x = -148.1;
      body.y = 0;
      body.z = -53.5;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.05;
    } else if (shot === "homefront") {
      // Home-0 from the far edge of the road, camera pitched up so the
      // whole house — wall to roof apex — is in frame.
      body.flying = false;
      body.x = -135.5;
      body.y = 0;
      body.z = -53.5;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.25;
    } else if (shot === "streetup") {
      // Same spot as "street", pitched up like "homefront" — a control
      // for the red mass seen in the homefront frame.
      body.flying = false;
      body.x = -140.6;
      body.y = 0;
      body.z = -53.5;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.25;
    } else if (shot === "homediag") {
      // Home-0 from the road to the south-west, diagonal 3/4 view so the
      // hip roof reads in 3D instead of edge-on.
      body.flying = false;
      body.x = -140;
      body.y = 0;
      body.z = -75;
      body.yaw = -2.34;
      body.pitch = 0.15;
    } else if (shot === "npc") {
      // Plaza regular Rio, at talk range, facing him.
      body.flying = false;
      body.x = 5;
      body.y = 0;
      body.z = 21;
      body.yaw = 0;
      body.pitch = 0.05;
    } else if (shot === "talkm") {
      // Barista Mina inside Cafe Nova, at talk range (she gives the barista job).
      body.flying = false;
      body.x = -17;
      body.y = 0;
      body.z = 54;
      body.yaw = -Math.PI / 2;
      body.pitch = 0.02;
    } else if (shot === "wish") {
      // Fountain ring: close enough to wish, facing the water.
      body.flying = false;
      body.x = -4;
      body.y = 0;
      body.z = 19;
      body.yaw = 0.5;
      body.pitch = 0.06;
    } else if (shot === "dance") {
      // Community Hall dance floor, at step-on range.
      body.flying = false;
      body.x = 48;
      body.y = 0;
      body.z = 91.5;
      body.yaw = 0;
      body.pitch = 0.02;
    } else if (shot === "photo") {
      // Fountain photo spot, at snap range.
      body.flying = false;
      body.x = 14;
      body.y = 0;
      body.z = 14;
      body.yaw = 0;
      body.pitch = 0.05;
    } else if (shot === "liftcall") {
      // Stand at the HQ lift call button in the lobby, facing the shaft.
      body.x = -93.5;
      body.y = 0;
      body.z = -25;
      body.yaw = -Math.PI / 2;
      body.pitch = 0;
    } else if (shot === "lift") {
      // Stand inside the HQ lift at the lobby, door open, facing the landing.
      const lift = lifts.find((item) => item.id === "hq-lift");
      if (lift) {
        body.x = lift.x;
        body.y = lift.floors[0];
        body.z = lift.z;
        body.yaw = Math.PI / 2;
        body.pitch = 0;
        liftOpen = { liftId: lift.id, floor: 0 };
        refreshActiveCols();
        const cab = liftCabs.get(lift.id);
        if (cab) cab.doorTarget = 1;
      }
    }
    snapCamNext = true;
    publish();
  }

  async function showProperty(shot: string, body: Body) {
    if (world.online && shot !== "sale") {
      try {
        const data = await world.buyLot("loft");
        applyMe();
        say(String(data.message || "Bought."));
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!/already own/i.test(message)) say(message);
      }
    }
    if (shot === "decorate") {
      const zone = zones.find((item) => item.id === "hall");
      if (zone) {
        body.x = zone.minX + 2.4;
        body.y = 0;
        body.z = (zone.minZ + zone.maxZ) / 2;
        body.yaw = Math.PI / 2;
        const pieces = [
          { id: "couch", kind: "couch", x: body.x + 2.2, z: body.z - 1.1, rot: 0.2 },
          { id: "table", kind: "table", x: body.x + 2.4, z: body.z + 1.2, rot: 1 },
          { id: "plant", kind: "plant", x: body.x + 3.6, z: body.z + 0.2, rot: 0 },
          { id: "lamp", kind: "lamp", x: body.x + 1.2, z: body.z + 1.8, rot: 0 },
        ];
        try {
          await world.saveFurniture("loft", pieces);
        } catch {
          // The room still shows whatever the server already stored.
        }
      }
      decorating = true;
      decorKind = "couch";
    } else if (shot === "sale") {
      body.x = -18;
      body.y = 0;
      body.z = 70;
      body.yaw = Math.PI;
      body.pitch = 0.28;
      camMode = "far";
    } else {
      body.x = 31.5;
      body.y = 0;
      body.z = 15;
      body.yaw = Math.atan2(41.6 - 31.5, -(18 - 15));
      body.pitch = 0.22;
      camMode = "far";
    }
    publish();
  }

  // Real billboard flow (online): the buy sends the swap and returns at
  // once; the order is polled until it is live. The App panel owns the
  // polling. The offline branch below is the this-device-only demo booking.
  async function book(id: string, days: number, project = wallet.name, text = "NEW CAMPAIGN") {
    if (world.online) {
      try {
        const data = await world.book(id, days, project, text, crypto.randomUUID());
        if (!data.ok) {
          const message = String(data.message || "Booking refused.");
          say(message);
          return { ok: false as const, message };
        }
        const message = String(data.message || "Swap sent.");
        say(message);
        return { ok: true as const, message, order: data.order as AdOrder | undefined };
      } catch (err) {
        const message = err instanceof Error ? err.message : "The city refused the booking.";
        say(message);
        return { ok: false as const, message };
      }
    }
    const price = DEMO_AD_PRICE[days] ?? 25;
    const result = spend(wallet, price, `ad-${id}-${Date.now()}`);
    if (!result.ok) {
      say(result.message);
      return { ok: false as const, message: result.message };
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
    return { ok: true as const, message };
  }

  async function quoteAd(id: string, days: number) {
    if (!world.online) return { ok: false as const, message: "Sign in to price a real billboard. Guests use City Sol only." };
    try {
      return await world.adQuote(id, days);
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "The quote failed." };
    }
  }

  async function adStatus(orderId: string) {
    if (!world.online) return { ok: false as const, message: "Offline." };
    try {
      return await world.adStatus(orderId);
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Status check failed." };
    }
  }

  async function adRetryBurn(orderId: string) {
    if (!world.online) return { ok: false as const, message: "Offline." };
    try {
      return await world.adRetryBurn(orderId);
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Burn retry failed." };
    }
  }

  async function adRemove(board: string) {
    if (!world.online) return { ok: false as const, message: "Offline." };
    try {
      return await world.adRemove(board);
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Removal failed." };
    }
  }

  async function adOrders() {
    if (!world.online) return { ok: false as const, message: "Offline.", orders: [] as AdOrder[] };
    try {
      return await world.adOrders();
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Could not load your ads.", orders: [] as AdOrder[] };
    }
  }

  // In-game radio: the playlist is shared, the sound is personal.
  async function radioList() {
    if (!world.online) return { ok: false as const, message: "Offline.", tracks: [] as RadioTrack[] };
    try {
      return await world.radioList();
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Could not load the radio.", tracks: [] as RadioTrack[] };
    }
  }

  async function radioUploadUrl(name: string, size: number) {
    if (!world.online) return { ok: false as const, message: "Offline." };
    try {
      return await world.radioUploadUrl(name, size);
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Could not start the upload." };
    }
  }

  async function radioRegister(name: string, path: string) {
    if (!world.online) return { ok: false as const, message: "Offline." };
    try {
      return await world.radioRegister(name, path);
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Could not add the track." };
    }
  }

  // GTA garage buy — mirrors buy() (vehicles WIRING.md §2). City Sol
  // only, no burn: vehicles are a purchase, not a burn event.
  async function buyCar(id: string, color: string) {
    const v = getVehicle(id);
    if (!v) {
      triggerHaptic("error");
      return "Unknown vehicle.";
    }
    if (world.online) {
      if (!currentUniverse) {
        const message = "Pick a universe on the menu first.";
        say(message);
        triggerHaptic("error");
        return message;
      }
      try {
        const data = await world.buyCar(id, color, currentUniverse);
        applyMe();
        spawnActiveCar();
        triggerHaptic("success");
        publish();
        say(String(data.message || "Bought."));
        return String(data.message || "Bought.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "The city refused the purchase.";
        say(message);
        triggerHaptic("error");
        return message;
      }
    }
    // Offline: local wallet only, never synced — the panel says so.
    if (localVehicles.some((owned) => owned.id === id)) {
      localActiveVehicle = id;
      saveLocalVehicles();
      spawnActiveCar();
      publish();
      say("Already yours. Equipped. Saved on this device only.");
      return "Already yours. Equipped.";
    }
    if (wallet.balance < v.price) {
      const message = "Not enough City Sol.";
      say(message);
      triggerHaptic("error");
      return message;
    }
    wallet.balance -= v.price;
    saveWallet(wallet);
    localVehicles = [...localVehicles, { id, color }];
    localActiveVehicle = id;
    saveLocalVehicles();
    spawnActiveCar();
    triggerHaptic("success");
    publish();
    say(`Bought ${v.name} for ${v.price} City Sol. Saved on this device only.`);
    return `Bought ${v.name} for ${v.price} City Sol.`;
  }

  async function selectCar(id: string) {
    if (!world.online && !localVehicles.some((v) => v.id === id)) {
      triggerHaptic("error");
      return "You do not own that vehicle.";
    }
    if (world.online) {
      if (!currentUniverse) {
        const message = "Pick a universe on the menu first.";
        say(message);
        triggerHaptic("error");
        return message;
      }
      try {
        await world.selectCar(id, currentUniverse);
        applyMe();
        spawnActiveCar();
        triggerHaptic("success");
        publish();
        say("Selected.");
        return "Selected.";
      } catch (err) {
        const message = err instanceof Error ? err.message : "The city refused the switch.";
        say(message);
        triggerHaptic("error");
        return message;
      }
    }
    localActiveVehicle = id;
    saveLocalVehicles();
    spawnActiveCar();
    publish();
    say("Selected. Saved on this device only.");
    return "Selected.";
  }

  // GTA home buy — City Sol only, per (player, universe).
  async function buyHome(homeId: string) {
    const home = homeById(homeId);
    if (!home) {
      triggerHaptic("error");
      return "Unknown home.";
    }
    if (world.online) {
      if (!currentUniverse) {
        const message = "Pick a universe on the menu first.";
        say(message);
        triggerHaptic("error");
        return message;
      }
      try {
        const data = await world.buyHome(homeId, currentUniverse);
        applyMe();
        triggerHaptic("success");
        publish();
        say(String(data.message || `Bought ${home.name} for ${home.price} City Sol.`));
        return String(data.message || "Bought.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "The city refused the purchase.";
        say(message);
        triggerHaptic("error");
        return message;
      }
    }
    // Offline: same checks as the server (buyHomeLocal), local save only.
    // No universe picked yet means the device-only save, universe 1.
    const server = (currentUniverse ?? 1) as 1 | 2 | 3 | 4 | 5;
    const result = buyHomeLocal(localHomes, world.id || wallet.name, wallet.name, homeId, server, wallet.balance);
    if (!result.ok) {
      say(result.message);
      triggerHaptic("error");
      return result.message;
    }
    wallet.balance -= result.price;
    saveWallet(wallet);
    localHomes = result.save;
    saveLocalHomes();
    triggerHaptic("success");
    publish();
    say(`Bought ${home.name} for ${result.price} City Sol. Saved on this device only.`);
    return `Bought ${home.name} for ${result.price} City Sol.`;
  }

  // Ownership on the CURRENT universe, for the Home panel. Online it asks
  // the server; offline it reads the local save.
  async function homeStatus() {
    if (world.online && currentUniverse) {
      try {
        const data = await world.homeStatus(currentUniverse);
        return { ok: true as const, homeServer: Number(data.homeServer || 0), mine: (data.mine as OwnedHome[]) || [] };
      } catch (err) {
        return { ok: false as const, message: err instanceof Error ? err.message : "Could not load homes.", homeServer: 0, mine: [] as OwnedHome[] };
      }
    }
    const server = currentUniverse ?? 0;
    return { ok: true as const, homeServer: localHomes.homeServer, mine: localHomes.homes.filter((h) => h.server === server) };
  }

  // Everything the player owns on the CURRENT universe, for the HUD's
  // "My Props" panel. One server round-trip (my-properties); offline the
  // local save only knows homes and its owned-lot list, so offices come
  // back empty.
  async function myProperties() {
    if (world.online && currentUniverse) {
      try {
        const data = await world.myProperties(currentUniverse);
        return {
          ok: true as const,
          server: Number(data.server || currentUniverse),
          lots: (data.lots as string[]) || [],
          offices: (data.offices as MyPropertyClaim[]) || [],
          homes: (data.homes as OwnedHome[]) || [],
        };
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : "Could not load your properties.",
          server: currentUniverse,
          lots: [] as string[],
          offices: [] as MyPropertyClaim[],
          homes: [] as OwnedHome[],
        };
      }
    }
    const server = currentUniverse ?? 0;
    return {
      ok: true as const,
      server,
      lots: [...((world.me?.owned as string[]) || [])],
      offices: [] as MyPropertyClaim[],
      homes: localHomes.homes.filter((h) => h.server === server),
    };
  }

  function setUniverse(id: number) {
    if (!isUniverseId(id)) return;
    currentUniverse = id;
    try {
      localStorage.setItem("orbitx-universe", String(id));
    } catch {
      // The selection still applies for this session.
    }
    publish();
  }

  // Join a universe (menu / Multiverse panel): loads that universe's own
  // save, re-spawns that universe's active car, updates the HUD tag.
  async function joinUniverse(id: number) {
    if (!isUniverseId(id)) throw new Error("Pick Universe 1 to 5.");
    const result = await universeJoin(id);
    currentUniverse = result.universe.id;
    universeIsHome = result.isHome;
    try {
      localStorage.setItem("orbitx-universe", String(id));
    } catch {
      // The selection still applies for this session.
    }
    applyMe();
    spawnActiveCar();
    publish();
    return result;
  }

  async function travelUniverse(id: number) {
    if (!isUniverseId(id)) throw new Error("Pick Universe 1 to 5.");
    const result = await universeTravel(id);
    currentUniverse = result.universe.id;
    universeIsHome = result.isHome;
    try {
      localStorage.setItem("orbitx-universe", String(id));
    } catch {
      // The selection still applies for this session.
    }
    applyMe();
    spawnActiveCar();
    publish();
    return result;
  }

  // District offices — City Sol leases, per (player, universe).
  async function claimDistrictOffice(suite: string, termDays: 1 | 7 | 30, project: string, logo: string, site: string) {
    if (!world.online || !currentUniverse) {
      const message = "Sign in and pick a universe to claim an office.";
      say(message);
      triggerHaptic("error");
      return { ok: false as const, message };
    }
    try {
      const data = await world.districtOfficeClaim(suite, currentUniverse, termDays, project, logo, site);
      applyMe();
      triggerHaptic("success");
      publish();
      say(String(data.message || "Claimed."));
      return { ok: true as const, message: String(data.message || "Claimed."), offices: (data.offices as unknown[]) || [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Claim failed.";
      say(message);
      triggerHaptic("error");
      return { ok: false as const, message };
    }
  }

  async function loadDistrictOffices(district: string) {
    if (!world.online || !currentUniverse) {
      return { ok: false as const, message: "Sign in and pick a universe first.", offices: [] as unknown[] };
    }
    try {
      const data = await world.districtOfficeClaims(district, currentUniverse);
      return { ok: true as const, offices: (data.offices as unknown[]) || [] };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Could not load the directory.", offices: [] as unknown[] };
    }
  }

  async function releaseDistrictOffice(suite: string) {
    if (!world.online || !currentUniverse) {
      return { ok: false as const, message: "Sign in and pick a universe first." };
    }
    try {
      const data = await world.districtOfficeRelease(suite, currentUniverse);
      applyMe();
      publish();
      say(String(data.message || "Released."));
      return { ok: true as const, message: String(data.message || "Released."), offices: (data.offices as unknown[]) || [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Release failed.";
      say(message);
      triggerHaptic("error");
      return { ok: false as const, message };
    }
  }

  async function buy(id: string) {
    const item = SHOP_CATALOG.find((entry) => entry.id === id);
    if (!item) return "Unknown item.";
    if (world.online) {
      try {
        const data = await world.spend(id);
        applyMe();
        equip(item);
        triggerHaptic("success");
        say(String(data.message || "Bought."));
        // Mission chain: a bought item is the "buy" step (server-verified
        // against the owned-count snapshot).
        void attemptMission();
        return String(data.message || "Bought.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "The city refused the purchase.";
        say(message);
        triggerHaptic("error");
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
    if (result.ok) triggerHaptic("success");
    else triggerHaptic("error");
    say(result.message);
    return result.message;
  }

  function equip(item: ShopCatalogItem) {
    if (item.kind === "color") wallet.color = item.value;
    if (item.kind === "hat") wallet.hat = item.value;
    if (item.kind === "trail") {
      trail = item.value;
      saveTrail();
    }
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
    colsNear,
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
    say,
    rideLift,
    consumeLook,
    setStick(x: number, y: number) {
      stickX = x;
      stickY = y;
    },
    addLook(dx: number, dy: number) {
      lookX += dx;
      lookY += dy;
    },
    hold(action: "jump" | "down" | "gas" | "brake", down: boolean) {
      if (action === "jump") holdJump = down;
      else if (action === "down") holdDown = down;
      else if (action === "gas") holdGas = down;
      else holdBrake = down;
    },
    toggleFly(body?: Body) {
      const who = body ?? lastBody;
      if (!who) return;
      // Driving? Step out of the car first, then fly. Before, the button
      // silently no-op'd while driving (the `driving` early return), so a
      // player driving around who tapped Fly saw nothing happen at all.
      if (driving) exitCar(who);
      who.flying = !who.flying;
      who.vy = 0;
      if (who.flying) {
        // Lift off the ground a touch so the tap is visibly doing
        // something. Before, the player stayed at y=0 until they held
        // Jump, so the button looked dead. Outdoors only — indoors there
        // may be a ceiling right above.
        if (!insideName) who.y += 0.6;
        say("Flying — hold Jump to climb, Down to come down.");
      } else {
        say("Walking.");
      }
    },
    setPaused(on: boolean) {
      paused = on;
      if (on) {
        stickX = 0;
        stickY = 0;
        holdGas = false;
        holdBrake = false;
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
    quoteAd,
    adStatus,
    adRetryBurn,
    adRemove,
    adOrders,
    radioList,
    radioUploadUrl,
    radioRegister,
    cycleCamera() {
      triggerHaptic("tap");
      const index = CAMS.indexOf(camMode);
      camMode = CAMS[(index + 1) % CAMS.length];
      localStorage.setItem("orbitx-cam", camMode);
      snapCamNext = true;
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
      if (miniGame) {
        say("Finish your game first — one gig at a time.");
        return;
      }
      job = id;
      phase = 0;
      dwell = 0;
      mailStops = [];
      if (id === "mail") resolveMailStops();
      riderOn = false;
      void world.jobStart(id);
      say(`${jobTitle(id)} started.`);
    },
    talkNext() {
      if (!talk || !talkLines.length) return;
      const next = (talk.index + 1) % talkLines.length;
      talk = { ...talk, line: talkLines[next], index: next };
      publish();
    },
    // Run the talking NPC's offer — a real City Sol exchange: a draw (pay
    // in, random pay back), a tip (pay in, a useful line out), a quest
    // (one-time, gated on a photo the player already took, fixed reward),
    // or work (pay a small cost up front, fixed pay for the task).
    npcOffer() {
      if (!talk || talkNpc < 0) return;
      const npc = npcs[talkNpc];
      const offer = NPC_LINES[npc.name]?.offer;
      if (!offer) return;
      const showLine = (line: string) => {
        talk = { ...talk!, line };
        publish();
      };
      if (offer.kind === "quest") {
        const key = `${npc.name}:${offer.needPhoto ?? "quest"}`;
        if (questsDone.includes(key)) {
          say("That one's done — find me again when the city has new work.");
          return;
        }
        if (offer.needPhoto && !photoSpots.includes(offer.needPhoto)) {
          const spot = PHOTO_SPOTS.find((item) => item.id === offer.needPhoto);
          say(`Snap the ${spot?.name ?? "photo"} first, then show me. The spot's on your map.`);
          return;
        }
        questsDone.push(key);
        saveQuestsDone();
        const amount = offer.reward ?? 0;
        say(earn(wallet, amount, `${npc.name}'s quest`));
        triggerHaptic("jobPay");
        showLine(offer.done.replace("{reward}", String(amount)));
        return;
      }
      if (offer.kind === "tip") {
        if (wallet.balance < offer.cost) {
          say(`That costs ${offer.cost} City Sol — come back richer.`);
          return;
        }
        wallet.balance -= offer.cost;
        saveWallet(wallet);
        const tip = offer.tips?.length
          ? offer.tips[Math.floor(Math.random() * offer.tips.length)]
          : offer.done;
        showLine(tip);
        say(`Paid ${offer.cost} City Sol for the tip.`);
        return;
      }
      if (offer.kind === "work") {
        if (wallet.balance < offer.cost) {
          say(`You need ${offer.cost} City Sol for the seed.`);
          return;
        }
        wallet.balance -= offer.cost;
        const amount = offer.reward ?? 0;
        wallet.balance += amount;
        saveWallet(wallet);
        burst(npc.x, 2.2, npc.z);
        showLine(offer.done.replace("{reward}", String(amount)));
        say(`Planted. The park pays ${amount} City Sol for the bloom.`);
        return;
      }
      // draw — a lucky seat: pay the ticket, roll a random seat reward.
      if (wallet.balance < offer.cost) {
        say(`A ticket costs ${offer.cost} City Sol — come back richer.`);
        return;
      }
      wallet.balance -= offer.cost;
      const table = offer.drawRewards ?? [0];
      const roll = Math.random();
      const reward =
        roll < 0.4 ? (table[0] ?? 0)
        : roll < 0.7 ? (table[1] ?? table[0] ?? 0)
        : roll < 0.9 ? (table[2] ?? table[0] ?? 0)
        : (table[3] ?? table[0] ?? 0);
      wallet.balance += reward;
      saveWallet(wallet);
      if (reward > 0) burst(npc.x, 2.2, npc.z);
      showLine(reward > 0 ? `Lucky seat! The house returns ${reward} City Sol.` : "No luck this time — the seat stays dark.");
      say(reward > 0 ? `Lucky seat — ${reward} City Sol back!` : "No luck on the lucky seat.");
    },
    closeTalk() {
      talk = null;
      talkLines = [];
      talkNpc = -1;
      publish();
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
        // Mission chain: saying hello is the "chat" step (client-attested).
        void attemptMission();
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
      world.emoteUntil = Date.now() + 3200;
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
    frozen: () => Date.now() < raceHoldUntil,
    decorating: () => decorating,
    wheeling: () => wheelOpen,
    setWheel(open: boolean) {
      wheelOpen = open;
      if (open) wheelIndex = 0;
      publish();
    },
    aimWheel(dx: number, dy: number) {
      if (!wheelOpen) return;
      if (dx * dx + dy * dy < 36) return;
      const angle = Math.atan2(dy, dx);
      const slice = (angle + Math.PI / 2) / (Math.PI * 2);
      wheelIndex = Math.floor((((slice % 1) + 1) % 1) * EMOTES.length) % EMOTES.length;
      publish();
    },
    commitWheel() {
      if (!wheelOpen) return;
      wheelOpen = false;
      const name = EMOTES[wheelIndex] || "wave";
      world.emote = name;
      world.emoteUntil = Date.now() + 3200;
      publish();
    },
    toggleDecor() {
      const lot = currentLot();
      if (!decorating && (!lot || lot.ownerId !== world.id)) {
        decorating = false;
        say(lot ? "Only the owner can decorate." : "Step inside a place you own, then press X.");
        publish();
        return;
      }
      decorating = !decorating;
      publish();
    },
    pickFurniture(kind: string) {
      if ((FURNITURE as readonly string[]).includes(kind)) decorKind = kind as (typeof FURNITURE)[number];
      publish();
    },
    spinDecor(dir: number) {
      decorRot += dir * 0.45;
    },
    placeFurniture() {
      const lot = currentLot();
      if (!lot || lot.ownerId !== world.id || !lastBody) {
        say("Stand inside your place to drop furniture.");
        return;
      }
      const zone = zones.find((item) => item.id === lot.zone);
      if (!zone) return;
      const x = Math.min(zone.maxX - 1.3, Math.max(zone.minX + 1.3, lastBody.x + Math.sin(lastBody.yaw) * 1.5));
      const z = Math.min(zone.maxZ - 1.3, Math.max(zone.minZ + 1.3, lastBody.z - Math.cos(lastBody.yaw) * 1.5));
      const furniture = [...lot.furniture, { id: `f${Date.now().toString(36)}`, kind: decorKind, x, z, rot: decorRot }];
      void world.saveFurniture(lot.id, furniture).then(() => say(`Placed a ${decorKind}.`)).catch((err) => say(err.message));
    },
    removeFurniture() {
      const lot = currentLot();
      if (!lot || lot.ownerId !== world.id || !lastBody) return;
      let best = -1;
      let bestD = 2.4;
      lot.furniture.forEach((piece, index) => {
        const d = Math.hypot(piece.x - (lastBody?.x || 0), piece.z - (lastBody?.z || 0));
        if (d < bestD) {
          best = index;
          bestD = d;
        }
      });
      if (best < 0) {
        say("Stand next to a piece to remove it.");
        return;
      }
      const furniture = lot.furniture.filter((_, index) => index !== best);
      void world.saveFurniture(lot.id, furniture).then(() => say("Removed.")).catch((err) => say(err.message));
    },
    buyLot(id: string) {
      void world.buyLot(id).then((data) => {
        applyMe();
        triggerHaptic("success");
        say(String(data.message || "Bought."));
      }).catch((err) => {
        triggerHaptic("error");
        say(err.message);
      });
    },
    claimDaily() {
      void world.claimDaily().then((data) => {
        applyMe();
        triggerHaptic("success");
        say(String(data.message || "Claimed."));
        // Mission chain: a claimed daily is the "daily" step
        // (server-verified against the daily claim).
        void attemptMission();
      }).catch((err) => {
        triggerHaptic("error");
        say(err.message);
      });
    },
    // Mission chain + new earning (fix-client) — the Missions panel.
    loadMissions() {
      void loadMissions();
    },
    attemptMission(missionId = "") {
      void attemptMission(missionId);
    },
    buskNow() {
      buskNow();
    },
    takeSafariPhoto(place: string) {
      takeSafariPhoto(place);
    },
    setAnnouncement(index: number, text: string) {
      void world.setAnnouncement(`hq-${index}`, text).then((data) => say(String(data.message || "Saved."))).catch((err) => say(err.message));
    },
    setBrand(index: number, name: string, line: string, site: string) {
      void world.setBrand(`hq-${index}`, name, line, site).then((data) => say(String(data.message || "Branded."))).catch((err) => say(err.message));
    },
    hostEvent(index: number, title: string, when: string, detail: string) {
      void world.hostEvent(`hq-${index}`, title, when, detail).then((data) => say(String(data.message || "Event posted."))).catch((err) => say(err.message));
    },
    buyBusiness(kind: string) {
      void world.buyBusiness(kind).then((data) => {
        applyMe();
        say(String(data.message || "Business open."));
      }).catch((err) => say(err.message));
    },
    collectBusiness() {
      void world.collectBusiness().then((data) => {
        applyMe();
        say(String(data.message || "Collected."));
      }).catch((err) => say(err.message));
    },
    payRent(lot: string) {
      void world.payRent(lot).then((data) => {
        applyMe();
        say(String(data.message || "Paid."));
      }).catch((err) => say(err.message));
    },
    startRace(kind: "street" | "hover") {
      void startRace(kind);
    },
    startCoinHunt() {
      startCoinHunt();
    },
    startFishing() {
      startFishing();
    },
    startShootout() {
      startShootout();
    },
    startTreasureHunt() {
      startTreasureHunt();
    },
    leaveRace() {
      raceNext = -1;
      raceHoldUntil = 0;
      void world.raceLeave().then((data) => say(String(data.message || "Left."))).catch((err) => say(err.message));
    },
    arcadeDeal() {
      return world.arcadePlay().then((data) => {
        applyMe();
        say(String(data.message || "Dealt."));
        return { shown: Number(data.shown || 0), token: String(data.token || "") };
      }).catch((err) => {
        say(err.message);
        return null;
      });
    },
    arcadeGuess(guess: "high" | "low", token: string) {
      void world.arcadePlay({ guess, token }).then((data) => {
        applyMe();
        say(String(data.message || "Resolved."));
      }).catch((err) => say(err.message));
    },
    arcadeArm() {
      return world.arcadeArm().then((data) => {
        applyMe();
        say(String(data.message || "Armed."));
        return { goAt: Number(data.goAt || 0), token: String(data.token || "") };
      }).catch((err) => {
        say(err.message);
        return null;
      });
    },
    arcadeHit(token: string) {
      void world.arcadeHit(token).then((data) => {
        applyMe();
        say(String(data.message || "Hit."));
      }).catch((err) => say(err.message));
    },
    refreshWallet() {
      void world.walletView().then(() => {
        applyMe();
        publish();
      }).catch((err) => say(err instanceof Error ? err.message : "Wallet unavailable."));
    },
    // Refresh the City Sol balance after a server-side spend (office claim).
    // walletView is account-only; meNow works for guests too.
    refreshMe() {
      void world.meNow().then(() => {
        applyMe();
        publish();
      }).catch(() => {});
    },
    quoteSend(destination: string, amount: string) {
      return world.walletQuote(destination, amount);
    },
    confirmSend(destination: string, amount: string, idempotencyKey: string) {
      return world.walletConfirm(destination, amount, idempotencyKey).then((data) => {
        applyMe();
        say(String(data.message || "Sent."));
        publish();
        return data;
      });
    },
    exportKey(proof: { password?: string; otp?: string }) {
      return world.walletExport(proof);
    },
    toggleSpectator() {
      spectator = !spectator;
      if (spectator) {
        if (driving && lastBody) exitCar(lastBody);
        if (lastBody) {
          lastBody.flying = true;
          if (lastBody.y < 2) lastBody.y = 6;
        }
      } else if (lastBody) {
        lastBody.flying = false;
        lastBody.y = 0;
        orbitOn = false;
        hideHud = false;
        clean = false;
      }
      publish();
    },
    toggleOrbit() {
      orbitOn = !orbitOn;
      if (orbitOn) spectator = true;
      publish();
    },
    toggleHud() {
      hideHud = !hideHud;
      publish();
    },
    toggleNames() {
      hideNames = !hideNames;
      hideChat = hideNames;
      publish();
    },
    // GTA wiring: garage, homes, universes, haptics (the functions above
    // — App.tsx calls these).
    buyCar(id: string, color: string) {
      return buyCar(id, color);
    },
    selectCar(id: string) {
      return selectCar(id);
    },
    buyHome(homeId: string) {
      return buyHome(homeId);
    },
    homeStatus() {
      return homeStatus();
    },
    myProperties() {
      return myProperties();
    },
    // Fast travel to a property the player owns: one tap in the HUD's
    // "My Props" panel lands the player inside the place (the same
    // stepInside() the door prompt uses — HQ lobby, tower lobby, or the
    // house itself). Steps out of the car first so the player lands on
    // foot, never in the driver's seat inside a building. App.tsx closes
    // the panel and unpauses after calling this.
    goToProperty(anchorId: string) {
      const anchor = anchors.find((a) => a.id === anchorId);
      if (!anchor || !lastBody) {
        say("Could not find that place.");
        publish();
        return;
      }
      if (driving) exitCar(lastBody);
      stepInside(anchor, lastBody);
      panel = "";
      publish();
    },
    setUniverse(id: number) {
      setUniverse(id);
    },
    getUniverse() {
      return currentUniverse;
    },
    joinUniverse(id: number) {
      return joinUniverse(id);
    },
    travelUniverse(id: number) {
      return travelUniverse(id);
    },
    claimDistrictOffice(suite: string, termDays: 1 | 7 | 30, project: string, logo: string, site: string) {
      return claimDistrictOffice(suite, termDays, project, logo, site);
    },
    loadDistrictOffices(district: string) {
      return loadDistrictOffices(district);
    },
    releaseDistrictOffice(suite: string) {
      return releaseDistrictOffice(suite);
    },
    setHaptics(on: boolean) {
      setHapticsEnabled(on);
      publish();
    },
    drivingAlt() {
      const car = cars[carIndex];
      return driving && car ? car.alt : 0;
    },
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
