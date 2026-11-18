// Vehicles rig (2026-11-18): against the LOCAL rig server (port 8946).
// Flow: boot (guest) -> buy ATV (1500) -> enter -> drive (displacement)
// -> buy board (150) -> enter -> push (displacement) -> buy compact (220)
// -> 4th buy (sedan 450) must be refused: "Garage full" (cap = 3)
// -> buy +2 garage slots (800) -> buy sedan (450) -> enter -> drive
// -> buy fly-skyhopper (6000) -> enter -> Take off -> player y rises.
// Every state read waits for the value itself, never a fixed sleep.
// Canvas hidden throughout except brief captures (OOM guard, SwiftShader).
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire("/home/hatch/workspace/cloudflare-deploy/package.json");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8946/?quality=low";
const OUT = "/home/hatch/workspace/orbitx-city-vehicles/rig";
fs.mkdirSync(OUT, { recursive: true });
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
function textOf(page) { return page.evaluate(() => document.body.textContent || ""); }
async function closePanel(page) {
  // The buy toast ("...It's on the road in front of you.") stays in the
  // DOM after the panel closes, so unmount is detected by the panel's own
  // heading, not by the toast text. If the heading is already gone the
  // panel closed on an earlier attempt — return instead of throwing.
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
  throw new Error("Shop panel did not close after 3 Close clicks");
}
const readPlayer = (page) => page.evaluate(() => window.__ORBITX_PLAYER ?? null);
const readSnap = (page) => page.evaluate(() => {
  const s = window.__ORBITX_SNAP;
  if (!s) return null;
  return {
    driving: s.driving,
    vehicles: (s.vehicles || []).map((v) => v.id),
    activeVehicle: s.activeVehicle,
    garage: s.garage,
    balance: s.balance,
    carFlying: s.carFlying,
  };
});
const readBalance = (page) => page.evaluate(() => {
  const el = document.querySelector(".topbar strong");
  const m = el ? (el.textContent || "").match(/([\d,]+)/) : null;
  return m ? Number(m[1].replace(/,/g, "")) : null;
});
async function buyCarByPrice(page, price) {
  return page.evaluate((p) => {
    const btn = [...document.querySelectorAll("article button")].find((b) => (b.textContent || "").trim() === `Buy — ${p} City Sol`);
    if (!btn) {
      const full = [...document.querySelectorAll("article button")].find((b) => (b.textContent || "").trim() === "Garage full");
      return full ? "garage-full-button-shown" : "no-buy-button";
    }
    if (btn.disabled) return "buy-disabled";
    btn.click();
    return "clicked";
  }, price);
}
async function pressUse(page) {
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Use");
    if (!b) return false;
    b.click();
    return true;
  });
  if (!ok) await page.keyboard.press("KeyE");
}
async function enterNearestCar(page, label) {
  await pressUse(page);
  await waitFor(page, async () => (await readSnap(page))?.driving === true, `driving (${label})`, 90000);
  const pos = await waitFor(page, async () => {
    const p = await readPlayer(page);
    return p && typeof p.x === "number" ? p : null;
  }, `player pos while driving (${label})`, 120000);
  return pos;
}
// Hold W for `secs` seconds, sampling the player pos each second.
// Returns the sampled trail + total displacement.
async function driveFor(page, secs) {
  const trail = [];
  const start = await readPlayer(page);
  trail.push(start);
  await page.keyboard.down("KeyW");
  try {
    for (let i = 0; i < secs; i++) {
      await sleep(1000);
      const p = await readPlayer(page);
      if (p) trail.push(p);
    }
  } finally {
    await page.keyboard.up("KeyW");
  }
  const end = trail[trail.length - 1];
  const disp = start && end ? Math.hypot(end.x - start.x, end.z - start.z) : 0;
  return { trail, displacement: +disp.toFixed(2) };
}
async function exitCar(page, label) {
  await page.keyboard.press("KeyE");
  await waitFor(page, async () => (await readSnap(page))?.driving === false, `exited (${label})`, 120000);
}
async function captureFrame(page, name) {
  try {
    await page.evaluate(() => { document.querySelector("#rig-hide-canvas")?.remove(); document.querySelectorAll("canvas").forEach((c) => { c.style.display = ""; }); });
    const before = await page.evaluate(() => window.__ORBITX_DRAWS ?? 0);
    await waitFor(page, async () => {
      const d = await page.evaluate(() => window.__ORBITX_DRAWS ?? 0);
      return d > before ? d : null;
    }, `fresh frame (${name})`, 120000);
    const dataUrl = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (!c) return null;
      const off = document.createElement("canvas");
      off.width = c.width; off.height = c.height;
      off.getContext("2d").drawImage(c, 0, 0);
      return off.toDataURL("image/jpeg", 0.85);
    });
    if (dataUrl) {
      fs.writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(dataUrl.split(",")[1], "base64"));
      return "ok";
    }
    return "no-canvas";
  } catch (e) { return String(e).slice(0, 120); }
  finally {
    await page.evaluate(() => {
      const s = document.createElement("style");
      s.id = "rig-hide-canvas";
      s.textContent = "canvas{display:none !important}";
      document.head.appendChild(s);
      document.querySelectorAll("canvas").forEach((c) => { c.style.display = "none"; });
    }).catch(() => {});
  }
}
async function openCarsTab(page) {
  await clickText(page, "Shop", "HUD Shop");
  await waitFor(page, async () => /Inventory/.test(await textOf(page)), "Shop panel", 60000);
  await clickText(page, "Cars", "Cars tab");
  await sleep(1500);
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
  const boot = await waitFor(page, async () => {
    const t = await textOf(page);
    if (t.includes("SKIP")) { await clickText(page, "SKIP →", "SKIP"); return "skipped flyover"; }
    if (t.includes("Play as guest") || t.includes("ENTER THE CITY")) return "menu (intro already ended)";
    return null;
  }, "intro SKIP or main menu", 300000);
  console.log(boot);
  await waitFor(page, async () => {
    const t = await textOf(page);
    if (t.includes("Play as guest")) return "menu";
    if (t.includes("ENTER THE CITY")) { await clickText(page, "ENTER THE CITY →", "ENTER THE CITY"); return "entered"; }
    return null;
  }, "ENTER THE CITY or main menu", 120000);
  await waitFor(page, async () => (await textOf(page)).includes("Play as guest"), "Play as guest", 120000);
  await clickText(page, "Play as guest", "Play as guest");
  await waitFor(page, async () => (await textOf(page)).includes("CHOOSE YOUR CHARACTER"), "CHOOSE YOUR CHARACTER", 120000);
  await clickText(page, "CHOOSE YOUR CHARACTER →", "CHOOSE YOUR CHARACTER");
  await waitFor(page, async () => {
    const b = await page.evaluate(() => {
      const el = document.querySelector("button#play");
      return el ? (el.textContent || "").trim() : null;
    });
    return b === "PLAY" || b === "BUILDING" ? b : null;
  }, "character select #play", 120000);
  await page.evaluate(() => { const el = document.querySelector("button#play"); if (el) el.click(); });
  await waitFor(page, async () => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Shop")), "HUD Shop button", 600000);
  console.log("hud ok");

  const balance0 = await readBalance(page);
  results.balanceStart = balance0;
  console.log("start balance:", balance0);

  // --- 1. ATV: buy 1500, enter, drive ---
  await openCarsTab(page);
  results.atvBuy = await buyCarByPrice(page, 1500);
  console.log("atv buy click:", results.atvBuy);
  const balAtv = await waitFor(page, async () => {
    const b = await readBalance(page);
    return b !== null && b !== balance0 ? b : null;
  }, "balance moves after ATV buy", 90000);
  results.atv = { balanceAfter: balAtv };
  await closePanel(page);
  const atvPos = await enterNearestCar(page, "ATV");
  results.atv.enterPos = atvPos;
  const atvDrive = await driveFor(page, 6);
  results.atv.drive = atvDrive;
  console.log("atv drive:", JSON.stringify(atvDrive.displacement));
  await exitCar(page, "ATV");
  results.atv.snapAfter = await readSnap(page);

  // --- 2. Skateboard: buy 150, enter, push ---
  await openCarsTab(page);
  results.boardBuy = await buyCarByPrice(page, 150);
  console.log("board buy click:", results.boardBuy);
  const balBoard = await waitFor(page, async () => {
    const b = await readBalance(page);
    return b !== null && b !== balAtv ? b : null;
  }, "balance moves after board buy", 90000);
  results.board = { balanceAfter: balBoard };
  await closePanel(page);
  const boardPos = await enterNearestCar(page, "board");
  results.board.enterPos = boardPos;
  const boardDrive = await driveFor(page, 6);
  results.board.drive = boardDrive;
  console.log("board drive:", JSON.stringify(boardDrive.displacement));
  await exitCar(page, "board");
  results.board.snapAfter = await readSnap(page);

  // --- 3. Compact (220): 3rd owned vehicle ---
  await openCarsTab(page);
  results.compactBuy = await buyCarByPrice(page, 220);
  console.log("compact buy click:", results.compactBuy);
  const balCompact = await waitFor(page, async () => {
    const b = await readBalance(page);
    return b !== null && b !== balBoard ? b : null;
  }, "balance moves after compact buy", 90000);
  results.compact = { balanceAfter: balCompact };
  await closePanel(page);
  results.snapAfter3 = await readSnap(page);
  console.log("owned after 3 buys:", JSON.stringify(results.snapAfter3));

  // --- 4. 4th buy (sedan 450) must hit the garage cap ---
  await openCarsTab(page);
  results.sedanBuyAttempt = await buyCarByPrice(page, 450);
  const sedanBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("article button")];
    const b = btns.find((x) => (x.textContent || "").includes("Orbit Sedan")) || null;
    return null;
  });
  const shopText = await textOf(page);
  results.cap = {
    buyAttempt: results.sedanBuyAttempt,
    garageFullShown: shopText.includes("Garage full"),
    garageFitsLine: (shopText.match(/Your garage fits \d+ cars — \d+ parked/) || [null])[0],
  };
  console.log("cap check:", JSON.stringify(results.cap));
  const balAfterCapAttempt = await readBalance(page);
  results.cap.balanceUnchanged = balAfterCapAttempt === balCompact;

  // --- 5. Garage upgrade: +2 slots (800) ---
  const upgradeClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("article button")].find((x) => (x.textContent || "").trim().startsWith("+2 slots"));
    if (!b) return "no-upgrade-button";
    if (b.disabled) return "upgrade-disabled";
    b.click();
    return "clicked";
  });
  results.upgradeClick = upgradeClick;
  console.log("upgrade click:", upgradeClick);
  const balUpgrade = await waitFor(page, async () => {
    const b = await readBalance(page);
    return b !== null && b !== balCompact ? b : null;
  }, "balance moves after garage upgrade", 90000);
  results.upgrade = { balanceAfter: balUpgrade };
  const snapAfterUpgrade = await readSnap(page);
  results.upgrade.snap = snapAfterUpgrade;
  console.log("garage after upgrade:", JSON.stringify(snapAfterUpgrade?.garage));

  // --- 6. Sedan (450) now buys -> enter -> drive ---
  results.sedanBuy = await buyCarByPrice(page, 450);
  console.log("sedan buy click:", results.sedanBuy);
  const balSedan = await waitFor(page, async () => {
    const b = await readBalance(page);
    return b !== null && b !== balUpgrade ? b : null;
  }, "balance moves after sedan buy", 90000);
  results.sedan = { balanceAfter: balSedan };
  await closePanel(page);
  results.sedanCapture = await captureFrame(page, "sedan-on-road");
  const sedanPos = await enterNearestCar(page, "sedan");
  results.sedan.enterPos = sedanPos;
  const sedanDrive = await driveFor(page, 6);
  results.sedan.drive = sedanDrive;
  console.log("sedan drive:", JSON.stringify(sedanDrive.displacement));
  await exitCar(page, "sedan");
  results.sedan.snapAfter = await readSnap(page);

  // --- 7. Flyer: buy skyhopper (6000) -> enter -> Take off -> y rises ---
  await openCarsTab(page);
  results.flyerBuy = await buyCarByPrice(page, 6000);
  console.log("flyer buy click:", results.flyerBuy);
  const balFlyer = await waitFor(page, async () => {
    const b = await readBalance(page);
    return b !== null && b !== balSedan ? b : null;
  }, "balance moves after flyer buy", 90000);
  results.flyer = { balanceAfter: balFlyer };
  await closePanel(page);
  const flyerPos = await enterNearestCar(page, "flyer");
  results.flyer.enterPos = flyerPos;
  const takeoff = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => ["Take off", "Fly"].includes((x.textContent || "").trim()));
    if (!b) return "no-fly-button";
    b.click();
    return "clicked";
  });
  results.flyer.takeoffClick = takeoff;
  console.log("takeoff click:", takeoff);
  const airPos = await waitFor(page, async () => {
    const p = await readPlayer(page);
    return p && p.y > 1 ? p : null;
  }, "player y rises (takeoff)", 120000).catch(() => null);
  results.flyer.airPos = airPos;
  const snapAir = await readSnap(page);
  results.flyer.snapAir = snapAir;
  console.log("flyer air:", JSON.stringify(airPos), "carFlying:", snapAir?.carFlying);
  // Land: press the Land button if present, else exit.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Land");
    if (b) b.click();
  }).catch(() => {});
  await sleep(3000);
  await exitCar(page, "flyer").catch(() => {});
  results.finalSnap = await readSnap(page);
  results.finalBalance = await readBalance(page);

  fs.writeFileSync(`${OUT}/results-phone.json`, JSON.stringify(results, null, 2));
  await browser.close();
  console.log("RIG DONE", JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error("RIG FAILED:", e.message);
  try { fs.writeFileSync(`${OUT}/results-phone.json`, JSON.stringify({ error: e.message, ...results }, null, 2)); } catch {}
  process.exit(1);
});
