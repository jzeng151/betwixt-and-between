import { test, expect, type Locator, type Page } from '@playwright/test';
import { clearAll } from './helpers/db.js';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ request }) => clearAll(request));

async function resize(page: Page, win: Locator, width: number, height: number) {
  const frame = (await win.boundingBox())!;
  const grip = (await win.locator('.resize-br').boundingBox())!;
  const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + width - frame.width, y + height - frame.height);
  await page.mouse.up();
  await expect.poll(async () => (await win.boundingBox())?.height).toBe(height);
}

for (const mode of ['new', 'view', 'edit'] as const) {
  test(`character portrait and lower sections remain reachable in ${mode} mode`, async ({ page, request }) => {
    if (mode !== 'new') {
      const character = await request.post('/api/entities', { data: { type: 'Character', name: 'Aster', data: { motivation: 'Find home', body: 'A memory.\n'.repeat(64) } } });
      const note = await request.post('/api/entities', { data: { type: 'Note', name: 'Field notes' } });
      const rel = await request.post('/api/relationships', { data: { fromId: (await note.json()).id, toId: (await character.json()).id, type: 'note_of' } });
      expect(rel.ok()).toBeTruthy();
    }
    await page.goto('/app');
    if (mode === 'new') {
      await page.getByTitle('Characters', { exact: true }).click();
      await page.getByRole('button', { name: '+ New', exact: true }).click();
    } else {
      await page.getByRole('button', { name: /Aster Character/ }).click();
    }
    const win = page.getByRole('dialog', { name: mode === 'new' ? 'New Character' : 'Aster', exact: true });
    if (mode === 'edit') await win.getByRole('button', { name: 'Edit', exact: true }).click();
    const avatar = win.locator('.avatar-lg');
    for (const height of [586, 340, 740]) {
      await resize(page, win, 600, height);
      const entry = win.getByRole('region', { name: 'Character details' });
      await entry.focus();
      await page.keyboard.press('Home');
      // Intersection includes clipping by *every ancestor*: a portrait sliver above Style fails.
      await expect(avatar).toBeInViewport({ ratio: 0.99 });
      if (mode !== 'view') {
        await expect(win.locator('.hfield-select')).toBeInViewport({ ratio: 0.99 });
        await win.getByPlaceholder('Affiliation').focus();
        await expect(win.getByPlaceholder('Affiliation')).toBeInViewport({ ratio: 0.99 });
        await win.getByTestId('is-asset-toggle').focus();
        await page.keyboard.press('Tab');
        await expect(win.locator('.entity-detail-body textarea')).toBeFocused();
        await expect(win.locator('.entity-detail-body textarea')).toBeInViewport();
        await win.locator('.entity-detail-body textarea').scrollIntoViewIfNeeded();
        await expect(win.locator('.entity-detail-body textarea')).toBeInViewport({ ratio: 0.99 });
      }
      const last = mode === 'view' ? win.locator('summary') : win.getByRole('button', { name: 'Delete character' });
      // Scroll the entry itself via the keyboard (not the outer desktop).
      await entry.focus();
      await page.keyboard.press('End');
      await expect(last).toBeInViewport({ ratio: 0.99 });
      await last.focus();
      await expect(last).toBeInViewport({ ratio: 0.99 });
    }
  });
}
