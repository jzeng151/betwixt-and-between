import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

test('a smaller desktop can continue into a loaded workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  await page.goto('/app');
  await expect(page.locator('.app-shell')).toBeHidden();
  const loaded = page.waitForResponse((response) => response.url().endsWith('/api/entities') && response.ok());
  await page.getByRole('button', { name: 'Continue at this size' }).click();
  await loaded;
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.too-small')).toBeHidden();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page.locator('.notes-app')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator('.notes-app')).toBeVisible();
});
