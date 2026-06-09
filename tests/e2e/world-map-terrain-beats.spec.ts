/**
 * WM3 Slice D — time-varying terrain beats E2E.
 *
 * The terrain-beat behavior: both brushes commit at the CURRENT playhead T and
 * the projection folds strokes in the (anchorT, t] window, so scrubbing the
 * playhead then painting authors a terrain change (forest→ash) that exists
 * only from that story-time onward. This spec locks the full authoring loop:
 *
 *   1. the paint-at indicator surfaces WHEN the brush will paint;
 *   2. a stroke painted at a later T commits with that tPosition;
 *   3. scrubbing BEFORE the paint T shows the map WITHOUT the art
 *      (pixel-identical to the pre-paint canvas at that T);
 *   4. scrubbing back past the paint T shows the art.
 *
 * Red if the brush stops committing at the playhead (paints "always"), if the
 * fold loses its T-window, or if the indicator disappears.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

// Tall viewport: the World Map keeps its default geometry (1024×668 at 80,0)
// and the Timeline is dragged BELOW it, so the two windows never overlap —
// canvas screenshots stay window-chrome-free and both stay clickable without
// z-order raises (a raised window covering the other was the flaky
// alternative).
test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1600, height: 1240 } });

type Ent = { id: string; name: string };

async function clearAll(request: APIRequestContext) {
	const ents: Ent[] = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}

const post = async <T>(r: APIRequestContext, url: string, data: unknown): Promise<T> =>
	(await r.post(url, { data })).json();

/** Acts 0–2 (×2 scenes) + a spanning interval so the timeline has extent. */
async function seedTimelineAndMap(request: APIRequestContext) {
	const acts: Ent[] = [];
	for (let i = 0; i < 3; i++) {
		acts.push(await post(request, '/api/entities', { type: 'Act', name: `Act ${i}`, position: i }));
	}
	for (const [ai, act] of acts.entries()) {
		for (let s = 0; s < 2; s++) {
			await post(request, '/api/entities', {
				type: 'Scene',
				name: `S${ai}.${s}`,
				parentId: act.id,
				position: s
			});
		}
	}
	const hero = await post<Ent>(request, '/api/entities', { type: 'Character', name: 'Chronicle' });
	await request.post('/api/intervals', {
		data: { entity_id: hero.id, start_act_id: acts[0].id, end_act_id: acts[2].id }
	});

	const loc = await post<Ent>(request, '/api/entities', { type: 'Location', name: 'Beat Realm' });
	const map = await post<{ id: string }>(request, '/api/maps', { name: 'Terrain Beats' });
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480, locationId: loc.id }
	});
	return map;
}

test('painting at a later playhead authors a terrain beat: absent before, present after', async ({
	page,
	request
}) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
	});

	const map = await seedTimelineAndMap(request);

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible({ timeout: 10000 });

	// Open the timeline and drag it below the World Map window (titlebar drag)
	// so neither window ever occludes the other.
	await page.click('button[title="Timeline"]');
	const tlWin = page.locator('.window[aria-label="Timeline"]');
	await expect(tlWin).toBeVisible();
	const tlBox = await tlWin.boundingBox();
	const mapBox = await win.boundingBox();
	if (!tlBox || !mapBox) throw new Error('window has no bounding box');
	await page.mouse.move(tlBox.x + tlBox.width / 2, tlBox.y + 10);
	await page.mouse.down();
	await page.mouse.move(300 + tlBox.width / 2, mapBox.y + mapBox.height + 40, { steps: 5 });
	await page.mouse.up();

	await tlWin.locator('.scrub-toggle').click();
	const rowsBox = await tlWin.locator('.rows').boundingBox();
	if (!rowsBox) throw new Error('timeline rows have no bounding box');
	const playheadT = async () =>
		Number(await tlWin.locator('.playhead').getAttribute('aria-valuenow'));

	// Scrub positions: EARLY (near the story start) and LATE (mid-story).
	const earlyX = rowsBox.x + rowsBox.width * 0.03;
	const lateX = rowsBox.x + rowsBox.width * 0.6;
	const rowsY = rowsBox.y + 30;

	// Baseline: the canvas at the EARLY position, before any painting.
	await page.mouse.click(earlyX, rowsY);
	await expect.poll(playheadT, { timeout: 8000 }).toBeLessThan(0.5);
	await page.waitForTimeout(400);
	const earlyBefore = await canvas.screenshot();

	// Scrub LATE and paint a freeform stroke there.
	await page.mouse.click(lateX, rowsY);
	await expect.poll(playheadT, { timeout: 8000 }).toBeGreaterThan(0.8);
	const paintT = await playheadT();

	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Brush' }).click();
	await win.locator('.brush-mode-toggle button', { hasText: 'Freeform' }).click();
	// Slice D affordance: the author can SEE the story-time they paint at.
	await expect(win.locator('[data-testid="paint-at-indicator"]')).toContainText('Painting from');

	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');
	const startX = box.x + box.width * 0.25;
	const y = box.y + box.height * 0.5;
	const lateBefore = await canvas.screenshot();
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(startX + box.width * 0.25, y + 30, { steps: 10 });
	await page.mouse.up();

	// The stroke committed AT the scrubbed playhead, not at the baseline.
	await expect
		.poll(
			async () => {
				const { rows } = (await (await request.get(`/api/maps/${map.id}/events`)).json()) as {
					rows: Array<{ kind: string; tPosition: number }>;
				};
				return rows.find((r) => r.kind === 'paint_stroke')?.tPosition ?? null;
			},
			{ timeout: 8000 }
		)
		.toBeCloseTo(paintT, 5);

	// The art renders at the paint T…
	await page.waitForTimeout(600);
	const lateAfter = await canvas.screenshot();
	expect(Buffer.compare(lateBefore, lateAfter)).not.toBe(0);

	// …and does NOT exist before it: the EARLY canvas is pixel-identical to its
	// pre-paint baseline. (Same click coords → same playhead T → same state.)
	// Switch off the brush first so the brush overlay can't differ.
	await win.locator('[data-testid="map-tool-selector"] button', { hasText: 'Select' }).click();
	await page.mouse.click(earlyX, rowsY);
	await expect.poll(playheadT, { timeout: 8000 }).toBeLessThan(0.5);
	await page.waitForTimeout(600);
	const earlyAfter = await canvas.screenshot();
	expect(Buffer.compare(earlyBefore, earlyAfter)).toBe(0);

	// Scrub forward again — the beat re-appears (the fold is T-windowed, not
	// destructive).
	await page.mouse.click(lateX, rowsY);
	await expect.poll(playheadT, { timeout: 8000 }).toBeGreaterThan(0.8);
	await page.waitForTimeout(600);
	const lateAgain = await canvas.screenshot();
	expect(Buffer.compare(lateAgain, earlyBefore)).not.toBe(0);

	expect(errors, errors.join('\n')).toEqual([]);
});
