// Temporary: measures the factory-line workspace. Deleted after use.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5199';
const PROF = process.env.NOPROF !== '1';
const SHOT = process.env.SHOT_DIR;
const LOG = `${SHOT}/server.log`;
const SLUG = process.env.SLUG ?? 'factory-line';
const PHASE_MS = Number(process.env.PHASE_MS ?? 8000);

const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
await ctx.addInitScript(() => {
  const w = window;
  w.__m = { draws: 0, frames: 0, gaps: [], long: 0, longN: 0, scans: 0, scanMs: 0 };
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = C.prototype[fn];
      if (!orig) continue;
      C.prototype[fn] = function (...a) {
        w.__m.draws += 1;
        return orig.apply(this, a);
      };
    }
  }
  let last = performance.now();
  const tick = (t) => {
    w.__m.frames += 1;
    w.__m.gaps.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      w.__m.long += e.duration;
      w.__m.longN += 1;
    }
  }).observe({ entryTypes: ['longtask'] });
  // The sim's scan loop is the only 50 ms interval on the page.
  const si = window.setInterval;
  window.setInterval = function (cb, ms, ...rest) {
    if (ms === 50 && typeof cb === 'function') {
      const wrapped = (...a) => {
        const t0 = performance.now();
        cb(...a);
        w.__m.scans += 1;
        w.__m.scanMs += performance.now() - t0;
      };
      return si.call(window, wrapped, ms, ...rest);
    }
    return si.call(window, cb, ms, ...rest);
  };
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

// Account, verified via the token the mailer logs, then dev unlock.
const email = `perf${Date.now()}@example.com`;
await page.goto(BASE + '/login');
let r = await page.request.post(BASE + '/api/auth/register', {
  data: { email, password: 'perf-password-1', displayName: 'Perf' },
});
if (!r.ok()) throw new Error('register ' + r.status() + (await r.text()));
await page.waitForTimeout(500);
const token = [...fs.readFileSync(LOG, 'utf8').matchAll(/verify-email\?token=([a-f0-9]+)/g)].pop()[1];
r = await page.request.post(BASE + '/api/auth/verify-email', { data: { token } });
if (!r.ok()) throw new Error('verify ' + r.status());
r = await page.request.put(BASE + '/api/settings', { data: { settings: { devUnlockAll: true } } });
if (!r.ok()) throw new Error('settings ' + r.status());

