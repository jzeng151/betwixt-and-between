/**
 * WM3 Slice B — layered canvas E2E.
 *
 * Drives the REAL UI: sidebar Layers pane → add an art layer, set its blend
 * mode + opacity (PATCHes world_maps.art_layers_jsonb), pick the layer in the
 * freeform palette, paint — and asserts the committed paint_stroke carries
 * layerId, the layer visibility toggle persists an `art:<id>` pref row, and
 * nothing errors during the per-layer container render.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

type ArtLayer = { id: string; name: string; blendMode: string; opacity: number };

async function getArtLayers(request: APIRequestContext, mapId: string): Promise<ArtLayer[]> {
	const map = (await (await request.get(`/api/maps/${mapId}`)).json()) as {
		artLayersJsonb: ArtLayer[];
	};
	return map.artLayersJsonb;
}

async function seedMapWithImage(request: APIRequestContext) {
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Layered Realm' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Layered Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});
	return map;
}

async function openWorldMap(page: Page) {
	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	await win.locator('button[aria-label="Maximize"]').click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });
	return { win, canvas };
}

test('add a layer, blend+opacity persist, paint targets it, visibility pref persists', async ({
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
	const { win, canvas } = await openWorldMap(page);

	// ── Add an art layer from the sidebar Layers pane. ──
	await win.locator('button[aria-label="Add art layer"]').click();
	await expect(win.locator('[data-testid="art-layer-row"]')).toHaveCount(1);
	await expect.poll(async () => (await getArtLayers(request, map.id)).length).toBe(1);
	let [layer] = await getArtLayers(request, map.id);
	expect(layer.name).toBe('Layer 1');
	expect(layer.blendMode).toBe('normal');
	expect(layer.opacity).toBe(1);

	// ── Blend mode + opacity edits persist through the PATCH. ──
	await win
		.locator(`select[aria-label="Blend mode for ${layer.name}"]`)
		.selectOption('multiply');
	await expect.poll(async () => (await getArtLayers(request, map.id))[0].blendMode).toBe(
		'multiply'
	);
	await win
		.locator(`input[aria-label="Opacity for ${layer.name}"]`)
		.fill('0.6');
	await expect.poll(async () => (await getArtLayers(request, map.id))[0].opacity).toBe(0.6);
	[layer] = await getArtLayers(request, map.id);

	// ── Paint a stroke targeting the layer. ──
	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Brush' }).click();
	await win.locator('.brush-mode-toggle button', { hasText: 'Freeform' }).click();
	const palette = win.locator('[data-testid="freeform-brush-palette"]');
	await expect(palette).toBeVisible();
	await palette.locator('.layer-select select').selectOption(layer.id);

	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');
	const startX = box.x + box.width * 0.25;
	const y = box.y + box.height * 0.5;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(startX + box.width * 0.2, y + 30, { steps: 10 });
	await page.mouse.up();

	await expect
		.poll(
			async () => {
				const { rows } = (await (await request.get(`/api/maps/${map.id}/events`)).json()) as {
					rows: Array<{ kind: string; payloadJsonb: { layerId?: string } }>;
				};
				return rows.find((r) => r.kind === 'paint_stroke')?.payloadJsonb.layerId ?? null;
			},
			{ timeout: 8000 }
		)
		.toBe(layer.id);

	// ── Visibility toggle persists an `art:<id>` pref row. ──
	await win.locator(`input[aria-label="Show ${layer.name}"]`).click();
	await expect
		.poll(async () => {
			const rows = (await (
				await request.get(`/api/world-map-layer-prefs?worldMapId=${map.id}`)
			).json()) as Array<{ layerKey: string; visible: number }>;
			return rows.find((r) => r.layerKey === `art:${layer.id}`)?.visible ?? null;
		})
		.toBe(0);

	// Let the per-layer container rebuild settle, then assert a clean console.
	await page.waitForTimeout(500);
	expect(errors, errors.join('\n')).toEqual([]);
});

test('deleting a layer keeps orphaned strokes visible (base fallback) without errors', async ({
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
	// Seed a layer + a stroke on it via the API (UI flow covered above).
	const layerId = crypto.randomUUID();
	await request.patch(`/api/maps/${map.id}`, {
		data: {
			artLayersJsonb: [{ id: layerId, name: 'Doomed', blendMode: 'normal', opacity: 1 }]
		}
	});
	await request.post(`/api/maps/${map.id}/events`, {
		data: {
			tPosition: 0,
			kind: 'paint_stroke',
			payloadJsonb: {
				path: [
					{ x: 0.3, y: 0.3 },
					{ x: 0.6, y: 0.6 }
				],
				brushSize: 0.08,
				softness: 0.3,
				mode: 'fill',
				textureKey: 'Grass',
				layerId
			}
		}
	});

	const { win, canvas } = await openWorldMap(page);
	await expect(win.locator('[data-testid="art-layer-row"]')).toHaveCount(1);
	// Painted canvas baseline (stroke on the layer).
	await page.waitForTimeout(600);
	const withLayer = await canvas.screenshot();

	// Delete the layer — the stroke's layerId now dangles; render must fall
	// back to the base group and keep the art visible (lazy GC), not blank it.
	// F15 added a confirm modal to the ✕; acknowledge it (this spec predated
	// the modal and was never updated — caught by the 2026-06 audit E2E run).
	await win.locator('button[aria-label="Delete Doomed"]').click();
	const confirmModal = page.locator('.modal-overlay', {
		has: page.getByRole('heading', { name: /Delete layer/ })
	});
	await confirmModal.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect.poll(async () => (await getArtLayers(request, map.id)).length).toBe(0);
	await page.waitForTimeout(600);
	const withoutLayer = await canvas.screenshot();

	// The stroke must still be painted: deleting the layer changes grouping,
	// not content — so the canvas stays materially the same, and definitely
	// does not throw.
	expect(Buffer.compare(withLayer, withoutLayer)).toBe(0);
	expect(errors, errors.join('\n')).toEqual([]);
});
