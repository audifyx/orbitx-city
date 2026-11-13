import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const main = readFileSync(new URL("../web/src/main.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/src/index.css", import.meta.url), "utf8");

test("stats route: /stats rewrites to the app shell on Vercel", () => {
  const rewrites = vercel.rewrites || [];
  assert.ok(
    rewrites.some((r) => r.source === "/stats" && r.destination === "/index.html"),
    `vercel.json needs a /stats -> /index.html rewrite, got ${JSON.stringify(rewrites)}`
  );
  // /stats/ (trailing slash) must not strand the relative ./game.js asset
  // under /stats/ — it redirects to the canonical /stats first.
  const redirects = vercel.redirects || [];
  assert.ok(
    redirects.some((r) => r.source === "/stats/" && r.destination === "/stats"),
    `vercel.json needs a /stats/ -> /stats redirect, got ${JSON.stringify(redirects)}`
  );
  // The rewrite is scoped to /stats only — /api/* must never be shadowed.
  assert.ok(!rewrites.some((r) => r.source.includes("api")), "no rewrite may touch /api/*");
});

test("stats route: /stats renders the standalone StatsPage, not the game", () => {
  assert.ok(main.includes('"/stats"'), "main.tsx must branch on the /stats path");
  assert.ok(main.includes("StatsPage"), "main.tsx must render StatsPage on /stats");
  assert.ok(app.includes("export function StatsPage"), "App.tsx must export StatsPage");
  // The standalone page fetches the SAME gated op as the in-game panel —
  // the server returns 200/403/404, the page never decides access itself.
  assert.ok(app.includes('op: "city-stats"'), "StatsPage must call the city-stats op");
  // The standalone page shares the panel rendering — same sections, same data.
  assert.ok(app.includes("<CityStatsPanel stats={stats}"), "StatsPage must render the shared CityStatsPanel");
  // No game boots on the stats path: StatsPage never creates a canvas.
  const statsPage = app.slice(app.indexOf("export function StatsPage"));
  assert.ok(!statsPage.includes("createGame"), "StatsPage must not boot the game engine");
});

test("stats route: the page has its own scroll + readable styles", () => {
  assert.ok(css.includes(".stats-page"), "index.css must style the standalone stats page");
  assert.ok(css.includes("overflow-y: auto"), "the stats page must scroll on its own (body is overflow:hidden)");
});
