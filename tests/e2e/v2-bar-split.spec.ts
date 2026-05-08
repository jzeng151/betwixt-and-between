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

test.describe('V2 Bar split via hairline click (D7 / 5b A)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking a hairline on a 3-act bar splits it into 2 adjacent intervals', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const a1 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const a2 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'C', position: 2 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a2.id }
		});

		const win = await openTimeline(page);
		// Two internal hairlines on a 3-act bar
		const hairlines = win.locator(`.row[data-entity-id="${ellie.id}"] svg.interval-bar line`);
		await expect(hairlines).toHaveCount(2);

		// Click the first hairline (boundary between Act A and Act B)
		await hairlines.first().click({ force: true });

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const ellieInts = ints.filter((i: any) => i.entityId === ellie.id);
			expect(ellieInts).toHaveLength(2);
			// Adjacent — one ends at the split, the other starts there
			const sorted = ellieInts.sort(
				(x: any, y: any) => x.startPosition - y.startPosition
			);
			expect(sorted[0].endActId).toBe(a0.id);
			expect(sorted[1].startActId).toBe(a1.id);
		}).toPass({ timeout: 3000 });
	});

	test('clicking the second hairline on the now-2-act second-half bar splits again into 3 total', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const a1 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const a2 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'C', position: 2 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a2.id }
		});

		const win = await openTimeline(page);
		// First split at A|B boundary
		const initialHairlines = win.locator(`.row[data-entity-id="${ellie.id}"] svg.interval-bar line`);
		await initialHairlines.first().click({ force: true });

		// Wait for re-render: 2 bars total
		await expect(win.locator(`.row[data-entity-id="${ellie.id}"] .bar-wrapper`)).toHaveCount(2);

		// Second split: the second-half bar is multi-act (B-C); click its single hairline
		const secondHalf = win
			.locator(`.row[data-entity-id="${ellie.id}"] .bar-wrapper`)
			.nth(1);
		await secondHalf.locator('svg.interval-bar line').first().click({ force: true });

		await expect(async () => {
			const ints = await (await request.get('/api/intervals')).json();
			const ellieInts = ints.filter((i: any) => i.entityId === ellie.id);
			expect(ellieInts).toHaveLength(3);
		}).toPass({ timeout: 3000 });
	});

	test('single-act bars do not expose a hairline split affordance', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a0.id }
		});

		const win = await openTimeline(page);
		// A single-act bar has no internal boundaries, hence no hairline lines.
		const hairlines = win.locator(`.row[data-entity-id="${ellie.id}"] svg.interval-bar line`);
		await expect(hairlines).toHaveCount(0);
	});
});
