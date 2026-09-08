import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

test.describe('Landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('hero section is visible on load', async ({ page }) => {
    await expect(page.locator('#intro')).toBeVisible();
    await expect(page.locator('.hero-heading')).toContainText('fully mapped');
  });

  test('CTA links to /app', async ({ page }) => {
    const ctaLinks = page.locator('.cta-button');
    await expect(ctaLinks.first()).toBeVisible();
    const count = await ctaLinks.count();
    for (let i = 0; i < count; i++) {
      await expect(ctaLinks.nth(i)).toHaveAttribute('href', '/app');
    }
  });

  test('theatre sections scroll into view', async ({ page }) => {
    // Scroll to characters section
    await page.locator('#characters').scrollIntoViewIfNeeded();
    await expect(page.locator('#characters')).toBeVisible();

    // Scroll to map section
    await page.locator('#map').scrollIntoViewIfNeeded();
    await expect(page.locator('#map')).toBeVisible();
  });

  test('has proper page title and meta description', async ({ page }) => {
    await expect(page).toHaveTitle(/betwixt-and-between/);
    const metaDesc = page.locator('meta[name="description"]');
    await expect(metaDesc).toHaveAttribute('content', /Characters, story graphs/);
  });
});

test.describe('App route migration', () => {
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
