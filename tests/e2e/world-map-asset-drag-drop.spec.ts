/**
 * Slice 3 T8' — placeable-palette drag-drop E2E.
 *
 * Dragging a Character/Artifact/Item chip from the consolidated
 * PlaceablePalette (Slice 4 PR-D merged the old AssetLibrary into it)
 * onto the Pixi canvas creates a `map_placements` row (NOT a new entity,
 * per outside-voice B1) at the dropped fractional coords.
 *
 * Slice 4 PR-A regression: the placement references the entity directly
 * (D1 reference model), so the old `data.source_asset_id` provenance field
 * is no longer written — a drag-drop placement carries no `source_asset_id`.
 *
 * HTML5 drag-and-drop isn't synthesized by Playwright's mouse, so this
 * uses the shared `html5Drag` helper (dispatches real DragEvents with a
 * shared DataTransfer). The drop coords land at the canvas center, so the
 * placement's fractional coords are ~0.5/0.5.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { html5Drag } from './helpers/html5-drag.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}

test('drag an asset chip onto the canvas creates a placement (no source_asset_id)', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	// Seed: a Location to anchor the map (the palette + drop only render
	// when the active map has a linked Location and an image), and a
	// Character to act as the library asset.
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Drop Realm' } })
	).json();
	const asset = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Dragged Knight' } })
	).json();

	const map = await (
		await request.post('/api/maps', { data: { name: 'Drag Test' } })
	).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	// No placements yet.
	const before: Array<{ id: string }> = await (
		await request.get(`/api/map-placements?locationId=${loc.id}`)
	).json();
	expect(before).toHaveLength(0);

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	// Maximize so the placeable palette (below the canvas) is within the
	// viewport — the default 1024×720 window pushes it below the fold.
	await win.locator('button[aria-label="Maximize"]').click();
	await expect(win.locator('.pixi-stage canvas')).toBeVisible({ timeout: 10000 });

	// The asset chip in the consolidated placeable palette.
	const chip = win.locator('[data-testid="placeable-palette"] .chip', { hasText: 'Dragged Knight' });
	await expect(chip).toBeVisible({ timeout: 10000 });

	// Drop onto the canvas drop zone (center).
	const dropZone = win.locator('.pixi-drop-target');
	await expect(dropZone).toBeVisible();
	await html5Drag(page, chip, dropZone);

	// A placement now exists, bound to the dragged asset. Under the D1
	// reference model it carries no source_asset_id provenance field.
	await expect
		.poll(
			async () => {
				const rows: Array<{ placeableId: string; data?: { source_asset_id?: string } }> =
					await (await request.get(`/api/map-placements?locationId=${loc.id}`)).json();
				return rows.length;
			},
			{ timeout: 8000 }
		)
		.toBe(1);

	const after: Array<{
		placeableId: string;
		mapId: string | null;
		x: number;
		y: number;
		data?: { source_asset_id?: string };
	}> = await (await request.get(`/api/map-placements?locationId=${loc.id}`)).json();
	expect(after[0].placeableId).toBe(asset.id);
	// Slice 4 PR-A regression: no source_asset_id written on drag-drop.
	expect(after[0].data?.source_asset_id).toBeUndefined();
	// Dropped at canvas center → fractional coords near the middle.
	expect(after[0].x).toBeGreaterThan(0);
	expect(after[0].x).toBeLessThan(1);
	expect(after[0].y).toBeGreaterThan(0);
	expect(after[0].y).toBeLessThan(1);
});

test('click-to-arm a palette chip, then tap the canvas, creates a placement (T7 place-armed gate)', async ({
	page,
	request
}) => {
	// Covers the click-to-place path the T7 CanvasMode rewrite gates on
	// (handleCanvasClick fires only when canvasMode === 'place-armed' && !mapLoading).
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Click Realm' } })
	).json();
	await request.post('/api/entities', { data: { type: 'Character', name: 'Armed Knight' } });
	const map = await (await request.post('/api/maps', { data: { name: 'Click Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	// Arm the chip (click-to-arm → canvasMode becomes 'place-armed').
	const chip = win.locator('[data-testid="placeable-palette"] .chip', { hasText: 'Armed Knight' });
	await expect(chip).toBeVisible();
	await chip.click();
	await expect(chip).toHaveAttribute('aria-pressed', 'true');

	// Tap the canvas centre → handleCanvasClick creates a placement.
	const box = await canvas.boundingBox();
	if (!box) throw new Error('no canvas box');
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

	await expect
		.poll(
			async () => {
				const rows: Array<{ id: string }> = await (
					await request.get(`/api/map-placements?locationId=${loc.id}`)
				).json();
				return rows.length;
			},
			{ timeout: 8000 }
		)
		.toBe(1);
});

test('dropping a chip clears a pending click-to-place arm (T7 drop gate)', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Arm Realm' } })
	).json();
	const b = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Knight B' } })
	).json();
	await request.post('/api/entities', { data: { type: 'Character', name: 'Knight A' } });
	const map = await (await request.post('/api/maps', { data: { name: 'Arm Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	await expect(win.locator('.pixi-stage canvas')).toBeVisible({ timeout: 10000 });

	const palette = win.locator('[data-testid="placeable-palette"]');
	const chipA = palette.locator('.chip', { hasText: 'Knight A' });
	await chipA.click();
	await expect(chipA).toHaveAttribute('aria-pressed', 'true');

	// Drag the OTHER chip onto the canvas.
	const chipB = palette.locator('.chip', { hasText: 'Knight B' });
	await html5Drag(page, chipB, win.locator('.pixi-drop-target'));

	// B is placed, and the drop cleared A's arm.
	await expect
		.poll(async () => {
			const rows: Array<{ placeableId: string }> = await (
				await request.get(`/api/map-placements?locationId=${loc.id}`)
			).json();
			return rows.length;
		})
		.toBe(1);
	const rows: Array<{ placeableId: string }> = await (
		await request.get(`/api/map-placements?locationId=${loc.id}`)
	).json();
	expect(rows[0].placeableId).toBe(b.id);
	await expect(chipA).toHaveAttribute('aria-pressed', 'false');
});

test('a drop during brush mode is rejected (T7 drop gate)', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Brush Realm' } })
	).json();
	await request.post('/api/entities', { data: { type: 'Character', name: 'Brush Knight' } });
	const map = await (await request.post('/api/maps', { data: { name: 'Brush Drop Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	await expect(win.locator('.pixi-stage canvas')).toBeVisible({ timeout: 10000 });

	// Enter brush mode → canvasMode === 'brush' owns the pointer.
	await win.locator('[data-testid="brush-palette"] button[aria-pressed]').first().click();

	const chip = win.locator('[data-testid="placeable-palette"] .chip', { hasText: 'Brush Knight' });
	await html5Drag(page, chip, win.locator('.pixi-drop-target'));

	// The drop is rejected mid-brush — no placement created. Give it a beat.
	await page.waitForTimeout(1500);
	const rows: Array<{ id: string }> = await (
		await request.get(`/api/map-placements?locationId=${loc.id}`)
	).json();
	expect(rows).toHaveLength(0);
});
