import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { E2E_USER_HEADERS, E2E_USER_EMAIL, PGLITE_URL } from './pglite-config.js';

test.use({ viewport: { width: 1440, height: 1000 } });

test('Account saves the latest Notes draft and signs out through the auth endpoint', async ({ page, request, context }) => {
  const folder = await (await request.post('/api/notes/folders', { headers: E2E_USER_HEADERS, data: { name: 'Sign-out test' } })).json();
  const entry = await (await request.post('/api/notes/entries', { headers: E2E_USER_HEADERS, data: { name: 'Last edit', body: '', parentId: folder.id } })).json();
  const otherEntry = await (await request.post('/api/notes/entries', { headers: E2E_USER_HEADERS, data: { name: 'Other tab edit', body: '', parentId: folder.id } })).json();
  let renamedProfileUrl: string | undefined;
  try {
    await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
    await page.goto('/auth/login');
    const link = await page.request.post('/api/auth/sign-in/magic-link', { headers: { Origin: new URL(page.url()).origin }, data: { email: E2E_USER_EMAIL } });
    expect(link.ok(), await link.text()).toBe(true);
    const sql = postgres(PGLITE_URL, { max: 1, prepare: false });
    let token: string;
    try {
      const [verification] = await sql`select identifier from verification where value::jsonb->>'email' = ${E2E_USER_EMAIL} order by created_at desc limit 1`;
      token = verification.identifier;
    } finally { await sql.end(); }
    await page.goto(`/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=/app`);
    await expect(page).toHaveURL(/\/app$/);
    expect((await page.request.get('/api/auth/get-session')).ok()).toBe(true);
    const otherTab = await context.newPage();
    await otherTab.goto('/app');
    await otherTab.getByTitle('Notes', { exact: true }).click();
    const otherNotes = otherTab.locator('.window[aria-label="Notes"]');
    await otherNotes.getByRole('button', { name: 'Sign-out test' }).click();
    await otherNotes.getByRole('button', { name: /Other tab edit/ }).click();
    let releaseOtherSave!: () => void;
    const otherSave = new Promise<void>((resolve) => { releaseOtherSave = resolve; });
    let rejectOtherSave = true;
    await otherTab.route(`**/api/notes/entries/${otherEntry.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        await otherSave;
        if (rejectOtherSave) {
          rejectOtherSave = false;
          await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
          return;
        }
      }
      await route.continue();
    });
    await otherNotes.getByPlaceholder('Start writing...').fill('Keep the other tab edit too.');
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
    await settings.getByRole('button', { name: 'Profiles', exact: true }).click();
    await settings.getByRole('button', { name: 'Rename', exact: true }).first().click();
    await settings.locator('.rename-input').fill('Sign-out profile');
    let releaseRename!: () => void;
    const pendingRename = new Promise<void>((resolve) => { releaseRename = resolve; });
    await page.route('**/api/preferences/profiles/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        renamedProfileUrl = route.request().url();
        await pendingRename;
      }
      await route.continue();
    });
    const renameStarted = page.waitForRequest((req) => req.url().includes('/api/preferences/profiles/') && req.method() === 'PATCH');
    await settings.locator('.rename-input').press('Tab');
    await renameStarted;
    await expect(settings.getByRole('button', { name: 'Account', exact: true })).toBeDisabled();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTitle('Settings', { exact: true }).click();
    await settings.getByRole('button', { name: 'Account', exact: true }).click();
    const signingOut = page.waitForResponse((res) => res.url().endsWith('/api/auth/sign-out') && res.request().method() === 'POST');
    await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Signing out' })).toBeVisible();
    expect(signOutRequests).toBe(0);
    await expect(otherTab.getByRole('dialog', { name: 'Signing out' })).toBeVisible();
    await otherTab.evaluate(() => window.addEventListener('keydown', () => { document.body.dataset.backgroundShortcut = 'fired'; }));
    await otherTab.keyboard.press('Control+z');
    await expect(otherTab.locator('body')).not.toHaveAttribute('data-background-shortcut');
    releaseRename();
    releaseSave();
    expect(signOutRequests).toBe(0);
    releaseOtherSave();
    await expect(settings.getByRole('alert')).toContainText('Another tab could not save');
    expect(signOutRequests).toBe(0);
    await expect(otherNotes.getByPlaceholder('Start writing...')).toHaveValue('Keep the other tab edit too.');
    await expect(otherTab.getByRole('dialog', { name: 'Signing out' })).not.toBeVisible();
    await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
    expect((await signingOut).ok()).toBe(true);
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome to Betwixt' })).toBeVisible();
    expect((await (await request.get(`/api/notes/entries/${entry.id}`, { headers: E2E_USER_HEADERS })).json()).data.body).toBe('Keep this after sign-out.');
    await expect(page.locator('.window')).toHaveCount(0);
    expect((await (await request.get(`/api/notes/entries/${otherEntry.id}`, { headers: E2E_USER_HEADERS })).json()).data.body).toBe('Keep the other tab edit too.');
    await expect(otherTab).toHaveURL(/\/auth\/login$/);
    await expect(otherTab.locator('.window')).toHaveCount(0);
    expect(await (await page.request.get('/api/auth/get-session')).json()).toBeNull();
    await page.goBack();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.locator('.window')).toHaveCount(0);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth\/login$/);
  } finally {
    if (renamedProfileUrl) await request.patch(renamedProfileUrl, { headers: E2E_USER_HEADERS, data: { name: 'Default' } });
    await request.delete(`/api/notes/folders/${folder.id}`, { headers: E2E_USER_HEADERS });
  }
});
