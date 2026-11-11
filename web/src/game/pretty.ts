import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  BoxGeometry,
} from "three";
import type { Facade } from "./city";

export type QualityName = "low" | "medium" | "high";

const box = new BoxGeometry(1, 1, 1);
const column = new CylinderGeometry(0.35, 0.42, 1, 10);

function paintFacade(style: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { map: new CanvasTexture(canvas), glow: new CanvasTexture(canvas) };
  const bases = ["#1a1e28", "#12151c", "#241c22", "#101820"];
  ctx.fillStyle = bases[style % bases.length];
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = "#d7dde8";
  ctx.fillRect(0, 430, 256, 82);
  ctx.fillStyle = "#0e7490";
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 18 + col * 60;
      const y = 28 + row * 54;
      ctx.fillStyle = row % 2 === 0 ? "#12343f" : "#0b242c";
      ctx.fillRect(x, y, 44, 36);
      ctx.fillStyle = row % 2 === 0 ? "#7ef6ff" : "#49c8e8";
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x + 4, y + 4, 36, 22);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#f4f7fb";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 44, 36);
    }
  }
  ctx.fillStyle = "#9befff";
  ctx.fillRect(0, 418, 256, 8);
  ctx.fillStyle = "#071016";
  ctx.fillRect(78, 446, 100, 52);
  ctx.fillStyle = "#e9fbff";
  ctx.fillRect(88, 456, 80, 28);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.anisotropy = 4;
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 256;
  glowCanvas.height = 512;
  const g = glowCanvas.getContext("2d");
  const glow = new CanvasTexture(glowCanvas);
  if (g) {
    g.clearRect(0, 0, 256, 512);
    g.fillStyle = "#7ef6ff";
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 4; col++) {
        g.globalAlpha = row % 2 === 0 ? 1 : 0.45;
        g.fillRect(22 + col * 60, 32 + row * 54, 36, 22);
      }
    }
    g.globalAlpha = 1;
    glow.colorSpace = SRGBColorSpace;
    glow.wrapS = RepeatWrapping;
    glow.wrapT = RepeatWrapping;
  }
  return { map, glow };
}

const paints = [0, 1, 2, 3].map((style) => paintFacade(style));

function facadeMaterial(style: number, w: number, h: number) {
  const src = paints[style % paints.length];
  const map = src.map.clone();
  const glow = src.glow.clone();
  map.repeat.set(Math.max(1, w / 10), Math.max(1, h / 14));
  glow.repeat.set(map.repeat.x, map.repeat.y);
  map.needsUpdate = true;
  glow.needsUpdate = true;
  return new MeshStandardMaterial({
    map,
    emissiveMap: glow,
    emissive: 0x9af6ff,
    emissiveIntensity: 0.85,
    roughness: 0.42,
    metalness: 0.28,
  });
}

function addWall(
  group: Group,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  material: MeshStandardMaterial,
) {
  const mesh = new Mesh(box, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function hollow(facade: Facade, material: MeshStandardMaterial) {
  const group = new Group();
  const { x, z, w, d, h, door } = facade;
  const t = 0.45;
  const gap = 4;
  const cx = x + w / 2;
  const cz = z + d / 2;
  const midY = h / 2;
  const place = (alongX: boolean) => {
    const span = alongX ? w : d;
    const origin = alongX ? x : z;
    const gap0 = origin + (span - gap) / 2;
    const gap1 = gap0 + gap;
    if (alongX) {
      addWall(group, (x + gap0) / 2, midY, z + t / 2, gap0 - x, h, t, material);
      addWall(group, (gap1 + x + w) / 2, midY, z + t / 2, x + w - gap1, h, t, material);
      addWall(group, (gap0 + gap1) / 2, 3 + (h - 3) / 2, z + t / 2, gap, h - 3, t, material);
    } else {
      addWall(group, x + t / 2, midY, (z + gap0) / 2, t, h, gap0 - z, material);
      addWall(group, x + t / 2, midY, (gap1 + z + d) / 2, t, h, z + d - gap1, material);
      addWall(group, x + t / 2, 3 + (h - 3) / 2, (gap0 + gap1) / 2, t, h - 3, gap, material);
    }
  };
  if (door === "n") place(true);
  else addWall(group, cx, midY, z + t / 2, w, h, t, material);
  if (door === "s") {
    const gap0 = x + (w - gap) / 2;
    const gap1 = gap0 + gap;
    addWall(group, (x + gap0) / 2, midY, z + d - t / 2, gap0 - x, h, t, material);
    addWall(group, (gap1 + x + w) / 2, midY, z + d - t / 2, x + w - gap1, h, t, material);
    addWall(group, (gap0 + gap1) / 2, 3 + (h - 3) / 2, z + d - t / 2, gap, h - 3, t, material);
  } else addWall(group, cx, midY, z + d - t / 2, w, h, t, material);
  if (door === "w") place(false);
  else addWall(group, x + t / 2, midY, cz, t, h, d, material);
  if (door === "e") {
    const gap0 = z + (d - gap) / 2;
    const gap1 = gap0 + gap;
    addWall(group, x + w - t / 2, midY, (z + gap0) / 2, t, h, gap0 - z, material);
    addWall(group, x + w - t / 2, midY, (gap1 + z + d) / 2, t, h, z + d - gap1, material);
    addWall(group, x + w - t / 2, 3 + (h - 3) / 2, (gap0 + gap1) / 2, t, h - 3, gap, material);
  } else addWall(group, x + w - t / 2, midY, cz, t, h, d, material);
  const roofMat = new MeshStandardMaterial({ color: 0x141820, roughness: 0.7, metalness: 0.2 });
  addWall(group, cx, h + 0.2, cz, w, 0.4, d, roofMat);
  return group;
}

function orbitWord() {
  const glyphs: Record<string, string[]> = {
    O: ["01110", "10001", "10001", "10001", "01110"],
    R: ["11110", "10001", "11110", "10100", "10010"],
    B: ["11110", "10001", "11110", "10001", "11110"],
    I: ["11111", "00100", "00100", "00100", "11111"],
    T: ["11111", "00100", "00100", "00100", "00100"],
    X: ["10001", "01010", "00100", "01010", "10001"],
  };
  const word = "ORBITX";
  const group = new Group();
  const ps = 0.24;
  const gap = 0.14;
  const glyphW = 5 * ps;
  const total = word.length * glyphW + (word.length - 1) * gap;
  const plate = new Mesh(
    box,
    new MeshStandardMaterial({ color: 0x071018, roughness: 0.45, metalness: 0.2, emissive: 0x062833, emissiveIntensity: 0.35 }),
  );
  plate.scale.set(total + 0.36, 5 * ps + 0.36, 0.08);
  plate.position.set(0, 2 * ps, -0.1);
  group.add(plate);
  const lit = new MeshStandardMaterial({ color: 0xf7fdff, emissive: 0x8af6ff, emissiveIntensity: 1.55, roughness: 0.22 });
  let cursor = -total / 2;
  for (const ch of word) {
    const rows = glyphs[ch];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== "1") continue;
        const cell = new Mesh(box, lit);
        cell.position.set(cursor + (c + 0.5) * ps, (rows.length - 1 - r) * ps, 0);
        cell.scale.set(ps * 0.84, ps * 0.84, 0.2);
        group.add(cell);
      }
    }
    cursor += glyphW + gap;
  }
  return group;
}

