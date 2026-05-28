/**
 * Slice 3 T11 — polygon snap-to-grid E2E.
 *
 * While drawing a region polygon, holding Shift snaps each placed vertex
 * to the nearest grid intersection (square grid: cell corners). The map
 * is seeded 640×480 with the default 32×24 grid, so cell pitch is exactly
 * 20px on both axes — a snapped vertex's pixel coords are integer
 * multiples of 20.
 *
 * Two runs prove the differential:
 *   - Shift held  → the user-placed vertices land on grid corners.
 *   - Shift absent → at least one user-placed vertex is off-grid.
 *
 * The first vertex is seeded by the "Draw region here" context-menu click
 * (raw, never snapped), so assertions target the subsequently-placed
 * vertices (polygon[1..]).
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

const CELL_PX = 20; // 640/32 === 480/24 === 20

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}

function onGrid(coord: number): boolean {
	return Math.abs(coord / CELL_PX - Math.round(coord / CELL_PX)) < 1e-6;
}

async function seedMap(request: APIRequestContext, name: string): Promise<string> {
	const map = await (await request.post('/api/maps', { data: { name } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480 }
	});
	return map.id;
}

/**
 * Draw a triangular region by right-click-seeding the first vertex, then
 * placing two more vertices (optionally with Shift held), then committing
 * with Enter and saving the region form. Returns the stored polygon
 * ([y, x] pairs) of the created region.
 */
async function drawTriangleRegion(
	page: Page,
	request: APIRequestContext,
	mapId: string,
	withShift: boolean
): Promise<number[][]> {
	const win = page.locator('.window[aria-label="World Map"]');
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });
	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');

	// Three well-separated points forming a non-degenerate triangle.
	const seed = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
	const v1 = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.32 };
	const v2 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.72 };

	// Right-click → context menu → seed the first vertex.
	await canvas.click({ button: 'right', position: { x: seed.x - box.x, y: seed.y - box.y } });
	await page.locator('text=Draw region here').first().click();

	if (withShift) await page.keyboard.down('Shift');
	await page.mouse.click(v1.x, v1.y);
	await page.mouse.click(v2.x, v2.y);
	if (withShift) await page.keyboard.up('Shift');

	// Commit the polygon (Enter), then save the region form (null location OK).
	await page.keyboard.press('Enter');
	const saveBtn = win.locator('button', { hasText: 'Save Region' });
	await expect(saveBtn).toBeVisible({ timeout: 5000 });
	await saveBtn.click();

	// Read the persisted polygon back from the map detail endpoint.
	await expect
		.poll(
			async () => {
				const data: { regions: Array<{ polygon: number[][] }> } = await (
					await request.get(`/api/maps/${mapId}`)
				).json();
				return data.regions.length;
			},
			{ timeout: 8000 }
		)
		.toBeGreaterThan(0);
	const data: { regions: Array<{ polygon: number[][] }> } = await (
		await request.get(`/api/maps/${mapId}`)
	).json();
	return data.regions[0].polygon;
}

test('Shift-held vertices snap to grid intersections', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const mapId = await seedMap(request, 'Snap On');

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	await expect(page.locator('.window[aria-label="World Map"]')).toBeVisible();

	const polygon = await drawTriangleRegion(page, request, mapId, true);
	expect(polygon.length).toBe(3);
	// polygon[0] is the raw context-menu seed; polygon[1..] are the
	// Shift-placed vertices — both axes must land on grid corners.
	for (const [y, x] of polygon.slice(1)) {
		expect(onGrid(x)).toBe(true);
		expect(onGrid(y)).toBe(true);
	}
});

test('without Shift, vertices are free-form (not grid-aligned)', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	const mapId = await seedMap(request, 'Snap Off');

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	await expect(page.locator('.window[aria-label="World Map"]')).toBeVisible();

	const polygon = await drawTriangleRegion(page, request, mapId, false);
	expect(polygon.length).toBe(3);
	// At least one coordinate among the freely-placed vertices is off-grid.
	const placed = polygon.slice(1).flat();
	expect(placed.some((coord) => !onGrid(coord))).toBe(true);
});
