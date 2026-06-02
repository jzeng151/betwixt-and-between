/**
 * Brush + undo/redo QA regression specs. Each test guards a bug found during
 * world-map QA:
 *  - size selector reachable (was occluded by the sidebar) + a wide drag
 *    paints many distinct cells (was panning the viewport instead).
 *  - undo/redo wired to button + Ctrl+Z, optimistic.
 *  - spamming undo past history clears everything with no race / no leftover.
 *  - two quick separate clicks paint two cells, not a line between them
 *    (gesture must reset synchronously on pointerup).
 *  - undo fired while a paint POST is still in flight undoes the NEW stroke,
 *    not the previous one (create + undo share one serialization chain).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

type MapEvent = {
	id: string;
	kind: string;
	commandId: string | null;
	payloadJsonb: { cells?: Array<{ x: number; y: number }>; command_complete?: boolean };
};

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}

async function distinctPaintedCells(request: APIRequestContext, mapId: string): Promise<number> {
	const { rows }: { rows: MapEvent[] } = await (
		await request.get(`/api/maps/${mapId}/events`)
	).json();
	const seen = new Set<string>();
	for (const e of rows) {
		if (e.kind !== 'paint_cells') continue;
		for (const c of e.payloadJsonb.cells ?? []) seen.add(`${c.x},${c.y}`);
	}
	return seen.size;
}

async function livePaintEvents(request: APIRequestContext, mapId: string): Promise<MapEvent[]> {
	const { rows }: { rows: MapEvent[] } = await (
		await request.get(`/api/maps/${mapId}/events`)
	).json();
	return rows.filter((e) => e.kind === 'paint_cells');
}

async function paintedCellKeys(request: APIRequestContext, mapId: string): Promise<string[]> {
	const seen = new Set<string>();
	for (const e of await livePaintEvents(request, mapId)) {
		for (const c of e.payloadJsonb.cells ?? []) seen.add(`${c.x},${c.y}`);
	}
	return [...seen].sort();
}

test('size selector is clickable and a wide drag paints many distinct cells', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Paint Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Brush QA' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	const palette = win.locator('[data-testid="brush-palette"]');
	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Brush' }).click();
	await expect(palette).toBeVisible();

	// Bug 4: the size selector must be reachable. If the sidebar overlays it,
	// this click times out with "element intercepts pointer events".
	const size5 = palette.locator('.size-button', { hasText: '5' });
	await expect(size5).toBeVisible();
	await size5.click({ timeout: 4000 });
	await expect(size5).toHaveAttribute('aria-pressed', 'true');
	// Reset to size 1 for a clean single-cell-wide drag count.
	const size1 = palette.locator('.size-button', { hasText: '1' });
	await size1.click({ timeout: 4000 });
	await expect(size1).toHaveAttribute('aria-pressed', 'true');

	// Bug 5: a wide horizontal drag at constant Y. With drag paused it paints a
	// line of distinct cells; if the viewport panned instead it would pin to
	// ~1 cell.
	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');
	const y = box.y + box.height * 0.5;
	const startX = box.x + box.width * 0.15;
	const endX = box.x + box.width * 0.85;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(endX, y, { steps: 25 });
	await page.mouse.up();

	await expect
		.poll(async () => distinctPaintedCells(request, map.id), { timeout: 8000 })
		.toBeGreaterThan(4);
});

test('undo reverts a single-click paint (button) and a stroke (keyboard)', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Undo Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Undo QA' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	const palette = win.locator('[data-testid="brush-palette"]');
	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Brush' }).click();
	await expect(palette).toBeVisible();

	const box = await canvas.boundingBox();
	if (!box) throw new Error('no box');
	const cx = box.x + box.width * 0.5;
	const cy = box.y + box.height * 0.5;

	// Single click = one cell, one command (command_complete=true).
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	await page.mouse.up();
	await expect
		.poll(async () => distinctPaintedCells(request, map.id), { timeout: 8000 })
		.toBeGreaterThan(0);

	// Undo via the palette button reverts the single paint.
	await win.locator('[data-testid="map-tool-selector"] .history-button', { hasText: 'Undo' }).click();
	await expect
		.poll(async () => distinctPaintedCells(request, map.id), { timeout: 8000 })
		.toBe(0);

	// Paint a multi-cell stroke, then undo via keyboard (Ctrl+Z).
	await page.mouse.move(box.x + box.width * 0.2, cy);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.8, cy, { steps: 20 });
	await page.mouse.up();
	await expect
		.poll(async () => distinctPaintedCells(request, map.id), { timeout: 8000 })
		.toBeGreaterThan(4);

	// The World Map window is already focused from the interactions above, so
	// the window-scoped Ctrl+Z handler fires. (Don't click the canvas to focus
	// — the brush is active and a click would paint a new cell.)
	await page.keyboard.press('Control+z');
	await expect
		.poll(async () => distinctPaintedCells(request, map.id), { timeout: 8000 })
		.toBe(0);

	// Redo via the palette button re-applies the stroke (optimistic redo).
	await win.locator('[data-testid="map-tool-selector"] .history-button', { hasText: 'Redo' }).click();
	await expect
		.poll(async () => distinctPaintedCells(request, map.id), { timeout: 8000 })
		.toBeGreaterThan(0);
});

test('spamming undo past history clears every stroke (no leftover, no race)', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Spam Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Spam QA' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });
	const palette = win.locator('[data-testid="brush-palette"]');
	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Brush' }).click();
	await expect(palette).toBeVisible();

	const box = await canvas.boundingBox();
	if (!box) throw new Error('no box');
	const cy = box.y + box.height * 0.5;
	// Three separate single-click strokes at distinct cells.
	for (const fx of [0.3, 0.5, 0.7]) {
		await page.mouse.move(box.x + box.width * fx, cy);
		await page.mouse.down();
		await page.mouse.up();
	}
	// Wait until all three are committed server-side before undoing.
	await expect
		.poll(async () => (await livePaintEvents(request, map.id)).length, { timeout: 8000 })
		.toBe(3);

	// Spam undo well past the 3 strokes. Serialized undo + the empty-store
	// guard mean the extra presses no-op (no 422 storm) and nothing bounces
	// back.
	for (let i = 0; i < 7; i++) await page.keyboard.press('Control+z');

	await expect
		.poll(async () => distinctPaintedCells(request, map.id), { timeout: 8000 })
		.toBe(0);
	// And it stays at 0 (no late out-of-order response re-adds a stroke).
	await page.waitForTimeout(500);
	expect(await distinctPaintedCells(request, map.id)).toBe(0);
});

test('two quick separate clicks paint two cells, not a line between them', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Line Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Line QA' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	// Delay the paint POST so the first click's commit is still in flight while
	// the cursor moves to the second click — the exact window where the old
	// code recorded a line and the second pointerup committed it.
	await page.route('**/api/maps/*/events', async (route) => {
		if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 600));
		await route.continue();
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });
	const palette = win.locator('[data-testid="brush-palette"]');
	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Brush' }).click();
	await expect(palette).toBeVisible();

	const box = await canvas.boundingBox();
	if (!box) throw new Error('no box');
	const cy = box.y + box.height * 0.5;
	const ax = box.x + box.width * 0.3;
	const bx = box.x + box.width * 0.7;
	// Click A, move to B with the button UP, click B — all inside the 600ms
	// POST delay so the first commit is still pending during the move.
	await page.mouse.move(ax, cy);
	await page.mouse.down();
	await page.mouse.up();
	await page.mouse.move(bx, cy, { steps: 15 });
	await page.mouse.down();
	await page.mouse.up();

	// After both delayed POSTs land: exactly the two clicked cells, NOT the
	// ~12-cell line that the gap between them would produce.
	await expect
		.poll(async () => distinctPaintedCells(request, map.id), { timeout: 8000 })
		.toBe(2);
});

test('undo right after a paint (POST in flight) undoes the new stroke, not the previous one', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Race Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Race QA' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });
	const palette = win.locator('[data-testid="brush-palette"]');
	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Brush' }).click();
	await expect(palette).toBeVisible();

	const box = await canvas.boundingBox();
	if (!box) throw new Error('no box');
	const cy = box.y + box.height * 0.5;

	// Paint cell A and let it fully commit server-side.
	await page.mouse.move(box.x + box.width * 0.3, cy);
	await page.mouse.down();
	await page.mouse.up();
	await expect
		.poll(async () => (await livePaintEvents(request, map.id)).length, { timeout: 8000 })
		.toBe(1);
	const cellA = (await paintedCellKeys(request, map.id))[0];

	// Now delay the events POST, paint cell B, and immediately undo while B's
	// POST is still in flight. Serialized create+undo must undo B (the latest),
	// leaving A. The pre-fix race undid A (B not yet live server-side).
	await page.route('**/api/maps/*/events', async (route) => {
		if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 700));
		await route.continue();
	});
	await page.mouse.move(box.x + box.width * 0.7, cy);
	await page.mouse.down();
	await page.mouse.up();
	await page.keyboard.press('Control+z');

	// A survives, B is gone.
	await expect
		.poll(async () => paintedCellKeys(request, map.id), { timeout: 10000 })
		.toEqual([cellA]);
});
