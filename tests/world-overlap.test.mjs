// WORLD OVERLAP: no two building/house footprints share area, no two
// buildings share an exact edge plane (z-fighting), wings included.
// Regression test for the 2026-11-25 "broke houses / buildings blended"
// report — checked against the real buildCity(1) output (all state
// regions + all 150 homes). The game TS can't be imported by plain node
// (extensionless imports), so this test bundles tests/probe-world-overlap.ts
// with esbuild and runs it.
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

test("world overlap: no blended buildings, no coplanar walls (probe)", { timeout: 180000 }, async () => {
  const bundle = path.join(root, "rig", ".probe-world-overlap.bundle.mjs");
  await run(esbuild, [path.join(root, "tests", "probe-world-overlap.ts"), "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`, "--log-level=error"]);
  try {
    const { stdout } = await run(process.execPath, [bundle], { timeout: 120000 });
    assert.match(stdout, /ALL WORLD OVERLAP CHECKS PASSED/);
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join("\n");
    assert.fail(`world overlap probe failed:\n${out || e.message}`);
  } finally {
    try { fs.unlinkSync(bundle); } catch {}
  }
});
