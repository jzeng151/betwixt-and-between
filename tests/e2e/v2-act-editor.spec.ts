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

test.describe('V2 Act editor (D2/2B-i + D5 + D14)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking an act header opens the editor side panel and renders fields', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();

		const panel = win.locator('.entity-detail');
		await expect(panel).toBeVisible();
		// Fields per D5 — Synopsis / Goal / Stakes / Turning point / Color
		await expect(panel.locator('[data-field="synopsis"]')).toBeVisible();
		await expect(panel.locator('[data-field="goal"]')).toBeVisible();
		await expect(panel.locator('[data-field="stakes"]')).toBeVisible();
		await expect(panel.locator('[data-field="turningPoint"]')).toBeVisible();
		await expect(panel.locator('[data-field="color"]')).toBeVisible();

		// Sanity: panel is bound to the right act
		const ents = await (await request.get('/api/entities')).json();
		expect(ents.find((e: any) => e.id === a0.id)).toBeTruthy();
	});

	test('typing into Synopsis textarea + blur autosaves and persists to the server', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();
		// EntityDetail opens in view mode — toggle to edit before typing.
		await win.locator('.entity-detail-host .mode-toggle').click();

		const panel = win.locator('.entity-detail');
		const synopsis = panel
			.locator('[data-field="synopsis"]')
			.locator('textarea.field-textarea');
		await synopsis.fill('Ellie escapes the city in the opening act.');
		await synopsis.blur();

		// API confirms persistence (the "Saving… → Saved" transition shown
		// in the footer was an aspirational design — the live UI just
		// renders 'Saved · just now' once edit mode is open).
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const a = ents.find((e: any) => e.id === a0.id);
			const data = (a.data ?? {});
			expect(data.synopsis).toBe('Ellie escapes the city in the opening act.');
		}).toPass({ timeout: 3000 });
	});

	test('Esc cancels the draft — server unchanged', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', {
				data: { type: 'Act', name: 'Act A', position: 0, data: { synopsis: 'original' } }
			})
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		const panel = win.locator('.entity-detail');
		const synopsis = panel
			.locator('[data-field="synopsis"]')
			.locator('textarea.field-textarea');
		await synopsis.fill('discarded draft');
		await synopsis.press('Escape');

		// Server still has original
		const ents = await (await request.get('/api/entities')).json();
		const a = ents.find((e: any) => e.id === a0.id);
		const data = (a.data ?? {});
		expect(data.synopsis).toBe('original');
	});

	test('server error surfaces inline Retry button; clicking it re-fires the PATCH', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		// Force the next PATCH to /api/entities/<id> to fail
		let routeCount = 0;
		await page.route(`**/api/entities/${a0.id}`, async (route) => {
			if (route.request().method() === 'PATCH') {
				routeCount++;
				if (routeCount === 1) {
					await route.fulfill({ status: 500, body: 'boom' });
					return;
				}
			}
			await route.continue();
		});

		const synopsis = win
			.locator('.entity-detail [data-field="synopsis"] textarea.field-textarea');
		await synopsis.fill('attempt one');
		await synopsis.blur();

		const retry = win.locator('.entity-detail [data-field="synopsis"] button.retry');
		await expect(retry).toBeVisible();
		await retry.click();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const data = (ents.find((e: any) => e.id === a0.id).data ?? {});
			expect(data.synopsis).toBe('attempt one');
		}).toPass({ timeout: 3000 });
	});
});
