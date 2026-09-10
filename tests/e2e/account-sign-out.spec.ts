import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });

test('Account saves the latest Notes draft and signs out through the auth endpoint', async ({ page, request }) => {
  const folder = await (await request.post('/api/notes/folders', { data: { name: 'Sign-out test' } })).json();
  const entry = await (await request.post('/api/notes/entries', { data: { name: 'Last edit', body: '', parentId: folder.id } })).json();
  try {
    await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
    await page.goto('/auth/login');
    await page.goto('/app');
    await page.getByTitle('Notes', { exact: true }).click();
    const notes = page.locator('.window[aria-label="Notes"]');
    await notes.getByRole('button', { name: 'Sign-out test' }).click();
    await notes.getByRole('button', { name: /Last edit/ }).click();
    let releaseSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
    await page.route(`**/api/notes/entries/${entry.id}`, async (route) => {
      if (route.request().method() === 'PATCH') await pendingSave;
      await route.continue();
    });
    let signOutRequests = 0;
    page.on('request', (req) => { if (req.url().endsWith('/api/auth/sign-out')) signOutRequests++; });
    await notes.getByPlaceholder('Start writing...').fill('Keep this after sign-out.');
    await page.getByTitle('Settings', { exact: true }).click();
    const settings = page.locator('.window[aria-label="Settings"]');
    await settings.getByRole('button', { name: 'Account', exact: true }).click();
    const signingOut = page.waitForResponse((res) => res.url().endsWith('/api/auth/sign-out') && res.request().method() === 'POST');
    await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Signing out' })).toBeVisible();
    expect(signOutRequests).toBe(0);
    releaseSave();
    expect((await signingOut).ok()).toBe(true);
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome to Betwixt' })).toBeVisible();
    expect((await (await request.get(`/api/notes/entries/${entry.id}`)).json()).data.body).toBe('Keep this after sign-out.');
    await expect(page.locator('.window')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.locator('.window')).toHaveCount(0);
  } finally {
    await request.delete(`/api/notes/folders/${folder.id}`);
  }
});
