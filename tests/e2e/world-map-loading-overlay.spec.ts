/**
 * Bug 2 regression — the saved per-map layer config AND the placements both
 * load a beat after the map mounts. The canvas must show an explicit loading
 * state until BOTH have settled (not flash layers on, not pop placement
 * markers in afterward, not sit blank-looking-broken). We delay each GET in
 * turn to make the windows deterministic and assert the overlay stays up for
 * the whole window, then clears.
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
test('map shows a loading overlay while the saved layer config loads', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const loc = await (await request.post('/api/entities', { data: { type: 'Location', name: 'L' } })).json();
	const map = await (await request.post('/api/maps', { data: { name: 'M' } })).json();
	await request.patch(`/api/maps/${map.id}`, { data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id } });
	await page.route('**/api/world-map-layer-prefs**', async (route) => {
		if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 2000));
		await route.continue();
	});
	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const overlay = win.locator('.map-loading-overlay');
	await expect(overlay).toBeVisible({ timeout: 5000 });
	await expect(overlay.locator('.map-loading-text')).toHaveText('Loading map…');
	// After the delayed prefs land, the overlay goes away.
	await expect(overlay).toHaveCount(0, { timeout: 5000 });
});

test('loading overlay also waits for placements (markers do not pop in after)', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'L' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'M' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	// Layer prefs resolve normally; the PLACEMENTS GET is the slow one here.
	await page.route('**/api/map-placements**', async (route) => {
		if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 2000));
		await route.continue();
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const overlay = win.locator('.map-loading-overlay');
	// Overlay must still be up after layer-prefs would have landed, because
	// placements are still loading.
	await expect(overlay).toBeVisible({ timeout: 5000 });
	await page.waitForTimeout(800);
	await expect(overlay).toBeVisible();
	// Once placements land, it clears.
	await expect(overlay).toHaveCount(0, { timeout: 5000 });
});

test('loading overlay also waits for terrain/region data (anchors)', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'L' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'M' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});

	// The anchors GET (part of the anchors+events load that drives terrain +
	// region ownership) is the slow one here.
	await page.route('**/anchors', async (route) => {
		if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 2000));
		await route.continue();
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await win.locator('button[aria-label="Maximize"]').click();
	const overlay = win.locator('.map-loading-overlay');
	await expect(overlay).toBeVisible({ timeout: 5000 });
	await page.waitForTimeout(800);
	await expect(overlay).toBeVisible();
	await expect(overlay).toHaveCount(0, { timeout: 5000 });
});
