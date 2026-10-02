import { test, expect, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });
async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  const mounted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/entities');
  await page.goto('/app'); await mounted;
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox').fill('Whiteboard'); await page.getByRole('combobox').press('Enter');
  return page.getByRole('dialog', { name: 'Whiteboard', exact: true });
}
test('creates multiple boards, groups and moves ideas, undoes changes, and reopens saved work', async ({ page }) => {
  const app = await open(page);
  if (!(await app.getByRole('textbox', { name: 'New board name' }).isVisible())) await app.getByRole('button', { name: 'New board', exact: true }).click();
  await app.getByRole('textbox', { name: 'New board name' }).fill('Mystery clues');
  await app.getByRole('button', { name: 'Create board', exact: true }).click();
  const canvas = app.getByRole('application', { name: 'Whiteboard canvas' });
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  async function draw(tool: string, x: number, y: number, dx: number, dy: number) {
    await app.getByRole('button', { name: tool, exact: true }).click();
    await page.mouse.move(box.x + x, box.y + y); await page.mouse.down(); await page.mouse.move(box.x + x + dx, box.y + y + dy, { steps: 6 }); await page.mouse.up();
  }
  await draw('Frame', 40, 40, 440, 330);
  await app.getByRole('button', { name: 'Sticky note', exact: true }).click(); await canvas.click({ position: { x: 80, y: 100 } });
  await app.getByRole('textbox', { name: 'Element text' }).fill('The key is missing');
  await app.getByRole('button', { name: 'frame: Section', exact: true }).press('Enter');
  await app.getByRole('spinbutton', { name: 'Element x', exact: true }).fill('80'); await app.getByRole('spinbutton', { name: 'Element x', exact: true }).press('Tab');
  const note = app.getByRole('button', { name: 'sticky: The key is missing', exact: true });
  await expect(note).toHaveAttribute('transform', 'translate(120,100)');
  await app.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(note).toHaveAttribute('transform', 'translate(80,100)');
  await draw('Pen', 550, 260, -80, -70);
  await expect(app.locator('polyline')).toHaveCount(1);
  await expect(app.locator('.save-state')).toHaveText('Saved');
  await app.getByRole('button', { name: 'New board', exact: true }).click();
  await app.getByRole('textbox', { name: 'New board name' }).fill('Second board'); await app.getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(app.locator('[data-element-id]')).toHaveCount(0);
  await app.getByRole('combobox', { name: 'Current board' }).selectOption({ label: 'Mystery clues' });
  await expect(note).toBeAttached();
  await page.reload(); await expect(page.getByRole('dialog', { name: 'Whiteboard', exact: true })).toBeVisible();
  await expect(note).toBeAttached(); await expect(app.locator('polyline')).toHaveCount(1);
});
test('opens live entity and exact map references and keeps failed-save drafts recoverable', async ({ page, request }) => {
  const name = `Board reference ${Date.now()}`;
  const entity = await (await request.post('/api/entities', { data: { type: 'Character', name } })).json();
  const mapName = `Board map ${Date.now()}`;
  const map = await (await request.post('/api/maps', { data: { name: mapName } })).json();
  const id = crypto.randomUUID();
  await request.post('/api/whiteboards', { data: { id, name: 'Reference board' } });
  let failMaps = true;
  await page.route('**/api/maps', route => failMaps ? route.fulfill({ status: 503, json: { message: 'Maps unavailable' } }) : route.continue());
  const app = await open(page);
  await expect(app.getByRole('alert')).toBeVisible(); failMaps = false;
  await app.getByRole('button', { name: 'Retry loading' }).click();
  await app.getByRole('combobox', { name: 'Current board' }).selectOption(id);
  await app.getByRole('button', { name: 'Add from story', exact: true }).click(); await app.getByRole('textbox', { name: 'Find story items' }).fill(name);
  await app.getByRole('checkbox', { name: `${name} Character`, exact: true }).check();
  await app.getByRole('button', { name: 'Add 1 item', exact: true }).click();
  await app.getByRole('button', { name, exact: true }).press('Enter');
  const editor = page.getByRole('dialog', { name, exact: true }); await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await app.getByRole('button', { name: 'Add from story', exact: true }).click(); await app.getByRole('textbox', { name: 'Find story items' }).fill(mapName);
  await app.getByRole('checkbox', { name: `${mapName} Map`, exact: true }).check();
  await app.getByRole('button', { name: 'Add 1 item', exact: true }).click();
  await app.getByRole('button', { name: mapName, exact: true }).press('Space');
  const worldMap = page.getByRole('dialog', { name: 'World Map', exact: true }); await expect(worldMap).toBeVisible();
  await expect(worldMap.getByRole('combobox', { name: 'Active map' })).toHaveValue(map.id);
  await worldMap.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(app.locator('.save-state')).toHaveText('Saved');
  await request.patch(`/api/entities/${entity.id}`, { data: { name: `${name} renamed` } });
  await page.reload(); await expect(app.getByRole('button', { name: `${name} renamed`, exact: true })).toBeVisible();
  await page.route(`**/api/whiteboards/${id}`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 409, json: { message: 'Changed in another tab' } }) : route.continue());
  await app.getByRole('textbox', { name: 'Board name', exact: true }).fill('Unsaved title'); await app.getByRole('textbox', { name: 'Board name', exact: true }).press('Tab');
  await expect(app.getByRole('alert')).toContainText('Changed in another tab');
  const download = page.waitForEvent('download'); await app.getByRole('button', { name: 'Download draft' }).click(); expect((await download).suggestedFilename()).toBe('Unsaved_title.json');
  await page.unroute(`**/api/whiteboards/${id}`); await app.getByRole('button', { name: 'Retry save' }).click(); await expect(app.locator('.save-state')).toHaveText('Saved');
});

