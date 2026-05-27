/**
 * Δ1b-C — renderer-toggle WebGL stress test (T11).
 *
 * Toggle Leaflet ↔ Pixi 20× and assert no WebGL warnings escape to the
 * console. Browsers cap active WebGL contexts at ~16; a single leaked
 * context per cycle hits the cap after a dozen toggles and Pixi starts
 * refusing to initialize. PixiStage's imperative destroy({context:true})
 * (Slice 1b PR 2 commit 2) is the protection — this test pins the
 * regression class.
 *
 * Console-warning patterns to fail on:
 *   - "WebGL warning"
 *   - "Too many active WebGL contexts"
 *   - "WEBGL_lose_context"
 *   - Any Pixi "renderer init" failure
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

test('renderer toggles 20× without WebGL warnings or errors', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	// Capture console messages so the assertion runs against the full
	// session, not just the moment of toggle. WebGL warnings can fire
	// asynchronously after a context is created.
	const warnings: string[] = [];
	const errors: string[] = [];
	page.on('console', (msg) => {
		const text = msg.text();
		if (msg.type() === 'warning' || /webgl|pixi|renderer init/i.test(text)) {
			warnings.push(`${msg.type()}: ${text}`);
		}
		if (msg.type() === 'error') {
			errors.push(text);
		}
	});

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();

	// Need an active map for the RendererToggle to mount.
	await win.locator('.empty-state button.btn-primary').click();
	await expect(win.locator('.renderer-toggle')).toBeVisible();

	const leafletPill = win.locator('.renderer-pill', { hasText: 'Leaflet' });
	const pixiPill = win.locator('.renderer-pill', { hasText: 'Pixi' });

	// 20 toggle cycles. Each cycle: Leaflet → Pixi → Leaflet (2 swaps).
	// Picked 20 cycles (40 swaps) to exceed the browser's typical 16-context
	// WebGL cap by a comfortable margin.
	for (let i = 0; i < 20; i++) {
		await pixiPill.click();
		await expect(pixiPill).toHaveAttribute('aria-pressed', 'true');
		// Wait for Pixi canvas to mount before swapping away — racing the
		// async init with the next swap is what the original svelte-pixi
		// implementation was leaking on.
		await win.locator('.pixi-stage canvas').waitFor({ state: 'attached', timeout: 5000 });

		await leafletPill.click();
		await expect(leafletPill).toHaveAttribute('aria-pressed', 'true');
	}

	// Filter to lines that legitimately indicate a problem. PIXI logs a
	// banner on startup ("PixiJS v8.x.y ..."); not a warning.
	const realWarnings = warnings.filter(
		(w) =>
			/too many active WebGL/i.test(w) ||
			/webgl_lose_context/i.test(w) ||
			/renderer init failed/i.test(w) ||
			/context lost/i.test(w)
	);
	expect(realWarnings, `unexpected warnings:\n${realWarnings.join('\n')}`).toEqual([]);

	const realErrors = errors.filter(
		(e) =>
			// SvelteKit / browser noise to ignore. PIXI init failures or
			// pixi.js stack traces are real.
			!/^Failed to load resource/i.test(e) &&
			!/sourcemap/i.test(e)
	);
	expect(realErrors, `unexpected errors:\n${realErrors.join('\n')}`).toEqual([]);
});
