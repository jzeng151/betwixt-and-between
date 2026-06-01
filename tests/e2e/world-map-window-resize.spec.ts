/**
 * Issue: the World Map window couldn't be resized — the map's high z-index
 * chrome (toolbar z-index:1000, sidebar, the bottom palettes z-index:150,
 * loading overlay) leaked into the window's stacking context and painted over
 * the resize handles, so the bottom edge + corners were dead. Isolating
 * .win-content contains those z-indexes and keeps the handles on top.
 *
 * We drag the bottom edge (which sat under the brush palette — the blocked
 * spot) to grow the height, and the right edge to grow the width.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1400, height: 1000 } });
async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}
test('world map window resizes from the bottom edge (under the palettes) and right edge', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const loc = await (await request.post('/api/entities', { data: { type: 'Location', name: 'L' } })).json();
	const map = await (await request.post('/api/maps', { data: { name: 'M' } })).json();
	await request.patch(`/api/maps/${map.id}`, { data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id } });

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	// The unified tool bar (DS4) is the always-present bottom chrome now; the
	// brush palette only shows under the Brush tool. Wait on the tool bar.
	await expect(win.locator('[data-testid="map-tool-selector"]')).toBeVisible({ timeout: 10000 });

	const before = await win.boundingBox();
	if (!before) throw new Error('no box');

	// Bottom edge — the strip that the brush palette used to cover.
	await page.mouse.move(before.x + before.width / 2, before.y + before.height - 3);
	await page.mouse.down();
	await page.mouse.move(before.x + before.width / 2, before.y + before.height + 110, { steps: 12 });
	await page.mouse.up();

	const mid = await win.boundingBox();
	if (!mid) throw new Error('no box mid');
	expect(mid.height).toBeGreaterThan(before.height + 60);

	// Right edge → grow width.
	await page.mouse.move(mid.x + mid.width - 3, mid.y + mid.height / 2);
	await page.mouse.down();
	await page.mouse.move(mid.x + mid.width + 110, mid.y + mid.height / 2, { steps: 12 });
	await page.mouse.up();

	const after = await win.boundingBox();
	if (!after) throw new Error('no box after');
	expect(after.width).toBeGreaterThan(mid.width + 60);
});
