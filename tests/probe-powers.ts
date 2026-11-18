// HERO POWERS probe: bundles web/src/game/powers.ts with esbuild and
// checks the 60-hero library + roster data (characters.json). Run via
// tests/powers.test.mjs — never imported directly by node (TS source).
import { readFileSync } from "node:fs";
import {
  POWER_DEFS,
  TRICK_ARROWS,
  cooldownReady,
  cooldownRemainingMs,
  inMeleeArc,
  isPowerActive,
  nextTrickArrow,
  powerForLook,
  powerIdsUsed,
  powerKindsUsed,
  powerSpeedMult,
} from "../web/src/game/powers.ts";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  if (!cond) failures.push(label);
  else console.log(`ok - ${label}`);
}

const chars = JSON.parse(readFileSync(new URL("../web/public/config/characters.json", import.meta.url), "utf8")) as Array<{
  id: string;
  displayName: string;
  look?: string;
  tagline?: string;
  group?: string;
}>;

// --- Library shape ---
check(POWER_DEFS.length === 60, `60 power defs (got ${POWER_DEFS.length})`);
const heroIds = POWER_DEFS.map((d) => d.heroId);
check(new Set(heroIds).size === 60, "every heroId unique (one power per hero)");
check(powerKindsUsed().length === 10, `10 effect kinds used (got ${powerKindsUsed().join(", ")})`);
check(powerIdsUsed().length >= 18, `>=18 distinct power ids (got ${powerIdsUsed().length})`);
for (const def of POWER_DEFS) {
  check(def.cooldownMs > 0, `${def.heroId}: cooldown > 0`);
  check(def.key === "KeyY", `${def.heroId}: key is KeyY`);
  check(def.name.length > 0 && def.blurb.length > 0, `${def.heroId}: name + blurb set`);
  check(def.range >= 0 && def.arcDeg >= 0 && def.arcDeg <= 360, `${def.heroId}: range/arc sane`);
  if (def.kind === "projectile") check(!!def.proj && (def.projSpeed ?? 0) > 0, `${def.heroId}: projectile has proj + speed`);
  if (def.kind === "breach") check((def.teleport ?? 0) > 0, `${def.heroId}: breach has teleport distance`);
}

// --- Roster coverage ---
const byGroup = new Map<string, number>();
for (const c of chars) byGroup.set(c.group ?? "kol", (byGroup.get(c.group ?? "kol") ?? 0) + 1);
check(chars.length === 72, `72 roster entries (got ${chars.length})`);
for (const [group, want] of [["walking-dead", 15], ["fear", 15], ["flash", 15], ["arrow", 15], ["kol", 12]] as const) {
  check(byGroup.get(group) === want, `group ${group} has ${want} (got ${byGroup.get(group)})`);
}
const charIds = new Set(chars.map((c) => c.id));
for (const def of POWER_DEFS) check(charIds.has(def.heroId), `def ${def.heroId} exists in characters.json`);
for (const c of chars) {
  if (c.group === "kol") check(!powerForLook(c.id), `KOL ${c.id} has no power (wave 2)`);
  else check(!!powerForLook(c.id), `hero ${c.id} has a power`);
}

// --- No original TV names in any user-visible string ---
const banned = [
  "rick grimes", "daryl dixon", "michonne", "carol peletier", "negan", "lucille", "maggie greene",
  "glenn rhee", "abraham ford", "rosita espinosa", "eugene porter", "ezekiel", "gabriel stokes", "sasha williams",
  "madison clark", "nick clark", "alicia clark", "travis manawa", "victor strand", "daniel salazar", "ofelia salazar",
  "luciana galvez", "morgan jones", "dwight", "john dorie", "naomi", "althea szewczyk", "sarah rabinowitz",
  "barry allen", "the flash", "iris west", "caitlin snow", "killer frost", "cisco ramon", "joe west",
  "harrison wells", "reverse-flash", "wally west", "kid flash", "jesse quick", "jay garrick", "ralph dibny",
  "elongated man", "leonard snart", "captain cold", "mick rory", "heat wave", "cecile horton", "chester p. runk",
  "nora west-allen", "oliver queen", "green arrow", "felicity smoak", "john diggle", "spartan", "laurel lance",
  "black canary", "sara lance", "white canary", "thea queen", "speedy", "roy harper", "arsenal", "malcolm merlyn",
  "dark archer", "slade wilson", "deathstroke", "adrian chase", "prometheus", "emiko queen", "rene ramirez",
  "wild dog", "dinah drake", "curtis holt", "mr. terrific", "nyssa al ghul", "carl grimes",
];
for (const c of chars) {
  const s = `${c.displayName} ${c.look ?? ""} ${c.tagline ?? ""}`.toLowerCase();
  for (const b of banned) check(!s.includes(b), `${c.id}: no banned name "${b}" in visible strings`);
}
for (const def of POWER_DEFS) {
  const s = `${def.heroName} ${def.name} ${def.blurb}`.toLowerCase();
  for (const b of banned) check(!s.includes(b), `power ${def.heroId}: no banned name "${b}"`);
}

