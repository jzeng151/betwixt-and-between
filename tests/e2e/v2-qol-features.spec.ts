import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
}

async function seedForSearch(request: APIRequestContext) {
	await clearAll(request);
	await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });
	await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } });
	await request.post('/api/entities', { data: { type: 'Character', name: 'Damien' } });
	await request.post('/api/entities', { data: { type: 'Character', name: 'Elena' } });
	await request.post('/api/entities', { data: { type: 'Event', name: 'Battle' } });
	await request.post('/api/entities', { data: { type: 'Event', name: 'Coronation' } });
}

async function seedForCancel(request: APIRequestContext) {
	await clearAll(request);
	const a0 = await (
		await request.post('/api/entities', {
			data: { type: 'Act', name: 'Act A', position: 0, data: { synopsis: 'original synopsis' } }
		})
	).json();
	return { a0 };
}

async function seedForSpotlight(request: APIRequestContext) {
	await clearAll(request);
	const a0 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act 1', position: 0 } })
	).json();
	const a1 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act 2', position: 1 } })
	).json();
	// Scene inside Act 1
	await request.post('/api/entities', {
		data: { type: 'Scene', name: 'Scene 1', position: 0, parentId: a0.id }
	});
	await request.post('/api/entities', {
		data: { type: 'Scene', name: 'Scene 2', position: 1, parentId: a0.id }
	});
	return { a0, a1 };
}

async function openTimeline(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.click('button[title="Timeline"]');
	const win = page.locator('.window[aria-label="Timeline"]');
	await expect(win).toBeVisible();
	return win;
}

test.describe('Palette search', () => {
	test.beforeEach(async ({ request }) => {
		await seedForSearch(request);
	});

	test('typing a query filters both characters and events', async ({ page }) => {
		const win = await openTimeline(page);
		const input = win.locator('.palette-search-input');
		await expect(input).toBeVisible();

		// All characters visible initially
		await expect(win.locator('.palette-section').first().locator('.palette-item')).toHaveCount(3);

		await input.fill('el');
		// "Ellie" and "Elena" match, not "Damien"
		const charItems = win.locator('.palette-section').first().locator('.palette-item');
		await expect(charItems).toHaveCount(2);
		await expect(charItems.nth(0).locator('.palette-name')).toContainText('Ellie');
		await expect(charItems.nth(1).locator('.palette-name')).toContainText('Elena');
	});

	test('query that matches no items shows "No matches." empty state', async ({ page }) => {
		const win = await openTimeline(page);
		await win.locator('.palette-search-input').fill('zzz');

		// Characters section
		const charSection = win.locator('.palette-section').first();
		await expect(charSection.locator('.palette-empty')).toContainText('No matches.');
	});

	test('clearing the query restores all items', async ({ page }) => {
		const win = await openTimeline(page);
		const input = win.locator('.palette-search-input');

		await input.fill('el');
		await expect(win.locator('.palette-section').first().locator('.palette-item')).toHaveCount(2);

		await input.clear();
		await expect(win.locator('.palette-section').first().locator('.palette-item')).toHaveCount(3);
	});
});

test.describe('Palette collapse toggle', () => {
	test('clicking toggle hides the palette and shows restore button', async ({
		page,
		request
	}) => {
		await seedForSearch(request);
		const win = await openTimeline(page);

		// Palette visible initially
		await expect(win.locator('aside.palette')).toBeVisible();

		// Click collapse (‹ button)
		await win.locator('.palette-toggle').click();

		// Palette unmounted
		await expect(win.locator('aside.palette')).toHaveCount(0);

		// Toggle shows › (restore)
		await expect(win.locator('.palette-toggle')).toContainText('›');

		// Click restore — palette comes back
		await win.locator('.palette-toggle').click();
		await expect(win.locator('aside.palette')).toBeVisible();
		await expect(win.locator('.palette-toggle')).toContainText('‹');
	});
});

