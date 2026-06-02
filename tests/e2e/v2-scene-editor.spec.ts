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

// Clicking a scene cell opens a standalone 'entity-detail' editor window
// (Issue 19A); the legacy in-Timeline side panel was retired.
test.describe('V2 Scene editor (T3-pulled-in + D5)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking a scene cell opens the editor with all D5 fields', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		await request.post('/api/entities', {
			data: { type: 'Scene', name: 'Opening', parentId: a0.id, position: 0 }
		});

		const win = await openTimeline(page);
		await win.locator('.scene-cell').first().click();

		const panel = page.locator('.entity-detail-host');
		await panel.locator('.mode-toggle').click();

		// POV field removed by Step 5.5 (drizzle/0011_data_model_cleanup.sql)
		// alongside the pov_of relationship cut.
		await expect(panel).toBeVisible();
		await expect(panel.locator('[data-field="description"]')).toBeVisible();
		await expect(panel.locator('[data-field="goal"]')).toBeVisible();
		await expect(panel.locator('[data-field="outcome"]')).toBeVisible();
		await expect(panel.locator('[data-field="sensoryAnchor"]')).toBeVisible();
		await expect(panel.locator('[data-field="wordCountTarget"]')).toBeVisible();
		await expect(panel.locator('[data-field="color"]')).toBeVisible();
	});

	test('Goal autosaves on blur and persists', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Opening', parentId: a0.id, position: 0 }
			})
		).json();

		const win = await openTimeline(page);
		await win.locator('.scene-cell').first().click();

		const panel = page.locator('.entity-detail-host');
		await panel.locator('.mode-toggle').click();

		const goal = panel
			.locator('[data-field="goal"]')
			.locator('input.field-input, textarea.field-textarea')
			.first();
		await goal.fill('Establish the threat');
		await goal.blur();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const data = ents.find((e: any) => e.id === sc.id).data ?? {};
			expect(data.goal).toBe('Establish the threat');
		}).toPass({ timeout: 3000 });
	});

	test('Sensory anchor textarea + Word-count target numeric input both persist', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const sc = await (
			await request.post('/api/entities', {
				data: { type: 'Scene', name: 'Opening', parentId: a0.id, position: 0 }
			})
		).json();

		const win = await openTimeline(page);
		await win.locator('.scene-cell').first().click();

		const panel = page.locator('.entity-detail-host');
		await panel.locator('.mode-toggle').click();

		const sensory = panel
			.locator('[data-field="sensoryAnchor"]')
			.locator('textarea.field-textarea, input.field-input')
			.first();
		await sensory.fill('Smell of damp moss');
		await sensory.blur();

		const wct = panel.locator('[data-field="wordCountTarget"]').locator('input.field-input');
		await wct.fill('1500');
		await wct.blur();

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const data = ents.find((e: any) => e.id === sc.id).data ?? {};
			expect(data.sensoryAnchor).toBe('Smell of damp moss');
			// Stored as number or numeric string — accept either
			expect(String(data.wordCountTarget)).toBe('1500');
		}).toPass({ timeout: 3000 });
	});
});
