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

// Per-facade materials whose emissive (window glow) is driven by setPrettyNight.
const nightMats: Array<{ mat: MeshStandardMaterial; day: number; night: number }> = [];
export function setPrettyNight(f: number) {
  const t = Math.max(0, Math.min(1, f));
  for (const entry of nightMats) {
    entry.mat.emissiveIntensity = entry.day + (entry.night - entry.day) * t;
  }
}

function glowRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

function storefront(ctx: CanvasRenderingContext2D, base: string, glass: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 442, 256, 70);
  // Gold signage band.
  ctx.fillStyle = "#e0b33a";
  ctx.fillRect(0, 442, 256, 12);
  ctx.fillStyle = "#10141c";
  ctx.fillRect(20, 445, 216, 6);
  // Striped awning.
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#e0b33a" : "#f4f7fb";
    ctx.fillRect(i * 32, 454, 32, 12);
  }
  // Big glass panes + a door with gold handles (second pane).
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * 62;
    ctx.fillStyle = "#0b1c26";
    ctx.fillRect(x - 2, 468, 52, 38);
    const paneGrad = ctx.createLinearGradient(0, 470, 0, 506);
    paneGrad.addColorStop(0, glass);
    paneGrad.addColorStop(1, "#ffca7a");
    ctx.fillStyle = paneGrad;
    ctx.fillRect(x, 470, 48, 34);
    ctx.fillStyle = "rgba(126,246,255,0.5)";
    ctx.fillRect(x + 4, 474, 40, 5);
    if (i === 1) {
      ctx.fillStyle = "#e0b33a";
      ctx.fillRect(x + 18, 482, 3, 18);
      ctx.fillRect(x + 28, 482, 3, 18);
    }
    glowRect(ctx, x, 470, 48, 34, "#ffca7a", 0.65);
  }
}

