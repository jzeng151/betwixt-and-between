import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { BoardElement } from '../../src/lib/features/whiteboard/model.js';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });

function note(text: string, x: number, y: number): BoardElement {
  return { id: crypto.randomUUID(), type: 'sticky', text, x, y, width: 120, height: 90, color: '#c8942a' };
}

async function openBoard(page: Page, request: APIRequestContext, elements: BoardElement[]) {
  const id = crypto.randomUUID();
  expect((await request.post('/api/whiteboards', { data: { id, name: 'Connected clues' } })).ok()).toBe(true);
  expect((await request.put(`/api/whiteboards/${id}`, { data: {
    name: 'Connected clues', revision: 0, document: { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, elements }
  } })).ok()).toBe(true);
  await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  const mounted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/entities');
  await page.goto('/app'); await mounted;
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox').fill('Whiteboard'); await page.getByRole('combobox').press('Enter');
  const app = page.getByRole('dialog', { name: 'Whiteboard', exact: true });
  await app.getByRole('combobox', { name: 'Current board' }).selectOption(id);
  await expect(app.locator('[data-element-id]')).toHaveCount(elements.length);
  return { id, app, canvas: app.getByRole('application', { name: 'Whiteboard canvas' }) };
}

test('selects by shift-click or marquee and moves a group as one undoable change', async ({ page, request }) => {
  const first = note('The letter', 70, 70), second = note('The key', 270, 100), third = note('The witness', 610, 300);
  const { id, app, canvas } = await openBoard(page, request, [first, second, third]);
  const a = app.locator(`[data-element-id="${first.id}"]`), b = app.locator(`[data-element-id="${second.id}"]`);
  const selection = app.getByRole('complementary', { name: 'Selected elements', exact: true });
  await a.click(); await b.click({ modifiers: ['Shift'] });
  await expect(selection).toContainText('2 selected');
  await b.click({ modifiers: ['Shift'] }); await expect(selection).not.toBeVisible();
  await b.click({ modifiers: ['Shift'] }); await expect(selection).toContainText('2 selected');
  const bounds = (await a.boundingBox())!;
  await page.mouse.move(bounds.x + 50, bounds.y + 40); await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 70, { steps: 5 }); await page.mouse.up();
  await expect(a).toHaveAttribute('transform', 'translate(110,100)');
  await expect(b).toHaveAttribute('transform', 'translate(310,130)');
  await app.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(a).toHaveAttribute('transform', 'translate(70,70)');
  await expect(b).toHaveAttribute('transform', 'translate(270,100)');
  await canvas.press('ArrowRight');
  await expect(a).toHaveAttribute('transform', 'translate(80,70)');
  await expect(b).toHaveAttribute('transform', 'translate(280,100)');
  await app.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(a).toHaveAttribute('transform', 'translate(70,70)');
  await expect(b).toHaveAttribute('transform', 'translate(270,100)');
  await canvas.click({ position: { x: 20, y: 20 } });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 230, { steps: 5 }); await page.mouse.up();
  await expect(selection).toContainText('2 selected');
  await page.mouse.move(box.x + 450, box.y + 250); await page.mouse.down();
  await page.mouse.move(box.x + 580, box.y + 380, { steps: 3 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(selection).toContainText('2 selected');
  await expect(a).toHaveAttribute('transform', 'translate(70,70)');
  await expect(b).toHaveAttribute('transform', 'translate(270,100)');
  // A keyboard action during a drag must survive the subsequent pointer release.
  await canvas.press('Control+a');
  await page.mouse.move(bounds.x + 50, bounds.y + 40); await page.mouse.down();
  await page.mouse.move(bounds.x + 70, bounds.y + 55, { steps: 3 });
  await page.keyboard.press('Control+d'); await page.mouse.up();
  await expect(app.locator('[data-element-id]')).toHaveCount(6);
  await expect(a).toHaveAttribute('transform', 'translate(90,85)');
  await expect(app.locator('.save-state')).toHaveText('Saved');
  expect((await (await request.get(`/api/whiteboards/${id}`)).json()).document.elements).toHaveLength(6);
  await app.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(app.locator('[data-element-id]')).toHaveCount(3);
  await expect(a).toHaveAttribute('transform', 'translate(90,85)');
  await app.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(a).toHaveAttribute('transform', 'translate(70,70)');
});

