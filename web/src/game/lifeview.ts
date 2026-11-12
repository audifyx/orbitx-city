import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
} from "three";
import type { Anchor, Zone } from "./city";
import type { Leaders, LotCard, MarketCard, NoteCard } from "./life";
import { GATES } from "./life";

const box = new BoxGeometry(1, 1, 1);
const post = new CylinderGeometry(0.18, 0.18, 1, 8);

function canvas(width: number, height: number) {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  const ctx = el.getContext("2d");
  return { el, ctx };
}

function textureOf(el: HTMLCanvasElement) {
  const map = new CanvasTexture(el);
  map.needsUpdate = true;
  return map;
}

function fillBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
) {
  ctx.fillStyle = "#071018";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#7ef6ff";
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  paint(ctx);
}

function lines(ctx: CanvasRenderingContext2D, rows: { name: string; value: string }[], x: number, y: number) {
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.fillStyle = "#d7f7ff";
  rows.slice(0, 4).forEach((row, index) => {
    ctx.textAlign = "left";
    ctx.fillText(row.name.slice(0, 14), x, y + index * 28);
    ctx.textAlign = "right";
    ctx.fillText(row.value.slice(0, 16), x + 220, y + index * 28);
  });
  if (!rows.length) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#8aa";
    ctx.fillText("No scores yet", x, y);
  }
}

