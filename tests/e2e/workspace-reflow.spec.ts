import { expect, test } from '@playwright/test';
import { clearAll } from './helpers/db.js';
import { E2E_USER_HEADERS } from './pglite-config.js';

const desktop = { width: 1440, height: 900 };
const narrow = { width: 320, height: 800 };
test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: desktop });

test.beforeEach(async ({ request }) => { await clearAll(request); });

for (const app of ['Notes', 'Timeline', 'World Map']) {
  test(`${app} reflows after resize without losing its desktop bounds`, async ({ page }) => {
    await page.goto('/app');
    await page.getByTitle(app, { exact: true }).click();
    const win = page.getByRole('dialog', { name: app, exact: true });
    await expect(win).toBeVisible();
    if (app === 'World Map') await win.getByRole('button', { name: 'Create your first map' }).click();
    const original = await win.boundingBox();
    await page.setViewportSize(narrow);
    await page.getByRole('button', { name: 'Continue at this size' }).click();
    await expect(win).toBeInViewport({ ratio: 1 });
    const action = app === 'Timeline' ? win.getByRole('button', {name: 'Add act'})
      : app === 'World Map' ? win.getByTitle('New map', {exact:true}) : win.getByRole('button', {name:'Close', exact:true});
    await expect(action).toBeInViewport({ ratio: 1 });
    await action.click({ trial: true });
    await page.setViewportSize(desktop);
    await expect.poll(() => win.boundingBox()).toEqual(original);
  });
}

test('Notes can open and dismiss a folder dialog on fresh narrow entry', async ({ page }) => {
  await page.setViewportSize(narrow);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Continue at this size' }).click();
  await page.getByTitle('Notes', { exact: true }).click();
  const win = page.getByRole('dialog', {name:'Notes',exact:true});
  await win.getByTitle('New folder').click();
  const name = win.getByRole('textbox', { name: 'Name' });
  await name.fill('Drafts');
  await page.getByTitle('Timeline', { exact: true }).click();
  await expect(win).toBeHidden();
  await page.getByTitle('Notes', { exact: true }).click();
  await expect(name).toHaveValue('Drafts');
  await win.getByRole('button', {name:'Cancel'}).click();
  await win.getByRole('button', {name:'Close',exact:true}).click();
  await expect(win).toHaveCount(0);
});
