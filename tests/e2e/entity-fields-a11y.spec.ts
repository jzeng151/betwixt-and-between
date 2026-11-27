import { expect, test } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
});

test('Appearance labels the accent color picker', async ({ page }) => {
  await page.goto('/app');
  await page.click('button[title="Settings"]');
  await expect(page.getByLabel('Accent Color', { exact: true })).toHaveValue(/^#[0-9a-f]{6}$/i);
});

for (const type of ['Act', 'Scene', 'Event', 'Location']) {
  test(`${type} details are a named keyboard scroll stop in view mode`, async ({ page, request }) => {
    const name = `Keyboard ${type} ${Date.now()}`;
    const response = await request.post('/api/entities', { data: { name, type } });
    expect(response.ok()).toBeTruthy();
    await page.goto('/app');
    await page.getByRole('button', { name: 'Command palette', exact: true }).click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const search = palette.getByRole('combobox');
    await search.fill(name);
    await expect(palette.getByRole('option')).toHaveCount(1);
    await search.press('Enter');

    const win = page.getByRole('dialog', { name, exact: true });
    const region = win.getByRole('region', { name: `${type} details`, exact: true });
    const edit = win.getByRole('button', { name: 'Edit', exact: true });
    await edit.press('Tab');
    await expect(region).toBeFocused();
    await expect(region).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => region.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('End');
    await expect.poll(() => region.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
    await page.keyboard.press('Tab');
    await expect(region).not.toBeFocused();
    await edit.click();
    await expect(region).toHaveCount(0);
  });
}