test.describe('Characters section collapse', () => {
	test('all/none toggle collapses and restores characters section', async ({
		page,
		request
	}) => {
		await seedForSearch(request);
		const win = await openTimeline(page);

		const charSection = win.locator('.palette-section').first();
		const toggle = charSection.locator('.palette-filter');

		// Characters visible initially
		await expect(charSection.locator('.palette-item')).toHaveCount(3);
		await expect(toggle).toContainText('all');

		// Collapse characters
		await toggle.click();
		await expect(charSection.locator('.palette-item')).toHaveCount(0);
		await expect(toggle).toContainText('none');

		// Restore characters
		await toggle.click();
		await expect(charSection.locator('.palette-item')).toHaveCount(3);
		await expect(toggle).toContainText('all');
	});

	test('search query overrides collapse — characters visible when query active', async ({
		page,
		request
	}) => {
		await seedForSearch(request);
		const win = await openTimeline(page);

		const charSection = win.locator('.palette-section').first();

		// Collapse characters
		await charSection.locator('.palette-filter').click();
		await expect(charSection.locator('.palette-item')).toHaveCount(0);

		// Type a search query — characters reappear despite collapse
		await win.locator('.palette-search-input').fill('el');
		await expect(charSection.locator('.palette-item')).toHaveCount(2);
	});
});

test.describe('EntityDetail Cancel button', () => {
	test('Cancel discards in-flight field edits and reverts to prior value', async ({
		page,
		request
	}) => {
		const { a0 } = await seedForCancel(request);
		const win = await openTimeline(page);

		// Open the act editor
		await win.locator('.act-col-header').first().click();
		await expect(win.locator('.entity-detail-host')).toBeVisible();

		// Switch to edit mode
		await win.locator('.entity-detail-host .mode-toggle').click();

		// Edit the synopsis field
		const synopsis = win
			.locator('.entity-detail [data-field="synopsis"] textarea.field-textarea');
		await synopsis.click(); // ensure focus so Cancel's mousedown dispatches Escape to it
		await synopsis.fill('discarded draft');

		// Click Cancel — mousedown dispatches Escape to the textarea, reverting draft
		await win.locator('.entity-detail-host .mode-cancel').click();

		// Field should revert to original
		const panel = win.locator('.entity-detail');
		await expect(panel.locator('[data-field="synopsis"]')).toContainText('original synopsis');

		// Server should NOT have the draft
		const ents = await (await request.get('/api/entities')).json();
		const act = ents.find((e: any) => e.id === a0.id);
		expect((act.data ?? {}).synopsis).toBe('original synopsis');
	});
});

test.describe('Spotlight position label', () => {
	test('label reads "Act Name · Scene Name" not a decimal', async ({
		page,
		request
	}) => {
		const { a0, a1 } = await seedForSpotlight(request);
		const win = await openTimeline(page);

		// Activate spotlight
		await win.locator('.scrub-toggle').click();
		await expect(win.locator('.playhead')).toBeVisible();

		// Default scrub position = 0 → "Act 1 · Scene 1"
		const label = win.locator('.scrub-pos');
		await expect(label).toContainText('Act 1');

		// Should NOT contain a raw decimal like "0.00"
		const text = await label.textContent();
		expect(text).not.toMatch(/^\d+\.\d+$/);

		// Scrub to middle of Act 1 (T ≈ 0.5)
		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('no rows box');
		await page.mouse.click(rowsBox.x + rowsBox.width * 0.25, rowsBox.y + 30);
		await page.waitForTimeout(100);

		// Label still shows act+scene format
		await expect(label).toContainText('Act 1');
		const textAfterScrub = await label.textContent();
		expect(textAfterScrub).not.toMatch(/^\d+\.\d+$/);
	});

	test('label shows act name only when act has no scenes', async ({
		page,
		request
	}) => {
		await seedForSpotlight(request);
		const win = await openTimeline(page);

		await win.locator('.scrub-toggle').click();

		// Scrub to Act 2 (right half) — Act 2 has no scenes
		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('no rows box');
		await page.mouse.click(rowsBox.x + rowsBox.width * 0.75, rowsBox.y + 30);
		await page.waitForTimeout(100);

		const label = win.locator('.scrub-pos');
		await expect(label).toContainText('Act 2');
		const text = await label.textContent();
		expect(text).not.toContain('·');
	});
});
