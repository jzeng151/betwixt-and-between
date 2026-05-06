import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
}

async function openTimeline(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.click('button[title="Timeline"]');
	const win = page.locator('.window[aria-label="Timeline"]');
	await expect(win).toBeVisible();
	return win;
}

test.describe('V2 Scene rename (InlineEdit on scene name in EntityDetail)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking a scene cell opens EntityDetail; renaming persists to server', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Old Name', parentId: a0.id, position: 0 }
			})
		).json();

		const win = await openTimeline(page);
		await win.locator('.scene-cell').first().click();

		// EntityDetail side panel opens; toggle to edit mode
		await win.locator('.entity-detail-host .mode-toggle').click();

		// forceEditing InlineEdit renders the name as an input
		const nameInput = win.locator('.inline-edit-input');
		await expect(nameInput).toBeVisible();
		await nameInput.fill('New Scene Name');
		await nameInput.press('Enter');

		// Toggle back to view mode so entity-detail-title-text is rendered (edit mode shows InlineEdit input)
		await win.locator('.entity-detail-host .mode-toggle').click();
		const title = win.locator('.entity-detail-host .entity-detail-title-text');
		await expect(title).toHaveText('New Scene Name', { timeout: 3000 });

		// And persists to the server
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const scene = ents.find((e: any) => e.id === sc.id);
			expect(scene?.name).toBe('New Scene Name');
		}).toPass({ timeout: 3000 });
	});

	test('renaming to a blank name is rejected and original name is kept', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Keep This Name', parentId: a0.id, position: 0 }
			})
		).json();

		const win = await openTimeline(page);
		await win.locator('.scene-cell').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		const nameInput = win.locator('.inline-edit-input');
		await nameInput.fill('   ');
		await nameInput.press('Enter');

		// Server still has original name
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const scene = ents.find((e: any) => e.id === sc.id);
			expect(scene?.name).toBe('Keep This Name');
		}).toPass({ timeout: 3000 });
	});
});
