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

	test('empty state asks the user to create a Character or Location', async ({ page }) => {
		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();
		await expect(win.locator('.empty-state')).toContainText(
			'Your wiki is empty. Create a Character or Location to begin.'
		);
	});

	test('sidebar groups entities by type and excludes Notes', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await request.post('/api/entities', { data: { type: 'Location', name: 'Edoras' } });
		await request.post('/api/entities', { data: { type: 'Note', name: 'Hidden Note' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();

		await expect(win.locator('.type-divider-label', { hasText: 'Characters' })).toBeVisible();
		await expect(win.locator('.type-divider-label', { hasText: 'Locations' })).toBeVisible();
		await expect(win.locator('.entry', { hasText: 'Aragorn' })).toBeVisible();
		await expect(win.locator('.entry', { hasText: 'Edoras' })).toBeVisible();
		// Notes are deliberately not in the sidebar (Lock 2).
		await expect(win.locator('.entry', { hasText: 'Hidden Note' })).toHaveCount(0);
	});

	test('clicking a sidebar entry shows EntityDetail in the content area', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();

		await win.locator('.entry', { hasText: 'Aragorn' }).click();
		await expect(
			win.locator('.entity-detail-host[data-entity-type="Character"]')
		).toBeVisible();
		await expect(win.locator('.entity-detail-title-text')).toHaveText('Aragorn');
	});

	test('search filters the sidebar', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await request.post('/api/entities', { data: { type: 'Character', name: 'Boromir' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();
		await expect(win.locator('.entry')).toHaveCount(2);

		await win.locator('input[aria-label="Search wiki"]').fill('boro');
		await expect(win.locator('.entry')).toHaveCount(1);
		await expect(win.locator('.entry').first()).toHaveText('Boromir');
	});

	test('type-filter pill toggles a group on and off', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await request.post('/api/entities', { data: { type: 'Location', name: 'Edoras' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await expect(win).toBeVisible();
		await expect(win.locator('.entry')).toHaveCount(2);

		// Toggle Characters off; only Edoras (Location) remains.
		await win.locator('.type-pill', { hasText: 'Characters' }).click();
		await expect(win.locator('.entry')).toHaveCount(1);
		await expect(win.locator('.entry').first()).toHaveText('Edoras');
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
		// Existing characters open in view mode — toggle to edit to access hfield-select
		await detailWin.locator('.mode-toggle').click();
		await detailWin.locator('.hfield-select').selectOption('Antagonist');
		// Toggle back to view mode to see the role badge
		await detailWin.locator('.mode-toggle').click();

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
		// Existing characters open in view mode — toggle to edit to access hfield-input
		await detailWin.locator('.mode-toggle').click();
		await detailWin.locator('.hfield-input').fill('The Conclave');
		await detailWin.locator('.hfield-input').blur();
		// Toggle back to view mode to see the affiliation text
		await detailWin.locator('.mode-toggle').click();

		await expect(detailWin.locator('.hfield-text')).toHaveText('The Conclave', { timeout: 3000 });
	});

	test('details section contains Timeline color, Show on timeline, Motivation, Notes — not Role', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
		await page.goto('/');

		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });
		await listWin.locator('.char-row').first().click();

		const detailWin = page.locator('.window[aria-label="Elara"]');
		await expect(detailWin).toBeVisible();
		// Existing characters open in view mode — toggle to edit to see full affordances
		await detailWin.locator('.mode-toggle').click();

		// Four label sections: Timeline color, Show on timeline, Motivation, Notes.
		// The first two use div.field-header > span.field-label; the latter two use
		// label.field-label directly. All share the .field-label class.
		// Role lives in the window header, not here.
		const labels = detailWin.locator('.details .field-label');
		await expect(labels).toHaveCount(4);
		await expect(labels.nth(0)).toContainText('Timeline color');
		await expect(labels.nth(1)).toContainText('Show on timeline');
		await expect(labels.nth(2)).toContainText('Motivation');
		await expect(labels.nth(3)).toContainText('Notes');

		// New feature affordances actually render (color swatches + radio group)
		await expect(detailWin.locator('.details .swatch')).toHaveCount(8);
		await expect(detailWin.locator('.details .radio-group input[type="radio"]')).toHaveCount(3);

		// Role label is not rendered inside .details (lives in the window header).
		await expect(detailWin.locator('.details')).not.toContainText(/^Role$/);
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
