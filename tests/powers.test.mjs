// HERO POWERS: the 60-hero library + roster data, checked against the
// real powers.ts + characters.json. The game TS can't be imported by plain
// node (extensionless imports), so this test bundles tests/probe-powers.ts
// with esbuild and runs it (same pattern as city-doors-floor.test.mjs).
// Run: node --test tests/powers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = path.join(root, "web", "node_modules", ".bin", "esbuild");

test("hero powers library + 60-hero roster (probe)", { timeout: 180000 }, async () => {
  const bundle = path.join(root, "rig", ".probe-powers.bundle.mjs");
  await run(esbuild, [path.join(root, "tests", "probe-powers.ts"), "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`, "--log-level=error"]);
  try {
    const { stdout } = await run(process.execPath, [bundle], { timeout: 120000 });
    assert.match(stdout, /ALL POWER CHECKS PASSED/);
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join("\n");
    assert.fail(`powers probe failed:\n${out || e.message}`);
  } finally {
    try { fs.unlinkSync(bundle); } catch {}
  }
});
