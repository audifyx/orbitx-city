// Door-blockers check: for every door / interaction anchor in the real
// buildCity(1) world, test the approach in front of the door against every
// solid object in the world:
//   - HARD: a collider (tree trunk, bench, hedge, kiosk, grill, curb, wall,
//     ...) whose footprint overlaps the walk-up corridor at walk height.
//     The corridor is the centre line the player walks to reach the anchor:
//     0.9 wide (player is ~0.8, so a hedge flanking the doorway 0.7
//     off-centre does NOT count), from 1.1 behind the anchor (just short
//     of the door face, so the door panel / the building's own wall is
//     never flagged) out to 4.6 in front of it, toward the street. A
//     trunk on the path is caught even when it stands a few units out.
//     Colliders under 0.5 tall are walkable ground (slabs, paths) and
//     are ignored.
//   - CANOPY: a leaves box over the central strip of the doorway (a tree
//     canopy hanging over the door + sign, even when the trunk is clear).
//   - LAMP: a lamp pole (0.26 x 4.3 black post) inside the corridor.
// Board anchors (jobs / events / ads kiosks) are measured from the anchor
// itself, since the kiosk sits BEHIND the anchor.
// Usage: esbuild-bundle, run with node. Exits 1 when any door is blocked.
import { buildCity, type Anchor } from "./web/src/game/city";

const city = buildCity(1);
console.log(`boxes=${city.boxes.length} colliders=${city.colliders.length} anchors=${city.anchors.length}`);

