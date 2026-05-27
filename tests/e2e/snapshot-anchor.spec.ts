/**
 * Δ1b-E — right-click "Snapshot world state here" E2E (T11).
 *
 * Right-clicking an empty area of the canvas (Pixi is the only renderer
 * opens a ContextMenu with "Snapshot world state here" (Slice 1b PR 2
 * commit 6). Clicking the item POSTs a new map_anchor row at the
 * current playhead with the rendered region/faction state snapshotted.
 *
 * This test seeds a map + region, opens under Pixi, right-clicks the
 * canvas, clicks the snapshot item, then asserts a new anchor exists
 * in the DB via the API. The baseline anchor at t=-Infinity is created
 * automatically by the region POST; the snapshot lands at t=0 (no
 * playhead set → default).
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

test('right-click → Snapshot world state here creates a new anchor', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	// Seed via API: create one map with explicit dimensions + a
	// baseImageUrl so WorldMap.svelte treats it as having an image
	// (otherwise the upload-area overlay intercepts canvas clicks).
	// The URL doesn't need to resolve — only its presence affects the
	// has-image gate.
	// POST /api/maps ignores width/height (those come from the
	// upload-image flow). PATCH them on after creation so hasImage
	// resolves true and the upload-area overlay doesn't intercept clicks.
	const map = await (
		await request.post('/api/maps', { data: { name: 'Snapshot Test' } })
	).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 600, height: 400 }
	});
	await request.post(`/api/maps/${map.id}/regions`, {
		data: {
			polygon: [
				[10, 10],
				[10, 100],
				[100, 100],
				[100, 10]
			]
		}
	});

	// Baseline anchor: 1 (t=-Infinity, created by region POST fan-out).
	const before: Array<{ id: string; tPosition: number }> = (
		await (await request.get(`/api/maps/${map.id}/anchors`)).json()
	).rows;
	expect(before).toHaveLength(1);

	// Open the world-map app. T13 made Pixi the only renderer.
	await page.goto(`/app`);
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();

	// Wait for Pixi canvas to mount.
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	// Right-click an empty-area position (top-right of the canvas, where
	// no region polygon is drawn — the seeded region occupies the
	// top-left quadrant).
	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');
	await canvas.click({
		button: 'right',
		position: { x: box.width * 0.8, y: box.height * 0.2 }
	});

	// ContextMenu appears at the click coords.
	const snapItem = page.locator('text=Snapshot world state here').first();
	await expect(snapItem).toBeVisible({ timeout: 5000 });
	await snapItem.click();

	// Toast confirms. (The component's flashInfo auto-dismisses after
	// 3.5s — assert before that.)
	await expect(win.locator('.action-info')).toContainText(/Snapshot saved/);

	// API: anchor count went up.
	const after: Array<{ id: string; tPosition: number }> = (
		await (await request.get(`/api/maps/${map.id}/anchors`)).json()
	).rows;
	expect(after.length).toBe(before.length + 1);
	// New anchor lands at t=0 (no playhead set in this session — the
	// snapshot handler defaults to `get(playhead) ?? 0`).
	const newAnchor = after.find((a) => !before.some((b) => b.id === a.id));
	expect(newAnchor?.tPosition).toBe(0);
});
