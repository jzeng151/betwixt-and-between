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
	const ellie = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
	).json();
	await request.post('/api/intervals', {
		data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a0.id }
	});
	const damien = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Damien' } })
	).json();
	await request.post('/api/intervals', {
		data: { entity_id: damien.id, start_act_id: a1.id, end_act_id: a1.id }
	});
	return { a0, a1, ellie, damien };
}

async function openTimeline(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.click('button[title="Timeline"]');
	const win = page.locator('.window[aria-label="Timeline"]');
	await expect(win).toBeVisible();
	return win;
}

test.describe('Story Player window', () => {
	test('Spotlight toggle opens a standalone Story Player window; closing it dismisses the playhead', async ({
		page,
		request
	}) => {
		await seed(request);
		const tlWin = await openTimeline(page);
		const playerWin = page.locator('.window[aria-label="Story Player"]');

		await expect(playerWin).toHaveCount(0);

		await tlWin.locator('.scrub-toggle').click();
		await expect(playerWin).toBeVisible();
		await expect(playerWin.locator('[aria-label="Play"]')).toBeVisible();
		// Playhead overlay shows on the Timeline because the dock activated it.
		await expect(tlWin.locator('.playhead')).toBeVisible();

		// Closing the standalone window via its titlebar X dismisses the playhead.
		await playerWin.locator('.window-control-close, .window-close, [aria-label="Close"]').first().click();
		await expect(playerWin).toHaveCount(0);
		await expect(tlWin.locator('.playhead')).toHaveCount(0);
	});

	test('play button auto-advances the playhead at the configured speed; pause stops it', async ({
		page,
		request
	}) => {
		await seed(request);
		const tlWin = await openTimeline(page);
		await tlWin.locator('.scrub-toggle').click();
		const playerWin = page.locator('.window[aria-label="Story Player"]');

		await playerWin.locator('.speed-select').selectOption('2');

		const playBtn = playerWin.locator('.play-btn');
		await playBtn.click();
		await expect(playBtn).toHaveClass(/playing/);
		await expect(tlWin.locator('.playhead')).toBeVisible();

		// First tick fires after ~2s; allow generous slack for CI.
		await page.waitForTimeout(2600);

		await playBtn.click();
		await expect(playBtn).not.toHaveClass(/playing/);

		const overlayBox = await tlWin.locator('.playhead').boundingBox();
		const rowsBox = await tlWin.locator('.rows').boundingBox();
		if (!overlayBox || !rowsBox) throw new Error('missing geometry');
		expect(overlayBox.x - rowsBox.x).toBeGreaterThan(rowsBox.width * 0.25);
	});

	test('step forward and step back jump scene-by-scene without playing', async ({
		page,
		request
	}) => {
		await seed(request);
		const tlWin = await openTimeline(page);
		await tlWin.locator('.scrub-toggle').click();
		const playerWin = page.locator('.window[aria-label="Story Player"]');

		const playBtn = playerWin.locator('.play-btn');
		await playerWin.locator('[aria-label="Step forward"]').click();
		const rowsBox = await tlWin.locator('.rows').boundingBox();
		const after1 = await tlWin.locator('.playhead').boundingBox();
		if (!rowsBox || !after1) throw new Error('missing geometry');
		expect(after1.x - rowsBox.x).toBeGreaterThan(rowsBox.width * 0.4);

		await playerWin.locator('[aria-label="Step back"]').click();
		const after2 = await tlWin.locator('.playhead').boundingBox();
		if (!after2) throw new Error('missing geometry');
		expect(after2.x - rowsBox.x).toBeLessThan(rowsBox.width * 0.1);

		await expect(playBtn).not.toHaveClass(/playing/);
	});

	test('manual scrub during playback pauses playback', async ({ page, request }) => {
		await seed(request);
		const tlWin = await openTimeline(page);
		await tlWin.locator('.scrub-toggle').click();
		const playerWin = page.locator('.window[aria-label="Story Player"]');
		await playerWin.locator('.speed-select').selectOption('16');

		const playBtn = playerWin.locator('.play-btn');
		await playBtn.click();
		await expect(playBtn).toHaveClass(/playing/);

		const rows = tlWin.locator('.rows');
		const rowsBox = await rows.boundingBox();
		if (!rowsBox) throw new Error('rows box');
		await rows.dispatchEvent('click', {
			bubbles: true,
			cancelable: true,
			clientX: rowsBox.x + rowsBox.width * 0.75,
			clientY: rowsBox.y + 30
		});

		await expect(playBtn).not.toHaveClass(/playing/);
	});
});
