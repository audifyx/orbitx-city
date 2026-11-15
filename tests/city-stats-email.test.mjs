import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

// The stats page must NEVER show an email address — not to the admin,
// not to another signed-in user, not to a logged-out visitor. The 404
// screen must not hint at who can see the page, and the 403 screen and
// the admin header must not name anyone either. The access control
// itself (server-side, audifyx@gmail.com only) is untouched — only the
// visible text is email-free. The gate logic and comments still name
// the admin email in code; what matters is the RENDERED output, which
// comes only from these two functions.
function sliceFunction(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, `end marker not found: ${endMarker}`);
  return src.slice(start, end);
}

const panel = sliceFunction(app, "function CityStatsPanel(", "export function StatsPage");
const statsPage = sliceFunction(app, "export function StatsPage", "// Alerts:");

test("stats privacy: the shared stats panel renders no email address", () => {
  // CityStatsPanel renders the stats for the admin AND the error screens
  // for the 403 (other email) and 404 (logged out) cases. It must contain
  // no "@" at all, so no email address can appear in any of those views.
  assert.ok(!panel.includes("@"), "CityStatsPanel must not contain '@' anywhere");
  assert.ok(!panel.includes("audifyx@gmail.com"), "CityStatsPanel must not name the admin email");
  assert.ok(!panel.toLowerCase().includes("only available to"), "no 'only available to' wording in the stats panel");
});

test("stats privacy: the standalone /stats page renders no email address", () => {
  assert.ok(!statsPage.includes("@"), "StatsPage must not contain '@' anywhere");
  assert.ok(!statsPage.includes("audifyx@gmail.com"), "StatsPage must not name the admin email");
  assert.ok(!statsPage.toLowerCase().includes("can see this page"), "no 'can see this page' wording in the stats header");
  // The 404/403 status lines stay generic — no hint about who can access it.
  assert.ok(statsPage.includes("404 — Not found."), "logged-out screen stays a generic 404");
  assert.ok(statsPage.includes("403 — Forbidden."), "other-email screen stays a generic 403");
});

test("stats privacy: the leak sentences are gone from the client", () => {
  assert.ok(!app.includes("The stats page is only available to"), "the 404/403 leak sentence is gone");
  assert.ok(!app.includes("Only audifyx@gmail.com can see this page"), "the admin-header leak sentence is gone");
});
