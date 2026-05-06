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

test.describe('V2 Edit-during-delete (D16 / 14A)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('toast does NOT fire on optimistic-then-rolled-back delete', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		const synopsis = win
			.locator('.entity-detail [data-field="synopsis"] textarea.field-textarea');
		await synopsis.fill('still typing');

		// Force the DELETE to fail. The optimistic remove rolls back via
		// load(), $entities still has the act → no vanish → no toast.
		await page.route(`**/api/entities/${a.id}`, async (route) => {
			if (route.request().method() === 'DELETE') {
				await route.fulfill({ status: 500, body: 'no-op' });
				return;
			}
			await route.continue();
		});

		await win.locator('.act-col-header').first().hover();
		await win.locator(`button.act-delete-btn[aria-label="Delete Act A"]`).click({ force: true });
		await win.locator('.delete-confirm button.btn-danger').click();

		await page.waitForTimeout(500);
		await expect(page.locator('.toast.toast--draft')).toHaveCount(0);
		await expect(page.locator('.toast')).toHaveCount(0);
	});

	// The draft-preview toast (D16/14A) and the Copy-to-clipboard variant
	// fire when an entity is deleted FROM ANOTHER WINDOW while the current
	// window has an uncommitted draft. Both are untestable end-to-end
	// without a real cross-tab refresh signal:
	//
	// - Single-tab: any UI action that triggers $entities.load() (clicking
	//   delete, navigating away, etc.) blurs the focused textarea first,
	//   which commits the draft and clears the editable-drafts bus. The
	//   entity then vanishes with no draft to recover.
	// - Cross-context (browser.newContext()): context B can DELETE via the
	//   API, but context A's store has no listener — the app doesn't ship
	//   SSE / WebSocket / polling, so context A never knows the act is
	//   gone unless the user does something that calls load(). That action
	//   blurs the textarea (see above).
	//
	// The functional pieces — Toast.svelte's draft-preview variant, the
	// editable-drafts module-level bus, and EntityDetail.onEntityVanished —
	// are unit-tested in tests/component/. A meaningful cross-window e2e
	// would require either a server push channel or a dedicated
	// "refresh entities now" UI control that does NOT blur the editor.
	test.skip('typing into synopsis then deleting the act fires a toast with truncated preview', () => {});
	test.skip('Copy-to-clipboard button copies the FULL draft text', () => {});
});
