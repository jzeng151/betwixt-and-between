import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { html5Drag } from './helpers/html5-drag.js';

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

test.describe('V2 Scene reorder within an act (T3-pulled-in + D18)', () => {
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
		const cell3 = win.locator(`.scene-cell[data-entity-id="${sc3.id}"]`);
		const scenesAct = win.locator(`.scenes-act[data-act-id="${a0.id}"]`);
		await expect(cell3).toBeVisible();

		// Drop near the LEFT edge of scenes-act so sceneActDragOver
		// computes idx=0 and the dragged scene lands first.
		const sBox = await scenesAct.boundingBox();
		if (!sBox) throw new Error('scenes-act box');
		await html5Drag(page, cell3, {
			element: scenesAct,
			x: sBox.x + 4,
			y: sBox.y + sBox.height / 2
		});

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
		const cell2 = win.locator(`.scene-cell[data-entity-id="${sc2.id}"]`);
		const scenesAct = win.locator(`.scenes-act[data-act-id="${a0.id}"]`);
		const sBox = await scenesAct.boundingBox();
		if (!sBox) throw new Error('scenes-act box');
		await html5Drag(page, cell2, {
			element: scenesAct,
			x: sBox.x + 4,
			y: sBox.y + sBox.height / 2
		});

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const scenes = ents.filter((e: any) => e.type === 'Scene');
			expect(scenes.every((s: any) => s.parentId === a0.id)).toBe(true);
		}).toPass({ timeout: 3000 });
		// silence unused lint
		void sc1;
	});
});
