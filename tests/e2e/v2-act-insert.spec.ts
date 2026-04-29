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

test.describe('V2 Act insert-between (D6 / 5A)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('hover between two act headers reveals + button; click opens inline name input', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } });

		const win = await openTimeline(page);

		// Hover the gap between the two headers; the + reveal target lives there
		const insertSlot = win.locator('.act-insert-slot[data-insert-position="1"]');
		await insertSlot.hover();
		const plus = insertSlot.locator('button.act-insert-btn');
		await expect(plus).toBeVisible();

		await plus.click();
		const input = win.locator('input.act-insert-input[data-insert-position="1"]');
		await expect(input).toBeVisible();
	});

	test('inserting an act at position 1 shifts existing siblings and persists position correctly', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } })
		).json();

		const win = await openTimeline(page);
		const slot = win.locator('.act-insert-slot[data-insert-position="1"]');
		await slot.hover();
		await slot.locator('button.act-insert-btn').click();
		const input = win.locator('input.act-insert-input[data-insert-position="1"]');
		await input.fill('Act AB');
		await input.press('Enter');

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const acts = ents.filter((e: any) => e.type === 'Act').sort((x: any, y: any) => x.position - y.position);
			expect(acts.map((a: any) => a.name)).toEqual(['Act A', 'Act AB', 'Act B']);
			expect(acts.map((a: any) => a.position)).toEqual([0, 1, 2]);
			// Original Act B's position bumped from 1 → 2
			const updatedB = acts.find((a: any) => a.id === b.id);
			expect(updatedB.position).toBe(2);
		}).toPass({ timeout: 3000 });
	});

	test('an interval crossing the insertion boundary stretches through the new act', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		// Ellie spans Act A → Act B (crosses the boundary that's about to be split)
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a.id, end_act_id: b.id }
		});

		const win = await openTimeline(page);
		const slot = win.locator('.act-insert-slot[data-insert-position="1"]');
		await slot.hover();
		await slot.locator('button.act-insert-btn').click();
		const input = win.locator('input.act-insert-input[data-insert-position="1"]');
		await input.fill('Act AB');
		await input.press('Enter');

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const iv = ints.find((i: any) => i.entityId === ellie.id);
			// Per D6/5A: crossing interval stretches through the new act.
			// End act is now the moved-to-position-2 original Act B.
			expect(iv.startActId).toBe(a.id);
			expect(iv.endActId).toBe(b.id);
			// Span should still cover all 3 acts (start in 0, end in 2)
			expect(iv.endPosition).toBeGreaterThan(2);
		}).toPass({ timeout: 3000 });
	});

	test('Escape cancels the insert form without creating an act', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } });
		await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } });

		const win = await openTimeline(page);
		const slot = win.locator('.act-insert-slot[data-insert-position="1"]');
		await slot.hover();
		await slot.locator('button.act-insert-btn').click();
		const input = win.locator('input.act-insert-input[data-insert-position="1"]');
		await input.fill('Cancelled');
		await input.press('Escape');

		await expect(input).toHaveCount(0);
		const ents = await (await request.get('/api/entities')).json();
		expect(ents.filter((e: any) => e.type === 'Act')).toHaveLength(2);
	});
});
