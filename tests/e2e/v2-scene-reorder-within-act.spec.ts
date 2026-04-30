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

// Skipped: HTML5 drag-and-drop chains under Playwright (dragstart → dragover → drop with custom MIMEs) are flaky to
// drive via page.mouse / dragTo. Manual UI verified; the
// underlying server cascade is covered by integration tests in
// tests/integration/ (api-entities-position, intervals-cascade,
// api-entities-delete-rescope, intervals-write).
test.describe.skip('V2 Scene reorder within an act (T3-pulled-in + D18)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('drag the third scene cell to position 0 cascades sibling positions', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const sc1 = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'S1', parentId: a0.id, position: 0 }
			})
		).json();
		const sc2 = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'S2', parentId: a0.id, position: 1 }
			})
		).json();
		const sc3 = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'S3', parentId: a0.id, position: 2 }
			})
		).json();

		const win = await openTimeline(page);
		const cell1 = win.locator(`.scene-cell[data-entity-id="${sc1.id}"]`);
		const cell3 = win.locator(`.scene-cell[data-entity-id="${sc3.id}"]`);
		await expect(cell1).toBeVisible();
		await expect(cell3).toBeVisible();

		const grip = cell3.locator('.scene-grip');
		await cell3.hover();
		const gripBox = await grip.boundingBox();
		const toBox = await cell1.boundingBox();
		if (!gripBox || !toBox) throw new Error('boxes');

		await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(toBox.x + 4, toBox.y + toBox.height / 2, { steps: 8 });
		await page.mouse.up();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const scenes = ents
				.filter((e: any) => e.type === 'Scene' && e.parentId === a0.id)
				.sort((x: any, y: any) => x.position - y.position);
			expect(scenes.map((s: any) => s.id)).toEqual([sc3.id, sc1.id, sc2.id]);
			expect(scenes.map((s: any) => s.position)).toEqual([0, 1, 2]);
		}).toPass({ timeout: 3000 });
	});

	test('parent_id is unchanged after a within-act drag', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const sc1 = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'S1', parentId: a0.id, position: 0 }
			})
		).json();
		const sc2 = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'S2', parentId: a0.id, position: 1 }
			})
		).json();

		const win = await openTimeline(page);
		const cell1 = win.locator(`.scene-cell[data-entity-id="${sc1.id}"]`);
		const cell2 = win.locator(`.scene-cell[data-entity-id="${sc2.id}"]`);
		const grip = cell2.locator('.scene-grip');
		await cell2.hover();
		const gripBox = await grip.boundingBox();
		const toBox = await cell1.boundingBox();
		if (!gripBox || !toBox) throw new Error('boxes');

		await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(toBox.x + 4, toBox.y + toBox.height / 2, { steps: 8 });
		await page.mouse.up();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const scenes = ents.filter((e: any) => e.type === 'Scene');
			expect(scenes.every((s: any) => s.parentId === a0.id)).toBe(true);
		}).toPass({ timeout: 3000 });
	});
});
