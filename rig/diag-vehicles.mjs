// Diagnostic rig: WHY doesn't the ATV move, and WHY can't the board be
// entered? Samples render draws (proof frames actually run) alongside
// position, snap and the interact prompt.
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire("/home/hatch/workspace/cloudflare-deploy/package.json");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8946/?quality=low";
const OUT = "/home/hatch/workspace/orbitx-city-vehicles/rig";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, label, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("poll evaluate hung")), 60000)),
      ]);
      if (v) return v;
    } catch {}
    await sleep(2000);
  }
  throw new Error(`timeout waiting for: ${label}`);
}
async function clickText(page, text, label) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === t);
    if (!b) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error(`button not found: ${label || text}`);
  return true;
}
const textOf = (page) => page.evaluate(() => document.body.textContent || "");
const readPlayer = (page) => page.evaluate(() => window.__ORBITX_PLAYER ?? null);
const readDraws = (page) => page.evaluate(() => window.__ORBITX_DRAWS ?? 0);
const readSnap = (page) => page.evaluate(() => {
  const s = window.__ORBITX_SNAP;
  if (!s) return null;
  return { driving: s.driving, vehicles: (s.vehicles || []).map((v) => v.id), activeVehicle: s.activeVehicle, balance: s.balance, prompt: s.prompt ?? null };
});
const readBalance = (page) => page.evaluate(() => {
  const el = document.querySelector(".topbar strong");
  const m = el ? (el.textContent || "").match(/([\d,]+)/) : null;
  return m ? Number(m[1].replace(/,/g, "")) : null;
});
async function buyCarByPrice(page, price) {
  return page.evaluate((p) => {
    const btn = [...document.querySelectorAll("article button")].find((b) => (b.textContent || "").trim() === `Buy — ${p} City Sol`);
    if (!btn) return "no-buy-button";
    if (btn.disabled) return "buy-disabled";
    btn.click();
    return "clicked";
  }, price);
}
async function openCarsTab(page) {
  await clickText(page, "Shop", "HUD Shop");
  await waitFor(page, async () => /Inventory/.test(await textOf(page)), "Shop panel", 60000);
  await clickText(page, "Cars", "Cars tab");
  await sleep(1500);
}
async function closePanel(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const open = await page.evaluate(() => (document.body.textContent || "").includes("Cars — OrbitX Motors"));
    if (!open) return true;
    await clickText(page, "Close", "Close panel");
    const closed = await waitFor(page, async () => {
      const t = await textOf(page);
      return !t.includes("Cars — OrbitX Motors") ? true : null;
    }, "panel unmounts", 30000).catch(() => null);
    if (closed) return true;
  }
  throw new Error("Shop panel did not close");
}
async function pressUse(page) {
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Use");
    if (!b) return false;
    b.click();
    return true;
  });
  if (!ok) await page.keyboard.press("KeyE");
  return ok;
}

