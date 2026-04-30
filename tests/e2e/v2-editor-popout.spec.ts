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

test.describe('V2 Editor pop-out + mutex (D2 + D3)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('"↗ Move to window" shows inline confirmation; Cancel keeps the side panel open', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();

		const panel = win.locator('.entity-detail');
		await win.locator(".entity-detail-host button.popout-btn").click();

		const confirm = win.locator('.entity-detail-host .popout-confirm');
		await expect(confirm).toBeVisible();
		await expect(confirm).toContainText(/Move to standalone window/i);

		await confirm.locator('button', { hasText: /cancel/i }).click();
		// Side panel still open, no pop-out window opened
		await expect(panel).toBeVisible();
		await expect(page.locator(`.window[aria-label="${a.name}"]`)).toHaveCount(0);
	});

	test('Confirm pop-out: side panel closes and a standalone window opens for that act', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();

		const panel = win.locator('.entity-detail');
		await win.locator(".entity-detail-host button.popout-btn").click();
		await win.locator('.entity-detail-host .popout-confirm button', { hasText: /^move$/i }).click();

		// Pop-out window opens, side panel closes
		await expect(page.locator(`.window[aria-label="Act A"]`)).toBeVisible();
		await expect(win.locator('.entity-detail')).toHaveCount(0);
	});

	test('Multiple pop-outs for different acts coexist', async ({ page, request }) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } })
		).json();

		const win = await openTimeline(page);

		// Pop out Act A
		await win.locator(`.act-col-header[data-entity-id="${a.id}"]`).click();
		await win.locator('.entity-detail-host button.popout-btn').click();
		await win
			.locator('.entity-detail-host .popout-confirm button', { hasText: /^move$/i })
			.click();
		await expect(page.locator('.window[aria-label="Act A"]')).toBeVisible();

		// Pop out Act B
		await win.locator(`.act-col-header[data-entity-id="${b.id}"]`).click();
		await win.locator('.entity-detail-host button.popout-btn').click();
		await win
			.locator('.entity-detail-host .popout-confirm button', { hasText: /^move$/i })
			.click();
		await expect(page.locator('.window[aria-label="Act B"]')).toBeVisible();

		// Both windows present at once
		await expect(page.locator('.window[aria-label="Act A"]')).toBeVisible();
		await expect(page.locator('.window[aria-label="Act B"]')).toBeVisible();
	});

	test('Clicking an act with an existing pop-out focuses the pop-out (mutex per D2/2B-i)', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);

		// Open + pop out Act A
		await win.locator('.act-col-header').first().click();
		await win.locator('.entity-detail-host button.popout-btn').click();
		await win
			.locator('.entity-detail-host .popout-confirm button', { hasText: /^move$/i })
			.click();

		const popout = page.locator('.window[aria-label="Act A"]');
		await expect(popout).toBeVisible();
		const initialZ = await popout.evaluate((el) => Number((el as HTMLElement).style.zIndex || '0'));

		// Click the act in the timeline header — should focus the existing pop-out
		// rather than open the side panel.
		await win.locator('.act-col-header').first().click();

		// Side panel must NOT have re-opened
		await expect(win.locator('.entity-detail')).toHaveCount(0);
		// Pop-out z-index increased (focused)
		const newZ = await popout.evaluate((el) => Number((el as HTMLElement).style.zIndex || '0'));
		expect(newZ).toBeGreaterThan(initialZ);
	});
});
