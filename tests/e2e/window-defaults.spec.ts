/**
 * Settings customization Phase 2, Item 3 — "set current as default" window
 * geometry E2E.
 *
 *   - Single-instance app (Settings): SIZE + POSITION persist; reopening
 *     restores both.
 *   - Multi-instance app (Story Graph): only SIZE persists (position keeps the
 *     open-stagger so instances don't stack) — asserted server-side.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db';

// Large viewport so the moved/resized window stays fully on-screen (clamp-on-open
// would otherwise shift it and break the exact-geometry assertion).
test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1400, height: 1000 } });

async function windowsPrefs(request: APIRequestContext) {
	const body = await (await request.get('/api/preferences')).json();
	return body?.data?.windows?.defaults as
		| Record<string, { width: number; height: number; x?: number; y?: number }>
		| undefined;
}

async function dragResizeBR(page: Page, win: ReturnType<Page['locator']>, dx: number, dy: number) {
	const box = await win.boundingBox();
	if (!box) throw new Error('no window box');
	// Bottom-right corner handle.
	await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width + dx, box.y + box.height + dy, { steps: 12 });
	await page.mouse.up();
}

async function dragTitlebar(page: Page, win: ReturnType<Page['locator']>, dx: number, dy: number) {
	const tb = await win.locator('.titlebar').boundingBox();
	if (!tb) throw new Error('no titlebar box');
	await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
	await page.mouse.down();
	await page.mouse.move(tb.x + tb.width / 2 + dx, tb.y + tb.height / 2 + dy, { steps: 10 });
	await page.mouse.up();
}

test('single-instance window restores saved size + position on reopen', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');

	await page.click('button[title="Settings"]');
	const win = page.locator('.window[aria-label="Settings"]');
	await expect(win).toBeVisible();

	// Resize bigger, then move to a known on-screen spot.
	await dragResizeBR(page, win, 120, 90);
	await dragTitlebar(page, win, 160, 120);

	const customized = await win.boundingBox();
	if (!customized) throw new Error('no customized box');

	// Persist current geometry as the default for this app.
	await win.locator('button[aria-label="Set current size and position as default"]').click();

	// Server carries size + position for the single-instance app.
	await expect
		.poll(async () => (await windowsPrefs(request))?.settings, { timeout: 5000 })
		.toMatchObject({
			width: Math.round(customized.width),
			height: Math.round(customized.height)
		});
	const saved = (await windowsPrefs(request))!.settings;
	expect(saved.x).toBeGreaterThanOrEqual(0);
	expect(saved.y).toBeGreaterThanOrEqual(0);

	// Close and reopen → geometry restored from the saved default.
	await win.locator('button[aria-label="Close"]').click();
	await expect(win).toHaveCount(0);
	await page.click('button[title="Settings"]');
	await expect(win).toBeVisible();

	const reopened = await win.boundingBox();
	if (!reopened) throw new Error('no reopened box');
	expect(reopened.width).toBeCloseTo(customized.width, -1);
	expect(reopened.height).toBeCloseTo(customized.height, -1);
	expect(reopened.x).toBeCloseTo(customized.x, -1);
	expect(reopened.y).toBeCloseTo(customized.y, -1);
});

test('multi-instance window persists size only, never position', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');

	await page.click('button[title="Story Graph"]');
	const win = page.locator('.window[aria-label="Story Graph"]').first();
	await expect(win).toBeVisible();

	await dragResizeBR(page, win, 140, 100);
	await dragTitlebar(page, win, 150, 110);
	await win.locator('button[aria-label="Set current size and position as default"]').click();

	await expect
		.poll(async () => (await windowsPrefs(request))?.['story-graph'] ?? null, { timeout: 5000 })
		.not.toBeNull();
	const saved = (await windowsPrefs(request))!['story-graph'];

	expect(saved.width).toBeGreaterThan(0);
	expect(saved.height).toBeGreaterThan(0);
	// Multi-instance: position is NOT persisted (stagger preserved).
	expect(saved.x).toBeUndefined();
	expect(saved.y).toBeUndefined();
});
