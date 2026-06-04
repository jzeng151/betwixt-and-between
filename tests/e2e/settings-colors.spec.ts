/**
 * Settings customization Phase 1 — T6 color-customization E2E (design-review
 * test plan). Setting an entity-type color persists SERVER-side (survives a
 * localStorage clear + reload, proving the round-trip through user_preferences
 * rather than client cache), and the per-swatch reset returns it to default.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function getCharacterColor(request: APIRequestContext): Promise<string | undefined> {
	const body = await (await request.get('/api/preferences')).json();
	return body?.data?.appearance?.entityTypeColors?.Character;
}

async function openSettings(page: import('@playwright/test').Page) {
	await page.click('button[title="Settings"]');
	const win = page.locator('.window[aria-label="Settings"]');
	await expect(win).toBeVisible();
	return win;
}

test('entity-type color customization persists server-side and resets to default', async ({
	page,
	request
}) => {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');

	let win = await openSettings(page);
	const charChip = win.locator('.swatch', { hasText: 'Character' });
	const charInput = charChip.locator('input[type="color"]');
	await expect(charInput).toBeAttached({ timeout: 10000 });

	// Set Character to red via the native color input. `input` fires the live
	// CSS-var preview; `change` (what a real OS picker fires on close) is what
	// commits through applyPreferencePatch (Settings customization Phase 2, F4 —
	// commit-on-release so the map rebuilds once, not per drag frame).
	await charInput.evaluate((el: HTMLInputElement) => {
		el.value = '#ff0000';
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	});
	// Modified dot appears immediately (optimistic).
	await expect(charChip.locator('.swatch-modified')).toBeVisible();

	// Round-trips to the server (debounced PATCH).
	await expect.poll(() => getCharacterColor(request), { timeout: 5000 }).toBe('#ff0000');

	// No-flash SSR (T5b): the client mirrored the palette to a cookie; the
	// server hook inlines it into the served HTML so the next load paints the
	// custom color before hydration.
	const palette = (await page.context().cookies()).find((c) => c.name === 'btw_palette');
	expect(palette).toBeTruthy();
	const ssrHtml = await (
		await request.get('/app', { headers: { cookie: `${palette!.name}=${palette!.value}` } })
	).text();
	expect(ssrHtml).toContain('<style id="palette-ssr">');
	expect(ssrHtml).toContain('--color-type-character:#ff0000');

	// Prove SERVER persistence (not just localStorage cache): clear the cache,
	// reload, and the customization re-hydrates from the server.
	await page.evaluate(() => localStorage.removeItem('btw:preferences'));
	await page.reload();
	win = await openSettings(page);
	await expect(win.locator('.swatch', { hasText: 'Character' }).locator('.swatch-modified')).toBeVisible({
		timeout: 10000
	});

	// Reset the swatch → default restored, server override cleared.
	await win.locator('.swatch', { hasText: 'Character' }).locator('xpath=..').getByRole('button', {
		name: /reset character to default/i
	}).click();
	await expect(
		win.locator('.swatch', { hasText: 'Character' }).locator('.swatch-modified')
	).toHaveCount(0);
	await expect.poll(() => getCharacterColor(request), { timeout: 5000 }).toBeUndefined();
});
