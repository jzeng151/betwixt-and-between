import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function clearEntities(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	await Promise.all(ents.map((e) => request.delete(`/api/entities/${e.id}`)));
}

test.describe('Wiki', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearEntities(request);
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/app');
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
		await page.goto('/app');

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
		await page.goto('/app');

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
		await page.goto('/app');

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
		await page.goto('/app');

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
		await page.goto('/app');
	});

	test('character list shows role badge and affiliation when set', async ({ page, request }) => {
		const char = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } })
		).json();
		await request.patch(`/api/entities/${char.id}`, {
			data: { data: { role: 'Protagonist', affiliation: 'The Conclave' } }
		});
		await page.goto('/app');

		await page.click('button[title="Characters"]');
		const win = page.locator('.window[aria-label="Characters"]');
		await expect(win.locator('.char-role-badge').first()).toHaveText('Protagonist', { timeout: 3000 });
		await expect(win.locator('.char-affiliation').first()).toHaveText('The Conclave');
	});

	test('set role via header pencil → badge appears in header', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
		await page.goto('/app');

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
		await page.goto('/app');

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

	test('details section contains Timeline color, Show on timeline, Timeline snippet, Motivation — not Role', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
		await page.goto('/app');

		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });
		await listWin.locator('.char-row').first().click();

		const detailWin = page.locator('.window[aria-label="Elara"]');
		await expect(detailWin).toBeVisible();
		// Existing characters open in view mode — toggle to edit to see full affordances
		await detailWin.locator('.mode-toggle').click();

		// Four label sections in order: Timeline color, Show on timeline,
		// Timeline snippet (was "Notes" — renamed in slice 7's pre-implementation
		// fix to dedup with the new NotesSection), Motivation. The first two
		// use div.field-header > span.field-label; the latter two use
		// label.field-label directly. All share the .field-label class.
		// Role lives in the window header, not here.
		const labels = detailWin.locator('.details .field-label');
		await expect(labels).toHaveCount(4);
		await expect(labels.nth(0)).toContainText('Timeline color');
		await expect(labels.nth(1)).toContainText('Show on timeline');
		await expect(labels.nth(2)).toContainText('Timeline snippet');
		await expect(labels.nth(3)).toContainText('Motivation');

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
		await page.goto('/app');
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
		await page.goto('/app');

		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await expect(win.locator('.loc-name').first()).toHaveText('The Ashenveil', { timeout: 3000 });
		await expect(win.locator('.entity-chip').first()).toContainText('Scout');
	});

	test('multiple locations each get their own card', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Location', name: 'Ashenveil' } });
		await request.post('/api/entities', { data: { type: 'Location', name: 'The Citadel' } });
		await request.post('/api/entities', { data: { type: 'Location', name: 'Duskport' } });
		await page.goto('/app');

		await page.click('button[title="World Map"]');
		const win = page.locator('.window[aria-label="World Map"]');
		await expect(win).toBeVisible();
		await expect(win.locator('.loc-card')).toHaveCount(3, { timeout: 3000 });
	});
});

