import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
}

async function seed(request: APIRequestContext) {
	await clearAll(request);
	const a0 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
	).json();
	const a1 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } })
	).json();
	// Ellie — present only in Act A
	const ellie = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
	).json();
	await request.post('/api/intervals', {
		data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a0.id }
	});
	// Damien — present only in Act B
	const damien = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Damien' } })
	).json();
	await request.post('/api/intervals', {
		data: { entity_id: damien.id, start_act_id: a1.id, end_act_id: a1.id }
	});
	// Castle — Location linked to Ellie via located_at
	const castle = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Castle' } })
	).json();
	await request.post('/api/relationships', {
		data: { fromId: ellie.id, toId: castle.id, type: 'located_at' }
	});
	// Forest — Location linked to Damien
	const forest = await (
		await request.post('/api/entities', { data: { type: 'Location', name: 'Forest' } })
	).json();
	await request.post('/api/relationships', {
		data: { fromId: damien.id, toId: forest.id, type: 'located_at' }
	});
	return { a0, a1, ellie, damien, castle, forest };
}

async function openTimeline(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/');
	await page.click('button[title="Timeline"]');
	const win = page.locator('.window[aria-label="Timeline"]');
	await expect(win).toBeVisible();
	return win;
}

test.describe('Playhead scrubber', () => {
	test('toggle button activates the overlay; second click dismisses', async ({
		page,
		request
	}) => {
		await seed(request);
		const win = await openTimeline(page);

		await expect(win.locator('.playhead')).toHaveCount(0);

		await win.locator('.scrub-toggle').click();
		await expect(win.locator('.playhead')).toBeVisible();
		await expect(win.locator('.scrub-toggle')).toContainText(/Hide spotlight|T = 0\.00/);

		await win.locator('.scrub-toggle').click();
		await expect(win.locator('.playhead')).toHaveCount(0);
	});

	test('clicking on the track while active scrubs the playhead', async ({ page, request }) => {
		await seed(request);
		const win = await openTimeline(page);

		await win.locator('.scrub-toggle').click();

		const rowsBox = await win.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('rows box');
		// Click at 75% across (T ≈ 1.5 in a 2-act story)
		await page.mouse.click(rowsBox.x + rowsBox.width * 0.75, rowsBox.y + 30);
		await page.waitForTimeout(100);

		// Toolbar shows updated T
		await expect(win.locator('.scrub-toggle')).toContainText('T = 1.5');
		// Overlay positioned in right half of the track
		const overlayBox = await win.locator('.playhead').boundingBox();
		if (!overlayBox) throw new Error('overlay');
		expect(overlayBox.x).toBeGreaterThan(rowsBox.x + rowsBox.width * 0.5);
	});

	test('Story Graph nodes dim when the entity is out of scope', async ({ page, request }) => {
		const { ellie, damien } = await seed(request);
		const tlWin = await openTimeline(page);

		await page.click('button[title="Story Graph"]');
		const sgWin = page.locator('.window[aria-label="Story Graph"]');
		await expect(sgWin).toBeVisible();

		// Idle — neither node dimmed
		await expect(sgWin.locator('.node.node-out-of-scope')).toHaveCount(0);

		// Activate scrubber and scrub to T = 0.5 (middle of Act A → Ellie active, Damien out)
		await tlWin.locator('.scrub-toggle').click();
		const rowsBox = await tlWin.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('rows box');
		await page.mouse.click(rowsBox.x + rowsBox.width * 0.25, rowsBox.y + 30);
		await page.waitForTimeout(150);

		// Damien dimmed, Ellie not
		const ellieNode = sgWin.locator('.node').filter({ hasText: 'Ellie' });
		const damienNode = sgWin.locator('.node').filter({ hasText: 'Damien' });
		await expect(damienNode).toHaveClass(/node-out-of-scope/);
		await expect(ellieNode).not.toHaveClass(/node-out-of-scope/);

		// Scrub to T = 1.5 (middle of Act B) → swap
		await page.mouse.click(rowsBox.x + rowsBox.width * 0.75, rowsBox.y + 30);
		await page.waitForTimeout(150);
		await expect(ellieNode).toHaveClass(/node-out-of-scope/);
		await expect(damienNode).not.toHaveClass(/node-out-of-scope/);
	});

	test('World Map locations dim when their linked entities are out of scope', async ({
		page,
		request
	}) => {
		await seed(request);
		const tlWin = await openTimeline(page);

		await page.click('button[title="World Map"]');
		const wmWin = page.locator('.window[aria-label="World Map"]');
		await expect(wmWin).toBeVisible();

		// Idle — neither location dimmed
		await expect(wmWin.locator('.loc-card.out-of-scope')).toHaveCount(0);

		// Scrub to T = 0.5 → Ellie active → Castle in-scope, Forest dimmed
		await tlWin.locator('.scrub-toggle').click();
		const rowsBox = await tlWin.locator('.rows').boundingBox();
		if (!rowsBox) throw new Error('rows box');
		await page.mouse.click(rowsBox.x + rowsBox.width * 0.25, rowsBox.y + 30);
		await page.waitForTimeout(150);

		const castle = wmWin.locator('.loc-card').filter({ hasText: 'Castle' });
		const forest = wmWin.locator('.loc-card').filter({ hasText: 'Forest' });
		await expect(forest).toHaveClass(/out-of-scope/);
		await expect(castle).not.toHaveClass(/out-of-scope/);

		// Scrub to T = 1.5 → swap
		await page.mouse.click(rowsBox.x + rowsBox.width * 0.75, rowsBox.y + 30);
		await page.waitForTimeout(150);
		await expect(castle).toHaveClass(/out-of-scope/);
		await expect(forest).not.toHaveClass(/out-of-scope/);
	});
});
