import { test, expect, type Locator, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ request }) => { await clearAll(request); });

async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/entities');
  await page.goto('/app');
  await loaded;
}

async function app(page: Page, name: string) {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Search this story and apps' });
  await search.fill(name);
  await search.press('Enter');
  return page.getByRole('dialog', { name, exact: true });
}

async function send(page: Page, name: string, destination = 'new') {
  const dialog = page.getByRole('dialog', { name: 'Send to whiteboard', exact: true });
  await dialog.getByRole('combobox', { name: 'Destination board' }).selectOption(destination);
  if (destination === 'new') await dialog.getByRole('textbox', { name: 'New board name' }).fill(name);
  await dialog.getByRole('button', { name: 'Add to board', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const board = page.getByRole('dialog', { name: 'Whiteboard', exact: true });
  await expect(board.locator('.save-state')).toHaveText('Saved');
  return { board, id: await board.getByRole('combobox', { name: 'Current board' }).inputValue() };
}

async function expectNativeEditingMenu(target: Locator) {
  expect(await target.evaluate(element => {
    const events = [
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })
    ];
    return events.map(event => { element.dispatchEvent(event); return event.defaultPrevented; });
  })).toEqual([false, false, false]);
}

test('note row menus send the clicked IDs to new and existing boards and open the source editor', async ({ page, request }) => {
  const folder = await (await request.post('/api/notes/folders', { data: { name: 'Evidence notes' } })).json();
  const first = await (await request.post('/api/notes/entries', { data: { name: 'First note', body: 'First body', parentId: folder.id } })).json();
  const clicked = await (await request.post('/api/notes/entries', { data: { name: 'Harbor plans', body: 'A second note', parentId: folder.id } })).json();
  await start(page);
  const notes = await app(page, 'Notes');
  await notes.getByText(folder.name, { exact: true }).click();
  await notes.locator(`.content-entry-item[data-entity-id="${clicked.id}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Send to whiteboard…', exact: true }).click();
  const { board, id } = await send(page, 'Note evidence');
  await expect(board.getByRole('button', { name: `reference: ${clicked.name}`, exact: true })).toBeAttached();

  await app(page, 'Notes');
  await notes.locator(`.content-entry-item[data-entity-id="${first.id}"]`).press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Send to whiteboard…', exact: true }).click();
  await send(page, '', id);
  const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
  expect(saved.document.elements.map((element: { target: unknown }) => element.target)).toEqual([
    { kind: 'entity', id: clicked.id }, { kind: 'entity', id: first.id }
  ]);
  await board.getByRole('button', { name: 'Fit board', exact: true }).click();
  await board.getByRole('button', { name: clicked.name, exact: true }).click();
  const editor = page.locator(`.window .entity-detail-host[data-entity-id="${clicked.id}"]`);
  await expect(editor).toBeVisible();
  await expect(editor.locator('.entity-detail-title-text')).toHaveText(clicked.name);
});

for (const trigger of ['button', 'context menu']) {
  test(`a new note sent by ${trigger} keeps a failed draft, then sends its saved title and body without reloading`, async ({ page, request }) => {
    const folder = await (await request.post('/api/notes/folders', { data: { name: 'New notes' } })).json();
    await start(page);
    const notes = await app(page, 'Notes');
    await notes.getByText(folder.name, { exact: true }).click();
    await notes.getByTitle('New note').click();
    await expect(notes.getByPlaceholder('Entry title')).toHaveValue('Untitled');
    let fail = true;
    await page.route('**/api/notes/entries/*', route => route.request().method() === 'PATCH' && fail
      ? route.fulfill({ status: 503, json: { message: 'Try again' } }) : route.continue());
    await notes.getByPlaceholder('Entry title').fill('The new clue');
    await notes.getByPlaceholder('Start writing...').fill('Keep this draft.');
    async function openSend() {
      if (trigger === 'button') await notes.getByRole('button', { name: 'Send to whiteboard…', exact: true }).click();
      else {
        await notes.locator('.save-status').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Send to whiteboard…', exact: true }).click();
      }
    }
    await openSend();
    await expect(notes.getByRole('button', { name: 'Retry saving' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Send to whiteboard', exact: true })).not.toBeVisible();
    await expect(notes.getByPlaceholder('Start writing...')).toHaveValue('Keep this draft.');
    fail = false;
    await openSend();
    await expect(page.getByRole('dialog', { name: 'Send to whiteboard', exact: true }).locator('.summary')).toHaveText('The new clue');
    const { board, id } = await send(page, 'Fresh notes');
    await expect(board.getByRole('button', { name: 'reference: The new clue', exact: true })).toBeAttached();
    const [entry] = await (await request.get(`/api/notes/entries?folderId=${folder.id}`)).json();
    expect(entry.name).toBe('The new clue');
    expect(entry.data.body).toBe('Keep this draft.');
    const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
    expect(saved.document.elements[0].target).toEqual({ kind: 'entity', id: entry.id });
    await board.getByRole('button', { name: 'The new clue', exact: true }).click();
    await expect(page.locator(`.entity-detail-host[data-entity-id="${entry.id}"]`)).toBeVisible();
  });
}

for (const gesture of ['right-click', 'Shift+F10', 'ContextMenu']) {
  test(`EntityLink ${gesture} sends the linked duplicate, not the containing entity`, async ({ page, request }) => {
    const target = await (await request.post('/api/entities', { data: { type: 'Character', name: 'The captain' } })).json();
    await request.post('/api/entities', { data: { type: 'Character', name: target.name } });
    const source = await (await request.post('/api/entities', { data: {
      type: 'Character', name: 'The witness', data: { body: `Met [[#${target.id}|the linked captain]].` }
    } })).json();
    await start(page);
    const wiki = await app(page, 'Wiki');
    await wiki.locator('.entry').filter({ hasText: source.name }).click();
    const link = wiki.getByRole('button', { name: 'the linked captain', exact: true });
    if (gesture === 'right-click') await link.click({ button: 'right' });
    else await link.press(gesture);
    await page.getByRole('menuitem', { name: 'Send to whiteboard…', exact: true }).click();
    const { board, id } = await send(page, `Linked captain ${gesture}`);
    const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
    expect(saved.document.elements.map((element: { target: unknown }) => element.target)).toEqual([{ kind: 'entity', id: target.id }]);
    await board.getByRole('button', { name: target.name, exact: true }).click();
    await expect(page.locator(`.window .entity-detail-host[data-entity-id="${target.id}"]`)).toBeVisible();
  });
}

test('note title, body, and folder rename retain native editing menus', async ({ page, request }) => {
  const folder = await (await request.post('/api/notes/folders', { data: { name: 'Editable folder' } })).json();
  const entry = await (await request.post('/api/notes/entries', { data: { name: 'Editable note', body: 'Text', parentId: folder.id } })).json();
  await start(page);
  const notes = await app(page, 'Notes');
  await notes.getByText(folder.name, { exact: true }).click();
  await notes.getByText(entry.name, { exact: true }).click();
  await expectNativeEditingMenu(notes.getByPlaceholder('Entry title'));
  await expectNativeEditingMenu(notes.getByPlaceholder('Start writing...'));
  await expect(page.getByRole('menu')).not.toBeVisible();
  await notes.getByText(folder.name, { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await expectNativeEditingMenu(notes.locator('.rename-input'));
  await expect(page.getByRole('menu')).not.toBeVisible();
});
