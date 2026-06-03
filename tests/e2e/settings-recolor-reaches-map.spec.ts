/**
 * Settings customization Phase 2, Item 1 — the unify acceptance test: recoloring
 * an entity TYPE in Settings reaches the world map.
 *
 * The map is Pixi/canvas (no reliable pixel read), so we assert the DOM-observable
 * proxies that prove the resolved palette reached BOTH render paths:
 *   1. the `--color-type-artifact` CSS var on :root (the DOM consumers — graph/
 *      wiki/timeline — read this), and
 *   2. the map marker popover's StyleEditor "inherited" placeholder, which is
 *      `resolveStyle(placeable, resolvedTypeHex).color` — the same cascade the
 *      sprite tint uses. An Artifact (no character cycle) resolves straight to
 *      the type palette, so the placeholder == the Settings-set hex.
 *
 * Verified through a reload, so it proves the server round-trip, not just the
 * optimistic store.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1400, height: 1000 } });

const NEW_HEX = '#123456';

async function artifactPaletteColor(request: APIRequestContext): Promise<string | undefined> {
	const body = await (await request.get('/api/preferences')).json();
	return body?.data?.appearance?.entityTypeColors?.Artifact;
}

test('recoloring the Artifact type in Settings reaches the map cascade', async ({ page, request }) => {
	await clearAll(request);
	const loc = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Palette Realm' } })
	).json();
	const relic = await (
		await request.post('/api/entities', { data: { type: 'Artifact', name: 'Relic' } })
	).json();
	const map = await (await request.post('/api/maps', { data: { name: 'Palette Map' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});
	await request.post('/api/map-placements', {
		data: { placeableId: relic.id, locationId: loc.id, mapId: map.id, x: 0.5, y: 0.5 }
	});

	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');

	// Recolor the Artifact type in Settings (native input: input previews, change commits — F4).
	await page.click('button[title="Settings"]');
	const settings = page.locator('.window[aria-label="Settings"]');
	await expect(settings).toBeVisible();
	const artifactInput = settings
		.locator('.swatch', { hasText: 'Artifact' })
		.locator('input[type="color"]');
	await expect(artifactInput).toBeAttached({ timeout: 10000 });
	await artifactInput.evaluate((el: HTMLInputElement, hex) => {
		el.value = hex;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}, NEW_HEX);

	// DOM consumers: the :root CSS var updated immediately (graph/wiki/timeline
	// pick this up for free).
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					getComputedStyle(document.documentElement).getPropertyValue('--color-type-artifact').trim()
				),
			{ timeout: 5000 }
		)
		.toBe(NEW_HEX);

	// Persisted server-side.
	await expect.poll(() => artifactPaletteColor(request), { timeout: 5000 }).toBe(NEW_HEX);

	// Reload — prove it re-hydrates from the server, then open the map.
	await page.reload();
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

	// The StyleEditor "inherited" placeholder IS resolveStyle(..., resolvedTypeHex).color
	// for the Artifact with no override — the same cascade the sprite tint uses.
	await expect(popover.locator('input.hex-input')).toHaveAttribute('placeholder', NEW_HEX);
});
