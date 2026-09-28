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
  await app.getByRole('button', { name: 'Add reference', exact: true }).click(); await app.getByRole('textbox', { name: 'Find a reference' }).fill(name);
  await app.locator('.references').getByRole('button', { name: `${name} Character`, exact: true }).click();
  await app.getByRole('button', { name, exact: true }).press('Enter');
  const editor = page.getByRole('dialog', { name, exact: true }); await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await app.getByRole('button', { name: 'Add reference', exact: true }).click(); await app.getByRole('textbox', { name: 'Find a reference' }).fill(mapName);
  await app.locator('.references').getByRole('button', { name: `${mapName} Map`, exact: true }).click();
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
