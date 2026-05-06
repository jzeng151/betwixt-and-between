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

test.describe('V2 Act insert-between (D6 / 5A)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('hover an act header reveals the + insert overlay; click opens the inline name input', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } });

		const win = await openTimeline(page);
		const actHeader = win.locator('.act-col-header').nth(1);
		const overlay = actHeader.locator('.insert-overlay');
		await actHeader.hover();
		const plus = overlay.locator('button.insert-btn');
		await expect(plus).toBeVisible();

		await plus.click();
		await expect(overlay.locator('input.insert-input')).toBeVisible();
	});

	test('inserting at idx 1 shifts existing siblings and persists position correctly', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } })
		).json();

		const win = await openTimeline(page);
		const actHeader = win.locator('.act-col-header').nth(1);
		const overlay = actHeader.locator('.insert-overlay');
		await actHeader.hover();
		await overlay.locator('button.insert-btn').click();
		const input = overlay.locator('input.insert-input');
		await input.fill('Act AB');
		await input.press('Enter');

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const acts = ents
				.filter((e: any) => e.type === 'Act')
				.sort((x: any, y: any) => x.position - y.position);
			expect(acts.map((a: any) => a.name)).toEqual(['Act A', 'Act AB', 'Act B']);
			expect(acts.map((a: any) => a.position)).toEqual([0, 1, 2]);
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
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a.id, end_act_id: b.id }
		});

		const win = await openTimeline(page);
		const actHeader = win.locator('.act-col-header').nth(1);
		const overlay = actHeader.locator('.insert-overlay');
		await actHeader.hover();
		await overlay.locator('button.insert-btn').click();
		const input = overlay.locator('input.insert-input');
		await input.fill('Act AB');
		await input.press('Enter');

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const iv = ints.find((i: any) => i.entityId === ellie.id);
			expect(iv.startActId).toBe(a.id);
			expect(iv.endActId).toBe(b.id);
			expect(iv.endPosition).toBeGreaterThan(2);
		}).toPass({ timeout: 3000 });
	});

	test('Escape cancels the insert form without creating an act', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } });
		await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } });

		const win = await openTimeline(page);
		const actHeader = win.locator('.act-col-header').nth(1);
		const overlay = actHeader.locator('.insert-overlay');
		await actHeader.hover();
		await overlay.locator('button.insert-btn').click();
		const input = overlay.locator('input.insert-input');
		await input.fill('Cancelled');
		await input.press('Escape');

		await expect(input).toHaveCount(0);
		const ents = await (await request.get('/api/entities')).json();
		expect(ents.filter((e: any) => e.type === 'Act')).toHaveLength(2);
	});
});
