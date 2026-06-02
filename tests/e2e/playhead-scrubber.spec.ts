import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

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
	await page.goto('/app');
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
		await expect(win.locator('.scrub-toggle')).toContainText(/Hide spotlight|Time = 0\.00/);

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

		// Playhead landed at T ≈ 1.5 (the toggle no longer shows the decimal Time;
		// read it off the PlayheadOverlay's aria-valuenow instead).
		await expect(async () => {
			const t = Number(await win.locator('.playhead').getAttribute('aria-valuenow'));
			expect(t).toBeCloseTo(1.5, 1);
		}).toPass({ timeout: 2000 });
		// Overlay positioned in right half of the track
		const overlayBox = await win.locator('.playhead').boundingBox();
		if (!overlayBox) throw new Error('overlay');
		expect(overlayBox.x).toBeGreaterThan(rowsBox.x + rowsBox.width * 0.5);
	});

	test('Story Graph nodes dim when the entity is out of scope', async ({ page, request }) => {
		const { ellie, damien } = await seed(request);
		const tlWin = await openTimeline(page);
		// Wait for Timeline to finish loading both interval bars before proceeding.
		// StoryGraph reads the same intervalsStore singleton; without this wait the
		// store may still be empty when the scrubber activates, leaving outOfScope
		// empty and no nodes dimmed.
		await expect(tlWin.locator('.bar-wrapper')).toHaveCount(2);

		await page.click('button[title="Story Graph"]');
		const sgWin = page.locator('.window[aria-label="Story Graph"]');
		await expect(sgWin).toBeVisible();

		// Idle — neither node dimmed
		await expect(sgWin.locator('.node.node-out-of-scope')).toHaveCount(0);

		// Activate scrubber. Use dispatchEvent (not click/force) so the Story Graph
		// window physically overlapping the Timeline doesn't intercept the event.
		await tlWin.locator('.scrub-toggle').dispatchEvent('click');
		const rows = tlWin.locator('.rows');
		const rowsBox = await rows.boundingBox();
		if (!rowsBox) throw new Error('rows box');

		// Scrub to T≈0.5 via dispatchEvent so the overlay cannot intercept.
		// clientX/Y are required for clickTrackToScrub's position calculation.
		await rows.dispatchEvent('click', {
			bubbles: true,
			cancelable: true,
			clientX: rowsBox.x + rowsBox.width * 0.25,
			clientY: rowsBox.y + 30
		});
		// Confirm the scrub registered before checking Story Graph state
		await expect(async () => {
			const t = Number(await tlWin.locator('.playhead').getAttribute('aria-valuenow'));
			expect(t).toBeCloseTo(0.5, 1);
		}).toPass({ timeout: 2000 });

		// Damien dimmed, Ellie not
		const ellieNode = sgWin.locator('.node').filter({ hasText: 'Ellie' });
		const damienNode = sgWin.locator('.node').filter({ hasText: 'Damien' });
		await expect(damienNode).toHaveClass(/node-out-of-scope/);
		await expect(ellieNode).not.toHaveClass(/node-out-of-scope/);

		// Scrub to T = 1.5 (middle of Act B) → swap
		await rows.dispatchEvent('click', {
			bubbles: true,
			cancelable: true,
			clientX: rowsBox.x + rowsBox.width * 0.75,
			clientY: rowsBox.y + 30
		});
		await expect(async () => {
			const t = Number(await tlWin.locator('.playhead').getAttribute('aria-valuenow'));
			expect(t).toBeCloseTo(1.5, 1);
		}).toPass({ timeout: 2000 });
		await expect(ellieNode).toHaveClass(/node-out-of-scope/);
		await expect(damienNode).not.toHaveClass(/node-out-of-scope/);
	});

	// Removed: 'World Map locations dim when their linked entities are out of scope'.
	// The card-based World Map (.loc-card) was replaced by World Map v3, where
	// out-of-scope dimming lives in the Pixi canvas layers (PixiRegionLayer /
	// PixiPlacementLayer) and has no DOM class to assert against. A v3 map-dim
	// e2e would need pixel/canvas inspection and seeded map regions+placements —
	// tracked separately, not a DOM selector port.
});
