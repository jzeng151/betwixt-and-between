import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

test('a smaller desktop can continue into a loaded workspace', async ({ page, context }) => {
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
  await page.reload();
  await expect(page.locator('.notes-app')).toBeVisible();
  await expect(page.locator('.too-small')).toBeHidden();
  const other = await context.newPage();
  await other.setViewportSize({ width: 1000, height: 800 });
  await other.goto('/app');
  await expect(other.getByRole('button', { name: 'Continue at this size' })).toBeVisible();
  await other.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator('.notes-app')).toBeVisible();
});


test('small-screen entry still works when browser storage is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Blocked'); } }));
  await page.goto('/app');
  await page.getByRole('button', { name: 'Continue at this size' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Wiki', exact: true }).click();
  await expect(page.locator('.window[aria-label="Wiki"]')).toBeVisible();
});
