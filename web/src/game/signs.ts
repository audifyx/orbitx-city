/**
 * OrbitX City — neon signage (realistic overhaul, 2026-11-24).
 *
 * The 6 style videos are wall-to-wall neon: giant "ORBITX CITY" in pink
 * outline / white fill, vertical hotel strips, shop signs on every
 * storefront. All of it is canvas text — NEVER geometry letters — painted
 * once, cached, and reused by every sign in the city.
 *
 * The signs use MeshBasicMaterial (unlit, toneMapped false) so they read
 * as glowing neon at dusk/night and stay legible in daylight, with zero
 * per-frame cost. One shared canvas texture per (text, color, variant).
 */
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";

/** Neon palette straight from the key frames. */
export const NEON = {
  pink: "#ff2ea6",
  pinkSoft: "#ff5ec4",
  cyan: "#00e5ff",
  amber: "#ffb020",
  white: "#ffffff",
  red: "#ff3b30",
  green: "#34c759",
  purple: "#af52de",
  blue: "#0a84ff",
} as const;

export type NeonColor = keyof typeof NEON;

export interface NeonSignOptions {
  /** World width of the sign plane. Height follows the text aspect. */
  width: number;
  /** Neon color key (default pink). */
  color?: NeonColor;
  /** Fill color for the letters (default white, like the frames). */
  fill?: string;
  /** Dark backing panel behind the letters (default true for shop signs). */
  backing?: boolean;
  /** Vertical reading (rotated 90 deg, e.g. HOTEL GALAXY). */
  vertical?: boolean;
  /** Second, smaller line under the main text. */
  sub?: string;
  /** Make the plane double-sided (gate signs, seen from both sides). */
  doubleSide?: boolean;
  /** Font weight / family override. */
  font?: string;
}

const texCache = new Map<string, CanvasTexture>();

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Paint a neon sign onto a canvas. Layout: optional dark backing panel,
 * main text in bold condensed caps with a colored glow (shadowBlur) and
 * a colored outline, white fill; optional smaller sub line below.
 * Returns the canvas so the caller can size the texture from it.
 */
