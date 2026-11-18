// ---------------------------------------------------------------------------
// OrbitX City — CRIB 3D layer: the home you own, rendered your way.
// ---------------------------------------------------------------------------
// The 150 state homes are built ONCE, statically (homes.ts buildHome), so
// per-player crib state cannot live in the static city. This layer is the
// dynamic overlay, same pattern as lifeview's furniture: thin boxes and
// sprites added to the scene root, rebuilt only when the crib key
// changes, following the player every frame for the pet.
//
// What it renders, only for homes the player owns on this server:
//   - Walls & floors: a bought wall colour covers the striped wallpaper
//     with flat paint panels; a bought floor covers the wood with a slab;
//     a bought light colour re-lamps the pendants. Defaults (cream /
//     wood / warm) render nothing — the designed interior stays.
//   - Tiers: tier 1 adds a second lounge + bookshelf; tier 2 adds a
//     dining set, fireplace glow and gold trim; tier 3 adds a chandelier,
//     a balcony slab and a gold PENTHOUSE sign. (The rooftop itself is
//     the CRAZY theme's — this layer never builds it.)
//   - Lights: when the lights are off (switch or unpaid bills) a dark
//     veil covers the interior while you are inside.
//   - TV: when the TV is on, the static screen glows (the radio plays
//     through it — App owns the audio).
//   - Door notice: any owned home with overdue bills gets a "LIGHTS OFF
//     — BILLS DUE" sign over the door, visible from the street.
//   - Exterior: a bought exterior trim paints a band along the front
//     facade + a door frame; a bought roof colours the front eave; a
//     bought yard lays a slab in front of the door; a theme puts its
//     name on a sign over the door. Defaults render nothing — the
//     designed facade stays.
//   - Pet: a small dog / cat that follows you around your own home,
//     trotting when happy, lagging when sad (unfed).
// ---------------------------------------------------------------------------

import {
  BoxGeometry,
  CanvasTexture,
  FrontSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
} from "three";
import type { HomeDef } from "./homes";
import { CRIB_FLOORS, CRIB_LIGHTS, CRIB_WALLS, HOME_EXTERIORS, HOME_ROOFS, HOME_THEMES, HOME_YARDS, doorSpot, tvSpot, type CribHomeState, type CribPetState } from "./crib";
import { homeRoomLayout } from "./homeplan";

const box = new BoxGeometry(1, 1, 1);

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 128) {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const ctx = el.getContext("2d");
  if (ctx) draw(ctx, w, h);
  const tex = new CanvasTexture(el);
  tex.needsUpdate = true;
  return tex;
}

function petMesh(kind: string): Group {
  const group = new Group();
  const add = (color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, emissive = 0) => {
    const mesh = new Mesh(box, new MeshLambertMaterial({ color, emissive, emissiveIntensity: emissive ? 0.6 : 0 }));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
  };
  if (kind === "cat") {
    // Small grey cat: body, head, pointed ears, tail up.
    add(0x9aa0a8, 0, 0.28, 0, 0.85, 0.4, 0.42);
    add(0x9aa0a8, 0.5, 0.52, 0, 0.4, 0.38, 0.38);
    add(0x7c828a, 0.42, 0.78, -0.14, 0.12, 0.2, 0.08);
    add(0x7c828a, 0.42, 0.78, 0.14, 0.12, 0.2, 0.08);
    add(0x9aa0a8, -0.5, 0.55, 0, 0.1, 0.6, 0.1);
    add(0x222222, 0.68, 0.55, -0.1, 0.05, 0.06, 0.05);
    add(0x222222, 0.68, 0.55, 0.1, 0.05, 0.06, 0.05);
  } else {
    // Dog: bigger brown body, head, floppy ears, tail.
    add(0x8a5a2e, 0, 0.35, 0, 1.15, 0.5, 0.5);
    add(0x8a5a2e, 0.68, 0.62, 0, 0.5, 0.48, 0.46);
    add(0x6b4423, 0.6, 0.72, -0.26, 0.14, 0.34, 0.1);
    add(0x6b4423, 0.6, 0.72, 0.26, 0.14, 0.34, 0.1);
    add(0x5a3a1e, 0.95, 0.55, 0, 0.2, 0.16, 0.3);
    add(0x8a5a2e, -0.66, 0.62, 0, 0.1, 0.12, 0.5);
    add(0x222222, 0.9, 0.68, -0.12, 0.06, 0.07, 0.06);
    add(0x222222, 0.9, 0.68, 0.12, 0.06, 0.07, 0.06);
    // Legs.
    for (const [lx, lz] of [[0.4, -0.18], [0.4, 0.18], [-0.4, -0.18], [-0.4, 0.18]] as Array<[number, number]>) {
      add(0x6b4423, lx, 0.12, lz, 0.14, 0.24, 0.14);
    }
  }
  return group;
}