test('uploads images, cancels deletion when switching boards, and hides boards in another story', async ({ page, request }) => {
  const id = crypto.randomUUID(), second = crypto.randomUUID();
  await request.post('/api/whiteboards', { data: { id, name: 'Image board' } });
  await request.post('/api/whiteboards', { data: { id: second, name: 'Keep this board' } });
  const app = await open(page); await app.getByRole('combobox', { name: 'Current board' }).selectOption(id);
  let releaseUpload!: () => void, uploadStarted!: () => void;
  const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
  const started = new Promise<void>(resolve => { uploadStarted = resolve; });
  await page.route(`**/api/whiteboards/${id}/upload-image`, async route => { uploadStarted(); await uploadGate; await route.continue(); });
  await app.locator('input[type=file]').setInputFiles({ name: 'clue.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64') });
  await started; await app.getByRole('button', { name: 'Close', exact: true }).click();
  releaseUpload();
  await expect.poll(async () => (await (await request.get(`/api/whiteboards/${id}`)).json()).document.elements.length).toBe(1);
  await page.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect(app.locator('svg image')).toHaveAttribute('href', /\/api\/maps\/file\//);
  await expect(app.locator('.save-state')).toHaveText('Saved');
  const saved = await (await request.get(`/api/whiteboards/${id}`)).json(); expect(saved.document.elements[0].type).toBe('image');
  expect((await request.get(saved.document.elements[0].url)).ok()).toBe(true);
  await app.getByRole('button', { name: 'Delete board', exact: true }).click(); await expect(app.getByRole('button', { name: 'Confirm delete' })).toBeVisible();
  await app.getByRole('combobox', { name: 'Current board' }).selectOption(second); await expect(app.getByRole('button', { name: 'Confirm delete' })).not.toBeVisible();
  const story = await (await request.post('/api/stories', { data: { name: 'Isolated boards' } })).json();
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/entities'); await page.goto(`/app?story=${story.id}`); await loaded;
  await page.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect(app.getByRole('textbox', { name: 'New board name' })).toBeVisible();
  await expect(app.getByRole('option', { name: 'Image board', exact: true })).toHaveCount(0);
});

test('duplicating a framed note outside its frame leaves the copy independent', async ({ page, request }) => {
  const id = crypto.randomUUID(), frame = crypto.randomUUID(), note = crypto.randomUUID();
  await request.post('/api/whiteboards', { data: { id, name: 'Frame duplication' } });
  await request.put(`/api/whiteboards/${id}`, { data: { name: 'Frame duplication', revision: 0, document: { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, elements: [
    { id: frame, type: 'frame', text: 'Clues', x: 0, y: 0, width: 400, height: 300, color: '#c8942a' },
    { id: note, type: 'sticky', text: 'At the edge', x: 180, y: 70, width: 200, height: 150, color: '#c8942a', frameId: frame }
  ] } } });
  const app = await open(page); await app.getByRole('combobox', { name: 'Current board' }).selectOption(id);
  await app.getByRole('button', { name: 'sticky: At the edge', exact: true }).press('Enter');
  await app.getByRole('button', { name: 'Duplicate element' }).click();
  await app.getByRole('button', { name: 'frame: Clues', exact: true }).press('Enter');
  await app.getByRole('application').press('ArrowRight');
  const notes = app.getByRole('button', { name: 'sticky: At the edge', exact: true });
  await expect(notes.first()).toHaveAttribute('transform', 'translate(190,70)');
  await expect(notes.last()).toHaveAttribute('transform', 'translate(204,94)');
  await expect(app.locator('.save-state')).toHaveText('Saved');
});

