/**
 * Slice 3 T5 + B5 — terrain brush authoring E2E.
 *
 * Entering brush mode (BrushPalette toggle) and dragging across the Pixi
 * canvas paints cells. One gesture (down → drag → up) commits as one
 * undo-able command: every paint_cells event in the stroke shares a
 * command_id, and grouped-undo soft-deletes all of them atomically.
 *
 * The painting is driven through the real UI (palette toggle + canvas
 * pointer drag). There is no UI undo affordance yet, so undo is exercised
 * via the documented POST /events/undo endpoint — the Slice 3 B5 grouped
 * undo. The assertion is the plan's intent: a stroke's painted cells all
 * revert on a single undo.
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

async function livePaintEvents(request: APIRequestContext, mapId: string): Promise<MapEvent[]> {
	const { rows }: { rows: MapEvent[] } = await (
		await request.get(`/api/maps/${mapId}/events`)
	).json();
	return rows.filter((e) => e.kind === 'paint_cells');
}

test('paint a stroke on the canvas, then grouped-undo reverts every painted cell', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	// Brush requires a map with image + linked Location (the palette only
	// mounts then) and canvas dimensions (for the cell-coordinate math).
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Paint Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Brush Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	expect(await livePaintEvents(request, map.id)).toHaveLength(0);

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	// Maximize so the BrushPalette (below the canvas) is within the viewport
	// — the default 1024×720 window pushes it below the fold.
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	// Enter brush mode. (Default size 1; a multi-cell drag still paints
	// several distinct cells. The size selector sits under the right
	// sidebar at wide layouts, so we don't touch it here.)
	const palette = win.locator('[data-testid="brush-palette"]');
	await palette.locator('.mode-toggle').click();
	await expect(palette.locator('.mode-toggle')).toHaveText('Brush ON');

	// Drag a stroke across the canvas interior (left of the right-side
	// sidebar). Pixi's federated pointer system picks up these real DOM
	// pointer events; pointerup commits the stroke.
	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');
	const startX = box.x + box.width * 0.2;
	const midY = box.y + box.height * 0.5;
	await page.mouse.move(startX, midY);
	await page.mouse.down();
	await page.mouse.move(startX + box.width * 0.1, midY + 20, { steps: 8 });
	await page.mouse.move(startX + box.width * 0.25, midY + 40, { steps: 8 });
	await page.mouse.up();

	// The stroke committed: paint_cells event(s) exist, sharing one
	// command_id, with at least one painted cell.
	await expect
		.poll(async () => (await livePaintEvents(request, map.id)).length, { timeout: 8000 })
		.toBeGreaterThan(0);

	const painted = await livePaintEvents(request, map.id);
	const commandIds = new Set(painted.map((e) => e.commandId));
	expect(commandIds.size).toBe(1); // one gesture = one command
	const [strokeCommandId] = [...commandIds];
	expect(strokeCommandId).not.toBeNull();
	const totalCells = painted.reduce((n, e) => n + (e.payloadJsonb.cells?.length ?? 0), 0);
	expect(totalCells).toBeGreaterThan(0);
	// The final chunk closes the stroke (auto-anchor stroke boundary).
	expect(painted.some((e) => e.payloadJsonb.command_complete === true)).toBe(true);

	// Grouped undo: a single undo pops every event in the stroke.
	const undone: MapEvent[] = await (
		await request.post(`/api/maps/${map.id}/events/undo`)
	).json();
	expect(undone.length).toBe(painted.length);
	expect(undone.every((e) => e.commandId === strokeCommandId)).toBe(true);

	// Every painted cell reverted — no live paint_cells events remain.
	await expect
		.poll(async () => (await livePaintEvents(request, map.id)).length, { timeout: 8000 })
		.toBe(0);
});
