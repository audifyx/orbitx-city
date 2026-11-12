/* Bus verification (phone 390x844, real CDP touch) against local vite preview.
 * Flow: autostart at spawn -> drag the on-screen stick north to Central
 * Station -> tap Use to board the dwelling bus -> ride to Sunset, LA ->
 * tap Use to get off -> stick-walk away. Prints state + page errors;
 * screenshots to /tmp/bus-phone-*.png. */
import { createRequire } from 'module';
const require = createRequire('/home/hatch/workspace/cloudflare-deploy/package.json');
const { chromium } = require('playwright');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const shot = (n) => `/tmp/bus-phone-${n}.png`;

const ctx = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await ctx.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 300)); });
const cdp = await page.context().newCDPSession(page);

const state = () => page.evaluate(() => {
  const status = document.getElementById('status')?.textContent || '';
  const m = status.match(/(-?\d+)\s+(-?\d+)\s+seed/);
  return {
    status,
    px: m ? +m[1] : null,
    pz: m ? +m[2] : null,
    prompt: document.querySelector('.prompt')?.textContent || '',
    bus: window.__ORBITX_BUS || null,
    frameErr: window.__FRAME_ERR || '',
    fps: window.__ORBITX_FPS ?? null,
  };
});

/** Hold the on-screen stick in a direction (dx, dy in px from centre) via
 * real CDP touch events until `done()` is true or `maxMs` elapses. */
async function stickHold(dx, dy, done, maxMs) {
  const box = await page.locator('.stick').boundingBox();
  if (!box) { console.log('[stick not found]'); return false; }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx, y: cy + dy, id: 1 }] });
  const end = Date.now() + maxMs;
  let ok = false;
  while (Date.now() < end) {
    await wait(300);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx, y: cy + dy, id: 1 }] });
    if (await done()) { ok = true; break; }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return ok;
}

async function tapUse() {
  const box = await page.locator('button', { hasText: 'Use' }).first().boundingBox();
  if (!box) { console.log('[Use button not found]'); return; }
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

await page.goto('http://127.0.0.1:4175/?autostart&quality=low&touch=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
try {
  await page.waitForFunction(() => window.__ORBITX_READY === true, null, { timeout: 90000 });
} catch { console.log('READY TIMEOUT'); }
await wait(1500);
console.log('[boot]', JSON.stringify(await state()));
await page.screenshot({ path: shot('01-spawn') });

// Stick-walk north from spawn (0,62) to the Central Station door (0,30).
// Stick up = forward; drag ~70% of the stick radius.
const walked = await stickHold(0, -45, async () => {
  const s = await state();
  return s.pz !== null && s.pz <= 31;
}, 20000);
console.log('[walked to station]', walked, JSON.stringify(await state()));
await page.screenshot({ path: shot('02-station') });

// Board: tap Use when the prompt names the bus. Same fallback as desktop —
// if the 8s first dwell was missed, wait for the next Central dwell.
let boarded = false;
for (let i = 0; i < 150; i++) {
  const s = await state();
  if (/board the City Loop bus/.test(s.prompt)) {
    console.log('[board prompt]', JSON.stringify(s.prompt), JSON.stringify(s.bus));
    await tapUse();
    await wait(1500);
    const s2 = await state();
    console.log('[after tap Use]', JSON.stringify(s2.prompt), JSON.stringify(s2.bus));
    boarded = /Riding the City Loop/.test(s2.prompt) && s2.bus?.riding === true;
    break;
  }
  if (i % 10 === 0) console.log('[waiting for bus]', JSON.stringify(s.bus), JSON.stringify(s.prompt));
  await wait(2000);
}
console.log('[boarded]', boarded);
await page.screenshot({ path: shot('03-riding') });

// Ride to Sunset, LA.
const rideSamples = [];
let reachedSunset = false;
for (let i = 0; i < 50; i++) {
  const s = await state();
  rideSamples.push(`${s.status} | bus ${s.bus ? `${s.bus.x},${s.bus.z} dwell=${s.bus.dwelling} stop=${s.bus.atStop} spd=${s.bus.speed}` : '?'}`);
  if (s.bus && s.bus.dwelling && s.bus.atStop === 'sunset') { reachedSunset = true; break; }
  await wait(3000);
}
console.log('[ride samples]');
rideSamples.forEach((s) => console.log('  ', s));
console.log('[reached Sunset]', reachedSunset, JSON.stringify((await state()).prompt));
await page.screenshot({ path: shot('04-sunset') });

// Get off at Sunset via tap Use, then stick-walk away.
let off = false;
if (reachedSunset) {
  await tapUse();
  await wait(1500);
  const s = await state();
  console.log('[after get-off tap]', JSON.stringify(s.prompt), JSON.stringify(s.status));
  off = s.px !== null && Math.abs(s.px - 800) <= 4 && Math.abs(s.pz - 150) <= 4;
  const before = { x: s.px, z: s.pz };
  await stickHold(0, -45, async () => {
    const s2 = await state();
    return s2.px !== null && Math.hypot(s2.px - before.x, s2.pz - before.z) > 4;
  }, 8000);
  const s2 = await state();
  console.log('[walked away]', JSON.stringify(s2.status));
  off = off && Math.hypot(s2.px - before.x, s2.pz - before.z) > 3;
}
console.log('[got off at Sunset + walked away]', off);
await page.screenshot({ path: shot('05-off') });

console.log('[errors]', errors.length ? errors : 'none');
await ctx.close();
