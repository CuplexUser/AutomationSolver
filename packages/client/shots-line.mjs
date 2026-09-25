// Temporary: section close-ups of the factory line for an A/B look. Deleted after use.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:5199';
const SHOT = process.env.SHOT_DIR;
const TAG = process.env.TAG ?? 'a';
const browser = await chromium.launch({ channel: 'msedge', headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const email = `shot${Date.now()}@example.com`;
await page.goto(BASE + '/login');
await page.request.post(BASE + '/api/auth/register', { data: { email, password: 'perf-password-1', displayName: 'Shot' } });
await page.waitForTimeout(500);
const token = [...fs.readFileSync(`${SHOT}/server.log`, 'utf8').matchAll(/verify-email\?token=([a-f0-9]+)/g)].pop()[1];
await page.request.post(BASE + '/api/auth/verify-email', { data: { token } });
await page.request.put(BASE + '/api/settings', { data: { settings: { devUnlockAll: true } } });
await page.goto(`${BASE}/puzzles/factory-line`);
await page.waitForSelector('canvas');
const close = page.getByTitle('Close every window and watch the plant on its own');
if (await close.isEnabled()) await close.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOT}/dbg-${TAG}-0-loaded.png` });
for (const name of ['Weld bay', 'Rack store and portal', 'Test bay and dock']) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT}/ab-${TAG}-${name.split(' ')[0]}.png` });
}
await browser.close();
