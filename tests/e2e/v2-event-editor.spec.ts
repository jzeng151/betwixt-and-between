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

// Clicking an event bar opens a standalone 'entity-detail' editor window
// (Issue 19A); the legacy in-Timeline side panel was retired.
test.describe('V2 Event editor (D5)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking an event bar opens the editor with Description/Outcome/Mood/Color', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const ev = await (
			await request.post('/api/entities', { data: { type: 'Event', name: 'Coronation' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ev.id, start_act_id: a0.id, end_act_id: a0.id }
		});

		const win = await openTimeline(page);
		await win.locator('.bar-wrapper').first().click();

		const panel = page.locator('.entity-detail-host');
		await panel.locator('.mode-toggle').click();

		// POV field removed by Step 5.5 (drizzle/0011_data_model_cleanup.sql)
		// alongside the pov_of relationship cut.
		await expect(panel).toBeVisible();
		await expect(panel.locator('[data-field="description"]')).toBeVisible();
		await expect(panel.locator('[data-field="outcome"]')).toBeVisible();
		await expect(panel.locator('[data-field="mood"]')).toBeVisible();
		await expect(panel.locator('[data-field="color"]')).toBeVisible();
	});

	test('Outcome picklist commits on change (no blur required)', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const ev = await (
			await request.post('/api/entities', { data: { type: 'Event', name: 'Negotiation' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ev.id, start_act_id: a0.id, end_act_id: a0.id }
		});

		const win = await openTimeline(page);
		await win.locator('.bar-wrapper').first().click();

		const panel = page.locator('.entity-detail-host');
		await panel.locator('.mode-toggle').click();

		const outcomeSelect = panel.locator('[data-field="outcome"]').locator('select');
		await outcomeSelect.selectOption('yes-but');

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const data = ents.find((e: any) => e.id === ev.id).data ?? {};
			expect(data.outcome).toBe('yes-but');
		}).toPass({ timeout: 3000 });
	});
});
