/**
 * Slice 4 PR-F (DS4) — movement authoring E2E.
 *
 * Exercises the Move tool end-to-end on the PGlite Playwright harness:
 *   - Select Move in the unified tool bar (MapToolSelector).
 *   - Drag a placement marker across the canvas → a move_entity keyframe is
 *     authored at the playhead via POST /api/maps/[id]/events.
 *   - Reload → the keyframe persists (server-side, surfaced via the events API).
 *   - Keyboard authoring (DS4 a11y): click a marker to select it, arrow-nudge,
 *     Enter commits a keyframe.
 *
 * Like the brush E2E, assertions are at the events API, not canvas pixels —
 * Pixi markers aren't DOM-addressable and the rendered interpolated position is
 * pinned by the projection-movement unit suite (the tween midpoint, clamps, and
 * re-span are unit-tested). This spec's unique job is the real drag/keyboard
 * round-trip and persistence.
 *
 * The seeded placement sits at the fractional centre (0.5, 0.5); at the
 * viewport's fit-zoom the canvas centre maps to it, so the gesture starts at the
 * canvas bounding-box centre. The placement has no [start,end) window, so a
 * keyframe at the default playhead (T=0) is always in-window (D-PRF-9).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

type MapEvent = {
	id: string;
	kind: string;
	payloadJsonb: { placement_id?: string; position?: { x: number; y: number }; tween?: string };
};

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}

async function liveMoveEvents(request: APIRequestContext, mapId: string): Promise<MapEvent[]> {
	const { rows }: { rows: MapEvent[] } = await (await request.get(`/api/maps/${mapId}/events`)).json();
	return rows.filter((e) => e.kind === 'move_entity');
}

/** Seed a Location + placeable Character + map (image, dims, location) + a
 *  default-window placement at the fractional centre. Returns ids. */
async function seedMap(request: APIRequestContext) {
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Move Realm' } })
	).json();
	const knight = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Mover' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Move Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});
	await request.post('/api/map-placements', {
		data: { placeableId: knight.id, locationId: loc.id, mapId: map.id, x: 0.5, y: 0.5 }
	});
	return { loc, knight, map };
}

test('drag a marker in Move mode authors a move_entity keyframe that persists across reload', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const { map } = await seedMap(request);
	expect(await liveMoveEvents(request, map.id)).toHaveLength(0);

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	// Select the Move tool (DS4 unified tool bar).
	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Move' }).click();

	const box = await canvas.boundingBox();
	if (!box) throw new Error('no canvas box');
	// Marker at fractional (0.5,0.5) → canvas centre. Drag it left to ~quarter.
	const startX = box.x + box.width * 0.5;
	const startY = box.y + box.height * 0.5;
	const targetX = box.x + box.width * 0.25;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(targetX, startY, { steps: 20 });
	await page.mouse.up();

	// A move_entity keyframe was authored, dropped left of centre (x < 0.5).
	await expect
		.poll(async () => (await liveMoveEvents(request, map.id)).length, { timeout: 8000 })
		.toBe(1);
	const ev = (await liveMoveEvents(request, map.id))[0];
	expect(ev.payloadJsonb.position!.x).toBeLessThan(0.5);
	expect(Number.isFinite(ev.payloadJsonb.position!.x)).toBe(true);
	expect(ev.payloadJsonb.tween).toBe('ease_in_out');

	// Reload → the authored keyframe persists (loaded from the events API).
	await page.reload();
	await expect
		.poll(async () => (await liveMoveEvents(request, map.id)).length, { timeout: 8000 })
		.toBe(1);
});

test('keyboard nudge in Move mode authors a keyframe (DS4 a11y)', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const { map } = await seedMap(request);

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Move' }).click();

	const box = await canvas.boundingBox();
	if (!box) throw new Error('no canvas box');
	// A click (no drag) on the centre marker selects it for keyboard nudging.
	await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
	// The Move status hint reflects the selection.
	await expect(win.locator('.map-move-keyboard')).toContainText('Nudging');

	// Nudge left a few steps, then commit.
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Enter');

	await expect
		.poll(async () => (await liveMoveEvents(request, map.id)).length, { timeout: 8000 })
		.toBe(1);
	const ev = (await liveMoveEvents(request, map.id))[0];
	expect(ev.payloadJsonb.position!.x).toBeLessThan(0.5);
	expect(Number.isFinite(ev.payloadJsonb.position!.x)).toBe(true);
});
