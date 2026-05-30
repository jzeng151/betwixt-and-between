/**
 * Slice 3 T8' — AssetLibrary drag-drop E2E.
 *
 * Dragging a Character/Artifact/Item chip from the AssetLibrary palette
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

	// Seed: a Location to anchor the map (AssetLibrary + drop only render
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
	// Maximize so the AssetLibrary palette (below the canvas) is within the
	// viewport — the default 1024×720 window pushes it below the fold.
	await win.locator('button[aria-label="Maximize"]').click();
	await expect(win.locator('.pixi-stage canvas')).toBeVisible({ timeout: 10000 });

	// The asset chip in the AssetLibrary palette.
	const chip = win.locator('[data-testid="asset-library"] .chip', { hasText: 'Dragged Knight' });
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
