import { expect, test } from '@playwright/test';

test('register, build a ladder, solve it, and see progress persist', async ({ page }) => {
  const email = `e2e${Date.now()}@example.com`;

  // --- Register through the UI ---------------------------------------------
  await page.goto('/login');
  await page.getByRole('button', { name: /Need an account/ }).click();
  await page.getByLabel('Display name').fill('E2E Tech');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Lands on the puzzle list.
  await expect(page).toHaveURL(/\/puzzles$/);
  await expect(page.getByText('Direct Control')).toBeVisible();

  // --- Build the Direct Control solution: X0 (NO) -> Y0 (coil) --------------
  await page.goto('/puzzles/direct-control');
  await expect(page.getByText('Terminal Assignment')).toBeVisible();

  const cells = page.locator('.ladder-cell');
  // First cell: normally-open contact on X0.
  await cells.nth(0).click();
  await page.getByLabel('Device address').fill('X0');
  await page.locator('.instr-btn', { hasText: 'NO Contact' }).click();

  // Second cell: output coil on Y0.
  await cells.nth(1).click();
  await page.getByLabel('Device address').fill('Y0');
  await page.locator('.instr-btn', { hasText: 'Output Coil' }).click();

  // --- Run the simulation and confirm the lamp lights ----------------------
  await page.getByRole('button', { name: '▶ Run' }).click();
  await page.locator('.toggle').first().click(); // flip the Run Switch (X0)
  await expect(page.locator('.lamp.on')).toBeVisible();
  await page.getByRole('button', { name: '■ Stop' }).click();

  // --- Submit for grading --------------------------------------------------
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(/Solved — all scenarios pass/)).toBeVisible();
  await expect(page.locator('.score.ok')).toHaveText('100%');

  // --- Progress persists across a reload -----------------------------------
  await page.goto('/puzzles');
  await expect(page.locator('.puzzle-card', { hasText: 'Direct Control' })).toContainText('SOLVED');
});
