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

// Skipping these in single-tab Playwright: the draft-preview toast (D16/14A)
// fires when an entity is deleted FROM ANOTHER WINDOW while the current
// window has an uncommitted draft. In one tab, clicking the delete button
// blurs the textarea first → EditableField.onTextBlur commits → store
// saves → no draft left in the bus to recover. Reproducing the
// "concurrent window" scenario needs a second BrowserContext deleting via
// the API while the first context's textarea is still focused. The
// Toast.svelte / editable-drafts.ts / EntityDetail.onEntityVanished
// integration is exercised by unit tests in tests/unit/ instead.
test.describe.skip('V2 Edit-during-delete (D16 / 14A)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
		// Browser permission needed for navigator.clipboard.readText() in the assertion
	});

	test('typing into synopsis then deleting the act fires a toast with truncated preview', async ({
		page,
		request,
		context
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		const synopsis = win
			.locator('.entity-detail [data-field="synopsis"] textarea.field-textarea');
		const longDraft =
			'In the opening act, Ellie escapes the burning city under cover of darkness while the militia closes the gates and the river floods the lower district.';
		await synopsis.fill(longDraft);
		// Do NOT blur — leave draft uncommitted

		// Delete the act via the header X
		await win.locator('button.act-delete-btn[aria-label="Delete Act A"]').click();
		await win.locator('.delete-confirm button.btn-danger').click();

		// Toast appears with truncated preview (~80 chars + ellipsis)
		const toast = page.locator('.toast.draft-preview, .toast').filter({ hasText: longDraft.slice(0, 40) });
		await expect(toast).toBeVisible({ timeout: 3000 });
		const toastText = await toast.textContent();
		expect(toastText).toMatch(/…|\.\.\./);
	});

	test('Copy-to-clipboard button copies the FULL draft text', async ({
		page,
		request,
		context
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		const synopsis = win
			.locator('.entity-detail [data-field="synopsis"] textarea.field-textarea');
		const longDraft =
			'A long uncommitted draft that needs to survive the destructive delete via clipboard.';
		await synopsis.fill(longDraft);

		await win.locator('button.act-delete-btn[aria-label="Delete Act A"]').click();
		await win.locator('.delete-confirm button.btn-danger').click();

		const toast = page.locator('.toast.draft-preview, .toast').first();
		await expect(toast).toBeVisible({ timeout: 3000 });
		await toast.locator('button', { hasText: /copy/i }).click();

		const clip = await page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toBe(longDraft);
	});

	test('toast does NOT fire on optimistic-then-rolled-back delete (D16 P2-1)', async ({
		page,
		request,
		context
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		const synopsis = win
			.locator('.entity-detail [data-field="synopsis"] textarea.field-textarea');
		await synopsis.fill('still typing');

		// Force the DELETE to fail; the optimistic remove should be rolled back
		// via load(), and the toast must NOT fire.
		await page.route(`**/api/entities/${a.id}`, async (route) => {
			if (route.request().method() === 'DELETE') {
				await route.fulfill({ status: 500, body: 'no-op' });
				return;
			}
			await route.continue();
		});

		await win.locator('button.act-delete-btn[aria-label="Delete Act A"]').click();
		await win.locator('.delete-confirm button.btn-danger').click();

		// Wait a beat for any toast to (incorrectly) appear
		await page.waitForTimeout(500);
		await expect(page.locator('.toast.draft-preview')).toHaveCount(0);
	});
});
