// Color parity: client catalog (vehicles.ts VEHICLES) vs server (api/city.js
// VEHICLE_COLORS / VEHICLE_DEFAULT_COLORS, parsed from source — not exported).
// For each vehicle: is the client defaultColor valid server-side? Are the
// client color lists the same set as the server's? Does the server list
// include "white" (the pre-catalog fallback default that 400s buys)?
import fs from "node:fs";
import { VEHICLES } from "../web/src/game/vehicles.ts";

const src = fs.readFileSync("/home/hatch/workspace/orbitx-city-vehicles/api/city.js", "utf8");
function extractBlock(name) {
  const i = src.indexOf(name);
  const start = src.indexOf("{", i);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") depth++;
    if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error("block not found: " + name);
}
// The literals are plain JSON-compatible object syntax.
const srvColors = JSON.parse(extractBlock("const VEHICLE_COLORS ="));
const srvDefault = JSON.parse(extractBlock("const VEHICLE_DEFAULT_COLORS ="));

let bad = 0;
let whiteFails = [];
for (const v of VEHICLES) {
  const sc = srvColors[v.id];
  const sd = srvDefault[v.id];
  if (!sc) { console.log(`${v.id}: NO SERVER COLOR LIST`); bad++; continue; }
  const defOk = sc.includes(v.defaultColor);
  const setEq = sc.length === v.colors.length && sc.every((c) => v.colors.includes(c));
  const hasWhite = sc.includes("white");
  if (!hasWhite) whiteFails.push(v.id);
  const flag = !defOk || !setEq ? "  <-- MISMATCH" : "";
  if (flag) bad++;
  console.log(`${v.id.padEnd(16)} clientDef=${v.defaultColor.padEnd(12)} srvDef=${String(sd).padEnd(12)} defValid=${defOk} listsEqual=${setEq} srvHasWhite=${hasWhite}${flag}`);
  if (!setEq) {
    console.log(`    client-only: ${v.colors.filter((c) => !sc.includes(c)).join(",") || "-"}`);
    console.log(`    server-only: ${sc.filter((c) => !v.colors.includes(c)).join(",") || "-"}`);
  }
}
console.log(`\nvehicles whose server list LACKS "white" (buy 400s before catalog loads): ${whiteFails.length}`);
console.log(whiteFails.join(", "));
console.log(bad ? `${bad} vehicles with color mismatch` : "ALL 34: client defaultColor valid server-side AND color lists match");
