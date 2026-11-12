/* Bus verification (desktop) against local vite preview on 4173.
 * Flow: autostart at spawn -> walk north to Central Station -> board the
 * dwelling bus (E) -> ride to Sunset, LA (crosses the bridge in real time)
 * -> get off (E) at Sunset -> walk away. Prints state + page errors;
 * screenshots to /tmp/bus-*.png. */
import { createRequire } from 'module';
const require = createRequire('/home/hatch/workspace/cloudflare-deploy/package.json');
const { chromium } = require('playwright');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const shot = (n) => `/tmp/bus-${n}.png`;

const ctx = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await ctx.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 300)); });

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

await page.goto('http://127.0.0.1:4175/?autostart&quality=low', { waitUntil: 'domcontentloaded', timeout: 60000 });
try {
  await page.waitForFunction(() => window.__ORBITX_READY === true, null, { timeout: 180000 });
} catch { console.log('READY TIMEOUT'); }
await wait(1500);
console.log('[boot]', JSON.stringify(await state()));
try { await page.screenshot({ path: shot('01-spawn'), timeout: 60000 }); } catch (e) { console.log('[shot 01 failed]', String(e).slice(0, 120)); }

// Walk north from spawn (0,62) to the Central Station door (0,30).
await page.keyboard.down('KeyW');
let walked = false;
for (let i = 0; i < 40; i++) {
  const s = await state();
  if (s.pz !== null && s.pz <= 31) { walked = true; break; }
  await wait(400);
}
await page.keyboard.up('KeyW');
console.log('[walked to station]', walked, JSON.stringify(await state()));
try { await page.screenshot({ path: shot('02-station'), timeout: 60000 }); } catch (e) { console.log('[shot 02 failed]', String(e).slice(0, 120)); }

// Board: the bus dwells 8s at Central to start; if the walk missed it, wait
// at the station for its next Central dwell (waypoint 44, ~200s in).
let boarded = false;
for (let i = 0; i < 150; i++) {
  const s = await state();
  if (/board the City Loop bus/.test(s.prompt)) {
    console.log('[board prompt]', JSON.stringify(s.prompt), JSON.stringify(s.bus));
    await page.keyboard.press('KeyE');
    await wait(1500);
    const s2 = await state();
    console.log('[after board E]', JSON.stringify(s2.prompt), JSON.stringify(s2.bus));
    boarded = /Riding the City Loop/.test(s2.prompt) && s2.bus?.riding === true;
    break;
  }
  if (i % 10 === 0) console.log('[waiting for bus]', JSON.stringify(s.bus), JSON.stringify(s.prompt));
  await wait(2000);
}
console.log('[boarded]', boarded);
try { await page.screenshot({ path: shot('03-riding'), timeout: 60000 }); } catch (e) { console.log('[shot 03 failed]', String(e).slice(0, 120)); }

// Ride to Sunset, LA: sample every 3s — the player coords must track the
// bus, and the bus must hop the bridge (x 250 -> 556).
const rideSamples = [];
let reachedSunset = false;
for (let i = 0; i < 200; i++) {
  const s = await state();
  if (i % 5 === 0 || (s.bus && s.bus.dwelling)) rideSamples.push(`${s.status} | bus ${s.bus ? `${s.bus.x},${s.bus.z} dwell=${s.bus.dwelling} stop=${s.bus.atStop} spd=${s.bus.speed}` : '?'}`);
  if (s.bus && s.bus.dwelling && s.bus.atStop === 'sunset') { reachedSunset = true; break; }
  await wait(3000);
}
console.log('[ride samples]');
rideSamples.forEach((s) => console.log('  ', s));
console.log('[reached Sunset]', reachedSunset, JSON.stringify((await state()).prompt));
try { await page.screenshot({ path: shot('04-sunset'), timeout: 60000 }); } catch (e) { console.log('[shot 04 failed]', String(e).slice(0, 120)); }

// Get off at Sunset: E, then the player steps onto the sidewalk (800,150).
let off = false;
if (reachedSunset) {
  await page.keyboard.press('KeyE');
  await wait(1500);
  const s = await state();
  console.log('[after get-off E]', JSON.stringify(s.prompt), JSON.stringify(s.status));
  off = s.px !== null && Math.abs(s.px - 800) <= 4 && Math.abs(s.pz - 150) <= 4;
  // Walk away on foot (hold W ~2s) — coords must change.
  const before = { x: s.px, z: s.pz };
  await page.keyboard.down('KeyW');
  await wait(2000);
  await page.keyboard.up('KeyW');
  const s2 = await state();
  console.log('[walked away]', JSON.stringify(s2.status), 'delta', s2.px - before.x, s2.pz - before.z);
  off = off && Math.hypot(s2.px - before.x, s2.pz - before.z) > 3;
}
console.log('[got off at Sunset + walked away]', off);
try { await page.screenshot({ path: shot('05-off'), timeout: 60000 }); } catch (e) { console.log('[shot 05 failed]', String(e).slice(0, 120)); }

console.log('[errors]', errors.length ? errors : 'none');
await ctx.close();