function paintFacade(style: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { map: new CanvasTexture(canvas), glow: new CanvasTexture(canvas) };
  // Per-style base + window drawing. One canvas = a 10m x 14m module.
  const s = style % 6;
  if (s === 0) {
    // Glass curtain wall: dark blue glass bands + thin mullions.
    ctx.fillStyle = "#0d1b26";
    ctx.fillRect(0, 0, 256, 512);
    for (let row = 0; row < 7; row++) {
      const y = 28 + row * 54;
      ctx.fillStyle = "#16324a";
      ctx.fillRect(8, y, 240, 36);
      ctx.fillStyle = "rgba(126,246,255,0.55)";
      ctx.fillRect(12, y + 4, 232, 4);
      ctx.fillStyle = "#0a141d";
      for (let col = 0; col <= 7; col++) ctx.fillRect(8 + col * 32, y, 2, 36);
    }
    storefront(ctx, "#0a141d", "#16324a");
  } else if (s === 1) {
    // Warm brick residential: terracotta courses, small warm-lit windows.
    ctx.fillStyle = "#8a4a34";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#6e3a28";
    for (let y = 12; y < 442; y += 12) ctx.fillRect(0, y, 256, 1);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 22 + col * 74;
        const y = 30 + row * 54;
        ctx.fillStyle = "#2a1a12";
        ctx.fillRect(x - 3, y - 3, 34, 38);
        ctx.fillStyle = row % 2 === 0 ? "#ffd9a0" : "#c98d4e";
        ctx.fillRect(x, y, 28, 32);
        ctx.fillStyle = "#2a1a12";
        ctx.fillRect(x + 13, y, 2, 32);
      }
    }
    storefront(ctx, "#6e3a28", "#ffd9a0");
  } else if (s === 2) {
    // Concrete ribbon windows: light slabs, full-width dark bands.
    ctx.fillStyle = "#b8bcc0";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#9aa0a6";
    for (let y = 0; y < 442; y += 54) ctx.fillRect(0, y + 50, 256, 4);
    for (let row = 0; row < 7; row++) {
      const y = 30 + row * 54;
      ctx.fillStyle = "#232a30";
      ctx.fillRect(10, y, 236, 30);
      ctx.fillStyle = "#3d4a55";
      ctx.fillRect(14, y + 4, 228, 6);
      ctx.fillStyle = "#d7dde8";
      ctx.fillRect(10, y + 30, 236, 3);
    }
    storefront(ctx, "#8b9096", "#9fc4d6");
  } else if (s === 3) {
    // Cream stone modern: light base, pilasters, dark windows.
    ctx.fillStyle = "#e8e0cc";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#d8cfb8";
    for (let col = 0; col <= 4; col++) ctx.fillRect(col * 64 - 6, 0, 12, 442);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 20 + col * 60;
        const y = 28 + row * 54;
        ctx.fillStyle = "#1d2733";
        ctx.fillRect(x, y, 36, 40);
        ctx.fillStyle = "#8a97a8";
        ctx.fillRect(x + 3, y + 3, 30, 5);
        ctx.fillStyle = "#e8e0cc";
        ctx.fillRect(x, y + 40, 36, 3);
      }
    }
    storefront(ctx, "#cfc4a8", "#2a3540");
  } else if (s === 4) {
    // Neon commercial: dark base, big glowing panes, gold signage band.
    ctx.fillStyle = "#0c0f16";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#e0b33a";
    ctx.fillRect(0, 8, 256, 32);
    ctx.fillStyle = "#10141c";
    ctx.fillRect(24, 18, 208, 12);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 16 + col * 80;
        const y = 56 + row * 58;
        ctx.fillStyle = "#12303f";
        ctx.fillRect(x, y, 56, 44);
        ctx.fillStyle = row % 2 === 0 ? "#7ef6ff" : "#2fa8cc";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 4, y + 4, 48, 30);
        ctx.globalAlpha = 1;
      }
    }
    storefront(ctx, "#0a0d13", "#12303f");
  } else {
    // Dark OrbitX identity: cyan windows, gold floor lines.
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, 256, 512);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 18 + col * 60;
        const y = 28 + row * 54;
        ctx.fillStyle = "#12343f";
        ctx.fillRect(x, y, 44, 36);
        ctx.fillStyle = row % 2 === 0 ? "#7ef6ff" : "#49c8e8";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 4, y + 4, 36, 22);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#f4f7fb";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, 44, 36);
      }
      ctx.fillStyle = "#e0b33a";
      ctx.fillRect(0, 24 + row * 54, 256, 2);
    }
    ctx.fillStyle = "#9befff";
    ctx.fillRect(0, 418, 256, 8);
    storefront(ctx, "#0a0d13", "#12303f");
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.anisotropy = 4;
  // Emissive map: the windows glow (warm for brick/cream, cyan for the rest).
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 256;
  glowCanvas.height = 512;
  const g = glowCanvas.getContext("2d");
  const glow = new CanvasTexture(glowCanvas);
  if (g) {
    g.clearRect(0, 0, 256, 512);
    g.fillStyle = s === 1 || s === 3 ? "#ffc27a" : s === 2 ? "#bfe6ff" : "#7ef6ff";
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 4; col++) {
        g.globalAlpha = row % 2 === 0 ? 1 : 0.45;
        g.fillRect(22 + col * 60, 32 + row * 54, 36, 22);
      }
    }
    g.globalAlpha = 0.65;
    g.fillRect(10, 470, 236, 34);
    g.globalAlpha = 1;
    glow.colorSpace = SRGBColorSpace;
    glow.wrapS = RepeatWrapping;
    glow.wrapT = RepeatWrapping;
  }
  return { map, glow };
}

const paints = [0, 1, 2, 3, 4, 5].map((style) => paintFacade(style));

const STYLE_EMISSIVE = [0x9af6ff, 0xffc27a, 0xbfe6ff, 0xffc27a, 0x9af6ff, 0x9af6ff];