await page.goto(`${BASE}/puzzles/${SLUG}`);
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOT}/perf-0-loaded.png` });

const bucket = (url) => {
  if (!url) return '(native/gc/idle)';
  if (/react-dom|scheduler/.test(url)) return 'react-dom';
  if (/@react-three|react-three/.test(url)) return 'r3f';
  if (/postprocessing|n8ao|realism/.test(url)) return 'postprocessing';
  if (/three/.test(url)) return 'three';
  if (/\/src\//.test(url)) return 'app:' + url.replace(/.*\/src\//, '').replace(/\?.*/, '');
  return 'other:' + url.replace(/.*\//, '').replace(/\?.*/, '');
};

async function phase(name) {
  await page.evaluate(() => {
    const m = window.__m;
    Object.assign(m, { draws: 0, frames: 0, gaps: [], long: 0, longN: 0, scans: 0, scanMs: 0 });
  });
  if (PROF) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  await page.waitForTimeout(PHASE_MS);
  const { profile } = PROF
    ? await cdp.send('Profiler.stop')
    : { profile: { nodes: [], samples: [], timeDeltas: [] } };
  const m = await page.evaluate(() => {
    const m = window.__m;
    const g = [...m.gaps].sort((a, b) => a - b);
    return {
      fps: m.frames,
      p50: g[Math.floor(g.length * 0.5)],
      p95: g[Math.floor(g.length * 0.95)],
      max: g[g.length - 1],
      drawsPerFrame: m.frames ? m.draws / m.frames : 0,
      draws: m.draws,
      longMs: m.long,
      longN: m.longN,
      scans: m.scans,
      scanMsAvg: m.scans ? m.scanMs / m.scans : 0,
    };
  });
  const secs = PHASE_MS / 1000;
  // Self time per bucket from the sampled profile.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dts = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const fn = n.callFrame.functionName;
    const key = fn === '(idle)' ? '(idle)' : fn === '(program)' || fn === '(garbage collector)' ? fn : bucket(n.callFrame.url);
    self.set(key, (self.get(key) ?? 0) + (dts[i] ?? 0) / 1000);
  });
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const fns = new Map();
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    if (!f.url) {
      const nk = `[native] ${f.functionName || '(anon)'}`;
      fns.set(nk, (fns.get(nk) ?? 0) + (dts[i] ?? 0) / 1000);
      return;
    }
    const k = `${f.functionName || '(anon)'} @ ${f.url.replace(/.*\//, '').replace(/\?.*/, '')}:${f.lineNumber}`;
    fns.set(k, (fns.get(k) ?? 0) + (dts[i] ?? 0) / 1000);
  });
  // Charge each sample to its nearest ancestor in our own source: which component is paying.
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const owner = new Map();
  profile.samples.forEach((id, i) => {
    let cur = id;
    let key = null;
    while (cur != null) {
      const f = byId.get(cur).callFrame;
      if (/\/src\//.test(f.url)) {
        key = `${f.functionName || '(anon)'} @ ${f.url.replace(/.*\/src\//, '').replace(/\?.*/, '')}`;
        break;
      }
      cur = parent.get(cur);
    }
    if (key) owner.set(key, (owner.get(key) ?? 0) + (dts[i] ?? 0) / 1000);
  });
  const topOwners = [...owner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  const topFns = [...fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log(
    `\n== ${name}: ${(m.fps / secs).toFixed(1)} fps, frame p50 ${m.p50?.toFixed(1)} p95 ${m.p95?.toFixed(1)} max ${m.max?.toFixed(0)} ms, ` +
      `${(m.draws / secs / 1000).toFixed(1)}k draws/s, scans ${(m.scans / secs).toFixed(1)}/s (callback ${m.scanMsAvg.toFixed(1)} ms), ` +
      `long tasks ${m.longN} = ${((m.longMs / PHASE_MS) * 100).toFixed(0)}% of wall`,
  );
  for (const [k, v] of top) console.log(`   ${(v / secs).toFixed(0).padStart(5)} ms/s  ${k}`);
  console.log('   -- nearest app frame (inclusive):');
  for (const [k, v] of topOwners) console.log(`   ${(v / secs).toFixed(0).padStart(5)} ms/s  ${k}`);
  console.log('   -- top functions (self):');
  for (const [k, v] of topFns) console.log(`   ${(v / secs).toFixed(0).padStart(5)} ms/s  ${k}`);
  await page.screenshot({ path: `${SHOT}/perf-${name}.png` });
}

await phase('idle-stopped');

// Open the operator panel, run, AUTO, and hold START until the plant runs.
await page.getByTitle("The plant's pushbuttons, lamps and analog readouts").click();
await page.getByRole('button', { name: 'Run the simulation' }).click();
await page.getByRole('button', { name: 'Auto', exact: true }).click();
const start = page.getByRole('button', { name: 'Start', exact: true });
await start.dispatchEvent('pointerdown');
await page.waitForTimeout(2500);
await start.dispatchEvent('pointerup');
await page.waitForTimeout(4000);
await phase('running-hmi-open');

await page.getByTitle('Close every window and watch the plant on its own').click();
await page.waitForTimeout(1500);
await phase('running-plant-only');

for (const b of await page.locator('.pe-pou').all()) await b.dispatchEvent('click');
await page.waitForTimeout(2500);
await phase('running-sections-open');

await page.getByTitle('Close every window and watch the plant on its own').click();
await page.getByRole('button', { name: 'Stop the simulation' }).click();
await page.waitForTimeout(1000);
await phase('stopped-plant-only');

await browser.close();
