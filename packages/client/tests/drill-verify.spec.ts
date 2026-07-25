import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SERVER_LOG =
  'C:\\Users\\iddt\\AppData\\Local\\Temp\\claude\\D--Code-Claude-AutomationSolver\\bef297cf-b330-4467-894a-f8df5bcb5cb9\\scratchpad\\server.log';

function findVerifyToken(email: string): string {
  const log = readFileSync(SERVER_LOG, 'utf8');
  const idx = log.lastIndexOf(email);
  const chunk = log.slice(idx);
  const m = chunk.match(/verify-email\?token=([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error('verification token not found in server log yet');
  return m[1];
}

test('drill station 3D view renders with new camera + geometry', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('requestfailed', (req) => console.log('REQ FAILED', req.url(), req.failure()?.errorText));
  page.on('response', (res) => {
    if (res.url().includes('verify-email')) console.log('RESPONSE', res.status(), res.url());
  });

  const email = `drilltest+${Date.now()}@example.com`;
  await page.goto('/login');
  await page.getByRole('button', { name: /Need an account/ }).click();
  await page.getByLabel('Display name').fill('Drill Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  const confirm = page.getByLabel('Confirm password');
  if (await confirm.isVisible().catch(() => false)) await confirm.fill('testpass123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/Check your email/i)).toBeVisible({ timeout: 10000 });

  await page.waitForTimeout(500);
  const token = findVerifyToken(email);
  await page.goto(`/verify-email?token=${token}`);
  for (let i = 0; i < 20 && !/\/puzzles$/.test(page.url()); i++) {
    await page.waitForTimeout(500);
  }
  console.log('URL after verify wait:', page.url());
  if (!/\/puzzles$/.test(page.url())) {
    await page.reload();
    await page.waitForTimeout(1000);
  }

  await page.goto('/settings');
  await page.waitForTimeout(1000);
  const shotDir0 = process.env.SHOT_DIR ?? '.';
  await page.screenshot({ path: `${shotDir0}/settings-page.png` });
  const devToggle = page.getByText(/developer mode/i).locator('..').locator('input[type="checkbox"]');
  if (await devToggle.isVisible().catch(() => false)) {
    await devToggle.check();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.waitForTimeout(500);
  }

  await page.goto('/puzzles/drill-station');
  const canvas = page.locator('.machine3d canvas');
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  const shotDir = process.env.SHOT_DIR ?? '.';
  await page.screenshot({ path: `${shotDir}/drill-rest-view.png` });
  const box = await page.locator('.machine3d').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.screenshot({ path: `${shotDir}/drill-rest-view-2.png` });

  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
  expect(errors.filter((e) => /drill-station\.glb|SpindleHead|three/i.test(e))).toEqual([]);
});
