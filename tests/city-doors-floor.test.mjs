// HQ FLOOR + DYNAMIC DOORS: the door registry and the fall-through fix,
// checked against the real city build (seed 1).
// The game TS can't be imported by plain node (extensionless imports), so
// this test bundles rig/probe-doors-floor.ts with esbuild and runs it.
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

test("hq floor + dynamic doors (probe)", { timeout: 180000 }, async () => {
  const bundle = path.join(root, "rig", ".probe-doors-floor.bundle.mjs");
  await run(esbuild, [path.join(root, "rig", "probe-doors-floor.ts"), "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`, "--log-level=error"]);
  try {
    const { stdout } = await run(process.execPath, [bundle], { timeout: 120000 });
    assert.match(stdout, /ALL DOOR \+ FLOOR CHECKS PASSED/);
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join("\n");
    assert.fail(`door/floor probe failed:\n${out || e.message}`);
  } finally {
    try { fs.unlinkSync(bundle); } catch {}
  }
});
