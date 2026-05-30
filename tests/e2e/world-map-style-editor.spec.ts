/**
 * Slice 4 PR-C — entity STYLE section + is_asset toggle E2E.
 *
 * Drives the real DOM (no canvas pixel-reading): create a placeable via the
 * palette's inline "+ Artifact" (opens its entity-detail in edit mode), set a
 * color swatch and clear the is_asset toggle in the STYLE section, then assert:
 *   1. the override + flag persist (GET /api/entities → data.style / is_asset)
 *   2. the edit PROPAGATES live — the entity drops out of the World Map palette
 *      the moment is_asset is unchecked (reference model: one entity edit,
 *      every consumer updates).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}

test('STYLE section persists color + is_asset, and toggling is_asset propagates to the palette', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	// A Location to anchor the map (palette only renders with a linked Location
	// and an image).
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Style Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Style Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const mapWin = page.locator('.window[aria-label="World Map"]');
	await expect(mapWin).toBeVisible();
	await mapWin.locator('button[aria-label="Maximize"]').click();
	await expect(mapWin.locator('.pixi-stage canvas')).toBeVisible({ timeout: 10000 });

	const palette = mapWin.locator('[data-testid="placeable-palette"]');
	await expect(palette).toBeVisible();

	// Inline-create an Artifact → opens its entity-detail window in edit mode.
	await palette.locator('.palette-new button', { hasText: '+ Artifact' }).click();
	const detail = page.locator('.window[aria-label="Untitled Artifact"]');
	await expect(detail).toBeVisible({ timeout: 8000 });
	const styleSection = detail.locator('[data-testid="entity-style-section"]');
	await expect(styleSection).toBeVisible();

	// Default-true is_asset → the new Artifact appears in the palette.
	const chip = palette.locator('.chip', { hasText: 'Untitled Artifact' });
	await expect(chip).toBeVisible();

	// Pick the green swatch (#22c55e) → writes entity.data.style.color.
	await styleSection.locator('.swatch[title="#22c55e"]').click();
	// Uncheck "Show in placeables palette" → entity.data.is_asset = false.
	await styleSection.locator('[data-testid="is-asset-toggle"]').uncheck();

	// 1. Persisted: the Artifact row carries the override + the opt-out flag.
	await expect
		.poll(
			async () => {
				const ents: Array<{ type: string; data?: Record<string, unknown> }> = await (
					await request.get('/api/entities')
				).json();
				const art = ents.find((e) => e.type === 'Artifact');
				const style = art?.data?.style as { color?: string } | undefined;
				return { color: style?.color, isAsset: art?.data?.is_asset };
			},
			{ timeout: 8000 }
		)
		.toEqual({ color: '#22c55e', isAsset: false });

	// 2. Propagated: the chip is gone from the palette (is_asset !== false filter).
	await expect(chip).toHaveCount(0);
});

test('placement popover writes a per-instance style override', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Marker Realm' } })
	).json();
	const knight = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Knight' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Marker Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});
	// One placement of the Knight at the map centre so a canvas-centre click hits it.
	await request.post('/api/map-placements', {
		data: { placeableId: knight.id, locationId: loc.id, mapId: map.id, x: 0.5, y: 0.5 }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const mapWin = page.locator('.window[aria-label="World Map"]');
	await mapWin.locator('button[aria-label="Maximize"]').click();
	const canvas = mapWin.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	// Click the marker at canvas centre → Pixi pointertap opens the context menu.
	const box = await canvas.boundingBox();
	if (!box) throw new Error('no canvas box');
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

	// Context menu → "Edit style" → anchored style popover.
	await page.locator('.context-menu-item', { hasText: 'Edit style' }).click();
	const popover = page.locator('.placement-style-popover[role="dialog"]');
	await expect(popover).toBeVisible({ timeout: 5000 });

	// Pick the green swatch → writes placement.data.style.color (NOT the entity).
	await popover.locator('.swatch[title="#22c55e"]').click();

	await expect
		.poll(
			async () => {
				const rows: Array<{ placeableId: string; data?: { style?: { color?: string } } }> = await (
					await request.get(`/api/map-placements?locationId=${loc.id}`)
				).json();
				return rows[0]?.data?.style?.color;
			},
			{ timeout: 8000 }
		)
		.toBe('#22c55e');

	// The per-instance edit did NOT touch the entity's style.
	const ents: Array<{ id: string; data?: Record<string, unknown> }> = await (
		await request.get('/api/entities')
	).json();
	const knightRow = ents.find((e) => e.id === knight.id);
	expect(knightRow?.data?.style).toBeUndefined();
});

test('popover commits a typed hex when dismissed by clicking outside (Codex P2)', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Blur Realm' } })
	).json();
	const knight = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Blur Knight' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Blur Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});
	await request.post('/api/map-placements', {
		data: { placeableId: knight.id, locationId: loc.id, mapId: map.id, x: 0.5, y: 0.5 }
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const mapWin = page.locator('.window[aria-label="World Map"]');
	await mapWin.locator('button[aria-label="Maximize"]').click();
	const canvas = mapWin.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	const box = await canvas.boundingBox();
	if (!box) throw new Error('no canvas box');
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await page.locator('.context-menu-item', { hasText: 'Edit style' }).click();
	const popover = page.locator('.placement-style-popover[role="dialog"]');
	await expect(popover).toBeVisible({ timeout: 5000 });

	// Type a hex into the color field — it commits on BLUR, not per keystroke.
	await popover.locator('#se-color').fill('#abcdef');
	// Dismiss by clicking outside (top-left corner, away from the popover).
	await page.mouse.click(5, 5);
	await expect(popover).toBeHidden();

	// The typed-but-not-Enter'd draft was committed by the blur-before-close fix.
	await expect
		.poll(
			async () => {
				const rows: Array<{ data?: { style?: { color?: string } } }> = await (
					await request.get(`/api/map-placements?locationId=${loc.id}`)
				).json();
				return rows[0]?.data?.style?.color;
			},
			{ timeout: 8000 }
		)
		.toBe('#abcdef');
});