const results = {};
async function main() {
  const browser = await chromium.launch({
    args: ["--proxy-server=http://127.0.0.1:8888", "--ignore-certificate-errors", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=3072"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    const s = document.createElement("style");
    s.id = "rig-hide-canvas";
    s.textContent = "canvas{display:none !important}";
    document.head.appendChild(s);
  });
  await waitFor(page, async () => {
    const t = await textOf(page);
    if (t.includes("SKIP")) { await clickText(page, "SKIP →", "SKIP"); return "skipped"; }
    if (t.includes("Play as guest") || t.includes("ENTER THE CITY")) return "menu";
    return null;
  }, "intro", 300000);
  await waitFor(page, async () => {
    const t = await textOf(page);
    if (t.includes("Play as guest")) return "menu";
    if (t.includes("ENTER THE CITY")) { await clickText(page, "ENTER THE CITY →", "ENTER"); return "entered"; }
    return null;
  }, "menu", 120000);
  await waitFor(page, async () => (await textOf(page)).includes("Play as guest"), "guest", 120000);
  await clickText(page, "Play as guest", "guest");
  await waitFor(page, async () => (await textOf(page)).includes("CHOOSE YOUR CHARACTER"), "char", 120000);
  await clickText(page, "CHOOSE YOUR CHARACTER →", "char");
  await waitFor(page, async () => {
    const b = await page.evaluate(() => { const el = document.querySelector("button#play"); return el ? (el.textContent || "").trim() : null; });
    return b === "PLAY" || b === "BUILDING" ? b : null;
  }, "#play", 120000);
  await page.evaluate(() => { const el = document.querySelector("button#play"); if (el) el.click(); });
  await waitFor(page, async () => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Shop")), "HUD", 600000);
  console.log("hud ok");

  // --- ATV: buy, enter, drive with draws sampling ---
  await openCarsTab(page);
  console.log("atv buy:", await buyCarByPrice(page, 1500));
  const balAtv = await waitFor(page, async () => { const b = await readBalance(page); return b !== null && b !== 60000 ? b : null; }, "bal atv", 90000);
  results.atvBalanceAfter = balAtv;
  await closePanel(page);
  await pressUse(page);
  await waitFor(page, async () => (await readSnap(page))?.driving === true, "driving atv", 90000);
  const d0 = await readDraws(page);
  const p0 = await readPlayer(page);
  const trail = [{ t: 0, draws: d0, pos: p0 }];
  await page.keyboard.down("KeyW");
  try {
    for (let i = 1; i <= 10; i++) {
      await sleep(1000);
      trail.push({ t: i, draws: await readDraws(page), pos: await readPlayer(page) });
    }
  } finally { await page.keyboard.up("KeyW"); }
  const disp = trail.length > 1 && p0 && trail[trail.length - 1].pos
    ? Math.hypot(trail[trail.length - 1].pos.x - p0.x, trail[trail.length - 1].pos.z - p0.z) : 0;
  results.atvDrive = { drawsDelta: trail[trail.length - 1].draws - d0, displacement: +disp.toFixed(2), trail };
  console.log("ATV drive:", JSON.stringify({ drawsDelta: results.atvDrive.drawsDelta, displacement: results.atvDrive.displacement }));
  results.atvSnapDriving = await readSnap(page);
  // exit with E
  await page.keyboard.press("KeyE");
  await waitFor(page, async () => (await readSnap(page))?.driving === false, "exit atv", 120000);
  results.afterExitPos = await readPlayer(page);

  // --- Board: buy, then diagnose the enter failure ---
  await openCarsTab(page);
  console.log("board buy:", await buyCarByPrice(page, 150));
  const balBoard = await waitFor(page, async () => { const b = await readBalance(page); return b !== null && b !== balAtv ? b : null; }, "bal board", 90000);
  results.boardBalanceAfter = balBoard;
  await closePanel(page);
  results.boardSnap = await readSnap(page);
  const promptText = await page.evaluate(() => {
    const els = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /Press E|tap Use/.test(e.textContent || ""));
    return els.map((e) => (e.textContent || "").trim()).slice(0, 5);
  });
  results.boardPrompt = promptText;
  console.log("board snap:", JSON.stringify(results.boardSnap), "prompt:", JSON.stringify(promptText));
  const useFound = await pressUse(page);
  results.boardUseButtonFound = useFound;
  // watch driving + prompt for 15s
  let drove = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const s = await readSnap(page);
    if (s?.driving) { drove = true; break; }
  }
  results.boardEntered = drove;
  results.boardSnapAfterUse = await readSnap(page);
  console.log("board entered:", drove, JSON.stringify(results.boardSnapAfterUse));

  fs.writeFileSync(`${OUT}/diag-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  console.log("DIAG DONE");
}

main().catch((e) => {
  console.error("DIAG FAILED:", e.message);
  try { fs.writeFileSync(`${OUT}/diag-results.json`, JSON.stringify({ error: e.message, ...results }, null, 2)); } catch {}
  process.exit(1);
});