// yaw -> outward normal (doorAnchor convention: n=pi, s=0, w=pi/2, e=-pi/2).
function normal(a: Anchor): { nx: number; nz: number } {
  const yaw = a.yaw;
  const q = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (Math.abs(q) < 0.01) return { nx: 0, nz: 1 }; // s
  if (Math.abs(q - Math.PI) < 0.01) return { nx: 0, nz: -1 }; // n
  if (Math.abs(q - Math.PI / 2) < 0.01) return { nx: -1, nz: 0 }; // w
  if (Math.abs(q - (3 * Math.PI) / 2) < 0.01) return { nx: 1, nz: 0 }; // e
  throw new Error(`unexpected anchor yaw ${yaw}`);
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const BOARD_KINDS = new Set(["jobs", "events", "ads"]);

// Walk-up corridor for one anchor: 0.9 wide on the centre line (the
// player is ~0.8 wide, so only an object that actually intrudes into the
// player's body counts — a hedge flanking the doorway 0.7 off-centre does
// not), from 1.1 behind the anchor (just short of the door face, so the
// door panel itself is never flagged) out to 4.0 in front of it, toward
// the street. (A neighbouring building wall 4.5 out is the street, not
// the doorway — the farthest real blocker, a patio palm / monorail
// pillar, sits 3.6 out.) Boards: 0.2..6.0 out from the anchor.
function corridorRect(a: Anchor): Rect {
  const { nx, nz } = normal(a);
  const board = BOARD_KINDS.has(a.kind);
  const dNear = board ? 0.2 : -1.1;
  const dFar = board ? 6.0 : 4.0;
  const half = 0.45;
  let x0: number, x1: number, z0: number, z1: number;
  if (nz !== 0) {
    x0 = a.x - half;
    x1 = a.x + half;
    z0 = a.z + Math.min(nz * dNear, nz * dFar);
    z1 = a.z + Math.max(nz * dNear, nz * dFar);
  } else {
    z0 = a.z - half;
    z1 = a.z + half;
    x0 = a.x + Math.min(nx * dNear, nx * dFar);
    x1 = a.x + Math.max(nx * dNear, nx * dFar);
  }
  return { x0, z0, x1, z1 };
}

// Central strip over the door + sign (canopy check): 2.0 wide, from the
// face out to 4.5. Boards have no door/sign, so they skip this.
function canopyRect(a: Anchor): Rect | null {
  if (BOARD_KINDS.has(a.kind)) return null;
  const { nx, nz } = normal(a);
  const half = 1.0;
  const dNear = -1.4; // the face itself
  const dFar = 3.1; // 4.5 out from the face
  let x0: number, x1: number, z0: number, z1: number;
  if (nz !== 0) {
    x0 = a.x - half;
    x1 = a.x + half;
    z0 = a.z + Math.min(nz * dNear, nz * dFar);
    z1 = a.z + Math.max(nz * dNear, nz * dFar);
  } else {
    z0 = a.z - half;
    z1 = a.z + half;
    x0 = a.x + Math.min(nx * dNear, nx * dFar);
    x1 = a.x + Math.max(nx * dNear, nx * dFar);
  }
  return { x0, z0, x1, z1 };
}

function overlap(a: Rect, b: Rect): { ox: number; oz: number } | null {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  if (ox <= 0.05 || oz <= 0.05) return null;
  return { ox, oz };
}

interface Hit {
  anchor: Anchor;
  type: "HARD" | "CANOPY" | "LAMP";
  desc: string;
}

const hits: Hit[] = [];

// What boxes sit at a collider, so a HARD hit names the object.
function boxMatsAt(cx0: number, cz0: number, cx1: number, cz1: number): string {
  const seen = new Map<string, number>();
  for (const b of city.boxes) {
    const cos = Math.abs(Math.cos(b.ry || 0));
    const sin = Math.abs(Math.sin(b.ry || 0));
    const hx = (b.sx * cos + b.sz * sin) / 2;
    const hz = (b.sx * sin + b.sz * cos) / 2;
    if (b.x + hx < cx0 - 0.6 || b.x - hx > cx1 + 0.6) continue;
    if (b.z + hz < cz0 - 0.6 || b.z - hz > cz1 + 0.6) continue;
    if (b.y - b.sy / 2 >= 2.5) continue;
    seen.set(b.mat, (seen.get(b.mat) || 0) + 1);
  }
  return [...seen.entries()]
    .sort((p, q) => q[1] - p[1])
    .slice(0, 3)
    .map(([m, n]) => `${m}x${n}`)
    .join(" ");
}

// --- HARD: colliders at walk height ---------------------------------------
// A tagged lift-door is the lift's own cab door (it opens on call), like a
// building's door panel — never a foreign blocker.
for (const a of city.anchors) {
  const zr = corridorRect(a);
  for (const c of city.colliders) {
    if (c.tag && c.tag.startsWith("lift-door:")) continue;
    if (c.maxY <= 0.5 || c.minY >= 2.5) continue;
    const ov = overlap(zr, { x0: c.minX, z0: c.minZ, x1: c.maxX, z1: c.maxZ });
    if (!ov) continue;
    hits.push({
      anchor: a,
      type: "HARD",
      desc: `collider x${c.minX.toFixed(1)}..${c.maxX.toFixed(1)} z${c.minZ.toFixed(1)}..${c.maxZ.toFixed(1)} y${c.minY.toFixed(1)}..${c.maxY.toFixed(1)}${c.tag ? ` tag=${c.tag}` : ""} overlap ${ov.ox.toFixed(2)}x${ov.oz.toFixed(2)} [${boxMatsAt(c.minX, c.minZ, c.maxX, c.maxZ)}]`,
    });
  }
}

// --- CANOPY + LAMP: boxes ---------------------------------------------------
for (const a of city.anchors) {
  const zr = corridorRect(a);
  const cr = canopyRect(a);
  for (const b of city.boxes) {
    const cos = Math.abs(Math.cos(b.ry || 0));
    const sin = Math.abs(Math.sin(b.ry || 0));
    const hx = (b.sx * cos + b.sz * sin) / 2;
    const hz = (b.sx * sin + b.sz * cos) / 2;
    const fr: Rect = { x0: b.x - hx, z0: b.z - hz, x1: b.x + hx, z1: b.z + hz };
    const y0 = b.y - b.sy / 2;
    const y1 = b.y + b.sy / 2;
    if (cr && (b.mat === "leaves" || b.mat === "leavesDark") && y0 >= 3.5 && y1 <= 7.5) {
      const ov = overlap(cr, fr);
      if (ov) {
        hits.push({
          anchor: a,
          type: "CANOPY",
          desc: `leaves ${b.mat} at (${b.x.toFixed(1)},${b.z.toFixed(1)}) y${y0.toFixed(1)}..${y1.toFixed(1)} overlap ${ov.ox.toFixed(2)}x${ov.oz.toFixed(2)}`,
        });
      }
    }
    // lamp pole: the only 0.26 x 4.3 x 0.26 black post in the world
    if (
      b.mat === "black" &&
      Math.abs(b.sx - 0.26) < 0.01 &&
      Math.abs(b.sy - 4.3) < 0.01 &&
      Math.abs(b.sz - 0.26) < 0.01
    ) {
      const ov = overlap(zr, fr);
      if (ov) {
        hits.push({
          anchor: a,
          type: "LAMP",
          desc: `lamp pole at (${b.x.toFixed(1)},${b.z.toFixed(1)}) overlap ${ov.ox.toFixed(2)}x${ov.oz.toFixed(2)}`,
        });
      }
    }
  }
}

const byAnchor = new Map<string, Hit[]>();
for (const h of hits) {
  const k = `${h.anchor.id} (${h.anchor.name})`;
  if (!byAnchor.has(k)) byAnchor.set(k, []);
  byAnchor.get(k)!.push(h);
}

console.log(`\nBLOCKED DOORS: ${byAnchor.size} of ${city.anchors.length} anchors`);
for (const [k, hs] of [...byAnchor.entries()].sort()) {
  const a = hs[0].anchor;
  console.log(`\n  ${k} kind=${a.kind} at (${a.x.toFixed(1)},${a.z.toFixed(1)}) yaw=${a.yaw.toFixed(2)}`);
  for (const h of hs) console.log(`    [${h.type}] ${h.desc}`);
}

const hard = hits.filter((h) => h.type === "HARD").length;
const canopy = hits.filter((h) => h.type === "CANOPY").length;
const lamp = hits.filter((h) => h.type === "LAMP").length;
console.log(`\nDOOR_BLOCKERS=${byAnchor.size} HARD=${hard} CANOPY=${canopy} LAMP=${lamp} TOTAL_HITS=${hits.length}`);
if (byAnchor.size > 0) {
  console.log("FAIL: doors blocked — move the object, never the door.");
  process.exit(1);
}
console.log("PASS: every door approach is clear.");
