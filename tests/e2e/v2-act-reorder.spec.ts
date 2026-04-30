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

test.describe('V2 Act drag-reorder (D18 / 12A)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('hovering an act header reveals the ⋮⋮ grip', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } });
		await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } });

		const win = await openTimeline(page);
		const header = win.locator('.act-col-header').first();
		await header.hover();
		const grip = header.locator('.act-grip');
		await expect(grip).toBeVisible();
		// CSS opacity is 0.7 on hover, 1 on grip:hover. Either way it's painted.
		const opacity = await grip.evaluate((el) => Number(getComputedStyle(el).opacity));
		expect(opacity).toBeGreaterThan(0);
	});

	test('drag Act C to position 0 cascades sibling positions', async ({ page, request }) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const c = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'C', position: 2 } })
		).json();

		const win = await openTimeline(page);
		const headerA = win.locator(`.act-col-header[data-entity-id="${a.id}"]`);
		const headerC = win.locator(`.act-col-header[data-entity-id="${c.id}"]`);
		await headerC.hover();

		// Drop on the LEFT half of header A so the act-drop-left branch
		// triggers and C ends up at index 0.
		const aBox = await headerA.boundingBox();
		if (!aBox) throw new Error('headerA box');
		await html5Drag(page, headerC.locator('.act-grip'), {
			element: headerA,
			x: aBox.x + aBox.width * 0.2,
			y: aBox.y + aBox.height / 2
		});

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const acts = ents
				.filter((e: any) => e.type === 'Act')
				.sort((x: any, y: any) => x.position - y.position);
			expect(acts.map((x: any) => x.id)).toEqual([c.id, a.id, b.id]);
			expect(acts.map((x: any) => x.position)).toEqual([0, 1, 2]);
		}).toPass({ timeout: 3000 });
	});

	test('intervals recompute after reorder so they still anchor correctly', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const c = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'C', position: 2 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		// Ellie present only in Act B
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: b.id, end_act_id: b.id }
		});

		const win = await openTimeline(page);
		const headerA = win.locator(`.act-col-header[data-entity-id="${a.id}"]`);
		const headerC = win.locator(`.act-col-header[data-entity-id="${c.id}"]`);
		await headerC.hover();
		const aBox = await headerA.boundingBox();
		if (!aBox) throw new Error('headerA box');
		await html5Drag(page, headerC.locator('.act-grip'), {
			element: headerA,
			x: aBox.x + aBox.width * 0.2,
			y: aBox.y + aBox.height / 2
		});

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const iv = ints.find((i: any) => i.entityId === ellie.id);
			// Interval still anchored to Act B (B's act_index shifted from 1 → 2).
			expect(iv.startActId).toBe(b.id);
			expect(iv.endActId).toBe(b.id);
			expect(iv.startPosition).toBeCloseTo(2, 9);
			expect(iv.endPosition).toBeCloseTo(3, 9);
		}).toPass({ timeout: 3000 });
	});

	test('PATCH failure rolls UI state back to pre-drag positions', async ({ page, request }) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const c = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'C', position: 2 } })
		).json();

		const win = await openTimeline(page);

		await page.route(`**/api/entities/${c.id}`, async (route) => {
			if (route.request().method() === 'PATCH') {
				const body = route.request().postDataJSON();
				if (body && body.position !== undefined) {
					await route.fulfill({ status: 500, body: 'reorder-failed' });
					return;
				}
			}
			await route.continue();
		});

		const headerA = win.locator(`.act-col-header[data-entity-id="${a.id}"]`);
		const headerC = win.locator(`.act-col-header[data-entity-id="${c.id}"]`);
		await headerC.hover();
		const aBox = await headerA.boundingBox();
		if (!aBox) throw new Error('headerA box');
		await html5Drag(page, headerC.locator('.act-grip'), {
			element: headerA,
			x: aBox.x + aBox.width * 0.2,
			y: aBox.y + aBox.height / 2
		});

		// Server still has [a, b, c]; the failed PATCH triggered store load() to roll back.
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const acts = ents
				.filter((e: any) => e.type === 'Act')
				.sort((x: any, y: any) => x.position - y.position);
			expect(acts.map((x: any) => x.id)).toEqual([a.id, b.id, c.id]);
			expect(acts.map((x: any) => x.position)).toEqual([0, 1, 2]);
		}).toPass({ timeout: 3000 });
	});
});