// ── Slice 7: Body field, in-window chip nav, edit-mode preview, Settings toggle ──
test.describe('Wiki — body + in-window navigation (slice 7)', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearEntities(request);
		// app.css gates the desktop on viewports >= 1280px (the TooSmall
		// notice covers narrower windows). Default Playwright 1280x720 is
		// borderline — Firefox scrollbars can consume a few pixels and trip
		// the gate intermittently. Set explicitly above the threshold for
		// stable dock visibility across the slice 7 block.
		await page.setViewportSize({ width: 1440, height: 900 });
		// Tutorial-dismissed is the only init we need; the test fixture's
		// empty storageState already guarantees no stale preferences.
		// (Earlier draft cleared 'btw:preferences' here, which broke the
		// reload-persistence test because addInitScript runs on every
		// navigation including reload.)
		await page.addInitScript(() => {
			localStorage.setItem('tutorial-dismissed', 'true');
		});
		await page.goto('/');
	});

	test('Body field renders below structured fields for non-Note entities', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await win.locator('.entry', { hasText: 'Aragorn' }).click();

		// Body section present with hairline divider + 'Body' eyebrow.
		const bodySection = win.locator('.entity-detail-body');
		await expect(bodySection).toBeVisible();
		await expect(bodySection).not.toHaveClass(/no-divider/);
		await expect(bodySection.locator('.body-eyebrow')).toHaveText('Body');
		await expect(bodySection.locator('.body-divider')).toBeVisible();
	});

	test('typing [[Name]] in Body and saving renders an entity chip in view mode', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await request.post('/api/entities', { data: { type: 'Character', name: 'Boromir' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await win.locator('.entry', { hasText: 'Aragorn' }).click();

		// Switch to edit mode.
		await win.locator('.mode-toggle').click();

		// Type into Body textarea. The body field is the textarea inside
		// .entity-detail-body that doesn't have a label header.
		const bodyTextarea = win.locator('.entity-detail-body textarea.field-textarea');
		await bodyTextarea.fill('Aragorn rode with [[Boromir]] through Edoras.');
		await bodyTextarea.blur();

		// Toggle back to view mode.
		await win.locator('.mode-toggle').click();

		// Body view-mode renders WikiLinkText → EntityLink chip for Boromir.
		const bodyView = win.locator('.entity-detail-body .readonly-textarea');
		await expect(bodyView).toContainText('rode with');
		await expect(bodyView.locator('.entity-chip-name', { hasText: 'Boromir' })).toBeVisible();
	});

	test('clicking a [[Name]] chip in Body swaps Wiki content in-window (no new window)', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await request.post('/api/entities', { data: { type: 'Character', name: 'Boromir' } });
		await page.goto('/');

		// Pre-seed Aragorn's body via API so the test is fast + deterministic.
		const aragorn = await (await request.get('/api/entities')).json();
		const aragornEntity = aragorn.find((e: { name: string }) => e.name === 'Aragorn');
		await request.patch(`/api/entities/${aragornEntity.id}`, {
			data: { data: { body: 'Aragorn rode with [[Boromir]] through Edoras.' } }
		});
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await win.locator('.entry', { hasText: 'Aragorn' }).click();
		await expect(win.locator('.entity-detail-title-text')).toHaveText('Aragorn');

		// Count windows before clicking the chip.
		const allWindowsBefore = await page.locator('.window').count();

		// Click the Boromir chip in the body view.
		await win
			.locator('.entity-detail-body .readonly-textarea .entity-chip-name', {
				hasText: 'Boromir'
			})
			.click();

		// Wiki window now shows Boromir; window count unchanged (in-window swap).
		await expect(win.locator('.entity-detail-title-text')).toHaveText('Boromir');
		const allWindowsAfter = await page.locator('.window').count();
		expect(allWindowsAfter).toBe(allWindowsBefore);
	});

	test('preview pane appears in edit mode when Body draft contains a resolved [[Name]]', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await request.post('/api/entities', { data: { type: 'Character', name: 'Boromir' } });
		// Default Playwright viewport (1280x720) is comfortably above the
		// 480px mobile gate, so the preview pane is enabled by default.
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await win.locator('.entry', { hasText: 'Aragorn' }).click();
		await win.locator('.mode-toggle').click();

		const bodyTextarea = win.locator('.entity-detail-body textarea.field-textarea');
		const preview = win.locator('.entity-detail-body .wiki-link-preview');

		// Empty draft → no preview pane.
		await expect(preview).toHaveCount(0);

		// Partial bracket → still no preview (gate evaluates parsed segments,
		// not raw '[[' inclusion).
		await bodyTextarea.fill('rode with [[Cha');
		await expect(preview).toHaveCount(0);

		// Full resolved marker → preview pane appears with one decorative chip.
		await bodyTextarea.fill('rode with [[Boromir]] all the way');
		await expect(preview).toBeVisible();
		await expect(preview.locator('.preview-chip', { hasText: 'Boromir' })).toBeVisible();

		// Unknown name → no chip, no pane.
		await bodyTextarea.fill('rode with [[Faramir]]');
		await expect(preview).toHaveCount(0);
	});

	test('Settings → Editor section toggle disables the preview pane', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await request.post('/api/entities', { data: { type: 'Character', name: 'Boromir' } });
		await page.goto('/');

		// Open Settings → Editor and uncheck the toggle.
		await page.click('button[title="Settings"]');
		const settings = page.locator('.window[aria-label="Settings"]');
		await expect(settings).toBeVisible();
		await settings.locator('.sidebar-item', { hasText: 'Editor' }).click();
		await expect(settings.locator('h2', { hasText: 'Editor' })).toBeVisible();

		const checkbox = settings.locator('input[type="checkbox"]');
		await expect(checkbox).toBeChecked();
		await checkbox.uncheck();
		await expect(checkbox).not.toBeChecked();

		// Now open Wiki and confirm the preview pane stays hidden.
		await page.click('button[title="Wiki"]');
		const wiki = page.locator('.window[aria-label="Wiki"]');
		await wiki.locator('.entry', { hasText: 'Aragorn' }).click();
		await wiki.locator('.mode-toggle').click();
		const bodyTextarea = wiki.locator('.entity-detail-body textarea.field-textarea');
		await bodyTextarea.fill('Aragorn rode with [[Boromir]].');

		// Preference is off — pane should NOT render even though [[Boromir]] resolves.
		await expect(wiki.locator('.entity-detail-body .wiki-link-preview')).toHaveCount(0);
	});

	test('linkPreviewEnabled preference persists across reload', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await page.goto('/');

		// Toggle the preference off.
		await page.click('button[title="Settings"]');
		const settings = page.locator('.window[aria-label="Settings"]');
		await settings.locator('.sidebar-item', { hasText: 'Editor' }).click();
		await settings.locator('input[type="checkbox"]').uncheck();

		// Reload the page.
		await page.reload();

		// Re-open Settings → Editor and verify the checkbox is still off.
		await page.click('button[title="Settings"]');
		const settings2 = page.locator('.window[aria-label="Settings"]');
		await settings2.locator('.sidebar-item', { hasText: 'Editor' }).click();
		await expect(settings2.locator('input[type="checkbox"]')).not.toBeChecked();
	});

	test('Body textarea is below the structured editor branch (placement order)', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } });
		await page.goto('/');

		await page.click('button[title="Wiki"]');
		const win = page.locator('.window[aria-label="Wiki"]');
		await win.locator('.entry', { hasText: 'Aragorn' }).click();

		// CharacterEditorBody renders the avatar + role + relationships + details.
		// The Body section sits AFTER it (Pass 1 placement decision).
		// Use bounding boxes to verify visual order (top-down).
		const charBody = win.locator('.char-detail').first();
		const wikiBody = win.locator('.entity-detail-body').first();
		const charBox = await charBody.boundingBox();
		const wikiBox = await wikiBody.boundingBox();
		expect(charBox).not.toBeNull();
		expect(wikiBox).not.toBeNull();
		if (charBox && wikiBox) {
			expect(wikiBox.y).toBeGreaterThan(charBox.y);
		}
	});
});
