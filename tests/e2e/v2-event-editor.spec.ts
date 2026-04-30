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

test.describe('V2 Event editor (D5 + D4 multi-POV)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking an event bar opens the editor with Description/POV/Outcome/Mood/Color', async ({
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
		await win.locator('.entity-detail-host .mode-toggle').click();

		const panel = win.locator('.entity-detail');
		await expect(panel).toBeVisible();
		await expect(panel.locator('[data-field="description"]')).toBeVisible();
		await expect(panel.locator('[data-field="pov"]')).toBeVisible();
		await expect(panel.locator('[data-field="outcome"]')).toBeVisible();
		await expect(panel.locator('[data-field="mood"]')).toBeVisible();
		await expect(panel.locator('[data-field="color"]')).toBeVisible();
	});

	test('selecting two POV characters writes 2 pov_of relationship rows', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const ev = await (
			await request.post('/api/entities', { data: { type: 'Event', name: 'Battle' } })
		).json();
		const c1 = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		const c2 = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Damien' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ev.id, start_act_id: a0.id, end_act_id: a0.id }
		});

		const win = await openTimeline(page);
		await win.locator('.bar-wrapper').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		const povField = win.locator('.entity-detail [data-field="pov"]');
		// Pick Ellie
		await povField.locator(`[data-pick-id="${c1.id}"]`).click();
		// Pick Damien
		await povField.locator(`[data-pick-id="${c2.id}"]`).click();

		await expect(async () => {
			const rels = await (await request.get('/api/relationships')).json();
			const povRels = rels.filter(
				(r: any) => r.fromId === ev.id && r.type === 'pov_of'
			);
			expect(povRels).toHaveLength(2);
			const targetIds = povRels.map((r: any) => r.toId).sort();
			expect(targetIds).toEqual([c1.id, c2.id].sort());
		}).toPass({ timeout: 3000 });
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
		await win.locator('.entity-detail-host .mode-toggle').click();

		const outcomeSelect = win
			.locator('.entity-detail [data-field="outcome"]')
			.locator('select');
		await outcomeSelect.selectOption('yes-but');

		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const data = JSON.parse(ents.find((e: any) => e.id === ev.id).data || '{}');
			expect(data.outcome).toBe('yes-but');
		}).toPass({ timeout: 3000 });
	});

	test('removing a POV chip deletes the relationship row', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const ev = await (
			await request.post('/api/entities', { data: { type: 'Event', name: 'Battle' } })
		).json();
		const c1 = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ev.id, start_act_id: a0.id, end_act_id: a0.id }
		});
		await request.post('/api/relationships', {
			data: { fromId: ev.id, toId: c1.id, type: 'pov_of' }
		});

		const win = await openTimeline(page);
		await win.locator('.bar-wrapper').first().click();
		await win.locator('.entity-detail-host .mode-toggle').click();

		await win
			.locator('.entity-detail [data-field="pov"]')
			.locator(`[data-remove-id="${c1.id}"]`)
			.click();

		await expect(async () => {
			const rels = await (await request.get('/api/relationships')).json();
			const povRels = rels.filter(
				(r: any) => r.fromId === ev.id && r.type === 'pov_of'
			);
			expect(povRels).toHaveLength(0);
		}).toPass({ timeout: 3000 });
	});
});
