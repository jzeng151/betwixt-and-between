import { test, expect } from '@playwright/test';
import { clearAll } from './helpers/db.js';
import postgres from 'postgres';
import { E2E_USER_HEADERS, PGLITE_URL } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ request }) => { await clearAll(request); });

for (const type of ['Character', 'Location'] as const) {
  test(`an empty Wiki creates and edits a ${type}, then restores that entry on reload`, async ({ page, request }) => {
    let failLoad = type === 'Character';
    let failCreate = type === 'Character';
    await page.route('**/api/entities', async (route) => {
      if (route.request().method() === 'GET' && failLoad) {
        failLoad = false;
        return route.fulfill({ status: 503, body: 'Unavailable' });
      }
      if (route.request().method() === 'POST' && failCreate) {
        failCreate = false;
        return route.fulfill({ status: 503, body: 'Unavailable' });
      }
      await route.continue();
    });
    await page.goto('/app');
    await page.getByTitle('Wiki', { exact: true }).click();
    const wiki = page.locator('.window[aria-label="Wiki"]');
    if (type === 'Character') {
      await expect(wiki.getByRole('alert')).toHaveText("Couldn't load your wiki.");
      await wiki.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    const create = wiki.getByRole('button', { name: `Create a ${type.toLowerCase()}` });
    await create.click();
    if (type === 'Character') {
      await expect(wiki.getByRole('alert')).toContainText("Couldn't create character");
      await create.click();
    }
    const name = wiki.locator('.entity-detail-header .inline-edit-input');
    await expect(name).toHaveValue(`Untitled ${type}`);
    await name.fill(`First ${type}`);
    await name.press('Enter');
    await expect.poll(async () => (await (await request.get('/api/entities')).json()).map((e: { name: string }) => e.name)).toEqual([`First ${type}`]);
    await page.reload();
    await expect(wiki.locator('.entity-detail-title-text')).toHaveText(`First ${type}`);
    await expect(wiki.locator('.entry.active')).toHaveText(`First ${type}`);
  });
}

test('reload keeps window geometry and minimized state, while a new tab starts independently', async ({ page, context }) => {
  await page.goto('/app');
  await page.getByTitle('Notes', { exact: true }).click();
  const notes = page.locator('.window[aria-label="Notes"]');
  await notes.getByRole('button', { name: 'Minimize', exact: true }).click();
  await page.getByTitle('Settings', { exact: true }).click();
  const settings = page.locator('.window[aria-label="Settings"]');
  await settings.locator('.titlebar').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  const before = await settings.boundingBox();
  await page.reload();
  await expect(settings).toBeVisible();
  expect(await settings.boundingBox()).toEqual(before);
  await expect(settings).toBeFocused();
  await expect(notes).not.toBeVisible();
  await expect(page.getByTitle('Notes', { exact: true }).locator('.active-dot')).toBeVisible();
  const other = await context.newPage();
  await other.goto('/app');
  await expect(other.getByRole('heading', { name: 'Start with one true thing.' })).toBeVisible();
  await expect(other.locator('.window')).toHaveCount(0);
  await other.close();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.getByTitle('Notes', { exact: true }).locator('.active-dot')).toBeVisible();
  await expect(settings).toHaveCount(0);
  await page.getByTitle('Notes', { exact: true }).click();
  await expect(notes).toBeVisible();
});

test('switching accounts in the same tab discards the previous account window snapshot', async ({ page, context }) => {
  const id = crypto.randomUUID();
  const sql = postgres(PGLITE_URL, { max: 1, prepare: false });
  try {
    await sql`insert into "user" (id, name, email, email_verified) values (${id}, 'Other writer', ${`${id}@example.test`}, true)`;
    await page.goto('/app');
    await page.getByTitle('Settings', { exact: true }).click();
    await expect(page.locator('.window[aria-label="Settings"]')).toBeVisible();
    await context.setExtraHTTPHeaders({ 'x-test-user-id': id });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Start with one true thing.' })).toBeVisible();
    await expect(page.locator('.window')).toHaveCount(0);
  } finally {
    await sql`delete from "user" where id = ${id}`;
    await sql.end();
  }
});


test('successful Wiki creation retry permits sign-out without acknowledging a stale failure', async ({ page }) => {
  await page.goto('/app');
  await page.getByTitle('Wiki', { exact: true }).click();
  const wiki = page.locator('.window[aria-label="Wiki"]');
  const create = wiki.getByRole('button', { name: 'Create a character' });
  await expect(create).toBeVisible();
  await page.route('**/api/entities', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue(), { times: 1 });
  await create.click();
  await expect(wiki.getByRole('alert')).toContainText("Couldn't create character");
  await create.click();
  await expect(wiki.locator('.inline-edit-input')).toHaveValue('Untitled Character');
  await page.getByTitle('Settings', { exact: true }).click();
  const settings = page.locator('.window[aria-label="Settings"]');
  await settings.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Acknowledge failed changes' })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
});
