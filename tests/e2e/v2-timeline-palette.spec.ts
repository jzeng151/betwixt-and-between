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

test.describe('Timeline palette', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('empty timeline shows drop hint when characters but no intervals', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });
		await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } });

		const win = await openTimeline(page);
		await expect(win.locator('.drop-hint')).toContainText(
			'Drag a character or event from the palette onto the timeline'
		);
	});

	test('drag character chip onto track creates interval spanning the act', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } });
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();

		const win = await openTimeline(page);

		const chip = win.locator(`.palette-item[data-entity-id="${ellie.id}"]`);
		await expect(chip).toBeVisible();

		// Drop on the LEFT third of the rows area → first act
		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('no rows box');
		const dropX = rowsBox.x + rowsBox.width * 0.25;
		const dropY = rowsBox.y + 20;

		await chip.dragTo(win.locator('.rows'), { targetPosition: { x: dropX - rowsBox.x, y: 20 } });

		// handleDrop is async — wait for the interval to appear server-side
		await expect(async () => {
			const intervals = await (await request.get('/api/intervals')).json();
			const ellieInts = intervals.filter((i: any) => i.entityId === ellie.id);
			expect(ellieInts).toHaveLength(1);
			expect(ellieInts[0].startActId).toBe(a0.id);
			expect(ellieInts[0].endActId).toBe(a0.id);
		}).toPass({ timeout: 3000 });

		// Bar should render in the timeline
		await expect(win.locator('.bar-wrapper')).toHaveCount(1);

		// Chip gets the .placed grey treatment
		await expect(chip).toHaveClass(/placed/);
	});

	test('event chip drops onto its own row alongside character bars', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		const battle = await (
			await request.post('/api/entities', { data: { type: 'Event', name: 'Battle' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a0.id }
		});

		const win = await openTimeline(page);

		const chip = win.locator(`.palette-item[data-entity-id="${battle.id}"]`);
		await chip.dragTo(win.locator('.rows'), { targetPosition: { x: 100, y: 80 } });

		await expect(async () => {
			const intervals = await (await request.get('/api/intervals')).json();
			expect(intervals.find((i: any) => i.entityId === battle.id)).toBeTruthy();
		}).toPass({ timeout: 3000 });

		// Two rows now (ellie + battle)
		await expect(win.locator('.bar-wrapper')).toHaveCount(2);
	});
});