// --- Cooldown math ---
check(cooldownReady(5000, 0, 5000) === true, "cooldown ready at exactly cooldownMs");
check(cooldownReady(4999, 0, 5000) === false, "cooldown not ready 1ms early");
check(cooldownRemainingMs(2000, 0, 5000) === 3000, "cooldown remaining 3000ms");
check(cooldownRemainingMs(9000, 0, 5000) === 0, "cooldown remaining floors at 0");
check(isPowerActive(1000, 2000) === true, "power active before activeUntil");
check(isPowerActive(2000, 2000) === false, "power inactive at activeUntil");

// --- Speed Force: 3x while held/active, 1x after ---
const flash = powerForLook("dash-vance")!;
check(flash.id === "speed-force" && flash.hold === true, "Dash Vance: Speed Force hold power");
check(powerSpeedMult(flash, 1000, 9000) === 3, "Speed Force gives 3x while active");
check(powerSpeedMult(flash, 9000, 9000) === 1, "Speed Force gives 1x after it ends");
check(powerSpeedMult(null, 1000, 9000) === 1, "no power gives 1x");
const voss = powerForLook("harrison-voss")!;
check(voss.hold === true && voss.speedMult === 2.5, "Harrison Voss: Reverse Speed hold 2.5x");
const holds = POWER_DEFS.filter((d) => d.hold);
check(holds.length === 2 && holds.every((d) => d.kind === "speed-hold"), "exactly 2 hold powers, both speed-hold");

// --- Trick arrows cycle one type per shot ---
check(TRICK_ARROWS.join(",") === "standard,explosive,smoke", "trick arrow order standard/explosive/smoke");
check(nextTrickArrow("standard") === "explosive", "trick cycle standard -> explosive");
check(nextTrickArrow("explosive") === "smoke", "trick cycle explosive -> smoke");
check(nextTrickArrow("smoke") === "standard", "trick cycle smoke -> standard");
const quinn = powerForLook("owen-quinn")!;
check(quinn.trick === true && quinn.kind === "projectile", "Owen Quinn: trick arrows");

// --- Melee arc (yaw convention: forward = (sin yaw, -cos yaw)) ---
check(inMeleeArc(0, 0, 0, 0, -2, 3.2, 100) === true, "arc: target straight ahead in range hits");
check(inMeleeArc(0, 0, 0, 0, 2, 3.2, 100) === false, "arc: target behind does not hit");
check(inMeleeArc(0, 0, 0, 0, -2, 3.2, 360) === true, "arc: 360 sweep hits in range");
check(inMeleeArc(0, 0, 0, 0, -5, 3.2, 360) === false, "arc: out of range misses even at 360");
check(inMeleeArc(0, 0, 0, 2.5, -2.5, 3.8, 360) === true, "arc: staff sweep reaches 3.5u diagonal");

// --- Rally tuning differs between the two leaders ---
const cole = powerForLook("cole-maddox")!;
const mara = powerForLook("mara-clarke")!;
check(cole.kind === "rally" && mara.kind === "rally", "both leaders rally");
check(cole.range === 12 && cole.speedMult === 1.25 && cole.durationMs === 20000, "Cole rally: 12u / +25% / 20s");
check(mara.range === 8 && mara.speedMult === 1.15 && mara.durationMs === 15000, "Mara rally: 8u / +15% / 15s");

// --- Scope + breach spot checks ---
for (const id of ["maggie-hart", "carl-maddox", "sasha-wells"]) {
  check(powerForLook(id)?.scope === true, `${id}: scoped shot`);
}
check(powerForLook("sisko-ray")?.kind === "breach" && powerForLook("sisko-ray")?.teleport === 8, "Sisko Ray: breach 8u");
check(powerForLook("kate-frost")?.kind === "aoe" && powerForLook("kate-frost")?.aoeMode === "wait", "Kate Frost: freeze AoE");
check(powerForLook("laura-lance")?.aoeMode === "knockback", "Laura Lance: sonic knockback");
check(powerForLook("carolyn-marsh")?.kind === "stealth", "Carolyn Marsh: stealth");

if (failures.length) {
  console.error(`\n${failures.length} POWER CHECK(S) FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("ALL POWER CHECKS PASSED");
