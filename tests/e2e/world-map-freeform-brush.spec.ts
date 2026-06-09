/**
 * WM3 Slice A — freeform brush (paint_stroke) E2E.
 *
 * Drives the REAL UI: Brush tool → Freeform toggle → drag across the Pixi
 * canvas. Asserts the gesture commits a paint_stroke event with the right
 * payload (fill and stamp modes), and — critically for a canvas feature —
 * captures console/page errors during render so a PixiArtLayer rendering bug
 * (BlurFilter mask, TilingSprite, sprite scatter) fails the test instead of
 * silently producing a blank or broken layer.
 *
 * Render fidelity (does the fill blend / does the stamp scatter look right) is
 * a human judgment; this test guards the wiring + the no-throw contract.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { STAMP_GROUP_KEYS } from '../../src/lib/features/map/terrain-keys.generated.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

type MapEvent = {
	id: string;
	kind: string;
	commandId: string | null;
	payloadJsonb: {
		path?: Array<{ x: number; y: number }>;
		mode?: string;
		textureKey?: string;
		brushSize?: number;
		softness?: number;
	};
};

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}

async function strokeEvents(request: APIRequestContext, mapId: string): Promise<MapEvent[]> {
	const { rows }: { rows: MapEvent[] } = await (
		await request.get(`/api/maps/${mapId}/events`)
	).json();
	return rows.filter((e) => e.kind === 'paint_stroke');
}

// Open the World Map, maximize, enter Brush → Freeform. Returns the canvas locator.
async function openFreeformBrush(page: Page) {
	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Brush' }).click();
	// Grid palette is default; flip to Freeform.
	await win.locator('.brush-mode-toggle button', { hasText: 'Freeform' }).click();
	await expect(win.locator('[data-testid="freeform-brush-palette"]')).toBeVisible();
	return { win, canvas };
}

async function dragStroke(page: Page, canvas: ReturnType<Page['locator']>) {
	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');
	const startX = box.x + box.width * 0.2;
	const y = box.y + box.height * 0.5;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(startX + box.width * 0.15, y + 20, { steps: 10 });
	await page.mouse.move(startX + box.width * 0.3, y + 40, { steps: 10 });
	await page.mouse.up();
}

async function seedMapWithImage(request: APIRequestContext) {
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Art Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Freeform Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});
	return map;
}

test('fill stroke: drag commits a paint_stroke (mode=fill) and renders without errors', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	// Fail the test on any uncaught render error (catches PixiArtLayer bugs:
	// BlurFilter on the mask, TilingSprite masking, etc.).
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
	});

	const map = await seedMapWithImage(request);
	expect(await strokeEvents(request, map.id)).toHaveLength(0);

	const { canvas } = await openFreeformBrush(page);
	// Capture the canvas BEFORE painting — a blank fill (the bug this guards)
	// commits an event and throws nothing, so only pixel output catches it.
	const before = await canvas.screenshot();
	await dragStroke(page, canvas);

	await expect
		.poll(async () => (await strokeEvents(request, map.id)).length, { timeout: 8000 })
		.toBeGreaterThan(0);

	const events = await strokeEvents(request, map.id);
	expect(events).toHaveLength(1); // one gesture = one paint_stroke
	const p = events[0].payloadJsonb;
	expect(p.mode).toBe('fill');
	expect(p.textureKey).toBe('Grass'); // default fill key
	expect(Array.isArray(p.path)).toBe(true);
	expect((p.path?.length ?? 0)).toBeGreaterThan(1);
	expect(typeof p.brushSize).toBe('number');
	expect(events[0].commandId).not.toBeNull(); // one undo group

	// Let the projection fold + PixiArtLayer rasterize, then assert no render errors.
	await page.waitForTimeout(500);
	const after = await canvas.screenshot({ path: '.gstack/qa-reports/screenshots/freeform-fill.png' });
	expect(errors, errors.join('\n')).toEqual([]);
	// The fill MUST change the canvas pixels — a blank fill (TilingSprite+mask
	// clipped to nothing) would leave before === after and slip past the
	// event-commit + no-throw checks. This is the guard the QA screenshot caught.
	expect(Buffer.compare(before, after)).not.toBe(0);
});

test('stamp stroke: switching to Stamp commits a paint_stroke (mode=stamp) and renders without errors', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
	});

	const map = await seedMapWithImage(request);

	const { win, canvas } = await openFreeformBrush(page);
	// Switch to Stamp mode (resets textureKey to the first Objects/ stamp).
	await win.locator('[data-testid="freeform-brush-palette"] .mode-toggle button', { hasText: 'Stamp' }).click();
	await dragStroke(page, canvas);

	await expect
		.poll(async () => (await strokeEvents(request, map.id)).length, { timeout: 8000 })
		.toBeGreaterThan(0);

	const events = await strokeEvents(request, map.id);
	expect(events).toHaveLength(1);
	const p = events[0].payloadJsonb;
	expect(p.mode).toBe('stamp');
	// Slice C: the palette arms a FAMILY key (varied scatter), not a member key.
	expect(STAMP_GROUP_KEYS as readonly string[]).toContain(p.textureKey);

	await page.waitForTimeout(500);
	await canvas.screenshot({ path: '.gstack/qa-reports/screenshots/freeform-stamp.png' });
	expect(errors, errors.join('\n')).toEqual([]);
});

test('erase stroke: erasing across a fill removes art within the layer (Slice C mask)', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
	});

	const map = await seedMapWithImage(request);
	const { win, canvas } = await openFreeformBrush(page);

	// Paint a fill stroke, let it rasterize.
	await dragStroke(page, canvas);
	await expect
		.poll(async () => (await strokeEvents(request, map.id)).length, { timeout: 8000 })
		.toBe(1);
	await page.waitForTimeout(600);
	const painted = await canvas.screenshot();

	// Erase along the same path.
	await win
		.locator('[data-testid="freeform-brush-palette"] .mode-toggle button', { hasText: 'Erase' })
		.click();
	await dragStroke(page, canvas);

	await expect
		.poll(async () => (await strokeEvents(request, map.id)).length, { timeout: 8000 })
		.toBe(2);
	const events = await strokeEvents(request, map.id);
	const erase = events.find((e) => e.payloadJsonb.mode === 'erase');
	expect(erase).toBeTruthy();
	expect(erase!.payloadJsonb.textureKey).toBeUndefined(); // an eraser has no material

	// The erase must actually remove painted pixels — the RenderTexture pass
	// with 'erase' blend is the guard; a no-op erase (blend applied outside an
	// isolated target) would leave painted === erased.
	await page.waitForTimeout(600);
	const erased = await canvas.screenshot({
		path: '.gstack/qa-reports/screenshots/freeform-erase.png'
	});
	expect(Buffer.compare(painted, erased)).not.toBe(0);
	expect(errors, errors.join('\n')).toEqual([]);
});
