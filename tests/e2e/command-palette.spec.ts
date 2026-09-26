import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
});

test('searches names and types, opens the selected entity, and restores focus on dismissal', async ({ page, request }) => {
  const name = `Palette Elara ${Date.now()}`;
  await request.post('/api/entities', { data: { type: 'Character', name } });
  await page.goto('/app');
  const launcher = page.getByRole('button', { name: 'Command palette', exact: true });
  await launcher.click();
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const search = palette.getByRole('combobox');
  await expect(search).toBeFocused();
  await search.fill(`${name} character`);
  await expect(palette.getByRole('option')).toHaveCount(1);
  await search.press('Enter');
  const entity = page.getByRole('dialog', { name, exact: true });
  await expect(entity).toBeVisible();
  await expect(entity).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(palette).not.toBeVisible();
  await expect(entity).toBeFocused();
  await launcher.click();
  await search.fill('no-such-entry-938472');
  await expect(palette.getByRole('status')).toContainText('No matches');
  await search.press('Enter');
  await expect(palette).toBeVisible();
  await search.press('Escape');
  await expect(launcher).toBeFocused();
});

test('launches apps with arrow keys, traps focus, and keeps window shortcuts inside the palette', async ({ page }) => {
  await page.goto('/app');
  await page.keyboard.press('Meta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const search = palette.getByRole('combobox');
  await expect(search).toBeFocused();
  await search.fill('story');
  await expect(palette.getByRole('option', { selected: true })).toContainText('Story Graph');
  await search.press('ArrowDown');
  await expect(palette.getByRole('option', { selected: true })).toContainText('Story Player');
  await search.press('Enter');
  const player = page.getByRole('dialog', { name: 'Story Player', exact: true });
  await expect(player).toBeVisible();
  await page.keyboard.press('Control+k');
  await search.press('Control+w');
  await expect(player).toBeAttached();
  await search.press('Tab');
  await expect(palette.getByRole('button', { name: 'Close command palette' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await search.press('Control+k');
  await expect(palette).not.toBeVisible();
});

test('opens notebook notes across folders and preserves an unsaved draft', async ({ page, request }) => {
  const suffix = Date.now();
  const folder = await (await request.post('/api/notes/folders', { data: { name: `Palette folder ${suffix}` } })).json();
  const first = await (await request.post('/api/notes/entries', { data: { name: `Palette note Aster ${suffix}`, body: 'Original A', parentId: folder.id } })).json();
  const second = await (await request.post('/api/notes/entries', { data: { name: `Palette note Birch ${suffix}`, body: 'Original B', parentId: folder.id } })).json();
  await page.goto('/app');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const search = palette.getByRole('combobox');
  async function openNote(name: string) {
    await page.keyboard.press('Control+k');
    await search.fill(name);
    await expect(palette.getByRole('option')).toHaveCount(1);
    await search.press('Enter');
  }
  await openNote(first.name);
  const notes = page.getByRole('dialog', { name: 'Notes', exact: true });
  const editor = notes.getByPlaceholder('Start writing...');
  await expect(editor).toHaveValue('Original A');
  await page.route(`**/api/notes/entries/${first.id}`, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue());
  await editor.fill('Keep this unfinished draft.');
  await openNote(second.name);
  await expect(editor).toHaveValue('Original B');
  await openNote(first.name);
  await expect(editor).toHaveValue('Keep this unfinished draft.');
});

test('shows load failures with retry while keeping app commands available', async ({ page }) => {
  let fail = true;
  await page.route('**/api/entities', route => fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue());
  await page.goto('/app');
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await expect(palette.getByRole('alert')).toContainText("Couldn't load your story.");
  await expect(palette.getByRole('option', { name: 'Settings App', exact: true })).toBeVisible();
  fail = false;
  await palette.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(palette.getByRole('alert')).toHaveCount(0);
});

test('searches only the current story', async ({ page, request }) => {
  const name = `Only original ${Date.now()}`;
  await request.post('/api/entities', { data: { type: 'Location', name } });
  const story = await (await request.post('/api/stories', { data: { name: `Palette isolated ${Date.now()}` } })).json();
  await page.goto(`/app?story=${story.id}`);
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill(name);
  await expect(palette.getByRole('option')).toHaveCount(0);
  await expect(palette.getByText('Loading story entries… Apps are available below.')).toHaveCount(0);
});

test('retries a failed notebook load and reuses it when reopening', async ({ page }) => {
  let loads = 0;
  await page.route('**/api/notes/entries', async route => {
    loads++;
    await route.fulfill(loads === 1
      ? { status: 503, body: 'Unavailable' }
      : { json: [] });
  });
  await page.goto('/app');
  const launcher = page.getByRole('button', { name: 'Command palette', exact: true });
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await launcher.click();
  await expect(palette.getByRole('alert')).toContainText("Couldn't refresh notebook notes.");
  await palette.getByRole('button', { name: 'Retry notes' }).click();
  await expect(palette.getByRole('alert')).toHaveCount(0);
  await expect(palette.getByText('Loading notebook notes…')).toHaveCount(0);
  await palette.getByRole('combobox').press('Escape');
  await launcher.click();
  await expect(palette.getByText('Loading notebook notes…')).toHaveCount(0);
  await expect(palette.getByRole('combobox')).toBeFocused();
  expect(loads).toBe(2);
});
