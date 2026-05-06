import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
}

async function seedTwoActStory(request: APIRequestContext) {
	await clearAll(request);
	const a0 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
	).json();
	const a1 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } })
	).json();
	const ellie = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
	).json();
	await request.post('/api/intervals', {
		data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a1.id }
	});
	return { a0, a1, ellie };
}

async function openTimeline(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.click('button[title="Timeline"]');
	const win = page.locator('.window[aria-label="Timeline"]');
	await expect(win).toBeVisible();
	return win;
}

test.describe('Timeline resize', () => {
	test('13 drags including boundaries and cross-act all PATCH 200', async ({ page, request }) => {
		await seedTwoActStory(request);

		const responses: Array<{ status: number; body: string }> = [];
		page.on('response', async (res) => {
			if (res.url().includes('/api/intervals/') && res.request().method() === 'PATCH') {
				responses.push({ status: res.status(), body: await res.text() });
			}
		});

		const win = await openTimeline(page);
		const bar = win.locator('.bar-wrapper').first();
		await expect(bar).toBeVisible();

		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('rows box');
		const xAt = (pos: number) => rowsBox.x + (pos / 2) * rowsBox.width;

		async function drag(side: 'left' | 'right', toX: number) {
			const box = await bar.boundingBox();
			if (!box) throw new Error('bar box');
			const fromX = side === 'left' ? box.x + 2 : box.x + box.width - 2;
			const y = box.y + box.height / 2;
			await page.mouse.move(fromX, y);
			await page.waitForTimeout(20);
			await page.mouse.down();
			await page.mouse.move(toX, y, { steps: 8 });
			await page.waitForTimeout(20);
			await page.mouse.up();
			await page.waitForTimeout(150);
		}

		const series: Array<['left' | 'right', number]> = [
			['right', xAt(1.5)],
			['right', xAt(1.0)],
			['right', xAt(1.99)],
			['left', xAt(0.5)],
			['left', xAt(1.0)],
			['left', xAt(0.01)],
			['right', xAt(1.5)],
			['right', xAt(0.5)],
			['left', xAt(0)],
			['right', xAt(2)],
			['right', xAt(1.0)],
			['right', xAt(1) + 0.3],
			['right', xAt(2) + 500]
		];
		for (const [side, x] of series) await drag(side, x);

		const failures = responses.filter((r) => r.status !== 200);
		expect(failures, `non-200 PATCH responses: ${JSON.stringify(failures)}`).toEqual([]);
		expect(responses.length).toBeGreaterThan(0);
	});

	test('default resize is free-fraction; server stores precise position', async ({
		page,
		request
	}) => {
		const { ellie } = await seedTwoActStory(request);

		const win = await openTimeline(page);
		const bar = win.locator('.bar-wrapper').first();

		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('rows box');

		// Drag right edge to roughly 1/3 of the way through (position ≈ 2/3 of full extent)
		const targetX = rowsBox.x + rowsBox.width * 0.4;
		const box = await bar.boundingBox();
		if (!box) throw new Error('bar box');
		await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(targetX, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		await page.waitForTimeout(200);

		const ints = await (await request.get('/api/intervals')).json();
		const iv = ints.find((i: any) => i.entityId === ellie.id);
		expect(iv).toBeTruthy();
		// Position should be ~0.8 (40% of 2-act story), free-fraction — NOT snapped to 0 or 1
		expect(iv.endPosition).toBeGreaterThan(0.6);
		expect(iv.endPosition).toBeLessThan(1.0);
		// Free-fraction: not equal to any integer act boundary
		expect(Number.isInteger(iv.endPosition)).toBe(false);
	});

	test('Alt held during resize snaps to act boundary when no scenes', async ({ page, request }) => {
		await seedTwoActStory(request);

		const win = await openTimeline(page);
		const bar = win.locator('.bar-wrapper').first();

		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('rows box');
		// Target between act boundaries — without snap this would be ~0.7
		const targetX = rowsBox.x + rowsBox.width * 0.35;

		const box = await bar.boundingBox();
		if (!box) throw new Error('bar box');
		await page.keyboard.down('Alt');
		await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(targetX, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Alt');
		await page.waitForTimeout(200);

		const ints = await (await request.get('/api/intervals')).json();
		const iv = ints[0];
		// With Alt + no scenes, smartSnap rounds to nearest integer act boundary
		expect(iv.endPosition).toBe(1);
	});

	test('Alt held during resize snaps to scene boundary when scenes exist', async ({
		page,
		request
	}) => {
		const { a0, a1, ellie } = await seedTwoActStory(request);
		// Break Act A into 4 scenes via API to set up scene boundaries at 0.25, 0.5, 0.75
		for (let i = 0; i < 4; i++) {
			await request.post('/api/entities', {
				data: { type: 'Scene', name: `Scene ${i}`, parentId: a0.id, position: i }
			});
		}
		// Recompute on the act so scene-anchored intervals get refreshed (no-op here since interval has null scene FKs)

		const win = await openTimeline(page);
		const bar = win.locator('.bar-wrapper').first();

		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('rows box');
		// Target ~0.4 raw — closest scene boundary is 0.5
		const targetX = rowsBox.x + rowsBox.width * 0.2;

		const box = await bar.boundingBox();
		if (!box) throw new Error('bar box');
		await page.keyboard.down('Alt');
		await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(targetX, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Alt');
		await page.waitForTimeout(200);

		const ints = await (await request.get('/api/intervals')).json();
		const iv = ints.find((i: any) => i.entityId === ellie.id);
		// With Alt + 4 scenes in Act A, snap targets are 0, 0.25, 0.5, 0.75, 1
		expect([0, 0.25, 0.5, 0.75, 1]).toContain(iv.endPosition);
	});
});
