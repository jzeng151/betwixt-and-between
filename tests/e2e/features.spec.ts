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

test.describe('Characters', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearEntities(request);
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/');
	});

	test('character list shows role badge and affiliation when set', async ({ page, request }) => {
		const char = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } })
		).json();
		await request.patch(`/api/entities/${char.id}`, {
			data: { data: { role: 'Protagonist', affiliation: 'The Conclave' } }
		});
		await page.goto('/');

		await page.click('button[title="Characters"]');
		const win = page.locator('.window[aria-label="Characters"]');
		await expect(win.locator('.char-role-badge').first()).toHaveText('Protagonist', { timeout: 3000 });
		await expect(win.locator('.char-affiliation').first()).toHaveText('The Conclave');
	});

	test('set role via header pencil → badge appears in header', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
		await page.goto('/');

		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });
		await listWin.locator('.char-row').first().click();

		const detailWin = page.locator('.window[aria-label="Elara"]');
		await expect(detailWin).toBeVisible();

		// Hover to reveal the pencil, force-click since opacity:0 until hover
		await detailWin.locator('.header-meta').hover();
		await detailWin.locator('button[title="Edit role"]').click({ force: true });
		await detailWin.locator('.hfield-select').selectOption('Antagonist');

		await expect(detailWin.locator('.role-badge')).toHaveText('Antagonist', { timeout: 3000 });
	});

	test('set affiliation via header pencil → text appears in header', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
		await page.goto('/');

		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });
		await listWin.locator('.char-row').first().click();

		const detailWin = page.locator('.window[aria-label="Elara"]');
		await expect(detailWin).toBeVisible();

		await detailWin.locator('.header-meta').hover();
		await detailWin.locator('button[title="Edit affiliation"]').click({ force: true });
		await detailWin.locator('.hfield-input').fill('The Conclave');
		await detailWin.locator('.hfield-input').press('Enter');

		await expect(detailWin.locator('.hfield-text')).toHaveText('The Conclave', { timeout: 3000 });
	});

	test('details section contains only Motivation and Notes — not Role', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
		await page.goto('/');

		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });
		await listWin.locator('.char-row').first().click();

		const detailWin = page.locator('.window[aria-label="Elara"]');
		await expect(detailWin).toBeVisible();

		// Two field headers: Motivation + Notes. Role lives in the header, not here.
		await expect(detailWin.locator('.details .field-header')).toHaveCount(2);
		await expect(detailWin.locator('.details')).not.toContainText('Role');
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