function solidTower(facade: Facade) {
  const group = new Group();
  const tiers = [
    { w: 28, d: 26, h: 14 },
    { w: 22, d: 20, h: 12 },
    { w: 17, d: 15, h: 12 },
    { w: 13, d: 11, h: 10 },
    { w: 10, d: 8, h: 8 },
  ];
  let y = 0;
  tiers.forEach((tier, index) => {
    const material = facadeMaterial(index % 2, tier.w, tier.h);
    const mesh = new Mesh(box, material);
    mesh.position.set(0, y + tier.h / 2, -3 - tier.d / 2);
    mesh.scale.set(tier.w, tier.h, tier.d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const glass = new Mesh(
      new CylinderGeometry(Math.min(tier.w, tier.d) * 0.18, Math.min(tier.w, tier.d) * 0.22, tier.h * 0.92, 16),
      new MeshStandardMaterial({
        color: 0x9af6ff,
        emissive: 0x1ad8ff,
        emissiveIntensity: 0.8,
        roughness: 0.12,
        metalness: 0.45,
        transparent: true,
        opacity: 0.72,
      }),
    );
    glass.position.set(0, y + tier.h / 2, -3 - tier.d / 2);
    group.add(glass);
    y += tier.h;
  });
  const top = tiers[tiers.length - 1];
  const roofY = y + 1.35;
  const front = orbitWord();
  front.position.set(0, roofY, -2.55);
  group.add(front);
  const back = orbitWord();
  back.position.set(0, roofY, -3 - top.d - 0.4);
  back.rotation.y = Math.PI;
  group.add(back);
  for (const x of [-8, -4, 4, 8]) {
    const col = new Mesh(column, new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.4, metalness: 0.15 }));
    col.scale.set(1, 6.2, 1);
    col.position.set(x, 3.1, -1.2);
    col.castShadow = true;
    group.add(col);
  }
  const canopy = new Mesh(box, new MeshStandardMaterial({ color: 0x141820, roughness: 0.5, metalness: 0.3 }));
  canopy.scale.set(18, 0.35, 4);
  canopy.position.set(0, 6.2, -1.4);
  group.add(canopy);
  const lip = new Mesh(
    box,
    new MeshStandardMaterial({ color: 0xe9fbff, emissive: 0x5ef3ff, emissiveIntensity: 1.1, roughness: 0.2 }),
  );
  lip.scale.set(18.4, 0.12, 0.25);
  lip.position.set(0, 6.45, 0.4);
  group.add(lip);
  group.name = facade.id;
  group.userData.hero = true;
  return group;
}

export function mountPretty(facades: Facade[], quality: QualityName) {
  const root = new Group();
  root.name = "pretty-city";
  const plain = new MeshStandardMaterial({ color: 0x1c2430, roughness: 0.7, metalness: 0.2, emissive: 0x12343f, emissiveIntensity: 0.25 });
  for (const facade of facades) {
    if (facade.hero) {
      root.add(solidTower(facade));
      continue;
    }
    const material = quality === "low" ? plain : facadeMaterial(facade.style, facade.w, facade.h);
    if (facade.enterable && facade.door) root.add(hollow(facade, material));
    else {
      const mesh = new Mesh(box, material);
      mesh.position.set(facade.x + facade.w / 2, facade.h / 2, facade.z + facade.d / 2);
      mesh.scale.set(facade.w, facade.h, facade.d);
      mesh.castShadow = quality !== "low";
      mesh.receiveShadow = quality !== "low";
      root.add(mesh);
      if (quality !== "low") {
        const cap = new Mesh(
          box,
          new MeshStandardMaterial({ color: 0x10141c, roughness: 0.55, metalness: 0.25 }),
        );
        cap.position.set(facade.x + facade.w / 2, facade.h + 1.2, facade.z + facade.d / 2);
        cap.scale.set(facade.w * 0.42, 2.2, facade.d * 0.42);
        cap.castShadow = true;
        root.add(cap);
      }
    }
  }
  return root;
}