test('context menus add at the pointer and share selection actions with keyboard users', async ({ page, request }) => {
  const id = crypto.randomUUID();
  await request.post('/api/whiteboards', { data: { id, name: 'Menu board' } });
  const app = await open(page); await app.getByRole('combobox', { name: 'Current board' }).selectOption(id);
  const canvas = app.getByRole('application', { name: 'Whiteboard canvas' });
  await canvas.click({ button: 'right', position: { x: 40, y: 50 } });
  const menu = page.getByRole('menu');
  await menu.getByRole('menuitem', { name: 'Add sticky note', exact: true }).click();
  let note = app.getByRole('button', { name: 'sticky: New idea', exact: true });
  await expect(note).toHaveAttribute('transform', 'translate(40,50)');
  await note.press('Shift+F10');
  await page.keyboard.press('Escape'); await expect(note).toBeFocused();
  await note.press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Edit text', exact: true }).click();
  const text = app.getByRole('textbox', { name: 'Element text' }); await expect(text).toBeFocused();
  await text.fill('A letter with no sender');
  note = app.getByRole('button', { name: 'sticky: A letter with no sender', exact: true });
  await note.press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Duplicate element', exact: true }).click();
  await expect(app.getByRole('button', { name: 'sticky: A letter with no sender', exact: true })).toHaveCount(2);
  await app.getByRole('button', { name: 'Canvas actions', exact: true }).click();
  await menu.getByRole('menuitem', { name: 'Send to back', exact: true }).click();
  await expect(app.locator('[data-element-id]').first()).toHaveAttribute('transform', 'translate(64,74)');
  await app.getByRole('button', { name: 'Canvas actions', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible();
  await expect(app.getByRole('button', { name: 'Canvas actions', exact: true })).toBeFocused();
  await expect(app.locator('.save-state')).toHaveText('Saved');
  await page.reload(); await expect(app.locator('[data-element-id]').first()).toHaveAttribute('transform', 'translate(64,74)');
});

test('bulk-adds story items across filters as one undoable change and preserves source entities', async ({ page, request }) => {
  const id = crypto.randomUUID(), suffix = Date.now();
  await request.post('/api/whiteboards', { data: { id, name: 'Story collection' } });
  const character = await (await request.post('/api/entities', { data: { type: 'Character', name: `Mara ${suffix}` } })).json();
  const location = await (await request.post('/api/entities', { data: { type: 'Location', name: `Old quay ${suffix}` } })).json();
  const map = await (await request.post('/api/maps', { data: { name: `Harbor ${suffix}` } })).json();
  const app = await open(page); await app.getByRole('combobox', { name: 'Current board' }).selectOption(id);
  await app.getByRole('button', { name: 'Add from story', exact: true }).click();
  const search = app.getByRole('textbox', { name: 'Find story items' }); await expect(search).toBeFocused();
  await search.fill(character.name); await app.getByRole('checkbox', { name: `${character.name} Character`, exact: true }).check();
  await app.getByRole('combobox', { name: 'Story item type' }).selectOption('Location'); await search.fill(location.name);
  await app.getByRole('checkbox', { name: `${location.name} Location`, exact: true }).check();
  await app.getByRole('combobox', { name: 'Story item type' }).selectOption('map'); await search.fill(map.name);
  await app.getByRole('checkbox', { name: `${map.name} Map`, exact: true }).check();
  // Opening the palette from the picker preserves its selection and returns focus to search.
  await search.press('Control+k'); const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill('Add from story'); await palette.getByRole('combobox').press('Enter');
  await expect(search).toBeFocused();
  await app.getByRole('button', { name: 'Add 3 items', exact: true }).click();
  await expect(app.locator('[data-element-id]')).toHaveCount(3);
  await expect(app.getByRole('application')).toBeFocused();
  const bounds = (await app.getByRole('application').boundingBox())!;
  for (const card of await app.locator('[data-element-id]').all()) {
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x); expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
  await app.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(app.locator('[data-element-id]')).toHaveCount(0);
  await app.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(app.locator('[data-element-id]')).toHaveCount(3);
  await app.getByRole('button', { name: `reference: ${character.name}`, exact: true }).press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Remove from board', exact: true }).click();
  await expect(app.locator('[data-element-id]')).toHaveCount(2);
  expect((await request.get(`/api/entities/${character.id}`)).ok()).toBe(true);
  await expect(app.locator('.save-state')).toHaveText('Saved');
});

test('palette executes enabled board actions and drops context when the window is minimized or closed', async ({ page, request }) => {
  const id = crypto.randomUUID(); await request.post('/api/whiteboards', { data: { id, name: 'Keyboard ideas' } });
  const app = await open(page); await app.getByRole('combobox', { name: 'Current board' }).selectOption(id);
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true }), search = palette.getByRole('combobox');
  await page.keyboard.press('Control+k'); await search.fill('Duplicate element');
  await expect(palette.getByRole('option')).toHaveCount(0);
  await search.fill('Add sticky note'); await search.press('Enter');
  await expect(app.getByRole('button', { name: 'sticky: New idea', exact: true })).toBeVisible();
  await expect(app.getByRole('application')).toBeFocused();
  await page.keyboard.press('Control+k'); await search.fill('Undo whiteboard change'); await search.press('Enter');
  await expect(app.locator('[data-element-id]')).toHaveCount(0);
  await app.getByRole('button', { name: 'Minimize', exact: true }).click();
  await page.keyboard.press('Control+k'); await search.fill('Add sticky note'); await expect(palette.getByRole('option')).toHaveCount(0);
  await search.press('Escape'); await page.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await page.keyboard.press('Control+k'); await search.fill('Add sticky note'); await expect(palette.getByRole('option')).toHaveCount(1);
  await search.press('Escape'); await app.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Control+k'); await search.fill('Add sticky note'); await expect(palette.getByRole('option')).toHaveCount(0);
});
