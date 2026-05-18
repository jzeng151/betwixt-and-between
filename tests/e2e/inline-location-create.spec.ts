/**
 * Regression test for the chicken-and-egg fix shipped 2026-05-18 (T2):
 *   - Empty DB → open WorldMap → create a map → no Locations exist yet
 *   - Click "+ New Location" next to the toolbar picker
 *   - Type a name + Enter
 *   - Picker now reflects the new Location and the map is linked
 *
 * Before this fix, the picker could only link to pre-existing Locations,
 * but no UI surface created Locations — the user got stuck.
 *
 * The region-form variant (T3) shares the same createEntity + state-set
 * wiring; covered by inspection.
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

test.describe('Inline + New Location', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearAll(request);
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/app');
	});

	test('toolbar + button creates a Location and links the active map to it', async ({
		page,
		request
	}) => {
		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await expect(win).toBeVisible();

		// Empty state: no maps. Click "Create your first map".
		await win.locator('.empty-state button.btn-primary').click();

		// Toolbar should now show the linked-location picker with `(no linked
		// location)` selected, and a `+` button next to it.
		const picker = win.locator('select.map-location-picker');
		await expect(picker).toBeVisible();
		await expect(picker).toHaveValue('');

		// Click the + new-location button (the one in the toolbar near the picker).
		await win.locator('button[aria-label="New location"]').first().click();

		// Inline name input takes over the picker slot.
		const nameInput = win.locator('input[aria-label="Name of new location"]');
		await expect(nameInput).toBeVisible();
		await nameInput.fill('Ashenveil');
		await nameInput.press('Enter');

		// Picker is back, now showing Ashenveil as the linked location.
		await expect(picker).toBeVisible();
		const linkedOption = picker.locator('option[selected]');
		await expect(picker).toHaveValue(/.+/); // non-empty UUID

		// Verify against the API: a Location was created and the map links to it.
		const ents: Array<{ id: string; type: string; name: string }> = await (
			await request.get('/api/entities')
		).json();
		const locs = ents.filter((e) => e.type === 'Location');
		expect(locs).toHaveLength(1);
		expect(locs[0].name).toBe('Ashenveil');

		const maps: Array<{ id: string; locationId: string | null }> = await (
			await request.get('/api/maps')
		).json();
		expect(maps).toHaveLength(1);
		expect(maps[0].locationId).toBe(locs[0].id);
	});

	test('Escape cancels the inline input without creating anything', async ({
		page,
		request
	}) => {
		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await win.locator('.empty-state button.btn-primary').click();
		await win.locator('button[aria-label="New location"]').first().click();

		const nameInput = win.locator('input[aria-label="Name of new location"]');
		await nameInput.fill('Discarded');
		await nameInput.press('Escape');

		// Picker comes back; no Location was created.
		await expect(win.locator('select.map-location-picker')).toBeVisible();
		const ents: Array<{ type: string }> = await (await request.get('/api/entities')).json();
		expect(ents.filter((e) => e.type === 'Location')).toHaveLength(0);
	});

	test('Blank name commits as cancel (no Location created)', async ({ page, request }) => {
		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await win.locator('.empty-state button.btn-primary').click();
		await win.locator('button[aria-label="New location"]').first().click();

		const nameInput = win.locator('input[aria-label="Name of new location"]');
		// Submit empty (blur via Enter).
		await nameInput.press('Enter');

		await expect(win.locator('select.map-location-picker')).toBeVisible();
		const ents: Array<{ type: string }> = await (await request.get('/api/entities')).json();
		expect(ents.filter((e) => e.type === 'Location')).toHaveLength(0);
	});
});
