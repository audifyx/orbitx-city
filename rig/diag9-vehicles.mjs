// diag7: did ANY frame run before the first buy? Reads the frame hooks the
// moment the HUD Shop button appears, then buys the ATV and dumps worldCars.
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
      const v = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("poll evaluate hung")), 60000))]);
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
const readFrameState = (page) => page.evaluate(() => ({
  ready: window.__ORBITX_READY ?? null,
  draws: window.__ORBITX_DRAWS ?? null,
  fps: window.__ORBITX_FPS ?? null,
  player: window.__ORBITX_PLAYER ?? null,
}));

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
  // THE measurement: the instant the HUD Shop button exists, what frame state?
  await waitFor(page, async () => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Shop")), "HUD", 600000);
  results.frameAtHud = await readFrameState(page);
  console.log("FRAME AT HUD:", JSON.stringify(results.frameAtHud));
  // Now buy the ATV exactly like the proof rig does.
  await clickText(page, "Shop", "HUD Shop");
  await waitFor(page, async () => /Inventory/.test(await textOf(page)), "Shop panel", 60000);
  await clickText(page, "Cars", "Cars tab");
  await sleep(1500);
  results.frameAtBuy = await readFrameState(page);
  console.log("FRAME AT BUY:", JSON.stringify(results.frameAtBuy));
  const bought = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("article button")].find((b) => (b.textContent || "").trim() === "Buy — 1500 City Sol");
    if (!btn) return "no-buy-button";
    if (btn.disabled) return "buy-disabled";
    btn.click();
    return "clicked";
  });
  console.log("atv buy:", bought);
  results.buy = bought;
  await waitFor(page, async () => {
    const s = await page.evaluate(() => window.__ORBITX_SNAP);
    return s && s.balance !== null && s.balance !== 60000 ? s.balance : null;
  }, "balance moves", 180000);
  await sleep(3000);
  results.snapAfterBuy = await page.evaluate(() => {
    const s = window.__ORBITX_SNAP;
    return s ? { worldCars: s.worldCars, activeVehicle: s.activeVehicle, balance: s.balance, prompt: s.prompt ?? null } : null;
  });
  results.playerAfterBuy = await readFrameState(page);
  console.log("SNAP AFTER BUY:", JSON.stringify(results.snapAfterBuy));
  console.log("PLAYER AFTER BUY:", JSON.stringify(results.playerAfterBuy));

  // --- diag9: board + compact buys, garage upgrade, then poll the cap ---
  const buyByPrice = async (price, label) => {
    const r = await page.evaluate((p) => {
      const b = [...document.querySelectorAll("article button")].find((x) => (x.textContent || "").trim() === `Buy — ${p} City Sol`);
      if (!b) return "no-buy-button";
      if (b.disabled) return "buy-disabled";
      b.click();
      return "clicked";
    }, price);
    console.log(label, "buy:", r);
    const before = (await page.evaluate(() => window.__ORBITX_SNAP))?.balance;
    await waitFor(page, async () => {
      const s = await page.evaluate(() => window.__ORBITX_SNAP);
      return s && s.balance !== null && s.balance !== before ? s.balance : null;
    }, label + " balance moves", 180000);
    await sleep(2000);
    return r;
  };
  const shopOpen = await page.evaluate(() => /Inventory/.test(document.body.textContent || ""));
  if (!shopOpen) { await clickText(page, "Shop", "HUD Shop"); await waitFor(page, async () => /Inventory/.test(await textOf(page)), "Shop panel", 60000); }
  await clickText(page, "Cars", "Cars tab");
  await sleep(1500);
  await buyByPrice(150, "board");
  await buyByPrice(220, "compact");
  console.log("balance after 3 buys:", (await page.evaluate(() => window.__ORBITX_SNAP))?.balance);
  const up = await page.evaluate(() => {
    const b = [...document.querySelectorAll("article button")].find((x) => (x.textContent || "").trim().startsWith("+2 slots"));
    if (!b) return "no-upgrade-button";
    if (b.disabled) return "upgrade-disabled";
    b.click();
    return "clicked";
  });
  console.log("upgrade click:", up);
  results.upgradeClick = up;
  results.poll = [];
  for (let i = 0; i < 45; i++) {
    const st = await page.evaluate(() => {
      const s = window.__ORBITX_SNAP;
      const sedanBtn = [...document.querySelectorAll("article button")].find((b) => {
        const t = (b.textContent || "").trim();
        return t === "Buy — 450 City Sol" || t === "Garage full";
      });
      const fits = [...document.querySelectorAll("p")].map((p) => p.textContent || "").find((t) => t.includes("garage fits"));
      return s ? { bal: s.balance, slots: s.garage?.slots, vehicles: (s.vehicles || []).length, sedanBtn: sedanBtn ? sedanBtn.textContent.trim() : "none", fits: fits || null } : null;
    });
    results.poll.push({ t: i * 2, ...st });
    console.log("POLL " + (i * 2) + "s:", JSON.stringify(st));
    await sleep(2000);
  }
  fs.writeFileSync(`${OUT}/diag9-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  console.log("DIAG9 DONE");
}
main().catch((e) => {
  console.error("DIAG9 FAILED:", e.message);
  try { fs.writeFileSync(`${OUT}/diag9-results.json`, JSON.stringify({ error: e.message, ...results }, null, 2)); } catch {}
  process.exit(1);
});
