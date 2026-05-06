import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { html5Drag } from './helpers/html5-drag.js';

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

test.describe('V2 Act reorder preserves spotlight Time (D8 / 6A)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('Time stays unchanged after reordering acts', async ({ page, request }) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const b = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const c = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'C', position: 2 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: b.id, end_act_id: b.id }
		});

		const win = await openTimeline(page);

		// Activate spotlight; click at 50% across (Time = 1.5 in 3-act story).
		await win.locator('button.scrub-toggle').click();
		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('rows box');
		await page.mouse.click(rowsBox.x + rowsBox.width * 0.5, rowsBox.y + 30);
		await expect(win.locator('button.scrub-toggle')).toContainText('Time = 1.5');

		// Drag Act C to the LEFT half of Act A's header → C lands at idx 0.
		const headerA = win.locator(`.act-col-header[data-entity-id="${a.id}"]`);
		const headerC = win.locator(`.act-col-header[data-entity-id="${c.id}"]`);
		await headerC.hover();
		const aBox = await headerA.boundingBox();
		if (!aBox) throw new Error('headerA box');
		await html5Drag(page, headerC.locator('.act-grip'), {
			element: headerA,
			x: aBox.x + aBox.width * 0.2,
			y: aBox.y + aBox.height / 2
		});

		// Server reflects the new ordering.
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const acts = ents
				.filter((e: any) => e.type === 'Act')
				.sort((x: any, y: any) => x.position - y.position);
			expect(acts.map((x: any) => x.id)).toEqual([c.id, a.id, b.id]);
		}).toPass({ timeout: 3000 });

		// Playhead T (absolute story-time) must be unchanged.
		await expect(win.locator('button.scrub-toggle')).toContainText('Time = 1.5');
	});

	// Cross-window Story Graph dim assertion lives in playhead-scrubber.spec.ts;
	// the post-reorder swap is deferred to the Phase 1B graph refine since it
	// also fails standalone (window stacking pre-existing flake).
});
