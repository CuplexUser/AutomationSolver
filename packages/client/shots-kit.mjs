// Temporary: screenshots of the excavator kit in both plant views. Deleted after use.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:5199';
const SHOT = process.env.SHOT_DIR;
const RUN_MS = Number(process.env.RUN_MS ?? 45000);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 300)));
const email = `kit${Date.now()}@example.com`;
await page.goto(BASE + '/login');
await page.request.post(BASE + '/api/auth/register', { data: { email, password: 'perf-password-1', displayName: 'Kit' } });
await page.waitForTimeout(500);
const token = [...fs.readFileSync(`${SHOT}/server.log`, 'utf8').matchAll(/verify-email\?token=([a-f0-9]+)/g)].pop()[1];
await page.request.post(BASE + '/api/auth/verify-email', { data: { token } });
await page.request.put(BASE + '/api/settings', { data: { settings: { devUnlockAll: true } } });

for (const [slug, presets] of [['factory-supervisor', []]]) {
  await page.goto(`${BASE}/puzzles/${slug}`);
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Watch the plant run/i }).click();
  const close = page.getByTitle('Close every window and watch the plant on its own');
  if ((await close.count()) && (await close.isEnabled())) await close.click();
  await page.waitForTimeout(RUN_MS);
  await page.screenshot({ path: `${SHOT}/kit-${slug}-0.png` });
  for (const name of presets ?? []) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOT}/kit-${slug}-${name.split(' ')[0]}.png` });
  }
  if (process.env.SERIES) {
    await page.getByRole('button', { name: process.env.SERIES, exact: true }).click();
    for (let k = 0; k < 10; k++) {
      await page.waitForTimeout(4000);
      await page.locator('canvas').first().screenshot({ path: `${SHOT}/series-${k}.png` });
    }
  }
}
await browser.close();
