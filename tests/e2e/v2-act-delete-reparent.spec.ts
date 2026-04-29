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

test.describe('V2 Delete-act with scene reparent (D9 / 7B)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('confirm dialog grows a "Move scenes to" picker when the act has scenes', async ({
		page,
		request
	}) => {
		const aA = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } });
		await request.post('/api/entities', {
			data: { type: 'Scene', name: 'S1', parentId: aA.id, position: 0 }
		});
		await request.post('/api/entities', {
			data: { type: 'Scene', name: 'S2', parentId: aA.id, position: 1 }
		});

		const win = await openTimeline(page);
		await win.locator('button.act-delete-btn[aria-label="Delete A"]').click();

		const confirm = win.locator('.delete-confirm');
		await expect(confirm).toBeVisible();
		await expect(confirm).toContainText(/Move scenes to/i);
		await expect(confirm.locator('select.move-scenes-target, .move-scenes-picker')).toBeVisible();
	});

	test('picking a target act and confirming reparents scenes (parent_id flips, positions appended)', async ({
		page,
		request
	}) => {
		const aA = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const aB = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		await request.post('/api/entities', {
			data: { type: 'Scene', name: 'S1', parentId: aA.id, position: 0 }
		});
		await request.post('/api/entities', {
			data: { type: 'Scene', name: 'S2', parentId: aA.id, position: 1 }
		});
		await request.post('/api/entities', {
			data: { type: 'Scene', name: 'B0', parentId: aB.id, position: 0 }
		});

		const win = await openTimeline(page);
		await win.locator('button.act-delete-btn[aria-label="Delete A"]').click();
		const confirm = win.locator('.delete-confirm');
		await confirm
			.locator('select.move-scenes-target, .move-scenes-picker')
			.first()
			.selectOption(aB.id)
			.catch(async () => {
				// If picker is radio-style, fall back
				await confirm.locator(`[data-target-act-id="${aB.id}"]`).click();
			});
		await confirm.locator('button.btn-danger').click();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			expect(ents.find((e: any) => e.id === aA.id)).toBeFalsy();
			const scenes = ents
				.filter((e: any) => e.type === 'Scene')
				.sort((x: any, y: any) => x.position - y.position);
			// All 3 scenes now under aB, positions 0,1,2 with S1/S2 appended after B0
			expect(scenes).toHaveLength(3);
			expect(scenes.every((s: any) => s.parentId === aB.id)).toBe(true);
			expect(scenes.map((s: any) => s.position)).toEqual([0, 1, 2]);
		}).toPass({ timeout: 3000 });
	});

	test('intervals anchored to a reparented scene get start/end_act_id updated to the target act', async ({
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
				data: { type: 'Scene', name: 'S1', parentId: aA.id, position: 0 }
			})
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
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
		await win.locator('button.act-delete-btn[aria-label="Delete A"]').click();
		const confirm = win.locator('.delete-confirm');
		await confirm
			.locator('select.move-scenes-target, .move-scenes-picker')
			.first()
			.selectOption(aB.id)
			.catch(async () => {
				await confirm.locator(`[data-target-act-id="${aB.id}"]`).click();
			});
		await confirm.locator('button.btn-danger').click();

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const iv = ints.find((i: any) => i.entityId === ellie.id);
			expect(iv).toBeTruthy();
			expect(iv.startActId).toBe(aB.id);
			expect(iv.endActId).toBe(aB.id);
		}).toPass({ timeout: 3000 });
	});
});
