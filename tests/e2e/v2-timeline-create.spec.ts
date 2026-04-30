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

	test('+ Act creates an act with a default name and opens the editor in edit mode', async ({
		page,
		request
	}) => {
		const win = await openTimeline(page);

		// Empty state
		await expect(win.locator('.acts-empty')).toBeVisible();
		await expect(win.locator('.act-col-header')).toHaveCount(0);

		// Click + Act
		await win.locator('button.act-add-btn').click();

		// Server: act created with a default name (Act 1)
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const acts = ents.filter((e: any) => e.type === 'Act');
			expect(acts).toHaveLength(1);
			expect(acts[0].name).toBe('Act 1');
		}).toPass({ timeout: 3000 });

		// UI: header renders, empty state gone, side panel opens in edit mode
		await expect(win.locator('.act-col-header .act-name')).toHaveText('Act 1');
		await expect(win.locator('.acts-empty')).toHaveCount(0);
		// Edit mode → mode-toggle reads 'Done', InlineEdit's input is rendered.
		await expect(win.locator('.entity-detail-host .mode-toggle')).toHaveText('Done');
		await expect(win.locator('.entity-detail-title input')).toBeVisible();
	});

	test('+ Act sets the new act position to the end of the existing list', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Existing', position: 0 } });

		const win = await openTimeline(page);
		await win.locator('button.act-add-btn').click();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const acts = ents
				.filter((e: any) => e.type === 'Act')
				.sort((a: any, b: any) => a.position - b.position);
			expect(acts.map((a: any) => a.name)).toEqual(['Existing', 'Act 2']);
		}).toPass({ timeout: 3000 });
	});

	test('+ Event creates an event and opens the editor in edit mode', async ({
		page,
		request
	}) => {
		// Need an act so the event can later be dropped on the track. Not
		// strictly required for create — just realistic.
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });

		const win = await openTimeline(page);

		// Click the events + button in the palette
		await win
			.locator('.palette-section', { hasText: 'Events' })
			.locator('.palette-add-btn')
			.click();

		// Server: event created with the default name
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const evs = ents.filter((e: any) => e.type === 'Event');
			expect(evs).toHaveLength(1);
			expect(evs[0].name).toBe('Event 1');
		}).toPass({ timeout: 3000 });

		// Palette renders the chip and the side panel opens in edit mode
		const chip = win
			.locator('.palette-section', { hasText: 'Events' })
			.locator('.palette-item', { hasText: 'Event 1' });
		await expect(chip).toBeVisible();
		await expect(chip).toHaveAttribute('draggable', 'true');
		await expect(win.locator('.entity-detail-host .mode-toggle')).toHaveText('Done');
	});

	test('event chip created in the palette can be dragged onto the timeline', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });

		const win = await openTimeline(page);

		// Create the event via the palette + button
		await win
			.locator('.palette-section', { hasText: 'Events' })
			.locator('.palette-add-btn')
			.click();

		// Close the side panel that just opened so it doesn't cover .rows
		await win.locator('.entity-detail-close').click();

		const chip = win
			.locator('.palette-section', { hasText: 'Events' })
			.locator('.palette-item', { hasText: 'Event 1' });
		await expect(chip).toBeVisible();

		// Drag the chip onto the rows track
		await chip.dragTo(win.locator('.rows'), { targetPosition: { x: 100, y: 30 } });

		await expect(async () => {
			const intervals = await (await request.get('/api/intervals')).json();
			expect(intervals).toHaveLength(1);
		}).toPass({ timeout: 3000 });

		await expect(win.locator('.bar-wrapper')).toHaveCount(1);
	});
});