test('aligns a selection, persists locks, and unlocks through the existing command palette', async ({ page, request }) => {
  const first = note('Clue one', 70, 70), second = note('Clue two', 270, 200), third = note('Clue three', 510, 330);
  const { id, app, canvas } = await openBoard(page, request, [first, second, third]);
  await canvas.press('Control+a');
  const selection = app.getByRole('complementary', { name: 'Selected elements', exact: true });
  await expect(selection).toContainText('3 selected');
  await selection.getByRole('combobox', { name: 'Align selection' }).selectOption('left');
  for (const item of [first, second, third]) await expect(app.locator(`[data-element-id="${item.id}"]`)).toHaveAttribute('transform', `translate(70,${item.y})`);
  await selection.getByRole('button', { name: 'Lock selection', exact: true }).click();
  await canvas.press('ArrowRight'); await canvas.press('Delete');
  await expect(app.locator('[data-element-id]')).toHaveCount(3);
  for (const item of [first, second, third]) await expect(app.locator(`[data-element-id="${item.id}"]`)).toHaveAttribute('transform', `translate(70,${item.y})`);
  await expect(app.locator('.save-state')).toHaveText('Saved');
  const locked = await (await request.get(`/api/whiteboards/${id}`)).json();
  expect(locked.document.elements.every((item: BoardElement) => item.locked)).toBe(true);
  await page.reload();
  const a = app.locator(`[data-element-id="${first.id}"]`);
  await a.press('Enter');
  await expect(app.getByRole('textbox', { name: 'Element text' })).toBeDisabled();
  await canvas.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill('Unlock selection'); await palette.getByRole('combobox').press('Enter');
  await expect(app.getByRole('textbox', { name: 'Element text' })).toBeEnabled();
  await canvas.press('ArrowRight'); await expect(a).toHaveAttribute('transform', 'translate(80,70)');
  await expect(app.locator('.save-state')).toHaveText('Saved');
  const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
  expect(saved.document.elements.find((item: BoardElement) => item.id === first.id).locked).toBeFalsy();
  expect(saved.document.elements.filter((item: BoardElement) => item.id !== first.id).every((item: BoardElement) => item.locked)).toBe(true);
});

test('keeps labeled connectors attached and remaps their endpoints when copying connected cards', async ({ page, request }) => {
  const first = note('Mara', 70, 70), second = note('The harbor', 370, 220);
  const { id, app, canvas } = await openBoard(page, request, [first, second]);
  const a = app.locator(`[data-element-id="${first.id}"]`), b = app.locator(`[data-element-id="${second.id}"]`);
  await app.getByRole('button', { name: 'Connector', exact: true }).click(); await a.click(); await b.click();
  await app.getByRole('textbox', { name: 'Element text' }).fill('Knows the route');
  await expect(app.getByRole('combobox', { name: 'Connector from' })).toHaveValue(first.id);
  await expect(app.getByRole('combobox', { name: 'Connector to' })).toHaveValue(second.id);
  await app.getByRole('combobox', { name: 'Arrow direction' }).selectOption('both');
  await app.getByRole('checkbox', { name: 'Dashed', exact: true }).check();
  const connector = app.getByRole('button', { name: 'connector: Knows the route', exact: true });
  await expect(connector).toBeVisible();
  const line = canvas.locator('path[data-connector-id]');
  const initial = await line.getAttribute('d');
  expect(initial).toBeTruthy();
  await a.press('Enter');
  await app.getByRole('spinbutton', { name: 'Element x', exact: true }).fill('110');
  await app.getByRole('spinbutton', { name: 'Element x', exact: true }).press('Tab');
  await expect(line).not.toHaveAttribute('d', initial!);
  const moved = await line.getAttribute('d');
  await app.getByRole('spinbutton', { name: 'Element width', exact: true }).fill('200');
  await app.getByRole('spinbutton', { name: 'Element width', exact: true }).press('Tab');
  await expect(line).not.toHaveAttribute('d', moved!);
  await app.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(line).toHaveAttribute('d', moved!);
  await app.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(line).toHaveAttribute('d', initial!);
  // Copying just the two cards also copies their connecting line as one change.
  await a.click(); await b.click({ modifiers: ['Shift'] }); await canvas.press('Control+d');
  await expect(app.locator('[data-element-id]')).toHaveCount(6);
  await expect(app.locator('.save-state')).toHaveText('Saved');
  const saved = await (await request.get(`/api/whiteboards/${id}`)).json();
  const elements: BoardElement[] = saved.document.elements;
  const originalLine = elements.find(item => item.type === 'connector' && item.fromId === first.id)!;
  const copyLine = elements.find(item => item.type === 'connector' && item.id !== originalLine.id)!;
  const copiedCards = elements.filter(item => item.type === 'sticky' && ![first.id, second.id].includes(item.id));
  expect(copiedCards.map(item => item.id).sort()).toEqual([copyLine.fromId, copyLine.toId].sort());
  expect(copyLine).toMatchObject({ text: 'Knows the route', arrow: 'both', dashed: true });
  expect(copiedCards.every(item => !item.locked)).toBe(true);
  await a.press('Enter'); await canvas.press('Delete');
  await expect(a).toHaveCount(0); await expect(app.locator(`[data-element-id="${originalLine.id}"]`)).toHaveCount(0);
  await expect(app.locator(`[data-element-id="${copyLine.id}"]`)).toBeVisible();
  await expect(app.locator('[data-element-id]')).toHaveCount(4);
  await app.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(app.locator('[data-element-id]')).toHaveCount(6);
  await expect(app.locator('.save-state')).toHaveText('Saved');
  await page.reload();
  await expect(app.getByRole('button', { name: 'connector: Knows the route', exact: true })).toHaveCount(2);
});
