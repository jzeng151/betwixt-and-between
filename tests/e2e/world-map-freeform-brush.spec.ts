/**
 * WM3 Slice A — freeform brush (paint_stroke) E2E.
 *
 * Drives the REAL UI: Brush tool → Freeform toggle → drag across the Pixi
 * canvas. Asserts the gesture commits a paint_stroke event with the right
 * payload (fill and stamp modes), and — critically for a canvas feature —
 * captures console/page errors during render so a PixiArtLayer rendering bug
 * (BlurFilter feather, per-layer RenderTexture render, sprite scatter, erase
 * blend) fails the test instead of silently producing a blank or broken layer.
 * (F37: earlier drafts used a TilingSprite+mask approach that was abandoned for
 * the RenderTexture render; comments updated to match the shipped mechanism.)
 *
 * Render fidelity (does the fill blend / does the stamp scatter look right) is
 * a human judgment; this test guards the wiring + the no-throw contract.
 */

import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db.js';
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

// F38: poll until the canvas stops changing instead of a fixed sleep. The
// dissolve FX + async Assets.load + RT rebuild settle at variable times, so a
// fixed waitForTimeout is either flaky (too short) or needlessly slow. Returns
// the last (stable) screenshot.
async function waitForCanvasStable(
	page: Page,
	canvas: Locator,
	{
		interval = 120,
		timeout = 8000,
		changedFrom = null
	}: { interval?: number; timeout?: number; changedFrom?: Buffer | null } = {}
): Promise<Buffer> {
	let prev = await canvas.screenshot();
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		await page.waitForTimeout(interval);
		const next = await canvas.screenshot();
		const settled = Buffer.compare(prev, next) === 0;
		// When `changedFrom` is given, "stable" must ALSO mean "no longer equal to
		// the pre-paint frame". A fill stroke kicks off an async Assets.load before
		// the texture rasterizes; on a slow cold-start runner (CI software-GL
		// firefox) the canvas is blank-and-settled for >interval BEFORE that load
		// resolves, so a plain stability check returns the still-blank frame and the
		// "paint changed pixels" assertion fails spuriously. Requiring change-from-
		// baseline waits for the rasterize regardless of how slow the load is.
		const changed = !changedFrom || Buffer.compare(changedFrom, next) !== 0;
		if (settled && changed) return next;
		prev = next;
	}
	return prev;
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
	// BlurFilter feather, per-layer RenderTexture render, erase blend, etc.).
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

	// DIAG (temporary): log build-count / sprite-count / pixel-diff over time so
	// the CI firefox failure is observable. Tells us render-never-happened vs
	// slow-load vs screenshot-buffer-stale.
	const t0 = Date.now();
	await expect
		.poll(
			async () => {
				const diag = await page.evaluate(() => ({
					builds: (window as unknown as { __artBuildCount?: number }).__artBuildCount ?? 0,
					sprites: (window as unknown as { __artLastSprites?: number }).__artLastSprites ?? -1
				}));
				const diff = Buffer.compare(before, await canvas.screenshot());
				// eslint-disable-next-line no-console
				console.log(
					`[diag] t=${Date.now() - t0}ms builds=${diag.builds} sprites=${diag.sprites} pixelDiff=${diff}`
				);
				return diff;
			},
			{ timeout: 25000, intervals: [500, 1000, 1000, 1000, 2000, 2000, 2000, 3000] }
		)
		.not.toBe(0);

	const after = await canvas.screenshot({ path: '.gstack/qa-reports/screenshots/freeform-fill.png' });
	expect(errors, errors.join('\n')).toEqual([]);
	// The fill MUST change the canvas pixels — a blank fill (a texture-stroke
	// that renders nothing) would leave before === after and slip past the
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

	await waitForCanvasStable(page, canvas);
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
	const painted = await waitForCanvasStable(page, canvas);

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
	await waitForCanvasStable(page, canvas);
	const erased = await canvas.screenshot({
		path: '.gstack/qa-reports/screenshots/freeform-erase.png'
	});
	expect(Buffer.compare(painted, erased)).not.toBe(0);
	expect(errors, errors.join('\n')).toEqual([]);
});
