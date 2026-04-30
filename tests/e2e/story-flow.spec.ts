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
		await page.goto('/');
	});

	test('create a character in under 30 seconds', async ({ page }) => {
		const start = Date.now();

		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin).toBeVisible();

		const nameInput = listWin.locator('input[placeholder="Character name…"]');
		await expect(nameInput).toBeVisible();
		await nameInput.fill('Elara Voss');
		await nameInput.press('Enter');

		// Creation opens a separate detail window titled with the character's name
		const detailWin = page.locator('.window[aria-label="Elara Voss"]');
		await expect(detailWin.locator('.entity-name')).toContainText('Elara Voss', { timeout: 5000 });

		expect(Date.now() - start).toBeLessThan(30_000);
	});

	test('rename character via InlineEdit pencil → name updates', async ({ page }) => {
		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin).toBeVisible();

		await listWin.locator('input[placeholder="Character name…"]').fill('Original Name');
		await listWin.locator('input[placeholder="Character name…"]').press('Enter');

		// Scope to the char-detail div to stay stable across title changes
		const charDetail = page.locator('.char-detail');
		await expect(charDetail.locator('.entity-name')).toContainText('Original Name', { timeout: 5000 });

		// Block 5: char-detail opens in view mode → toggle to edit. With
		// forceEditing on InlineEdit, the title input renders directly so
		// no pencil click is needed; just type and press Enter, then
		// toggle back to view mode so the title renders as visible text
		// for the assertion.
		await charDetail.locator('.mode-toggle').click();
		await page.locator('.inline-edit-input').fill('Renamed Character');
		await page.locator('.inline-edit-input').press('Enter');
		await charDetail.locator('.mode-toggle').click();

		await expect(charDetail.locator('.entity-name')).toContainText('Renamed Character', { timeout: 3000 });
	});

	test('add event entity → Story Graph no longer shows empty overlay', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Event', name: 'The Battle' } });
		await page.goto('/');

		await page.click('button[title="Story Graph"]');
		await page.waitForTimeout(1000);
		await expect(page.locator('.empty-overlay')).not.toBeVisible();
	});
});
