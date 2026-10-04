import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ request }) => { await clearAll(request); });

async function seedMap(request: APIRequestContext) {
  const location = await (await request.post('/api/entities', { data: { type: 'Location', name: 'The coast' } })).json();
  const map = await (await request.post('/api/maps', { data: { name: 'Coastal map' } })).json();
  expect((await request.patch(`/api/maps/${map.id}`, {
    data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: location.id }
  })).ok()).toBe(true);
  return { location, map };
}

async function openMapMenu(page: Page) {
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/entities');
  await page.goto('/app'); await loaded;
  await page.getByRole('button', { name: 'World Map', exact: true }).click();
  const map = page.getByRole('dialog', { name: 'World Map', exact: true });
  await map.getByRole('button', { name: 'Maximize', exact: true }).click();
  const canvas = map.locator('.pixi-stage canvas');
  await expect(canvas).toBeVisible();
  await expect(map.locator('.map-loading-overlay')).toBeHidden();
  const box = (await canvas.boundingBox())!;
  // Fit centers the source image; its midpoint is also the Pixi canvas midpoint.
  await canvas.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByRole('menu')).toHaveCount(1);
  return map;
}

const polygon = [[80, 160], [80, 480], [400, 480], [400, 160]];

test('right-clicking a map marker sends its entity to a new board above an underlying region', async ({ page, request }) => {
  const { location, map } = await seedMap(request);
  const knight = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Mara' } })).json();
  const linked = await (await request.post('/api/entities', { data: { type: 'Location', name: 'The harbor' } })).json();
  expect((await request.post(`/api/maps/${map.id}/regions`, { data: { locationId: linked.id, polygon } })).ok()).toBe(true);
  expect((await request.post('/api/map-placements', {
    data: { placeableId: knight.id, locationId: location.id, mapId: map.id, x: 0.5, y: 0.5 }
  })).ok()).toBe(true);
  await openMapMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Send linked location to whiteboard…', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Send entity to whiteboard…', exact: true }).click();
  const destination = page.getByRole('dialog', { name: 'Send to whiteboard', exact: true });
  await expect(destination).toContainText(knight.name);
  await destination.getByRole('combobox', { name: 'Destination board' }).selectOption('new');
  await destination.getByRole('textbox', { name: 'New board name' }).fill('Harbor travelers');
  await destination.getByRole('button', { name: 'Add to board', exact: true }).click();
  const board = page.getByRole('dialog', { name: 'Whiteboard', exact: true });
  await expect(board.locator('.save-state')).toHaveText('Saved');
  const boardId = await board.getByRole('combobox', { name: 'Current board' }).inputValue();
  const saved = await (await request.get(`/api/whiteboards/${boardId}`)).json();
  expect(saved.document.elements.map((element: { target: unknown }) => element.target)).toEqual([{ kind: 'entity', id: knight.id }]);
  await board.getByRole('button', { name: knight.name, exact: true }).click();
  await expect(page.getByRole('dialog', { name: knight.name, exact: true }).locator('.entity-detail-host')).toHaveAttribute('data-entity-id', knight.id);
});

test('right-clicking a linked region sends its location to an existing board and opens its editor', async ({ page, request }) => {
  const { map } = await seedMap(request);
  const linked = await (await request.post('/api/entities', { data: { type: 'Location', name: 'The harbor' } })).json();
  expect((await request.post(`/api/maps/${map.id}/regions`, { data: { locationId: linked.id, polygon } })).ok()).toBe(true);
  const boardId = crypto.randomUUID();
  expect((await request.post('/api/whiteboards', { data: { id: boardId, name: 'Places to investigate' } })).ok()).toBe(true);
  await openMapMenu(page);
  await page.getByRole('menuitem', { name: 'Send linked location to whiteboard…', exact: true }).click();
  const destination = page.getByRole('dialog', { name: 'Send to whiteboard', exact: true });
  await expect(destination).toContainText(linked.name);
  await destination.getByRole('combobox', { name: 'Destination board' }).selectOption(boardId);
  await destination.getByRole('button', { name: 'Add to board', exact: true }).click();
  const board = page.getByRole('dialog', { name: 'Whiteboard', exact: true });
  await expect(board.locator('.save-state')).toHaveText('Saved');
  const saved = await (await request.get(`/api/whiteboards/${boardId}`)).json();
  expect(saved.document.elements.map((element: { target: unknown }) => element.target)).toEqual([{ kind: 'entity', id: linked.id }]);
  await board.getByRole('button', { name: linked.name, exact: true }).click();
  await expect(page.getByRole('dialog', { name: linked.name, exact: true }).locator('.entity-detail-host')).toHaveAttribute('data-entity-id', linked.id);
});

test('an unlinked region has no entity send action', async ({ page, request }) => {
  const { map } = await seedMap(request);
  expect((await request.post(`/api/maps/${map.id}/regions`, { data: { polygon } })).ok()).toBe(true);
  await openMapMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Edit region', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Send .*whiteboard/ })).toHaveCount(0);
});
