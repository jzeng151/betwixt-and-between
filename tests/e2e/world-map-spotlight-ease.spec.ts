/**
 * Cinematic Spotlight (Slice 8) PR0 — ease-mechanism no-storm gate.
 *
 * The single highest risk flagged by both outside reviews: easing region colors
 * toward each projected snapshot must be written IMPERATIVELY to Pixi display
 * objects in the anim-controller tick (Graphics.tint), never through Svelte
 * `$state`/`renderedState` — driving eased values through $state would re-run
 * the layer's geometry $effect at 60fps and re-enter the rebuild storm
 * anim-controller.ts Fix-4 exists to prevent.
 *
 * This spec proves the mechanism under a POPULATED, PLAYING map: it seeds a real
 * map (regions + factions + transfer_region events) and a real timeline (acts +
 * scenes → scene boundaries), hits Play on the Story Player, and asserts that
 * over a multi-second playback the anim ticker runs at frame rate (hundreds of
 * ticks) while the region-geometry rebuild count stays FLAT (single digits). A
 * storm would make rebuilds ≈ ticks; the fix makes ticks ≫ rebuilds.
 *
 * The diagnostic counters (window.__spotlightRegionTicks / __spotlightRegion
 * Rebuilds) are exposed by PixiRegionLayer only when window.__SPOTLIGHT_DIAG__
 * is set (below, via addInitScript) — prod stays clean.
 *
 * NOTE: this is a deliberately minimal throwaway seed to exercise the gate, NOT
 * the PR3/T8 demo world (war + migration + journey, cross-map). The richer demo
 * seed and the script-vs-hand-authored decision remain T8's.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
	const { rows: facs }: { rows: Array<{ id: string; isSystem?: boolean }> } = await (
		await request.get('/api/factions')
	).json();
	for (const f of facs) if (!f.isSystem) await request.delete(`/api/factions/${f.id}`);
}

async function seed(request: APIRequestContext) {
	await clearAll(request);

	// Timeline: 2 acts × 2 scenes → scene boundaries the playhead steps through.
	const a0 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act 0', position: 0 } })
	).json();
	const a1 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act 1', position: 1 } })
	).json();
	for (const [act, names] of [
		[a0, ['S0', 'S1']],
		[a1, ['S2', 'S3']]
	] as const) {
		let pos = 0;
		for (const name of names) {
			await request.post('/api/entities', {
				data: { type: 'Scene', name, parentId: act.id, position: pos++ }
			});
		}
	}
	// An interval so the timeline has content driving maxT > 0.
	const hero = await (
		await request.post('/api/entities', { data: { type: 'Character', name: 'Hero' } })
	).json();
	await request.post('/api/intervals', {
		data: { entity_id: hero.id, start_act_id: a0.id, end_act_id: a1.id }
	});

	// Map + one region + two factions. The transfer_region events flip the
	// region's owner as the playhead crosses them, so its color CHANGES during
	// playback — the scenario that WOULD storm under the old $state path.
	const map = await (await request.post('/api/maps', { data: { name: 'Ease Gate' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 600, height: 400 }
	});
	const region = await (
		await request.post(`/api/maps/${map.id}/regions`, {
			data: {
				polygon: [
					[40, 40],
					[40, 360],
					[560, 360],
					[560, 40]
				]
			}
		})
	).json();
	const red = await (
		await request.post('/api/factions', { data: { name: 'Crimson', color: '#ef4444' } })
	).json();
	const blue = await (
		await request.post('/api/factions', { data: { name: 'Azure', color: '#3b82f6' } })
	).json();
	// Flip owner mid-story: neutral → red at 0.3, red → blue at 0.6.
	for (const [tPosition, faction] of [
		[0.3, red],
		[0.6, blue]
	] as const) {
		await request.post(`/api/maps/${map.id}/events`, {
			data: {
				tPosition,
				kind: 'transfer_region',
				payloadJsonb: { region_id: region.id, new_faction_id: faction.id }
			}
		});
	}
	return { map, region, red, blue };
}

async function openWorldMap(page: Page) {
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	// Region layer mounts under the Pixi canvas.
	await expect(win.locator('.pixi-stage canvas')).toBeVisible({ timeout: 10000 });
	return win;
}

test('opening the map does not activate the global playhead', async ({ page, request }) => {
	await seed(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');

	await page.click('button[title="Timeline"]');
	const timeline = page.locator('.window[aria-label="Timeline"]');
	await expect(timeline).toBeVisible();
	await expect(timeline.locator('.playhead')).toHaveCount(0);

	const map = await openWorldMap(page);
	await expect(map.locator('.map-loading-overlay')).toBeHidden({ timeout: 10000 });
	await expect(timeline.locator('.playhead')).toHaveCount(0);
});

test('eased region color glides imperatively: ticker runs at frame rate with NO geometry rebuild storm', async ({
	page,
	request
}) => {
	await seed(request);

	await page.addInitScript(() => {
		localStorage.setItem('tutorial-dismissed', 'true');
		(window as unknown as { __SPOTLIGHT_DIAG__?: boolean }).__SPOTLIGHT_DIAG__ = true;
	});
	await page.goto('/app');

	await openWorldMap(page);

	// Open the Timeline + Story Player (Spotlight) and pick the fastest speed.
	await page.click('button[title="Timeline"]');
	const tlWin = page.locator('.window[aria-label="Timeline"]');
	await expect(tlWin).toBeVisible();
	await tlWin.locator('.scrub-toggle').click();
	const playerWin = page.locator('.window[aria-label="Story Player"]');
	await expect(playerWin).toBeVisible();
	await playerWin.locator('.speed-select').selectOption('2');

	// Let the ticker spin up, then snapshot the counters just before Play so we
	// measure the DELTA during playback (the region layer keeps the rebuild
	// counter as an absolute; ticks are cumulative).
	await page.waitForTimeout(500);
	const before = await page.evaluate(() => {
		const w = window as unknown as {
			__spotlightRegionRebuilds?: number;
			__spotlightRegionTicks?: number;
		};
		return { rebuilds: w.__spotlightRegionRebuilds ?? 0, ticks: w.__spotlightRegionTicks ?? 0 };
	});

	const playBtn = playerWin.locator('.play-btn');
	await playBtn.click();
	await expect(playBtn).toHaveClass(/playing/);

	// Play across both owner-flips (0.3, 0.6). The playhead overlay's
	// aria-valuenow advances; wait until it crosses 0.6 so the region color has
	// actually changed twice during this window (anti-vacuous: a no-storm result
	// is only meaningful if something was animating).
	const playhead = tlWin.locator('.playhead');
	await expect
		.poll(
			async () => {
				const v = await playhead.getAttribute('aria-valuenow');
				return v ? Number(v) : 0;
			},
			{ timeout: 15000, intervals: [200] }
		)
		.toBeGreaterThan(0.6);

	const after = await page.evaluate(() => {
		const w = window as unknown as {
			__spotlightRegionRebuilds?: number;
			__spotlightRegionTicks?: number;
		};
		return { rebuilds: w.__spotlightRegionRebuilds ?? 0, ticks: w.__spotlightRegionTicks ?? 0 };
	});

	const ticksDelta = after.ticks - before.ticks;
	const rebuildsDelta = after.rebuilds - before.rebuilds;

	// The anim ticker genuinely ran at frame rate during playback (≥ a few
	// seconds × tens of fps). Without this, the no-storm assertion is vacuous.
	expect(ticksDelta).toBeGreaterThan(100);
	// The mechanism under test: eased color is written imperatively (tint), so the
	// geometry $effect did NOT rebuild per frame. A storm would put rebuildsDelta
	// on the order of ticksDelta; the fix keeps it to a handful (shape never
	// changed during playback — at most a few incidental store-driven rebuilds).
	expect(rebuildsDelta).toBeLessThan(30);
	// And by a wide margin — the ratio is the proof.
	expect(ticksDelta).toBeGreaterThan(rebuildsDelta * 10);
});

test('SHIP GATE: a conquest flash fires when a region owner flips during playback', async ({
	page,
	request
}) => {
	await seed(request); // region owner flips at t=0.3 and t=0.6

	await page.addInitScript(() => {
		localStorage.setItem('tutorial-dismissed', 'true');
		(window as unknown as { __SPOTLIGHT_DIAG__?: boolean }).__SPOTLIGHT_DIAG__ = true;
	});
	await page.goto('/app');

	await openWorldMap(page);
	await page.click('button[title="Timeline"]');
	const tlWin = page.locator('.window[aria-label="Timeline"]');
	await expect(tlWin).toBeVisible();
	await tlWin.locator('.scrub-toggle').click();
	const playerWin = page.locator('.window[aria-label="Story Player"]');
	await expect(playerWin).toBeVisible();
	await playerWin.locator('.speed-select').selectOption('2');

	// Set the playhead near the start so play() crosses 0.3 then 0.6.
	const rowsBox = await tlWin.locator('.rows').boundingBox();
	if (!rowsBox) throw new Error('timeline rows have no bounding box');
	await page.mouse.click(rowsBox.x + rowsBox.width * 0.02, rowsBox.y + 30);
	await expect
		.poll(async () => Number(await tlWin.locator('.playhead').getAttribute('aria-valuenow')), {
			timeout: 8000
		})
		.toBeLessThan(0.25);

	// Reset the counter AFTER seeking — the scrub-back itself flips the owner
	// (blue→neutral) and flashes, which is correct but not what we're asserting.
	// We want a flash that fires during PLAYBACK crossing a flip forward.
	await page.evaluate(() => {
		(window as unknown as { __spotlightFlashCount?: number }).__spotlightFlashCount = 0;
	});

	await playerWin.locator('.play-btn').click();
	await expect(playerWin.locator('.play-btn')).toHaveClass(/playing/);

	// As the playhead auto-advances across an owner-flip (0.3, then 0.6), the
	// punctuation layer spawns a white-additive flash. Poll the diag counter.
	await expect
		.poll(
			async () =>
				page.evaluate(
					() => (window as unknown as { __spotlightFlashCount?: number }).__spotlightFlashCount ?? 0
				),
			{ timeout: 15000, intervals: [200] }
		)
		.toBeGreaterThan(0);

	// The within-map camera follows: once a flip sets a target, the camera eases
	// the viewport toward it during (unpinned) playback.
	await expect
		.poll(
			async () =>
				page.evaluate(
					() =>
						(window as unknown as { __spotlightCameraMoves?: number }).__spotlightCameraMoves ?? 0
				),
			{ timeout: 8000, intervals: [200] }
		)
		.toBeGreaterThan(0);
});

// NOTE: pin-on-interact via a VIEWPORT GESTURE (drag/pinch/wheel) is not
// e2e-covered here — Playwright synthetic mouse gestures don't reach
// pixi-viewport's plugins in headless Firefox (neither 'drag-start' nor
// 'wheel-start' fire), so the assertion can't be driven reliably. The wiring is
// mechanism-verified instead: the event names match the installed pixi-viewport
// bundle ('drag-start' / 'pinch-start' / 'wheel-start'), and the MANUAL-SELECT
// pin path (onSwitchMap → playback.pin()) is exercised by
// world-map-spotlight-nav-regression.spec.ts.

test('reduced motion: the conquest flash is suppressed (jump-cut)', async ({ page, request }) => {
	await seed(request);
	await page.emulateMedia({ reducedMotion: 'reduce' });

	await page.addInitScript(() => {
		localStorage.setItem('tutorial-dismissed', 'true');
		(window as unknown as { __SPOTLIGHT_DIAG__?: boolean }).__SPOTLIGHT_DIAG__ = true;
	});
	await page.goto('/app');

	await openWorldMap(page);
	await page.click('button[title="Timeline"]');
	const tlWin = page.locator('.window[aria-label="Timeline"]');
	await expect(tlWin).toBeVisible();
	await tlWin.locator('.scrub-toggle').click();
	const playerWin = page.locator('.window[aria-label="Story Player"]');
	await expect(playerWin).toBeVisible();
	await playerWin.locator('.speed-select').selectOption('2');

	const rowsBox = await tlWin.locator('.rows').boundingBox();
	if (!rowsBox) throw new Error('timeline rows have no bounding box');
	await page.mouse.click(rowsBox.x + rowsBox.width * 0.02, rowsBox.y + 30);
	await expect
		.poll(async () => Number(await tlWin.locator('.playhead').getAttribute('aria-valuenow')), {
			timeout: 8000
		})
		.toBeLessThan(0.25);
	await page.evaluate(() => {
		(window as unknown as { __spotlightFlashCount?: number }).__spotlightFlashCount = 0;
	});

	await playerWin.locator('.play-btn').click();
	await expect(playerWin.locator('.play-btn')).toHaveClass(/playing/);

	// Play past BOTH flips (cross 0.6), then assert NO flash fired — under reduced
	// motion the owner change still reads via the snapped tint, but the flashing FX
	// is suppressed.
	await expect
		.poll(async () => Number(await tlWin.locator('.playhead').getAttribute('aria-valuenow')), {
			timeout: 15000,
			intervals: [200]
		})
		.toBeGreaterThan(0.6);
	const flashes = await page.evaluate(
		() => (window as unknown as { __spotlightFlashCount?: number }).__spotlightFlashCount ?? 0
	);
	expect(flashes).toBe(0);
});
