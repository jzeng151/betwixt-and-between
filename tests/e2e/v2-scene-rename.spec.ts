import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
}

async function openTimeline(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/');
	await page.click('button[title="Timeline"]');
	const win = page.locator('.window[aria-label="Timeline"]');
	await expect(win).toBeVisible();
	return win;
}

test.describe('V2 Scene rename (InlineEdit on scene cell label)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking the scene cell label opens InlineEdit and saves on blur', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Old Name', parentId: a0.id, position: 0 }
			})
		).json();

		const win = await openTimeline(page);
		const cell = win.locator(`.scene-cell[data-entity-id="${sc.id}"]`);
		const label = cell.locator('.scene-name');
		await label.click();

		// InlineEdit input appears
		const input = cell.locator('input.inline-edit-input, input.scene-name-input');
		await expect(input.first()).toBeVisible();
		await input.first().fill('New Name');
		await input.first().blur();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			expect(ents.find((e: any) => e.id === sc.id).name).toBe('New Name');
		}).toPass({ timeout: 3000 });
		await expect(cell.locator('.scene-name')).toHaveText('New Name');
	});

	test('Esc cancels the inline rename without persisting', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Original', parentId: a0.id, position: 0 }
			})
		).json();

		const win = await openTimeline(page);
		const cell = win.locator(`.scene-cell[data-entity-id="${sc.id}"]`);
		await cell.locator('.scene-name').click();
		const input = cell.locator('input.inline-edit-input, input.scene-name-input').first();
		await input.fill('Discarded');
		await input.press('Escape');

		const ents = await (await request.get('/api/entities')).json();
		expect(ents.find((e: any) => e.id === sc.id).name).toBe('Original');
	});

	test('Enter commits the rename', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Old', parentId: a0.id, position: 0 }
			})
		).json();

		const win = await openTimeline(page);
		const cell = win.locator(`.scene-cell[data-entity-id="${sc.id}"]`);
		await cell.locator('.scene-name').click();
		const input = cell.locator('input.inline-edit-input, input.scene-name-input').first();
		await input.fill('Renamed');
		await input.press('Enter');

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			expect(ents.find((e: any) => e.id === sc.id).name).toBe('Renamed');
		}).toPass({ timeout: 3000 });
	});
});
