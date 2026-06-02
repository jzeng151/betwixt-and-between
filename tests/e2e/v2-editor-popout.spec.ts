import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

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

// Acts/Scenes/Events route directly to a standalone 'entity-detail' window
// (Issue 19A). The legacy in-Timeline side panel + "↗ Move to window" affordance
// was retired (onMoveToWindow is no longer wired). What remains, and what this
// spec covers, is the windowing + mutex behavior: one window per entity, focus
// the existing one on re-click, multiple entities coexist.
test.describe('V2 Editor windowing + mutex (D2 + D3)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking an act opens a standalone editor window (not an in-Timeline panel)', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();

		// A standalone window opens for the act…
		await expect(page.locator('.window[aria-label="Act A"]')).toBeVisible();
		await expect(page.locator('.window[aria-label="Act A"] .entity-detail-host')).toBeVisible();
		// …and there is no legacy side panel inside the Timeline window.
		await expect(win.locator('.entity-detail')).toHaveCount(0);
	});

	test('multiple acts each open their own window, coexisting', async ({ page, request }) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } })
		).json();

		const win = await openTimeline(page);
		await win.locator(`.act-col-header[data-entity-id="${a.id}"]`).click();
		await expect(page.locator('.window[aria-label="Act A"]')).toBeVisible();
		await win.locator(`.act-col-header[data-entity-id="${b.id}"]`).click();
		await expect(page.locator('.window[aria-label="Act B"]')).toBeVisible();

		// Both windows present at once
		await expect(page.locator('.window[aria-label="Act A"]')).toBeVisible();
		await expect(page.locator('.window[aria-label="Act B"]')).toBeVisible();
	});

	test('re-clicking an open act focuses its window instead of opening a duplicate (mutex)', async ({
		page,
		request
	}) => {
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } });

		const win = await openTimeline(page);
		await win.locator('.act-col-header').first().click();

		const popout = page.locator('.window[aria-label="Act A"]');
		await expect(popout).toBeVisible();
		const initialZ = await popout.evaluate((el) => Number((el as HTMLElement).style.zIndex || '0'));

		// Click the same act again — mutex: focus the existing window, no second one.
		await win.locator('.act-col-header').first().click();

		await expect(page.locator('.window[aria-label="Act A"]')).toHaveCount(1);
		const newZ = await popout.evaluate((el) => Number((el as HTMLElement).style.zIndex || '0'));
		expect(newZ).toBeGreaterThanOrEqual(initialZ);
		// The act window is the focused (top-most) window.
		const maxZ = await page
			.locator('.window')
			.evaluateAll((els) =>
				Math.max(...els.map((e) => Number((e as HTMLElement).style.zIndex || '0')))
			);
		expect(newZ).toBe(maxZ);
	});
});
