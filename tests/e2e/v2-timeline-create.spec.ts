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

test.describe('Timeline — create acts and events from the timeline UI', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('+ Act inline form creates an act and renders it in the header', async ({
		page,
		request
	}) => {
		const win = await openTimeline(page);

		// Empty state
		await expect(win.locator('.acts-empty')).toBeVisible();
		await expect(win.locator('.act-col-header')).toHaveCount(0);

		// Click the trailing + Act tile
		await win.locator('button.act-add-btn').click();
		const input = win.locator('input.act-add-input');
		await expect(input).toBeVisible();
		await input.fill('Opening');
		await input.press('Enter');

		// Server: act created
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			expect(ents.filter((e: any) => e.type === 'Act')).toHaveLength(1);
		}).toPass({ timeout: 3000 });

		// UI: header renders, empty state gone, + Act tile still present
		await expect(win.locator('.act-col-header .act-name')).toHaveText('Opening');
		await expect(win.locator('.acts-empty')).toHaveCount(0);
		await expect(win.locator('button.act-add-btn')).toBeVisible();

		// Add a second act → ordering by position
		await win.locator('button.act-add-btn').click();
		await win.locator('input.act-add-input').fill('Climax');
		await win.locator('input.act-add-input').press('Enter');

		await expect(win.locator('.act-col-header .act-name')).toHaveCount(2);
		const labels = await win.locator('.act-col-header .act-name').allTextContents();
		expect(labels).toEqual(['Opening', 'Climax']);
	});

	test('Escape cancels the + Act inline form', async ({ page }) => {
		const win = await openTimeline(page);
		await win.locator('button.act-add-btn').click();
		const input = win.locator('input.act-add-input');
		await input.fill('Discarded');
		await input.press('Escape');
		await expect(input).toHaveCount(0);
		await expect(win.locator('button.act-add-btn')).toBeVisible();
	});

	test('+ Event inline form creates an event chip in the palette', async ({ page, request }) => {
		const win = await openTimeline(page);

		// Open the events add form
		await win.locator('.palette-section', { hasText: 'Events' }).locator('.palette-add-btn').click();
		const input = win.locator('input.palette-add-input[aria-label="New event name"]');
		await expect(input).toBeVisible();
		await input.fill('Battle of Three Rivers');
		await input.press('Enter');

		// Server: event created
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const evs = ents.filter((e: any) => e.type === 'Event');
			expect(evs).toHaveLength(1);
			expect(evs[0].name).toBe('Battle of Three Rivers');
		}).toPass({ timeout: 3000 });

		// Palette renders the chip and is draggable (data-entity-id is set)
		const chip = win
			.locator('.palette-section', { hasText: 'Events' })
			.locator('.palette-item', { hasText: 'Battle of Three Rivers' });
		await expect(chip).toBeVisible();
		await expect(chip).toHaveAttribute('draggable', 'true');
		await expect(chip).toHaveAttribute('data-entity-id', /.+/);
	});

	test('event chip created in the palette can be dragged onto the timeline', async ({
		page,
		request
	}) => {
		// Pre-seed an act so the drop target exists
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });

		const win = await openTimeline(page);

		// Create the event via the palette form
		await win.locator('.palette-section', { hasText: 'Events' }).locator('.palette-add-btn').click();
		await win.locator('input.palette-add-input[aria-label="New event name"]').fill('Coronation');
		await win.locator('input.palette-add-input[aria-label="New event name"]').press('Enter');

		const chip = win
			.locator('.palette-section', { hasText: 'Events' })
			.locator('.palette-item', { hasText: 'Coronation' });
		await expect(chip).toBeVisible();

		// Drag the chip onto the rows track
		await chip.dragTo(win.locator('.rows'), { targetPosition: { x: 100, y: 30 } });

		await expect(async () => {
			const intervals = await (await request.get('/api/intervals')).json();
			expect(intervals).toHaveLength(1);
		}).toPass({ timeout: 3000 });

		// Bar renders in the timeline
		await expect(win.locator('.bar-wrapper')).toHaveCount(1);
	});
});
