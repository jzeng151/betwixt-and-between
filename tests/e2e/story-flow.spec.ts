import { test, expect, type APIRequestContext } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearEntities(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	await Promise.all(ents.map((e) => request.delete(`/api/entities/${e.id}`)));
}

test.describe('Story flow', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearEntities(request);
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/app');
	});

	test('create a character in under 30 seconds', async ({ page }) => {
		const start = Date.now();

		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin).toBeVisible();

		// "+ New" creates "New Character" and opens a per-character detail window in edit mode
		await listWin.locator('button.create-btn').click();

		// Window title starts as "New Character"; rename it via the forceEditing InlineEdit
		const newCharWin = page.locator('.window[aria-label="New Character"]');
		await expect(newCharWin).toBeVisible({ timeout: 5000 });
		await page.locator('.inline-edit-input').fill('Elara Voss');
		await page.locator('.inline-edit-input').press('Enter');

		// After rename the window aria-label updates to the new name
		const detailWin = page.locator('.window[aria-label="Elara Voss"]');
		await expect(detailWin).toBeVisible({ timeout: 5000 });
		// Toggle to view mode so entity-name renders as text (edit mode shows an input)
		await detailWin.locator('.mode-toggle').click();
		await expect(detailWin.locator('.entity-name')).toContainText('Elara Voss', { timeout: 5000 });

		expect(Date.now() - start).toBeLessThan(30_000);
	});

	test('rename character via InlineEdit pencil → name updates', async ({ page }) => {
		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin).toBeVisible();

		// "+ New" creates "New Character" and opens the detail window in edit mode
		await listWin.locator('button.create-btn').click();
		const charDetail = page.locator('.char-detail');

		// Window opens in edit mode with forceEditing InlineEdit visible; set initial name
		await page.locator('.inline-edit-input').fill('Original Name');
		await page.locator('.inline-edit-input').press('Enter');

		// Toggle to view mode so the name renders as static text, then assert
		await charDetail.locator('.mode-toggle').click();
		await expect(charDetail.locator('.entity-name')).toContainText('Original Name', { timeout: 5000 });

		// Back to edit mode, rename, toggle back to view, assert update
		await charDetail.locator('.mode-toggle').click();
		await page.locator('.inline-edit-input').fill('Renamed Character');
		await page.locator('.inline-edit-input').press('Enter');
		await charDetail.locator('.mode-toggle').click();

		await expect(charDetail.locator('.entity-name')).toContainText('Renamed Character', { timeout: 3000 });
	});

	test('add event entity → Story Graph no longer shows empty overlay', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Event', name: 'The Battle' } });
		await page.goto('/app');

		await page.click('button[title="Story Graph"]');
		await page.waitForTimeout(1000);
		await expect(page.locator('.empty-overlay')).not.toBeVisible();
	});
});
