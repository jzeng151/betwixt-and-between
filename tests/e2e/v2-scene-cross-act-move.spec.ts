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

test.describe('V2 Scene cross-act move (T3-pulled-in + moveSceneToAct)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('drag a scene from Act A scenes-row to Act B scenes-row updates parent_id', async ({
		page,
		request
	}) => {
		const aA = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const aB = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Scene1', parentId: aA.id, position: 0 }
			})
		).json();

		const win = await openTimeline(page);
		const cell = win.locator(`.scene-cell[data-entity-id="${sc.id}"]`);
		const dropZoneB = win.locator(`.scenes-row-dropzone[data-act-id="${aB.id}"]`);

		await cell.hover();
		const grip = cell.locator('.scene-grip');
		const gripBox = await grip.boundingBox();
		const toBox = await dropZoneB.boundingBox();
		if (!gripBox || !toBox) throw new Error('boxes');

		await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 10 });
		await page.mouse.up();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const moved = ents.find((e: any) => e.id === sc.id);
			expect(moved.parentId).toBe(aB.id);
			expect(moved.position).toBe(0);
		}).toPass({ timeout: 3000 });
	});

	test('intervals anchored to a moved scene get start/end_act_id updated', async ({
		page,
		request
	}) => {
		const aA = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const aB = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Scene1', parentId: aA.id, position: 0 }
			})
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		// Anchor an interval to scene `sc` — start_scene_id and end_scene_id reference it
		await request.post('/api/intervals', {
			data: {
				entity_id: ellie.id,
				start_act_id: aA.id,
				start_scene_id: sc.id,
				end_act_id: aA.id,
				end_scene_id: sc.id
			}
		});

		const win = await openTimeline(page);
		const cell = win.locator(`.scene-cell[data-entity-id="${sc.id}"]`);
		const dropZoneB = win.locator(`.scenes-row-dropzone[data-act-id="${aB.id}"]`);

		await cell.hover();
		const grip = cell.locator('.scene-grip');
		const gripBox = await grip.boundingBox();
		const toBox = await dropZoneB.boundingBox();
		if (!gripBox || !toBox) throw new Error('boxes');

		await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 10 });
		await page.mouse.up();

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const iv = ints.find((i: any) => i.entityId === ellie.id);
			// Per D9 P2-3: interval anchored to the moved scene should have its
			// act FKs updated to the new parent act.
			expect(iv.startActId).toBe(aB.id);
			expect(iv.endActId).toBe(aB.id);
		}).toPass({ timeout: 3000 });
	});
});