function facadeMaterial(style: number, w: number, h: number) {
  const src = paints[style % paints.length];
  const map = src.map.clone();
  const glow = src.glow.clone();
  map.repeat.set(Math.max(1, w / 10), Math.max(1, h / 14));
  glow.repeat.set(map.repeat.x, map.repeat.y);
  map.needsUpdate = true;
  glow.needsUpdate = true;
  const mat = new MeshStandardMaterial({
    map,
    emissiveMap: glow,
    emissive: STYLE_EMISSIVE[style % STYLE_EMISSIVE.length],
    emissiveIntensity: 0.55,
    roughness: 0.42,
    metalness: 0.28,
  });
  nightMats.push({ mat, day: 0.35, night: 1.7 });
  return mat;
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

// Rooftop kit replacing the old floating cap box: parapet rim, AC units,
// antenna with a cyan beacon.
function addRoofKit(group: Group, x: number, z: number, w: number, d: number, h: number) {
  const rimMat = new MeshStandardMaterial({ color: 0x141820, roughness: 0.7, metalness: 0.2 });
  const acMat = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 });
  const rim = 0.25;
  const mk = (px: number, pz: number, sx: number, sz: number, mat: MeshStandardMaterial) => {
    const m = new Mesh(box, mat);
    m.position.set(px, h + rim / 2, pz);
    m.scale.set(sx, rim, sz);
    group.add(m);
  };
  mk(x + w / 2, z + rim / 2, w, rim, rimMat);
  mk(x + w / 2, z + d - rim / 2, w, rim, rimMat);
  mk(x + rim / 2, z + d / 2, rim, d, rimMat);
  mk(x + w - rim / 2, z + d / 2, rim, d, rimMat);
  for (const [ax, az] of [
    [x + w * 0.22, z + d * 0.24],
    [x + w * 0.72, z + d * 0.7],
  ] as const) {
    const ac = new Mesh(box, acMat);
    ac.position.set(ax, h + 0.4, az);
    ac.scale.set(1.4, 0.8, 1.2);
    ac.castShadow = true;
    group.add(ac);
  }
  const antenna = new Mesh(box, new MeshStandardMaterial({ color: 0x232a38, roughness: 0.5, metalness: 0.6 }));
  antenna.position.set(x + w * 0.85, h + 1.4, z + d * 0.2);
  antenna.scale.set(0.14, 2.8, 0.14);
  group.add(antenna);
  const beacon = new Mesh(
    box,
    new MeshStandardMaterial({ color: 0x9af6ff, emissive: 0x1ad8ff, emissiveIntensity: 2.2, roughness: 0.2 }),
  );
  beacon.position.set(x + w * 0.85, h + 2.9, z + d * 0.2);
  beacon.scale.set(0.35, 0.35, 0.35);
  group.add(beacon);
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
  const goldTrimMat = new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.35, metalness: 0.7, emissive: 0x6a5208, emissiveIntensity: 0.4 });
  let y = 0;
  tiers.forEach((tier, index) => {
    // Alternate the OrbitX dark identity style with the glass curtain wall.
    const material = facadeMaterial(index % 2 === 0 ? 5 : 0, tier.w, tier.h);
    const mesh = new Mesh(box, material);
    mesh.position.set(0, y + tier.h / 2, -3 - tier.d / 2);
    mesh.scale.set(tier.w, tier.h, tier.d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (index > 0) {
      const trim = new Mesh(box, goldTrimMat);
      trim.position.set(0, y, -3 - tier.d / 2);
      trim.scale.set(tier.w + 0.3, 0.35, tier.d + 0.3);
      group.add(trim);
    }
    y += tier.h;
  });
  // Real glass atrium, proud of the tier-1 front face (the old hidden
  // cylinder inside the solid tiers was invisible from every angle).
  const atrium = new Mesh(
    box,
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
  atrium.position.set(0, 5, -3 + 0.75);
  atrium.scale.set(8, 10, 1.5);
  group.add(atrium);
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
  // Beacon pole + cyan beacon on top.
  const pole = new Mesh(box, new MeshStandardMaterial({ color: 0x232a38, roughness: 0.5, metalness: 0.6 }));
  pole.position.set(0, y + 1.6, -3 - top.d / 2);
  pole.scale.set(0.2, 3.2, 0.2);
  group.add(pole);
  const beacon = new Mesh(
    box,
    new MeshStandardMaterial({ color: 0x9af6ff, emissive: 0x1ad8ff, emissiveIntensity: 2.4, roughness: 0.2 }),
  );
  beacon.position.set(0, y + 3.4, -3 - top.d / 2);
  beacon.scale.set(0.5, 0.5, 0.5);
  group.add(beacon);
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
    if (facade.enterable && facade.door) {
      root.add(hollow(facade, material));
      if (quality !== "low") addRoofKit(root, facade.x, facade.z, facade.w, facade.d, facade.h);
    } else {
      const mesh = new Mesh(box, material);
      mesh.position.set(facade.x + facade.w / 2, facade.h / 2, facade.z + facade.d / 2);
      // A hair proud of the voxel shell plane so the overlay never z-fights it.
      mesh.scale.set(facade.w + 0.08, facade.h, facade.d + 0.08);
      mesh.castShadow = quality !== "low";
      mesh.receiveShadow = quality !== "low";
      root.add(mesh);
      if (quality !== "low") addRoofKit(root, facade.x, facade.z, facade.w, facade.d, facade.h);
    }
  }
  return root;
}
