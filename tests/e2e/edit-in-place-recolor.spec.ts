/**
 * Settings customization Phase 2, Item 2 — edit-in-place entity recolor E2E.
 *
 * Both surfaces write the per-entity `data.color` (the layer shared by graph
 * node, timeline bar, and map sprite), via the SAME EntityColorField:
 *   A. Story-graph node right-click → "Recolor…" → EntityColorPopover.
 *   B. Map marker popover → "This <type>" → EntityColorField (entity-level,
 *      distinct from the per-instance "This marker" StyleEditor).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1400, height: 1000 } });

// CHARACTER_COLORS[1] — a swatch present in EntityColorField, distinct from the
// StyleEditor palette presets so the locator is unambiguous within the popover.
const PICK = '#2dd4bf';

async function entityColor(request: APIRequestContext, id: string): Promise<unknown> {
	const ents: Array<{ id: string; data?: Record<string, unknown> }> = await (
		await request.get('/api/entities')
	).json();
	return ents.find((e) => e.id === id)?.data?.color;
}

test('story-graph node right-click recolor writes data.color and persists', async ({ page, request }) => {
	await clearAll(request);
	const knight = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Recolor Knight' } })
	).json();
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');

	await page.click('button[title="Story Graph"]');
	const sg = page.locator('.window[aria-label="Story Graph"]').first();
	await expect(sg).toBeVisible();

	const node = sg.locator('.node[aria-label="Open Recolor Knight"]').first();
	await expect(node).toBeVisible();
	await node.click({ button: 'right' });

	await page.getByRole('menuitem', { name: 'Recolor…' }).click();
	const popover = page.locator('.entity-color-popover[role="dialog"]');
	await expect(popover).toBeVisible({ timeout: 5000 });
	await popover.locator(`.entity-color .swatch[title="${PICK}"]`).click();

	// Persists server-side as the entity's data.color.
	await expect.poll(() => entityColor(request, knight.id), { timeout: 5000 }).toBe(PICK);

	// Survives a reload (server round-trip, not just optimistic store).
	await page.reload();
	expect(await entityColor(request, knight.id)).toBe(PICK);
});

test('map marker popover "This <type>" recolor writes entity data.color (not placement style)', async ({
	page,
	request
}) => {
	await clearAll(request);
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Recolor Realm' } })
	).json();
	const knight = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Map Knight' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Recolor Map' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});
	await request.post('/api/map-placements', {
		data: { placeableId: knight.id, locationId: loc.id, mapId: map.id, x: 0.5, y: 0.5 }
	});

	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
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

	// The "This <type>" section is the EntityColorField (entity-level data.color),
	// distinct from the "This marker" StyleEditor (per-instance placement style).
	await popover.locator(`.entity-color .swatch[title="${PICK}"]`).click();

	// Entity data.color persisted...
	await expect.poll(() => entityColor(request, knight.id), { timeout: 5000 }).toBe(PICK);

	// ...and the per-instance placement style was NOT touched.
	const rows: Array<{ data?: { style?: unknown } }> = await (
		await request.get(`/api/map-placements?locationId=${loc.id}`)
	).json();
	expect(rows[0]?.data?.style).toBeUndefined();
});
