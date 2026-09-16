import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`landing example is clearly illustrative at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('story in section');
    await expect(page.getByText('An example of a connected story, not a playable demo.')).toBeVisible();
    await expect(page.locator('.connection strong')).toHaveText(['Elara Voss', 'Ashenveil']);
    await expect(page.locator('.connection a, .views a')).toHaveCount(0);
    await expect(page).toHaveTitle(/Betwixt and Between/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const action = page.getByRole('link', { name: 'Open the workspace' });
    await expect(action).toBeVisible();
    await action.click();
    await expect(page).toHaveURL(/\/auth\/login$/);
  });
}

test.describe('App route migration', () => {
  test.use({ extraHTTPHeaders: E2E_USER_HEADERS });
  test('/app offers a useful empty workspace', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
    await page.goto('/app');
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start with one true thing.' })).toBeVisible();

    const createCharacter = page.getByRole('button', { name: 'Create a character' });
    await createCharacter.click();
    const characters = page.getByRole('dialog', { name: 'Characters' });
    await expect(characters).toBeVisible();

    await characters.getByRole('button', { name: 'Close' }).click();
    await expect(createCharacter).toBeFocused();
  });

  test('/app loads project data after the viewport expands', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    let entityRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/entities') entityRequests += 1;
    });

    await page.goto('/app');
    await expect(page.getByRole('button', { name: 'Continue at this size' })).toBeVisible();
    expect(entityRequests).toBe(0);

    await page.setViewportSize({ width: 1400, height: 800 });
    await expect.poll(() => entityRequests).toBe(1);
    await expect(page.locator('.app-shell')).toBeVisible();
  });

});
