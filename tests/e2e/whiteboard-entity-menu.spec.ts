import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ request }) => { await clearAll(request); });

async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/entities');
  await page.goto('/app'); await loaded;
}
async function send(page: Page, request: APIRequestContext, entity: { id: string; name: string }, boardId?: string) {
  await page.getByRole('menuitem', { name: /Send (entity )?to whiteboard…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Send to whiteboard', exact: true });
  await expect(dialog.locator('.summary')).toHaveText(entity.name);
  await dialog.getByRole('combobox', { name: 'Destination board' }).selectOption(boardId ?? 'new');
  if (!boardId) await dialog.getByRole('textbox', { name: 'New board name' }).fill('Selected evidence');
  await dialog.getByRole('button', { name: 'Add to board', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const board = page.getByRole('dialog', { name: 'Whiteboard', exact: true });
  const id = await board.getByRole('combobox', { name: 'Current board' }).inputValue();
  await expect(board.locator('.save-state')).toHaveText('Saved');
  const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
  expect(saved.document.elements.at(-1).target).toEqual({ kind: 'entity', id: entity.id });
  await board.getByRole('button', { name: entity.name, exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: entity.name, exact: true })).toBeVisible();
  return id;
}

for (const source of ['Wiki', 'Story Graph', 'Focused Graph'] as const) test(`${source} entity menu sends the clicked entity, not the previously selected one`, async ({ page, request }) => {
  const a = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Mara' } })).json();
  const b = await (await request.post('/api/entities', { data: { type: 'Location', name: 'North harbor' } })).json();
  await request.post('/api/relationships', { data: { fromId: a.id, toId: b.id, type: 'located_at' } });
  await start(page);
  await page.getByRole('button', { name: source === 'Wiki' ? 'Wiki' : 'Story Graph', exact: true }).click();
  let win = page.getByRole('dialog', { name: source === 'Wiki' ? 'Wiki' : 'Story Graph', exact: true });
  if (source === 'Wiki') {
    await win.getByRole('button', { name: a.name, exact: true }).click();
    await win.getByRole('complementary').getByRole('button', { name: b.name, exact: true }).press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Open focused graph', exact: true })).toBeVisible();
  } else {
    const first = win.getByRole('button', { name: `Open ${a.name}`, exact: true });
    await first.click({ button: 'right' });
    if (source === 'Focused Graph') {
      await page.getByRole('menuitem', { name: 'Open Focused Graph', exact: true }).click();
      win = page.locator('.window').filter({ has: page.locator('.fg') });
    } else await page.keyboard.press('Escape');
    await win.getByRole('button', { name: `Open ${b.name}`, exact: true }).click({ button: 'right' });
  }
  await send(page, request, b);
});

test('Characters, entity detail, and the workspace overview expose the shared entity menu', async ({ page, request }) => {
  const a = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Mara' } })).json();
  await start(page);
  const entry = page.getByRole('main').getByRole('button', { name: `${a.name} Character`, exact: true });
  await entry.press('Shift+F10'); await page.keyboard.press('Escape'); await expect(entry).toBeFocused();
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  const row = page.locator('.char-row', { hasText: a.name });
  await row.click({ button: 'right' });
  await send(page, request, a);
  const detail = page.getByRole('dialog', { name: a.name, exact: true });
  await detail.locator('.entity-detail-header').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Send to whiteboard…', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  const name = detail.locator('.entity-detail-title input');
  await name.press('Shift+F10');
  await expect(page.getByRole('menu')).not.toBeVisible();
});

test('Timeline sends the exact act, scene, palette item and interval without changing story time', async ({ page, request }) => {
  const act = await (await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })).json();
  const scene = await (await request.post('/api/entities', { data: { type: 'Scene', name: 'Arrival', parentId: act.id, position: 0 } })).json();
  const character = await (await request.post('/api/entities', { data: { type: 'Character', name: 'Mara' } })).json();
  await request.post('/api/intervals', { data: { entity_id: character.id, start_act_id: act.id, end_act_id: act.id } });
  await start(page);
  let boardId: string | undefined;
  for (const [selector, entity, keyboard] of [
    ['.act-name', act, true], ['.scene-cell', scene, false],
    ['.palette-item', character, true], ['.bar-activate', character, false]
  ] as const) {
    await page.getByRole('button', { name: 'Command palette', exact: true }).click();
    const search = page.getByRole('combobox', { name: 'Search this story and apps' });
    await search.fill('Timeline'); await search.press('Enter');
    const timeline = page.getByRole('dialog', { name: 'Timeline', exact: true });
    const target = timeline.locator(selector).first();
    if (keyboard) await target.press('Shift+F10'); else await target.click({ button: 'right' });
    boardId = await send(page, request, entity, boardId);
  }
  const intervals = await (await request.get('/api/intervals')).json();
  expect(intervals).toHaveLength(1);
  expect(intervals[0]).toMatchObject({ entityId: character.id, startPosition: 0, endPosition: 1 });
});
