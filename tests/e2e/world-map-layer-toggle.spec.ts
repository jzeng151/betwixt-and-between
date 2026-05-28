/**
 * Slice 3 E3 — layer-toggle persistence E2E.
 *
 * The MapSidebar Layers pane exposes a checkbox per WM3 layer
 * (background/grid/terrain/regions/placements). Toggling one PATCHes
 * `world_map_layer_prefs` (per-user-per-map). Unchecking persists: it
 * survives a full page reload, proving the pref round-trips through the
 * DB rather than living in component state.
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

async function openMap(page: import('@playwright/test').Page) {
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	return win;
}

test('toggling a layer off persists across a page reload', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const map = await (
		await request.post('/api/maps', { data: { name: 'Layers Test' } })
	).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480 }
	});

	await page.goto('/app');
	let win = await openMap(page);

	// The Grid layer row + its checkbox. Default: visible (checked).
	const gridRow = win.locator('.layer-row', { hasText: 'Grid' });
	const gridCheckbox = gridRow.locator('input[type="checkbox"]');
	await expect(gridCheckbox).toBeVisible({ timeout: 10000 });
	await expect(gridCheckbox).toBeChecked();

	// Uncheck it.
	await gridCheckbox.uncheck();
	await expect(gridCheckbox).not.toBeChecked();

	// Pref persisted server-side as visible=0 for layerKey 'grid'.
	await expect
		.poll(
			async () => {
				const prefs: Array<{ layerKey: string; visible: number }> = await (
					await request.get(`/api/world-map-layer-prefs?worldMapId=${map.id}`)
				).json();
				return prefs.find((p) => p.layerKey === 'grid')?.visible ?? null;
			},
			{ timeout: 8000 }
		)
		.toBe(0);

	// Reload the whole page — the toggle must survive (loaded from the DB,
	// not from in-memory component state).
	await page.reload();
	win = await openMap(page);
	const gridCheckboxAfter = win
		.locator('.layer-row', { hasText: 'Grid' })
		.locator('input[type="checkbox"]');
	await expect(gridCheckboxAfter).toBeVisible({ timeout: 10000 });
	await expect(gridCheckboxAfter).not.toBeChecked();
});
