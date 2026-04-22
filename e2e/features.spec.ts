import { test, expect, type APIRequestContext } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearEntities(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	await Promise.all(ents.map((e) => request.delete(`/api/entities/${e.id}`)));
}

test.describe('Wiki', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearEntities(request);
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/');
	});

	test('empty state → create note → write content → preview', async ({ page }) => {
		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();

		await expect(win.locator('.empty-state')).toBeVisible();

		await win.locator('.empty-state button').click();
		await expect(win.locator('.note-title')).toHaveText('Untitled Note', { timeout: 3000 });

		const textarea = win.locator('textarea.note-body');
		await textarea.fill('# Hello world\n\nNote content.');
		await textarea.blur();

		await win.locator('button', { hasText: 'Preview' }).click();
		await expect(win.locator('.markdown-preview')).toBeVisible();
		await expect(win.locator('.markdown-preview h1')).toHaveText('Hello world');
	});

	test('sidebar new note button creates a note', async ({ page }) => {
		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();

		// Create first note via empty state
		await win.locator('.empty-state button').click();
		await expect(win.locator('.note-item')).toHaveCount(1);

		// Create second note via sidebar button
		await win.locator('button.new-note-btn').click();
		await expect(win.locator('.note-item')).toHaveCount(2);
	});

	test('search filters note list', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Note', name: 'Alpha Note' } });
		await request.post('/api/entities', { data: { type: 'Note', name: 'Beta Note' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();
		await expect(win.locator('.note-item')).toHaveCount(2);

		await win.locator('input[aria-label="Search notes"]').fill('alpha');
		await expect(win.locator('.note-item')).toHaveCount(1);
		await expect(win.locator('.note-item').first()).toHaveText('Alpha Note');
	});

	test('clicking note in sidebar switches the editor', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Note', name: 'First Note' } });
		await request.post('/api/entities', { data: { type: 'Note', name: 'Second Note' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();

		await win.locator('.note-item', { hasText: 'Second Note' }).click();
		await expect(win.locator('.note-title')).toHaveText('Second Note');
	});

	test('no search results shows "No results." message', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Note', name: 'Alpha Note' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();

		await win.locator('input[aria-label="Search notes"]').fill('zzznomatch');
		await expect(win.locator('.empty-sidebar')).toHaveText('No results.');
	});
});

test.describe('Timeline', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearEntities(request);
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/');
	});

	test('empty state → create act via button → row appears', async ({ page }) => {
		await page.click('button[title="Timeline"]');
		const win = page.locator('.window[aria-label="Timeline"]');
		await expect(win).toBeVisible();

		await expect(win.locator('.empty-state')).toBeVisible();
		await expect(win.locator('.empty-state p')).toContainText('No events yet');

		await win.locator('.empty-state button').click();
		await expect(win.locator('.timeline-row')).toHaveCount(1, { timeout: 3000 });
		await expect(win.locator('.row-name').first()).toHaveText('New Act');
	});

	test('second act created via actions-row button', async ({ page }) => {
		await page.click('button[title="Timeline"]');
		const win = page.locator('.window[aria-label="Timeline"]');
		await expect(win).toBeVisible();

		await win.locator('.empty-state button').click();
		await expect(win.locator('.timeline-row')).toHaveCount(1, { timeout: 3000 });

		await win.locator('.actions-row button').click();
		await expect(win.locator('.timeline-row')).toHaveCount(2, { timeout: 3000 });
	});

	test('expand act row reveals linked entity chips', async ({ page, request }) => {
		const act = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act One' } })
		).json();
		const char = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } })
		).json();
		await request.post('/api/relationships', {
			data: { fromId: char.id, toId: act.id, type: 'appears_in' }
		});
		await page.goto('/');

		await page.click('button[title="Timeline"]');
		const win = page.locator('.window[aria-label="Timeline"]');
		await expect(win.locator('.row-name')).toHaveText('Act One', { timeout: 3000 });

		await win.locator('.expand-btn').first().click();
		await expect(win.locator('.entity-chip')).toBeVisible({ timeout: 2000 });
		await expect(win.locator('.entity-chip').first()).toContainText('Elara');
	});

	test('event rows show a bullet instead of expand arrow', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Event', name: 'The Battle' } });
		await page.goto('/');

		await page.click('button[title="Timeline"]');
		const win = page.locator('.window[aria-label="Timeline"]');
		await expect(win.locator('.row-name')).toHaveText('The Battle', { timeout: 3000 });
		// Event expand button shows bullet (•), not arrow
		await expect(win.locator('.expand-btn').first()).toHaveText('•');
	});
});

test.describe('World Map', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearEntities(request);
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/');
	});

	test('empty state → create location → card appears', async ({ page }) => {
		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await expect(win).toBeVisible();

		await expect(win.locator('.empty-state')).toBeVisible();
		await expect(win.locator('.empty-state p')).toContainText('No locations yet');

		await win.locator('.empty-state button').click();
		await expect(win.locator('.loc-card')).toHaveCount(1, { timeout: 3000 });
		await expect(win.locator('.loc-name').first()).toHaveText('New Location');
	});

	test('second location added via actions-row button', async ({ page }) => {
		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await expect(win).toBeVisible();

		await win.locator('.empty-state button').click();
		await expect(win.locator('.loc-card')).toHaveCount(1, { timeout: 3000 });

		await win.locator('.actions-row button').click();
		await expect(win.locator('.loc-card')).toHaveCount(2, { timeout: 3000 });
	});

	test('location card shows linked character chip', async ({ page, request }) => {
		const loc = await (
			await request.post('/api/entities', { data: { type: 'Location', name: 'The Ashenveil' } })
		).json();
		const char = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Scout' } })
		).json();
		await request.post('/api/relationships', {
			data: { fromId: char.id, toId: loc.id, type: 'located_at' }
		});
		await page.goto('/');

		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await expect(win.locator('.loc-name').first()).toHaveText('The Ashenveil', { timeout: 3000 });
		await expect(win.locator('.entity-chip').first()).toContainText('Scout');
	});

	test('multiple locations each get their own card', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Location', name: 'Ashenveil' } });
		await request.post('/api/entities', { data: { type: 'Location', name: 'The Citadel' } });
		await request.post('/api/entities', { data: { type: 'Location', name: 'Duskport' } });
		await page.goto('/');

		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await expect(win).toBeVisible();
		await expect(win.locator('.loc-card')).toHaveCount(3, { timeout: 3000 });
	});
});
