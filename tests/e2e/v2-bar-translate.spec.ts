import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

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

test.describe('V2 Bar translation (T5 — drag whole bar to shift temporally)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('drag the bar body shifts the interval without changing duration', async ({
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
		// Ellie spans Act A only — duration 1 act.
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a.id, end_act_id: a.id }
		});

		const win = await openTimeline(page);
		const bar = win.locator('.bar-wrapper').first();
		await expect(bar).toBeVisible();

		// Drag the bar half an act to the right. Original [0, 1); after a
		// 0.5-act shift the bar should land at ~[0.5, 1.5), spanning A and
		// B. Duration is preserved; the START stays in A and the END
		// crosses into B. Avoids pixel-rounding tipping the boundary.
		const rowsBox = await win.locator('.rows').boundingBox();
		const barBox = await bar.boundingBox();
		if (!rowsBox || !barBox) throw new Error('boxes');
		const halfActPx = rowsBox.width / 6;
		const fromX = barBox.x + barBox.width / 2;
		const fromY = barBox.y + barBox.height / 2;

		await page.mouse.move(fromX, fromY);
		await page.mouse.down();
		await page.mouse.move(fromX + halfActPx, fromY, { steps: 8 });
		await page.mouse.up();

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const iv = ints.find((i: any) => i.entityId === ellie.id);
			expect(iv).toBeTruthy();
			// Duration preserved (within pixel-rounding tolerance).
			expect(iv.endPosition - iv.startPosition).toBeCloseTo(1, 2);
			// Bar moved right; start now mid-Act-A, end now mid-Act-B.
			expect(iv.startActId).toBe(a.id);
			expect(iv.endActId).toBe(b.id);
			expect(iv.startPosition).toBeGreaterThan(0.3);
			expect(iv.startPosition).toBeLessThan(0.7);
			expect(iv.endPosition).toBeGreaterThan(1.3);
			expect(iv.endPosition).toBeLessThan(1.7);
		}).toPass({ timeout: 3000 });

		// Touch c to silence unused.
		void c;
	});

	test('translation clamps so the bar does not exit the track', async ({ page, request }) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } });
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a.id, end_act_id: a.id }
		});

		const win = await openTimeline(page);
		const bar = win.locator('.bar-wrapper').first();
		const rowsBox = await win.locator('.rows').boundingBox();
		const barBox = await bar.boundingBox();
		if (!rowsBox || !barBox) throw new Error('boxes');

		// Drag wildly far to the LEFT — should clamp to startPosition = 0.
		const fromX = barBox.x + barBox.width / 2;
		const fromY = barBox.y + barBox.height / 2;
		await page.mouse.move(fromX, fromY);
		await page.mouse.down();
		await page.mouse.move(fromX - rowsBox.width * 2, fromY, { steps: 6 });
		await page.mouse.up();

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const iv = ints.find((i: any) => i.entityId === ellie.id);
			expect(iv.startPosition).toBeCloseTo(0, 5);
			expect(iv.endPosition - iv.startPosition).toBeCloseTo(1, 5);
		}).toPass({ timeout: 3000 });
	});

	test('a small click without movement still selects the interval (does not translate)', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a.id, end_act_id: a.id }
		});

		const win = await openTimeline(page);
		const bar = win.locator('.bar-wrapper').first();
		const barBox = await bar.boundingBox();
		if (!barBox) throw new Error('bar box');
		// Click without dragging.
		await page.mouse.click(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);

		await expect(win.locator('.entity-detail-host')).toBeVisible();
		// Server-side interval is unchanged.
		const ints = await (await request.get('/api/intervals')).json();
		const iv = ints.find((i: any) => i.entityId === ellie.id);
		expect(iv.startActId).toBe(a.id);
		expect(iv.endActId).toBe(a.id);
	});
});
