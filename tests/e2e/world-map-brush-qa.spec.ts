/**
 * QA verification spec (temporary) for two brush bugs:
 *
 *  - Bug 4: the size selector was occluded by the right-side MapSidebar, so
 *    QA reported "no brush size selection". Verify the size buttons are
 *    actually clickable (Playwright's actionability check fails if another
 *    element intercepts the pointer).
 *
 *  - Bug 5: dragging while the brush is active panned the viewport instead of
 *    painting. When the pixi-viewport 'drag' plugin is NOT paused, a drag
 *    keeps the same world point under the cursor, so the gesture records ~1
 *    cell. With drag paused (correct), a wide horizontal drag records many
 *    distinct cells. We assert the painted-cell count is well above 1.
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
	await palette.locator('.mode-toggle').click();
	await expect(palette.locator('.mode-toggle')).toHaveText('Brush ON');

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
