/**
 * Settings customization Phase 3 — workspace profiles switcher E2E (D1).
 *
 * Proves the full round-trip: create a profile (copies the active blob +
 * activates it), edit a color in the new profile, switch back to Default, and
 * confirm the edit did NOT bleed across profiles (per-profile isolation through
 * the server, not just local state).
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

async function setCharacter(win: import('@playwright/test').Locator, hex: string) {
	const input = win.locator('.swatch', { hasText: 'Character' }).locator('input[type="color"]');
	await expect(input).toBeAttached({ timeout: 10000 });
	await input.evaluate((el: HTMLInputElement, value: string) => {
		el.value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}, hex);
}

test('profiles isolate appearance and switch persists server-side', async ({ page, request }) => {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');

	const win = await openSettings(page);

	// Default profile: set Character red, confirm it reaches the server.
	await setCharacter(win, '#ff0000');
	await expect.poll(() => getCharacterColor(request), { timeout: 5000 }).toBe('#ff0000');

	// Create a new profile (copies the active blob → also red, then becomes active).
	await win.getByRole('button', { name: 'Profiles' }).click();
	await win.getByPlaceholder('New profile name').fill('Revision');
	await win.getByRole('button', { name: 'New profile' }).click();
	await expect(win.locator('.profile-row.active')).toContainText('Revision', { timeout: 10000 });

	// Edit Character to blue in the new profile.
	await win.getByRole('button', { name: 'Appearance' }).click();
	await expect(win.locator('.active-profile-line')).toContainText('Revision');
	await setCharacter(win, '#0000ff');
	await expect.poll(() => getCharacterColor(request), { timeout: 5000 }).toBe('#0000ff');

	// Switch back to Default — its Character is still red (isolation).
	await win.getByRole('button', { name: 'Profiles' }).click();
	await win
		.locator('.profile-row', { hasText: 'Default' })
		.getByRole('button', { name: /Default/ })
		.click();
	await expect.poll(() => getCharacterColor(request), { timeout: 5000 }).toBe('#ff0000');

	// Reload + clear local cache → the active profile (Default, red) re-hydrates
	// from the server, proving the switch persisted server-side.
	await page.evaluate(() => localStorage.removeItem('btw:preferences'));
	await page.reload();
	await expect.poll(() => getCharacterColor(request), { timeout: 5000 }).toBe('#ff0000');
});
