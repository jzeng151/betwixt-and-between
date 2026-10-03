import { test, expect, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ request }) => { await clearAll(request); });

async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/entities');
  await page.goto('/app'); await loaded;
}
async function app(page: Page, name: string) {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search this story and apps' }).fill(name); await page.getByRole('combobox', { name: 'Search this story and apps' }).press('Enter');
  return page.getByRole('dialog', { name, exact: true });
}
async function newDestination(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Send to whiteboard', exact: true });
  await dialog.getByRole('combobox', { name: 'Destination board' }).selectOption('new');
  await dialog.getByRole('textbox', { name: 'New board name' }).fill(name);
  await dialog.getByRole('button', { name: 'Add to board', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  return page.getByRole('dialog', { name: 'Whiteboard', exact: true });
}

test('sends entities and exact maps to a chosen board and preserves source records when cards are removed', async ({ page, request }) => {
  const entity = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Mara at the harbor' } })).json();
  const map = await (await request.post('/api/maps', { data: { name: 'Harbor map' } })).json();
  await start(page); const wiki = await app(page, 'Wiki');
  await wiki.getByRole('button', { name: entity.name, exact: true }).click();
  const trigger = wiki.getByRole('button', { name: 'Send to whiteboard…', exact: true });
  await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click();
  const board = await newDestination(page, 'Harbor evidence');
  const id = await board.getByRole('combobox', { name: 'Current board' }).inputValue();
  await expect(board.getByRole('button', { name: `reference: ${entity.name}`, exact: true })).toBeAttached();
  const mapApp = await app(page, 'World Map');
  await mapApp.getByRole('combobox', { name: 'Active map' }).selectOption(map.id);
  await mapApp.getByRole('button', { name: 'Send to whiteboard…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send to whiteboard', exact: true });
  await dialog.getByRole('combobox', { name: 'Destination board' }).selectOption(id);
  await dialog.getByRole('button', { name: 'Add to board', exact: true }).click();
  await expect(board.getByRole('button', { name: `reference: ${map.name}`, exact: true })).toBeAttached();
  await expect(board.locator('.save-state')).toHaveText('Saved');
  const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
  expect(saved.document.elements.map((e: { target: unknown }) => e.target)).toEqual([{ kind: 'entity', id: entity.id }, { kind: 'map', id: map.id }]);
  await board.getByRole('button', { name: `reference: ${map.name}`, exact: true }).press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Remove from board', exact: true }).click();
  expect((await request.get(`/api/maps/${map.id}`)).ok()).toBe(true);
  expect((await request.get(`/api/entities/${entity.id}`)).ok()).toBe(true);
});

test('imports the filtered graph as an editable frozen diagram with live source names and one undo', async ({ page, request }) => {
  const a = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Mara' } })).json();
  const b = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Oren' } })).json();
  const relationship = await (await request.post('/api/relationships', { data: { fromId: a.id, toId: b.id, type: 'allied_with', label: 'Trust at dusk' } })).json();
  await request.post('/api/relationships', { data: { fromId: a.id, toId: b.id, type: 'rivals', label: 'Hidden rivalry' } });
  await start(page); const graph = await app(page, 'Story Graph');
  await expect(graph.getByRole('button', { name: 'Open Mara', exact: true })).toBeVisible();
  await graph.getByRole('button', { name: 'Toggle rivals edges', exact: true }).click();
  const canvas = graph.getByRole('application', { name: 'Graph canvas' });
  await canvas.focus(); await canvas.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Send editable diagram to whiteboard…', exact: true }).click();
  const board = await newDestination(page, 'The alliance');
  const id = await board.getByRole('combobox', { name: 'Current board' }).inputValue();
  await expect(board.getByRole('button', { name: 'reference: Mara', exact: true })).toBeAttached();
  await expect(board.locator('.save-state')).toHaveText('Saved');
  const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
  const connectors = saved.document.elements.filter((e: { type: string }) => e.type === 'connector');
  expect(connectors).toHaveLength(1); expect(connectors[0].text).toBe('Trust at dusk');
  expect(saved.document.elements.some((e: { text?: string }) => e.text?.includes('Story time: all times'))).toBe(true);
  await board.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(board.locator('[data-element-id]')).toHaveCount(0);
  await board.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(board.locator('[data-element-id]')).toHaveCount(5);
  await expect(board.locator('.save-state')).toHaveText('Saved');
  await request.patch(`/api/entities/${a.id}`, { data: { name: 'Mara Voss' } });
  await request.delete(`/api/relationships/${relationship.id}`);
  await page.reload();
  await expect(board.getByRole('button', { name: 'reference: Mara Voss', exact: true })).toBeAttached();
  expect((await (await request.get('/api/relationships')).json()).length).toBe(1);
  expect((await (await request.get(`/api/whiteboards/${id}`)).json()).document.elements.filter((e: { type: string }) => e.type === 'connector')).toHaveLength(1);
});

test('captures a focused graph snapshot with labels hidden and retries an upload without recreating the board', async ({ page, request }) => {
  const a = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Mara' } })).json();
  const b = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Oren' } })).json();
  await request.post('/api/entities', { data: { type: 'Character', name: 'Outside this view' } });
  await request.post('/api/relationships', { data: { fromId: a.id, toId: b.id, type: 'rivals', label: 'A disputed debt' } });
  await start(page); const graph = await app(page, 'Story Graph');
  await graph.getByRole('button', { name: 'Open Mara', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open Focused Graph', exact: true }).click();
  const focused = page.locator('.window').filter({ has: page.locator('.fg') });
  await expect(focused.locator('.node')).toHaveCount(2);
  await focused.getByRole('button', { name: 'Hide edge labels', exact: true }).click();
  await focused.getByRole('button', { name: 'Send graph to whiteboard', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Send graph snapshot to whiteboard…', exact: true }).click();
  let fail = true;
  await page.route('**/api/whiteboards/*/upload-image', route => fail ? route.fulfill({ status: 503, json: { message: 'Upload interrupted. Try again.' } }) : route.continue());
  const dialog = page.getByRole('dialog', { name: 'Send to whiteboard', exact: true });
  await dialog.getByRole('combobox', { name: 'Destination board' }).selectOption('new');
  await dialog.getByRole('textbox', { name: 'New board name' }).fill('Frozen rivalry');
  await dialog.getByRole('button', { name: 'Add to board', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Upload interrupted');
  fail = false; await dialog.getByRole('button', { name: 'Add to board', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const board = page.getByRole('dialog', { name: 'Whiteboard', exact: true });
  await expect(board.locator('svg image')).toBeAttached(); await expect(board.locator('.save-state')).toHaveText('Saved');
  const id = await board.getByRole('combobox', { name: 'Current board' }).inputValue();
  const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
  expect(saved.document.elements.map((e: { type: string }) => e.type)).toEqual(['frame', 'image', 'text']);
  expect(saved.document.elements[2].text).toContain('labels off');
  expect(saved.document.elements[2].text).toContain('Mara');
  expect(saved.document.elements[2].text).not.toContain('Outside this view');
  const bytes = await (await request.get(saved.document.elements[1].url)).body();
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(100); expect(bytes.length).toBeGreaterThan(500);
  expect((await (await request.get('/api/whiteboards')).json()).filter((b: { name: string }) => b.name === 'Frozen rivalry')).toHaveLength(1);
  await board.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(board.locator('[data-element-id]')).toHaveCount(0);
});