function paintSign(
  text: string,
  colorHex: string,
  fill: string,
  backing: boolean,
  sub: string | undefined,
  font: string,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const lines = text.split("\n");
  const hasSub = !!sub;
  // Canvas is sized by the longest line: 1024 wide for one line, taller
  // for stacked lines. Height follows so the plane aspect stays true.
  const canvas = document.createElement("canvas");
  const W = 1024;
  const lineH = 190;
  const H = Math.max(256, lines.length * lineH + (hasSub ? 110 : 40) + 60);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  if (backing) {
    // Dark glass panel with a faint colored edge — the sign reads on any
    // wall, day or night, like the shop fronts in the frames.
    ctx.fillStyle = "rgba(6,8,18,0.88)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = rgba(colorHex, 0.55);
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, W - 16, H - 16);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontFor = (px: number) => `800 ${px}px ${font}`;
  lines.forEach((line, i) => {
    const y = 60 + lineH / 2 + i * lineH + (hasSub ? 0 : (H - lines.length * lineH) / 2 - 30);
    const size = Math.min(170, Math.floor((W * 0.92) / Math.max(4, line.length * 0.62)));
    ctx.font = fontFor(size);
    // Outer glow (three passes: wide soft, mid, tight) then the fill.
    ctx.shadowColor = colorHex;
    ctx.shadowBlur = 64;
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 10;
    ctx.strokeText(line, W / 2, y);
    ctx.shadowBlur = 28;
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 6;
    ctx.strokeText(line, W / 2, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = fill;
    ctx.fillText(line, W / 2, y);
    // Crisp colored outline on top of the fill (pink outline / white
    // fill, exactly like the ORBITX CITY sign in the splash frames).
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.strokeText(line, W / 2, y);
  });
  if (hasSub) {
    const y = H - 62;
    ctx.font = `700 64px ${font}`;
    ctx.shadowColor = colorHex;
    ctx.shadowBlur = 22;
    ctx.fillStyle = colorHex;
    ctx.fillText(sub, W / 2, y);
    ctx.shadowBlur = 0;
  }
  return canvas;
}

/** Shared texture for one sign's text/color/variant. */
export function neonTexture(
  text: string,
  color: NeonColor = "pink",
  opts: { fill?: string; backing?: boolean; sub?: string; font?: string } = {},
): CanvasTexture | null {
  const key = `${text}|${color}|${opts.fill ?? "w"}|${opts.backing ?? true}|${opts.sub ?? ""}|${opts.font ?? ""}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const canvas = paintSign(
    text,
    NEON[color],
    opts.fill ?? "#ffffff",
    opts.backing ?? true,
    opts.sub,
    opts.font ?? "'Arial Black', 'Archivo Black', sans-serif",
  );
  if (!canvas) return null;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

/**
 * A neon sign mesh, ready to place. The plane's height follows the
 * canvas aspect so the text never stretches. `width` is the world width.
 */
export function makeNeonSign(text: string, opts: NeonSignOptions): Mesh | null {
  const color = opts.color ?? "pink";
  const tex = neonTexture(text, color, {
    fill: opts.fill,
    backing: opts.backing ?? true,
    sub: opts.sub,
    font: opts.font,
  });
  if (!tex) return null;
  const img = tex.image as HTMLCanvasElement;
  const aspect = img.width / Math.max(1, img.height);
  const height = opts.width / aspect;
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    toneMapped: false,
    side: opts.doubleSide ? DoubleSide : undefined,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(opts.width, height), mat);
  mesh.name = `neon:${text}`;
  if (opts.vertical) mesh.rotation.z = Math.PI / 2;
  // Neon never receives a shadow; it IS a light source visually.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 3;
  return mesh;
}

/**
 * A glowing billboard screen (gradient panel + big neon text), like the
 * OrbitX billboards in the frames. Same texture cache rules as signs.
 */
export function makeBillboard(
  text: string,
  opts: { width: number; color?: NeonColor; sub?: string },
): Mesh | null {
  if (typeof document === "undefined") return null;
  const color = opts.color ?? "pink";
  const key = `billboard|${text}|${color}|${opts.sub ?? ""}`;
  let tex = texCache.get(key);
  if (!tex) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Deep purple-blue screen gradient, like the frames' billboards.
    const g = ctx.createLinearGradient(0, 0, 1024, 512);
    g.addColorStop(0, "#1a0b2e");
    g.addColorStop(0.5, "#2b1055");
    g.addColorStop(1, "#0b1a33");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    // Star specks.
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * 1024, Math.random() * 512, 2, 2);
    }
    ctx.strokeStyle = rgba(NEON[color], 0.8);
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, 1004, 492);
    const lines = text.split("\n");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => {
      const y = 256 + (i - (lines.length - 1) / 2) * 150;
      ctx.font = `800 130px 'Arial Black', sans-serif`;
      ctx.shadowColor = NEON[color];
      ctx.shadowBlur = 56;
      ctx.strokeStyle = NEON[color];
      ctx.lineWidth = 8;
      ctx.strokeText(line, 512, y);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(line, 512, y);
    });
    if (opts.sub) {
      ctx.font = `700 56px 'Arial Black', sans-serif`;
      ctx.shadowColor = NEON[color];
      ctx.shadowBlur = 20;
      ctx.fillStyle = NEON[color];
      ctx.fillText(opts.sub, 512, 448);
      ctx.shadowBlur = 0;
    }
    tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    texCache.set(key, tex);
  }
  const mat = new MeshBasicMaterial({ map: tex, toneMapped: false, depthWrite: false });
  const mesh = new Mesh(new PlaneGeometry(opts.width, opts.width / 2), mat);
  mesh.name = `billboard:${text}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 3;
  return mesh;
}