export function createLifeView(root: Group, zones: Zone[], anchors: Anchor[]) {
  const signs = new Map<string, { sprite: Sprite; key: string }>();
  const furniture = new Group();
  root.add(furniture);
  const furnKey = { value: "" };

  const leader = canvas(1024, 576);
  const leaderTex = textureOf(leader.el);
  // Two single-sided planes back to back, like the roadside boards in
  // mountBoard: one DoubleSide plane renders the canvas mirrored from
  // behind, so the plaza board read backwards from the spawn (south) side.
  // The front plane faces the plaza (north); the back plane faces the
  // street (south). The same texture reads correctly from both sides.
  const leaderMat = new MeshLambertMaterial({ map: leaderTex, side: FrontSide, emissive: 0x062028, emissiveIntensity: 0.4 });
  const leaderMesh = new Mesh(new PlaneGeometry(8.4, 4.7), leaderMat);
  leaderMesh.position.set(0, 3.6, 28);
  leaderMesh.rotation.y = Math.PI;
  root.add(leaderMesh);
  const leaderBack = new Mesh(new PlaneGeometry(8.4, 4.7), leaderMat);
  leaderBack.position.set(0, 3.6, 28.06);
  leaderBack.rotation.y = 0;
  root.add(leaderBack);

  const hqMeshes: { zone: Zone; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; tex: CanvasTexture; key: string }[] = [];
  for (const zone of zones.filter((item) => item.kind === "project")) {
    const board = canvas(1024, 512);
    const tex = textureOf(board.el);
    const mesh = new Mesh(
      new PlaneGeometry(4.6, 2.3),
      new MeshLambertMaterial({ map: tex, side: DoubleSide, emissive: 0x062028, emissiveIntensity: 0.45 }),
    );
    mesh.position.set(zone.signX, 2.15, zone.signZ);
    mesh.rotation.y = zone.signRot;
    root.add(mesh);
    hqMeshes.push({ zone, canvas: board.el, ctx: board.ctx, tex, key: "" });
  }

  const loungeZone = zones.find((zone) => zone.id === "project-0");
  let lounge: Mesh | null = null;
  if (loungeZone) {
    lounge = new Mesh(
      box,
      new MeshLambertMaterial({ color: 0xe0b33a, transparent: true, opacity: 0.28, emissive: 0x8a6a12, emissiveIntensity: 0.4 }),
    );
    const width = 4.2;
    const depth = Math.min(8, loungeZone.maxZ - loungeZone.minZ - 2);
    lounge.scale.set(width, 2.2, depth);
    lounge.position.set((loungeZone.minX + loungeZone.maxX) / 2, 1.2, loungeZone.maxZ - depth / 2 - 0.8);
    root.add(lounge);
  }

  const gates = GATES.map((gate, index) => {
    const mesh = new Mesh(post, new MeshLambertMaterial({ color: index === 0 ? 0x7ef6ff : 0x1a4a55, emissive: 0x19d8ff, emissiveIntensity: index === 0 ? 0.8 : 0.15 }));
    mesh.scale.set(1, index === 0 ? 3.2 : 1.6, 1);
    mesh.position.set(gate.x, (index === 0 ? 3.2 : 1.6) / 2, gate.z);
    root.add(mesh);
    return mesh;
  });
  const archL = new Mesh(box, new MeshLambertMaterial({ color: 0x101820 }));
  const archR = archL.clone();
  archL.scale.set(0.35, 3.2, 0.35);
  archR.scale.set(0.35, 3.2, 0.35);
  archL.position.set(34.2, 1.6, 0);
  archR.position.set(37.8, 1.6, 0);
  const lintel = new Mesh(box, new MeshLambertMaterial({ color: 0x7ef6ff, emissive: 0x19d8ff, emissiveIntensity: 0.6 }));
  lintel.scale.set(4.2, 0.28, 0.28);
  lintel.position.set(36, 3.2, 0);
  root.add(archL, archR, lintel);

  function paintLeaders(leaders: Leaders) {
    if (!leader.ctx) return;
    const ctx = leader.ctx;
    fillBoard(ctx, 1024, 576, () => {
      ctx.fillStyle = "#e0b33a";
      ctx.font = "700 48px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ORBITX CITY BOARDS", 512, 78);
      const heads = ["Richest", "Top earners", "Most burned", "Race times"];
      const cols = [leaders.rich, leaders.earners, leaders.burned, leaders.race];
      heads.forEach((title, index) => {
        const x = 40 + index * 250;
        ctx.textAlign = "left";
        ctx.fillStyle = "#7ef6ff";
        ctx.font = "700 26px system-ui, sans-serif";
        ctx.fillText(title, x, 150);
        lines(ctx, cols[index] || [], x, 196);
      });
      ctx.fillStyle = "#9ab";
      ctx.font = "500 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Demo credits only", 512, 520);
    });
    leaderTex.needsUpdate = true;
  }

  function paintHq(
    slot: (typeof hqMeshes)[number],
    project: { name: string; line: string; site?: string; holders?: string; price?: string },
    note: NoteCard | undefined,
    market: MarketCard | null,
  ) {
    if (!slot.ctx) return;
    const ctx = slot.ctx;
    fillBoard(ctx, 1024, 512, () => {
      ctx.fillStyle = "#e0b33a";
      ctx.beginPath();
      ctx.arc(88, 92, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#071018";
      ctx.font = "700 36px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(project.name.slice(0, 1).toUpperCase(), 88, 104);
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 40px system-ui, sans-serif";
      ctx.fillText(project.name, 146, 86);
      ctx.fillStyle = "#9ad";
      ctx.font = "500 24px system-ui, sans-serif";
      ctx.fillText(project.line, 146, 124);
      ctx.fillStyle = "#7ef6ff";
      ctx.fillText(project.site || "Link in projects.json", 64, 190);
      const price = market?.configured && market.price ? market.price : project.price || "Price placeholder";
      const holders = market?.configured && market.holders ? market.holders : project.holders || "Holders placeholder";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`Price  ${price}`, 64, 240);
      ctx.fillText(`Holders  ${holders}`, 64, 280);
      ctx.fillStyle = "#e0b33a";
      ctx.fillText("Announcement", 64, 340);
      ctx.fillStyle = "#ffffff";
      ctx.font = "500 26px system-ui, sans-serif";
      const text = note?.text || "The HQ owner can post a note from the phone.";
      ctx.fillText(text.slice(0, 70), 64, 384);
      if (note?.author) {
        ctx.fillStyle = "#9ab";
        ctx.font = "500 20px system-ui, sans-serif";
        ctx.fillText(note.author, 64, 424);
      }
    });
    slot.tex.needsUpdate = true;
  }

  function pieceMesh(kind: string) {
    const group = new Group();
    const add = (mesh: Mesh, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      group.add(mesh);
    };
    if (kind === "couch") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc4493a })), 0, 0.38, 0, 1.5, 0.42, 0.7);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x8d2f28 })), 0, 0.72, -0.24, 1.5, 0.42, 0.18);
    } else if (kind === "plant") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b3a22 })), 0, 0.22, 0, 0.36, 0.36, 0.36);
      add(new Mesh(post, new MeshLambertMaterial({ color: 0x3c9a4a })), 0, 0.7, 0, 0.7, 0.9, 0.7);
    } else if (kind === "lamp") {
      add(new Mesh(post, new MeshLambertMaterial({ color: 0x222222 })), 0, 0.7, 0, 0.2, 1.3, 0.2);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xe0b33a, emissive: 0xe0b33a, emissiveIntensity: 0.5 })), 0, 1.35, 0, 0.45, 0.2, 0.45);
    } else if (kind === "screen") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x101820 })), 0, 0.7, 0, 1.2, 0.75, 0.08);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x7ef6ff, emissive: 0x19d8ff, emissiveIntensity: 0.4 })), 0, 0.72, 0.06, 1.05, 0.6, 0.02);
    } else if (kind === "rug") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x8d4b2a })), 0, 0.05, 0, 2.2, 0.06, 1.4);
    } else if (kind === "tv" || kind === "screen") {
      // OrbitX TV: black slab + cyan glow screen, on a low stand.
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x101820 })), 0, 0.15, 0, 1.4, 0.3, 0.45);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x101820 })), 0, 0.95, 0, 1.7, 1.05, 0.08);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x7ef6ff, emissive: 0x19d8ff, emissiveIntensity: 0.5 })), 0, 0.95, 0.06, 1.55, 0.9, 0.02);
    } else if (kind === "tv-stand") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0, 0.28, 0, 1.7, 0.5, 0.5);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xe0b33a })), 0, 0.28, 0.26, 1.5, 0.06, 0.02);
    } else if (kind === "bed") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0, 0.18, 0, 1.7, 0.3, 2.3);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xf2f0e6 })), 0, 0.42, 0, 1.55, 0.22, 2.15);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xe0b33a })), 0, 0.55, -0.9, 1.3, 0.14, 0.35);
    } else if (kind === "dining-table") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc9a36a })), 0, 0.75, 0, 1.9, 0.1, 1.0);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), -0.8, 0.35, -0.4, 0.1, 0.7, 0.1);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0.8, 0.35, -0.4, 0.1, 0.7, 0.1);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), -0.8, 0.35, 0.4, 0.1, 0.7, 0.1);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0.8, 0.35, 0.4, 0.1, 0.7, 0.1);
    } else if (kind === "chair") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc4493a })), 0, 0.45, 0, 0.5, 0.1, 0.5);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x8d2f28 })), 0, 0.85, -0.22, 0.5, 0.7, 0.08);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), -0.2, 0.22, -0.2, 0.07, 0.45, 0.07);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0.2, 0.22, 0.2, 0.07, 0.45, 0.07);
    } else if (kind === "shelf") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), -0.55, 0.9, 0, 0.08, 1.7, 0.35);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0.55, 0.9, 0, 0.08, 1.7, 0.35);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc9a36a })), 0, 0.5, 0, 1.2, 0.07, 0.35);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc9a36a })), 0, 1.1, 0, 1.2, 0.07, 0.35);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc4493a })), -0.25, 1.22, 0, 0.4, 0.18, 0.3);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x7ef6ff })), 0.3, 0.62, 0, 0.3, 0.18, 0.3);
    } else if (kind === "kitchen") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x222222 })), -0.7, 0.45, 0, 1.6, 0.9, 0.9);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xe8e4d8 })), -0.7, 0.95, 0, 1.6, 0.08, 0.95);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xf2f0e6 })), 0.9, 0.95, 0, 0.7, 1.9, 0.7);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x7ef6ff, emissive: 0x19d8ff, emissiveIntensity: 0.3 })), 0.9, 0.55, 0.36, 0.5, 0.5, 0.02);
    } else if (kind === "desk") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc9a36a })), 0, 0.75, 0, 1.6, 0.08, 0.8);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), -0.7, 0.35, -0.3, 0.08, 0.7, 0.08);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0.7, 0.35, -0.3, 0.08, 0.7, 0.08);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x101820 })), 0, 1.05, -0.2, 0.7, 0.45, 0.05);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x7ef6ff, emissive: 0x19d8ff, emissiveIntensity: 0.4 })), 0, 1.05, -0.17, 0.6, 0.35, 0.02);
    } else if (kind === "armchair") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x2a4b6b })), 0, 0.38, 0, 0.85, 0.42, 0.75);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x1f3550 })), 0, 0.72, -0.28, 0.85, 0.45, 0.16);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x1f3550 })), -0.44, 0.55, 0, 0.12, 0.35, 0.7);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x1f3550 })), 0.44, 0.55, 0, 0.12, 0.35, 0.7);
    } else if (kind === "coffee-table") {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc9a36a })), 0, 0.4, 0, 1.25, 0.08, 0.65);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), -0.5, 0.18, -0.22, 0.08, 0.36, 0.08);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0.5, 0.18, 0.22, 0.08, 0.36, 0.08);
    } else {
      add(new Mesh(box, new MeshLambertMaterial({ color: 0xc9a36a })), 0, 0.42, 0, 1.2, 0.1, 0.7);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), -0.45, 0.2, -0.25, 0.08, 0.4, 0.08);
      add(new Mesh(box, new MeshLambertMaterial({ color: 0x6b4a2a })), 0.45, 0.2, 0.25, 0.08, 0.4, 0.08);
    }
    return group;
  }

  return {
    sync(input: {
      lots: LotCard[];
      leaders: Leaders;
      projects: { name: string; line: string; site?: string; holders?: string; price?: string }[];
      notes: NoteCard[];
      market: MarketCard | null;
      raceNext: number;
      // Edit Home: placed pieces in the player's own homes (world coords,
      // rendered in the same furniture group as lot pieces) + the ghost
      // preview of the piece being carried.
      homeFurniture?: { kind: string; x: number; z: number; rot: number }[];
      ghost?: { kind: string; x: number; z: number; rot: number } | null;
    }) {
      const leaderKey = JSON.stringify(input.leaders);
      if (leaderMesh.userData.key !== leaderKey) {
        leaderMesh.userData.key = leaderKey;
        paintLeaders(input.leaders);
      }
      hqMeshes.forEach((slot, index) => {
        const project = input.projects[index] || { name: "Project HQ", line: "Add it in projects.json" };
        const note = input.notes.find((item) => item.project === `hq-${index}` || item.project === slot.zone.id);
        const key = JSON.stringify({ project, note, market: input.market });
        if (slot.key !== key) {
          slot.key = key;
          paintHq(slot, project, note, input.market);
        }
      });
      for (const lot of input.lots) {
        const anchor = anchors.find((item) => item.id === lot.anchor);
        if (!anchor) continue;
        const label = lot.ownerId ? `${lot.name} — Owned by ${lot.ownerName}` : `${lot.name} — For sale · ${lot.price}`;
        let row = signs.get(lot.id);
        if (!row) {
          const sprite = new Sprite(new SpriteMaterial({ map: textureOf(canvas(512, 128).el), transparent: true, depthWrite: false }));
          sprite.scale.set(5.4, 1.35, 1);
          const yaw = anchor.yaw + Math.PI;
          sprite.position.set(anchor.x + Math.sin(yaw) * 1.35, 3.95, anchor.z - Math.cos(yaw) * 1.35);
          root.add(sprite);
          row = { sprite, key: "" };
          signs.set(lot.id, row);
        }
        if (row.key !== label) {
          row.key = label;
          const face = canvas(512, 128);
          if (face.ctx) {
            face.ctx.fillStyle = "rgba(0,0,0,0.78)";
            face.ctx.fillRect(0, 24, 512, 80);
            face.ctx.fillStyle = lot.ownerId ? "#e0b33a" : "#7ef6ff";
            face.ctx.font = "700 36px system-ui, sans-serif";
            face.ctx.textAlign = "center";
            face.ctx.fillText(label, 256, 76, 490);
          }
          const map = textureOf(face.el);
          (row.sprite.material as SpriteMaterial).map = map;
          (row.sprite.material as SpriteMaterial).needsUpdate = true;
        }
      }
      const furnStamp = JSON.stringify([input.lots.map((lot) => [lot.id, lot.furniture]), input.homeFurniture || [], input.ghost || null]);
      if (furnKey.value !== furnStamp) {
        furnKey.value = furnStamp;
        furniture.clear();
        for (const lot of input.lots) {
          for (const piece of lot.furniture) {
            const mesh = pieceMesh(piece.kind);
            mesh.position.set(piece.x, 0, piece.z);
            mesh.rotation.y = piece.rot;
            furniture.add(mesh);
          }
        }
        for (const piece of input.homeFurniture || []) {
          const mesh = pieceMesh(piece.kind);
          mesh.position.set(piece.x, 0, piece.z);
          mesh.rotation.y = piece.rot;
          furniture.add(mesh);
        }
        if (input.ghost) {
          // Semi-transparent preview of the carried piece at the drop point.
          const mesh = pieceMesh(input.ghost.kind);
          mesh.position.set(input.ghost.x, 0, input.ghost.z);
          mesh.rotation.y = input.ghost.rot;
          mesh.traverse((child) => {
            const mat = (child as Mesh).material as MeshLambertMaterial | undefined;
            if (mat) {
              mat.transparent = true;
              mat.opacity = 0.55;
            }
          });
          furniture.add(mesh);
        }
      }
      gates.forEach((mesh, index) => {
        const hot = input.raceNext === index;
        mesh.scale.set(1, hot || index === 0 ? 3.2 : 1.5, 1);
        mesh.position.y = mesh.scale.y / 2;
        const mat = mesh.material as MeshLambertMaterial;
        mat.emissiveIntensity = hot ? 1.1 : index === 0 ? 0.7 : 0.12;
      });
    },
    lounge,
  };
}
