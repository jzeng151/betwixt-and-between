/**
 * Settings customization Phase 2, Item 4 — graph-toggle persistence E2E.
 *
 * The hard-filter (Scrubbing) + ghost-trails toggles are a GLOBAL user default:
 * changing one in a graph window writes it to user_preferences.graph, and every
 * graph window opened afterward hydrates from it. Proves the round-trip through
 * the server (survives reload) and that a freshly-opened window picks it up.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function graphPrefs(request: APIRequestContext) {
	const body = await (await request.get('/api/preferences')).json();
	return body?.data?.graph as { hardFilter?: boolean; showGhostTrails?: boolean } | undefined;
}

async function openStoryGraph(page: Page) {
	await page.click('button[title="Story Graph"]');
	const win = page.locator('.window[aria-label="Story Graph"]').first();
	await expect(win).toBeVisible();
	return win;
}

async function openSettingsPanel(win: ReturnType<Page['locator']>) {
	await win.locator('button[aria-label="Toggle layout settings"]').click();
	const panel = win.locator('.sg-settings');
	await expect(panel).toBeVisible();
	return panel;
}

test('graph toggles persist server-side and hydrate into a freshly-opened graph window', async ({
	page,
	request
}) => {
	await clearAll(request);
	// One entity so the graph renders a node (not strictly required for the
	// settings panel, but keeps the window in its normal rendered state).
	await request.post('/api/entities', { data: { type: 'Character', name: 'Toggle Knight' } });
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');

	const win = await openStoryGraph(page);
	const panel = await openSettingsPanel(win);

	const ghost = panel.locator('.sg-settings-row', { hasText: 'Ghost trails' }).locator('input[type="checkbox"]');
	const scrubbing = panel.locator('.sg-settings-row', { hasText: 'Scrubbing' }).locator('select');

	// Set to the non-default state (ghost on, soft scrubbing). `.check()` /
	// `selectOption` are idempotent, so this is robust to whatever the shared
	// PGlite's prior `graph` prefs happen to be.
	await ghost.check();
	await scrubbing.selectOption('soft');

	// Round-trips to the server (debounced PATCH).
	await expect
		.poll(() => graphPrefs(request), { timeout: 5000 })
		.toEqual({ hardFilter: false, showGhostTrails: true });

	// Clear the localStorage cache + reload so the next graph window MUST hydrate
	// the toggles from the SERVER (not the optimistic client cache). A graph window
	// snapshots prefs at open time (intentional "apply on open"), so wait for the
	// hydrate GET to land + settle before opening the fresh window.
	await page.evaluate(() => localStorage.removeItem('btw:preferences'));
	await Promise.all([
		page.waitForResponse(
			(r) => r.url().includes('/api/preferences') && r.request().method() === 'GET'
		),
		page.reload()
	]);
	await page.waitForTimeout(300);
	const win2 = await openStoryGraph(page);
	const panel2 = await openSettingsPanel(win2);
	await expect(
		panel2.locator('.sg-settings-row', { hasText: 'Ghost trails' }).locator('input[type="checkbox"]')
	).toBeChecked();
	await expect(
		panel2.locator('.sg-settings-row', { hasText: 'Scrubbing' }).locator('select')
	).toHaveValue('soft');
});