export interface CribViewInput {
  /** The owned home the player is standing in, if any. */
  currentHome: HomeDef | null;
  currentCrib: CribHomeState | null;
  /** Player's pet (anywhere) — only shown inside their own home. */
  pet: CribPetState | null;
  insideOwnHome: boolean;
  /** Owned homes with overdue bills — door notices, from the street. */
  notices: HomeDef[];
}

export function createCribView(root: Group) {
  const decor = new Group();
  const tierGroup = new Group();
  const dark = new Group();
  const tvGroup = new Group();
  const doorGroup = new Group();
  const extGroup = new Group();
  root.add(decor, tierGroup, dark, tvGroup, doorGroup, extGroup);

  const pet = new Group();
  pet.visible = false;
  root.add(pet);
  let petKind = "";
  let petHappy = true;
  const petPos = { x: 0, z: 0, bob: 0 };

  let key = "";
  let noticeKey = "";

  function mat(color: number, emissive = 0, emissiveIntensity = 0) {
    return new MeshLambertMaterial({ color, emissive, emissiveIntensity });
  }

  function addBox(parent: Group, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, emissive = 0, emissiveIntensity = 0) {
    const mesh = new Mesh(box, mat(color, emissive, emissiveIntensity));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }

  function buildDecor(home: HomeDef, crib: CribHomeState) {
    const { x0, z0, w, d, door } = home;
    const cx = x0 + w / 2;
    const cz = z0 + d / 2;
    const wallColor = CRIB_WALLS[crib.decor.wall]?.color ?? 0xe8dcc8;
    const floorColor = CRIB_FLOORS[crib.decor.floor]?.color ?? 0x8a5a2e;
    const lightColor = CRIB_LIGHTS[crib.decor.light]?.color ?? 0xffd9a0;
    // Walls & floors — whole-home by default; per-room when the Home
    // Workshop set room finishes (decor.rooms). A room with no explicit
    // finish inherits the whole-home wall/floor, so a room left at the
    // defaults shows the base wallpaper / wood floor.
    const rooms = crib.decor.rooms && Object.keys(crib.decor.rooms).length ? crib.decor.rooms : null;
    if (rooms) {
      const layout = homeRoomLayout(home);
      const roomWall = (id: string) => rooms[id]?.wall ?? crib.decor.wall;
      const roomFloor = (id: string) => rooms[id]?.floor ?? crib.decor.floor;
      // Floors: one slab per room whose floor is not the wood default.
      for (const room of layout) {
        const floorKey = roomFloor(room.id);
        if (floorKey && floorKey !== "wood") {
          addBox(decor, CRIB_FLOORS[floorKey]?.color ?? 0x8a5a2e, room.x0 + room.w / 2, 0.15, room.z0 + room.d / 2, room.w - 0.1, 0.05, room.d - 0.1);
        }
      }
      // Walls: each non-door wall split at the centre line, each half
      // painted with the room that owns that side. Door wall skipped,
      // same as the whole-home path.
      const roomAtQuad = (sx: number, sz: number) =>
        layout.find((r) => Math.sign(r.x0 + r.w / 2 - cx) === sx && Math.sign(r.z0 + r.d / 2 - cz) === sz);
      const inset = 0.72;
      const y = 1.85;
      const h = 3.15;
      const segLenX = w / 2 - 1.25;
      const segLenZ = d / 2 - 1.25;
      const paintWallSeg = (wallKey: string | undefined, x: number, z: number, sx: number, sz: number) => {
        if (!wallKey || wallKey === "cream") return;
        addBox(decor, CRIB_WALLS[wallKey]?.color ?? 0xe8dcc8, x, y, z, sx, h, sz);
      };
      if (door !== "n") {
        const west = roomAtQuad(-1, -1);
        const east = roomAtQuad(1, -1);
        paintWallSeg(west ? roomWall(west.id) : undefined, x0 + w / 4 + 0.625, z0 + inset, segLenX, 0.08);
        paintWallSeg(east ? roomWall(east.id) : undefined, x0 + (3 * w) / 4 - 0.625, z0 + inset, segLenX, 0.08);
      }
      if (door !== "s") {
        const west = roomAtQuad(-1, 1);
        const east = roomAtQuad(1, 1);
        paintWallSeg(west ? roomWall(west.id) : undefined, x0 + w / 4 + 0.625, z0 + d - inset, segLenX, 0.08);
        paintWallSeg(east ? roomWall(east.id) : undefined, x0 + (3 * w) / 4 - 0.625, z0 + d - inset, segLenX, 0.08);
      }
      if (door !== "w") {
        const north = roomAtQuad(-1, -1);
        const south = roomAtQuad(-1, 1);
        paintWallSeg(north ? roomWall(north.id) : undefined, x0 + inset, z0 + d / 4 + 0.625, 0.08, segLenZ);
        paintWallSeg(south ? roomWall(south.id) : undefined, x0 + inset, z0 + (3 * d) / 4 - 0.625, 0.08, segLenZ);
      }
      if (door !== "e") {
        const north = roomAtQuad(1, -1);
        const south = roomAtQuad(1, 1);
        paintWallSeg(north ? roomWall(north.id) : undefined, x0 + w - inset, z0 + d / 4 + 0.625, 0.08, segLenZ);
        paintWallSeg(south ? roomWall(south.id) : undefined, x0 + w - inset, z0 + (3 * d) / 4 - 0.625, 0.08, segLenZ);
      }
    } else {
      // Walls: flat paint panels proud of the striped wallpaper (0.72 in
      // from the shell, the wallpaper bands end at 0.66). Door wall skipped.
      if (crib.decor.wall !== "cream") {
        const inset = 0.72;
        const y = 1.85;
        const h = 3.15;
        if (door !== "n") addBox(decor, wallColor, cx, y, z0 + inset, w - 2.5, h, 0.08);
        if (door !== "s") addBox(decor, wallColor, cx, y, z0 + d - inset, w - 2.5, h, 0.08);
        if (door !== "w") addBox(decor, wallColor, x0 + inset, y, cz, 0.08, h, d - 2.5);
        if (door !== "e") addBox(decor, wallColor, x0 + w - inset, y, cz, 0.08, h, d - 2.5);
      }
      // Floor: a slab over the wood (wood top is 0.12, slab sits 0.13-0.17).
      if (crib.decor.floor !== "wood") {
        addBox(decor, floorColor, cx, 0.15, cz, w - 2.4, 0.05, d - 2.4);
      }
    }
    // Lights: re-lamp the five static pendants in the chosen colour.
    if (crib.decor.light !== "warm") {
      for (const [dx, dz] of [[-4.2, -3.2], [4.2, -3.2], [-4.2, 3.2], [4.2, 3.2], [0, 0]] as Array<[number, number]>) {
        addBox(decor, lightColor, cx + dx, 2.85, cz + dz, 0.6, 0.18, 0.6, lightColor, 0.7);
      }
    }
    // Tier extras — more rooms, more space, more flex per tier.
    const tier = crib.tier || 0;
    if (tier >= 1) {
      // Second lounge on the west side + a bookshelf + a rug.
      addBox(tierGroup, 0xc4493a, x0 + 2.6, 0.38, cz - 2.5, 1.1, 0.45, 3.2);
      addBox(tierGroup, 0x8d2f28, x0 + 2.1, 0.85, cz - 2.5, 0.2, 0.7, 3.2);
      addBox(tierGroup, 0x6b4a2a, x0 + 3.4, 1.4, z0 + 2.2, 0.6, 2.2, 2.6);
      for (let i = 0; i < 3; i++) {
        addBox(tierGroup, [0xd43a2e, 0x7eefff, 0xe0b33a][i] ?? 0xffffff, x0 + 3.4, 1.0 + i * 0.45, z0 + 1.4 + i * 0.5, 0.5, 0.35, 0.4);
      }
      addBox(tierGroup, 0x8d4b2a, x0 + 3.2, 0.14, cz - 2.5, 2.4, 0.05, 3.4);
    }
    if (tier >= 2) {
      // Dining set + fireplace glow + gold trim bands on the side walls.
      addBox(tierGroup, 0x8a5a2e, cx - 4, 0.45, z0 + 3.2, 2.2, 0.1, 1.4);
      for (const [dx, dz] of [[-1.2, 0], [1.2, 0]] as Array<[number, number]>) {
        addBox(tierGroup, 0xd43a2e, cx - 4 + dx, 0.3, z0 + 3.2 + dz, 0.5, 0.5, 0.5);
      }
      const alongX = door === "n" || door === "s";
      const fx = alongX ? x0 + 1.22 : cx;
      const fz = alongX ? cz : z0 + 1.22;
      addBox(tierGroup, 0xff7a3c, fx, 0.9, fz, alongX ? 0.9 : 3.4, 1.2, alongX ? 3.4 : 0.9, 0xff7a3c, 0.9);
      addBox(tierGroup, 0xe0b33a, cx, 3.25, z0 + 0.72, w - 2.5, 0.18, 0.08);
      addBox(tierGroup, 0xe0b33a, cx, 3.25, z0 + d - 0.72, w - 2.5, 0.18, 0.08);
    }
    if (tier >= 3) {
      // Penthouse: chandelier + balcony slab off the back + gold sign.
      // (The rooftop itself belongs to the CRAZY theme — never built here.)
      addBox(tierGroup, 0xe0b33a, cx, 2.9, cz, 0.16, 0.5, 0.16);
      addBox(tierGroup, 0xe0b33a, cx, 2.55, cz, 1.3, 0.22, 1.3, 0xe0b33a, 0.9);
      addBox(tierGroup, 0xffd9a0, cx, 2.4, cz, 0.9, 0.14, 0.9, 0xffd9a0, 0.8);
      const backZ = door === "n" ? z0 + d + 1.6 : door === "s" ? z0 - 1.6 : cz;
      const backX = door === "w" ? x0 + w + 1.6 : door === "e" ? x0 - 1.6 : cx;
      if (door === "n" || door === "s") addBox(tierGroup, 0xe8e8ec, backX, 0.2, backZ, 6, 0.2, 3);
      else addBox(tierGroup, 0xe8e8ec, backX, 0.2, backZ, 3, 0.2, 6);
      const tex = canvasTexture((ctx, w, h) => {
        ctx.fillStyle = "#071018";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#e0b33a";
        ctx.font = "700 52px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("PENTHOUSE", w / 2, h / 2 + 18);
      });
      // Two single-sided planes back to back, like the roadside boards:
      // one DoubleSide plane would read mirrored from behind.
      const signMat = new MeshLambertMaterial({ map: tex, side: FrontSide, emissive: 0x332200, emissiveIntensity: 0.4 });
      const frontZ = door === "s" ? z0 + d + 0.7 : door === "n" ? z0 - 0.7 : cz;
      const frontX = door === "e" ? x0 + w + 0.7 : door === "w" ? x0 - 0.7 : cx;
      const rotY = door === "n" || door === "s" ? 0 : Math.PI / 2;
      const sign = new Mesh(new PlaneGeometry(5, 1.25), signMat);
      sign.position.set(frontX, 4.6, frontZ);
      sign.rotation.y = rotY;
      tierGroup.add(sign);
      const signBack = new Mesh(new PlaneGeometry(5, 1.25), signMat);
      signBack.position.set(frontX, 4.6, frontZ);
      signBack.rotation.y = rotY + Math.PI;
      tierGroup.add(signBack);
    }
    // Dark veil: lights off (switch or unpaid bills) while you are inside.
    const lightsOff = crib.lightsOn === false || crib.bills.lightsOff;
    if (lightsOff) {
      const veil = new Mesh(box, new MeshLambertMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
      veil.position.set(cx, 1.8, cz);
      veil.scale.set(w - 2, 3.6, d - 2);
      dark.add(veil);
    }
    // TV glow over the static screen when the TV is on.
    if (crib.tvOn) {
      const tv = tvSpot(home);
      const alongX = door === "n" || door === "s";
      addBox(tvGroup, 0x7eefff, tv.x, 1.5, tv.z, alongX ? 3.2 : 0.12, 1.6, alongX ? 0.12 : 3.2, 0x19d8ff, 0.9);
    }
  }

  // Which one-tap theme does this crib match, if any? Derived from the
  // saved decor + style — the server stores the pieces, not the name.
  function themeLabelFor(crib: CribHomeState): string {
    for (const [key, theme] of Object.entries(HOME_THEMES)) {
      if (key === "classic") continue;
      if (
        crib.decor.wall === theme.wall &&
        crib.decor.floor === theme.floor &&
        crib.decor.light === theme.light &&
        crib.style.exterior === theme.exterior &&
        crib.style.roof === theme.roof &&
        crib.style.yard === theme.yard
      ) return theme.label;
    }
    return "";
  }

  // Exterior overlay: trim band + roof eave + yard slab + theme sign.
  // Only for the home the player owns and is standing in — the static
  // city cannot carry per-player state, so this is the exterior surface.
  function buildExterior(home: HomeDef, crib: CribHomeState) {
    const { x0, z0, w, d, h, door } = home;
    const cx = x0 + w / 2;
    const cz = z0 + d / 2;
    const style = crib.style ?? { exterior: "default", roof: "standard", yard: "none" };
    const alongX = door === "n" || door === "s";
    // Front facade line: the wall the door is on, pushed 0.25 out so the
    // band sits proud of the static facade instead of z-fighting it.
    const frontX = door === "e" ? x0 + w + 0.25 : door === "w" ? x0 - 0.25 : cx;
    const frontZ = door === "s" ? z0 + d + 0.25 : door === "n" ? z0 - 0.25 : cz;
    const frontLen = alongX ? w : d;
    // Trim: a band just under the roofline + a frame around the door.
    if (style.exterior !== "default") {
      const trim = HOME_EXTERIORS[style.exterior]?.trim ?? 0xe8dcc8;
      if (alongX) addBox(extGroup, trim, frontX, h - 0.45, frontZ, frontLen - 1, 0.5, 0.18);
      else addBox(extGroup, trim, frontX, h - 0.45, frontZ, 0.18, 0.5, frontLen - 1);
      const spot = doorSpot(home);
      addBox(extGroup, trim, spot.x - 0.9, 2.6, spot.z, 0.18, 5.2, 0.18);
      addBox(extGroup, trim, spot.x + 0.9, 2.6, spot.z, 0.18, 5.2, 0.18);
      addBox(extGroup, trim, spot.x, 5.1, spot.z, 2.0, 0.18, 0.18);
    }
    // Roof: a coloured edge along the front eave, just above the wall top.
    if (style.roof !== "standard") {
      const roof = HOME_ROOFS[style.roof]?.roof ?? 0x8a5a2e;
      if (alongX) addBox(extGroup, roof, frontX, h + 0.12, frontZ, frontLen + 0.4, 0.24, 0.5);
      else addBox(extGroup, roof, frontX, h + 0.12, frontZ, 0.5, 0.24, frontLen + 0.4);
    }
    // Yard: a slab on the ground in front of the door.
    if (style.yard !== "none") {
      const yard = HOME_YARDS[style.yard]?.yard ?? 0x8a5a2e;
      const spot = doorSpot(home);
      addBox(extGroup, yard, spot.x, 0.12, spot.z, alongX ? 7 : 4.5, 0.14, alongX ? 4.5 : 7);
    }
    // Theme sign over the door, same pattern as the PENTHOUSE sign.
    const themeLabel = themeLabelFor(crib);
    if (themeLabel) {
      const tex = canvasTexture((ctx, w, h) => {
        ctx.fillStyle = "#071018";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#e0b33a";
        ctx.font = "700 52px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(themeLabel.toUpperCase(), w / 2, h / 2 + 18);
      });
      const signMat = new MeshLambertMaterial({ map: tex, side: FrontSide, emissive: 0x332200, emissiveIntensity: 0.4 });
      const rotY = alongX ? 0 : Math.PI / 2;
      const sign = new Mesh(new PlaneGeometry(5, 1.25), signMat);
      sign.position.set(frontX, 4.6, frontZ);
      sign.rotation.y = rotY;
      extGroup.add(sign);
      const signBack = new Mesh(new PlaneGeometry(5, 1.25), signMat);
      signBack.position.set(frontX, 4.6, frontZ);
      signBack.rotation.y = rotY + Math.PI;
      extGroup.add(signBack);
    }
  }

  function buildNotices(notices: HomeDef[]) {
    for (const home of notices) {
      const spot = doorSpot(home);
      const tex = canvasTexture((ctx, w, h) => {
        ctx.fillStyle = "rgba(0,0,0,0.82)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#ff5a4a";
        ctx.font = "700 40px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("LIGHTS OFF — BILLS DUE", w / 2, 56);
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 28px system-ui, sans-serif";
        ctx.fillText("Pay this week's bills in My Properties", w / 2, 98);
      });
      const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.scale.set(5.4, 1.35, 1);
      sprite.position.set(spot.x, 3.4, spot.z);
      doorGroup.add(sprite);
    }
  }

  return {
    sync(input: CribViewInput) {
      const { currentHome, currentCrib, pet: nextPet, insideOwnHome } = input;
      const nextKey = JSON.stringify([
        currentHome?.id ?? null,
        currentCrib ? [currentCrib.tier, currentCrib.decor, currentCrib.style, currentCrib.tvOn, currentCrib.lightsOn, currentCrib.bills.lightsOff] : null,
        insideOwnHome,
      ]);
      if (nextKey !== key) {
        key = nextKey;
        decor.clear();
        tierGroup.clear();
        dark.clear();
        tvGroup.clear();
        extGroup.clear();
        if (currentHome && currentCrib) {
          buildDecor(currentHome, currentCrib);
          buildExterior(currentHome, currentCrib);
        }
      }
      const nextNoticeKey = JSON.stringify(input.notices.map((h) => h.id));
      if (nextNoticeKey !== noticeKey) {
        noticeKey = nextNoticeKey;
        doorGroup.clear();
        buildNotices(input.notices);
      }
      // Pet: (re)build on kind change, show only inside your own home.
      const kind = nextPet?.kind ?? "";
      if (kind !== petKind) {
        petKind = kind;
        pet.clear();
        if (kind) pet.add(petMesh(kind));
      }
      petHappy = nextPet ? nextPet.happy : true;
      pet.visible = insideOwnHome && !!kind;
      if (pet.visible && (petPos.x === 0 && petPos.z === 0)) {
        petPos.x = currentHome ? currentHome.x0 + currentHome.w / 2 : 0;
        petPos.z = currentHome ? currentHome.z0 + currentHome.d / 2 : 0;
        pet.position.set(petPos.x, 0, petPos.z);
      }
    },
    tick(dt: number, px: number, pz: number, yaw: number, moving: boolean) {
      if (!pet.visible) return;
      // Trail a step behind the player; a happy pet trots, a sad one lags.
      const speed = petHappy ? 2.6 : 1.1;
      const tx = px - Math.sin(yaw) * 1.4;
      const tz = pz - Math.cos(yaw) * 1.4;
      const dx = tx - petPos.x;
      const dz = tz - petPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = Math.min(dist, speed * dt);
        petPos.x += (dx / dist) * step;
        petPos.z += (dz / dist) * step;
        pet.rotation.y = Math.atan2(dx, dz);
      }
      if (moving && dist > 0.3) {
        petPos.bob += dt * 10;
        pet.position.y = Math.abs(Math.sin(petPos.bob)) * 0.12;
      } else {
        pet.position.y = 0;
      }
      pet.position.x = petPos.x;
      pet.position.z = petPos.z;
    },
  };
}
