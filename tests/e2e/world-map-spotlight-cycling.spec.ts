/**
 * Cinematic Spotlight (Slice 8) PR3 / T8 — demo world + between-map cycling E2E.
 *
 * Seeds "The Ash Host War" through the REAL authoring path (entities, maps,
 * regions, factions, takes_place_at / caused_by relationships, map-events — the
 * same endpoints the editor POSTs to, so the world is editable afterward; P3).
 * Then hits Play on the Story Player and asserts BEHAVIOR, not pixels (eng
 * decision #9):
 *   - the playhead auto-advances,
 *   - the view CYCLES between maps ≥1× with no manual interaction (the headline
 *     T6 behaviour: the map-switcher value changes mid-playback),
 *   - the loading overlay never shows while playing (switch-only-when-ready +
 *     overlay suppression — no strobe),
 *   - the conquest flash and a diegetic caption actually fire on the seeded world
 *     (DIAG counters, proving the FX + T9 caption pipelines end-to-end).
 *
 * The world: Ash Host musters in the Fen (a map-less sublocation → cycling falls
 * back to its Northmarch map), marches west, then the story crosses to Greyhold
 * (cycle #1) where the Fall of Greyhold is caused_by the broken treaty (ripple),
 * then returns north (cycle #2). Three acts scope which Location is active when.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

type Ent = { id: string; name: string };

async function clearAll(request: APIRequestContext) {
	const ents: Ent[] = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
	const { rows: facs }: { rows: Array<{ id: string; isSystem?: boolean }> } = await (
		await request.get('/api/factions')
	).json();
	for (const f of facs) if (!f.isSystem) await request.delete(`/api/factions/${f.id}`);
}

const post = async <T>(r: APIRequestContext, url: string, data: unknown): Promise<T> =>
	(await r.post(url, { data })).json();

/** Seed the demo world. Returns the two map ids and the map-event count. */
async function seedAshHostWar(request: APIRequestContext) {
	await clearAll(request);

	// ── Timeline: 3 acts × 2 scenes → scene boundaries the playhead steps. ──
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
	// An interval spanning all three acts so maxT reaches Act 2.
	const hero = await post<Ent>(request, '/api/entities', { type: 'Character', name: 'Chronicle' });
	await request.post('/api/intervals', {
		data: { entity_id: hero.id, start_act_id: acts[0].id, end_act_id: acts[2].id }
	});

	// ── Locations. Fen is part_of Northmarch and has NO map of its own, so
	//    cycling must fall back to the Northmarch map (ancestor fallback). ──
	const north = await post<Ent>(request, '/api/entities', { type: 'Location', name: 'Northmarch' });
	const fen = await post<Ent>(request, '/api/entities', { type: 'Location', name: 'The Fen' });
	const grey = await post<Ent>(request, '/api/entities', { type: 'Location', name: 'Greyhold' });
	const keep = await post<Ent>(request, '/api/entities', { type: 'Location', name: 'Broken Keep' });
	await post(request, '/api/relationships', { fromId: fen.id, toId: north.id, type: 'part_of' });
	await post(request, '/api/relationships', { fromId: keep.id, toId: grey.id, type: 'part_of' });

	// ── Maps (linked to their Location). Northmarch + Greyhold each bear a map;
	//    Fen / Keep do not. ──
	async function makeMap(name: string, locationId: string) {
		const m = await post<{ id: string }>(request, '/api/maps', { name });
		await request.patch(`/api/maps/${m.id}`, {
			data: { baseImageUrl: 'about:blank', width: 800, height: 500, locationId }
		});
		return m;
	}
	const mapNorth = await makeMap('Northmarch', north.id);
	const mapGrey = await makeMap('Greyhold', grey.id);

	// ── Regions (carry locationId so causal centroids resolve). On Greyhold,
	//    Grey + Keep sit in different halves so the caused_by edge is drawable. ──
	const rect = (x0: number, y0: number, x1: number, y1: number) => [
		[y0, x0],
		[y1, x0],
		[y1, x1],
		[y0, x1]
	];
	const regFen = await post<{ id: string }>(request, `/api/maps/${mapNorth.id}/regions`, {
		locationId: fen.id,
		polygon: rect(60, 60, 740, 440)
	});
	const regGrey = await post<{ id: string }>(request, `/api/maps/${mapGrey.id}/regions`, {
		locationId: grey.id,
		polygon: rect(40, 60, 380, 440)
	});
	await post(request, `/api/maps/${mapGrey.id}/regions`, {
		locationId: keep.id,
		polygon: rect(420, 60, 760, 440)
	});

	// ── Factions. ──
	const ash = await post<{ id: string }>(request, '/api/factions', { name: 'Ash Host', color: '#e0524f' });
	await post(request, '/api/factions', { name: 'Greyhold Watch', color: '#4f7fe0' });

	// ── Event entities (the beats). ──
	const evMuster = await post<Ent>(request, '/api/entities', { type: 'Event', name: 'The Ash Host musters' });
	const evTreaty = await post<Ent>(request, '/api/entities', { type: 'Event', name: 'The broken treaty' });
	const evFall = await post<Ent>(request, '/api/entities', { type: 'Event', name: 'The fall of Greyhold' });
	const evReturn = await post<Ent>(request, '/api/entities', { type: 'Event', name: 'The long road home' });

	// ── takes_place_at, scoped per act → which Location is active when. As the
	//    playhead crosses acts, the active Location (and thus the map) changes. ──
	const tpa = (from: string, to: string, act: Ent) =>
		post<{ id: string; startPosition: number; endPosition: number }>(request, '/api/relationships', {
			fromId: from,
			toId: to,
			type: 'takes_place_at',
			startActId: act.id,
			endActId: act.id
		});
	const tpaMuster = await tpa(evMuster.id, fen.id, acts[0]); // Act 0 → Fen → Northmarch map
	const tpaTreaty = await tpa(evTreaty.id, keep.id, acts[1]); // Act 1 → Keep → Greyhold map
	const tpaFall = await tpa(evFall.id, grey.id, acts[1]); // Act 1 → Greyhold
	await tpa(evReturn.id, north.id, acts[2]); // Act 2 → Northmarch (cycle back)

	// ── caused_by: the fall is caused_by the treaty (effect ← cause). Both
	//    endpoints' regions live on the Greyhold map → a drawable causal edge
	//    that ripples when it lights up. ──
	await post(request, '/api/relationships', {
		fromId: evFall.id,
		toId: evTreaty.id,
		type: 'caused_by'
	});

	// ── Conquest map-events, placed at the MIDPOINT of each act's window (read
	//    back from the computed bounds) so each flash lands on the active map. ──
	const mid = (b: { startPosition: number; endPosition: number }) =>
		b.startPosition + (b.endPosition - b.startPosition) * 0.5;
	let eventCount = 0;
	const transfer = async (mapId: string, regionId: string, tPosition: number) => {
		await request.post(`/api/maps/${mapId}/events`, {
			data: { tPosition, kind: 'transfer_region', payloadJsonb: { region_id: regionId, new_faction_id: ash.id } }
		});
		eventCount++;
	};
	await transfer(mapNorth.id, regFen.id, mid(tpaMuster)); // conquest in Act 0 (Northmarch)
	await transfer(mapGrey.id, regGrey.id, mid(tpaFall)); // conquest in Act 1 (Greyhold)

	// ── A march: a placement on the Northmarch map with two move_entity
	//    keyframes straddling a sampled boundary, so its interpolated position
	//    changes frame-to-frame → a march trail. (GIF flourish; not asserted.)
	//    The placement MUST carry locationId (the map's anchor location), not just
	//    mapId: the move_entity validator scopes placements through location_id +
	//    user_id (world-map-v3.ts D-PRF-8), so a locationId-less placement 400s
	//    every keyframe ("placement_id not found on this map") and the march never
	//    renders. The real editor passes both (WorldMap.svelte placement create);
	//    the original seed omitted locationId, which is why this flourish silently
	//    never fired (T1 dogfood finding). ──
	const warband = await post<Ent>(request, '/api/entities', { type: 'Character', name: 'Ash warband' });
	const placement = await post<{ id: string }>(request, '/api/map-placements', {
		placeableId: warband.id,
		locationId: north.id,
		mapId: mapNorth.id,
		x: 0.2,
		y: 0.5
	});
	const w0 = tpaMuster;
	for (const [frac, x] of [
		[0.2, 0.2],
		[0.7, 0.72]
	] as const) {
		const res = await request.post(`/api/maps/${mapNorth.id}/events`, {
			data: {
				tPosition: w0.startPosition + (w0.endPosition - w0.startPosition) * frac,
				kind: 'move_entity',
				payloadJsonb: { placement_id: placement.id, position: { x, y: 0.5 }, tween: 'ease_in_out' }
			}
		});
		// Guard: a silent 400 here is exactly how the march flourish was dead for so
		// long. Fail the seed loudly if a keyframe doesn't persist.
		if (!res.ok()) throw new Error(`seed move_entity keyframe failed: ${res.status()} ${await res.text()}`);
		eventCount++;
	}

	return { mapNorthId: mapNorth.id, mapGreyId: mapGrey.id, eventCount };
}

async function openWorldMap(page: Page) {
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	await expect(win.locator('.pixi-stage canvas')).toBeVisible({ timeout: 10000 });
	return win;
}

test('Play on the seeded demo world cycles between maps, fires FX + captions, and never strobes the loading overlay', async ({
	page,
	request
}) => {
	const seeded = await seedAshHostWar(request);
	expect(seeded.eventCount).toBeGreaterThanOrEqual(4); // seed created N map-events

	await page.addInitScript(() => {
		(window as unknown as { __SPOTLIGHT_DIAG__?: boolean }).__SPOTLIGHT_DIAG__ = true;
		localStorage.setItem('tutorial-dismissed', 'true');
	});
	await page.goto('/app');
	const win = await openWorldMap(page);

	const switcher = win.locator('.map-switcher');
	await expect(switcher).toBeVisible();
	await expect(switcher.locator('option')).toHaveCount(2);
	// Pin to the Northmarch map first. The Act-0 conquest (the Ash Host taking the
	// Fen, whose region lives on the Northmarch map) must be on the VISIBLE map when
	// its owner flips during forward playback, so the flash is a legitimate
	// during-playback beat — NOT the old load-order artifact where a cycled-to map's
	// async region load produced a spurious flash of an already-past conquest. Play
	// unpins, so cycling still resumes from t=0.
	await switcher.selectOption({ label: 'Northmarch' });
	const startMap = await switcher.inputValue();

	// Open the Story Player + timeline scrubber.
	await page.click('button[title="Timeline"]');
	const tlWin = page.locator('.window[aria-label="Timeline"]');
	await tlWin.locator('.scrub-toggle').click();
	const playerWin = page.locator('.window[aria-label="Story Player"]');
	await playerWin.locator('.speed-select').selectOption('2');

	// Set the playhead near the start so play() crosses the flip going forward
	// (mirrors world-map-spotlight-ease.spec.ts).
	const rowsBox = await tlWin.locator('.rows').boundingBox();
	if (!rowsBox) throw new Error('timeline rows have no bounding box');
	await page.mouse.click(rowsBox.x + rowsBox.width * 0.02, rowsBox.y + 30);
	await expect
		.poll(async () => Number(await tlWin.locator('.playhead').getAttribute('aria-valuenow')), {
			timeout: 8000
		})
		.toBeLessThan(0.25);
	// The scrub-back itself can flip an owner and move a placement, producing a
	// flash/march; reset the counters so we only count what fires during forward
	// PLAYBACK (the ripple counter too, so the Fix B assertion below can't be
	// satisfied by a pre-play artifact).
	await page.evaluate(() => {
		const w = window as unknown as {
			__spotlightFlashCount?: number;
			__spotlightMarchCount?: number;
			__spotlightRippleCount?: number;
		};
		w.__spotlightFlashCount = 0;
		w.__spotlightMarchCount = 0;
		w.__spotlightRippleCount = 0;
	});

	// Two continuous watches running for the whole playback, set up BEFORE play:
	//   - the loading overlay must NEVER appear while playing (switch-only-when-ready
	//     stages the whole target map before committing, so a cycle doesn't flash it);
	//   - the map-switcher value must change at least once (the headline T6 cycle).
	// We watch the switcher continuously (rather than polling after the FX assertions)
	// because the cycle to Greyhold is TRANSIENT — the playhead crosses into Greyhold's
	// act and later returns to Northmarch (Act 2), so a post-hoc poll can miss the
	// window in slow CI. Recording "ever cycled" from play-start is timing-robust.
	const overlay = win.locator('.map-loading-overlay');
	let overlayEverVisible = false;
	let everCycled = false;
	const overlayWatch = setInterval(() => {
		overlay
			.isVisible()
			.then((v) => {
				if (v) overlayEverVisible = true;
			})
			.catch(() => {});
	}, 100);
	const switcherWatch = setInterval(() => {
		switcher
			.inputValue()
			.then((v) => {
				if (v && v !== startMap) everCycled = true;
			})
			.catch(() => {});
	}, 100);

	await playerWin.locator('.play-btn').click();
	await expect(playerWin.locator('.play-btn')).toHaveClass(/playing/);

	// A conquest flash fires as the Fen's owner flips on the visible Northmarch map
	// during forward playback, and a diegetic caption fires for a scoped beat — both
	// proving the FX + T9 caption pipelines end-to-end on real data.
	await expect
		.poll(
			async () =>
				page.evaluate(
					() => (window as unknown as { __spotlightFlashCount?: number }).__spotlightFlashCount ?? 0
				),
			{ timeout: 15000, intervals: [200] }
		)
		.toBeGreaterThan(0);
	await expect
		.poll(
			async () =>
				page.evaluate(
					() =>
						(window as unknown as { __spotlightCaptionCount?: number }).__spotlightCaptionCount ?? 0
				),
			{ timeout: 8000, intervals: [200] }
		)
		.toBeGreaterThan(0);

	// The seeded march (two move_entity keyframes straddling a sampled boundary on the
	// Northmarch map) must actually project into a march trail during playback — not
	// merely have its keyframes accepted by the API at seed time. punctuation-diff emits
	// a MarchTrail for every placement whose interpolated position moved, WorldMap calls
	// spawnMarch, and PixiPunctuationLayer bumps __spotlightMarchCount per rendered trail.
	// Poll it like the flash/caption counters so a regression in loading, projection,
	// punctuation diffing, or rendering of move_entity events fails this test instead of
	// silently leaving it green (codex P2, 2026-06-08).
	await expect
		.poll(
			async () =>
				page.evaluate(
					() =>
						(window as unknown as { __spotlightMarchCount?: number }).__spotlightMarchCount ?? 0
				),
			{ timeout: 15000, intervals: [200] }
		)
		.toBeGreaterThan(0);

	// Headline T6 behavior: the view cycled to a DIFFERENT map with no manual input as
	// the playhead crossed into Greyhold's act (observed by the continuous watch above).
	await expect.poll(() => everCycled, { timeout: 25000, intervals: [200] }).toBe(true);

	// ADR 0007 Fix B: the causal ripple fires on the cycle TO Greyhold. The view
	// cycles there BECAUSE the fall-caused_by-treaty edge resolves at the act
	// boundary, so the edge is already lit on the first post-switch frame — the
	// exact case the null-on-switch baseline used to swallow (ripple count stayed
	// 0 through full auto-play, the T1 dogfood bug). The controller now diffs
	// against the new map projected at the PRIOR playhead, where the edge was
	// still unlit → it ripples. Red when Fix B is reverted.
	await expect
		.poll(
			async () =>
				page.evaluate(
					() =>
						(window as unknown as { __spotlightRippleCount?: number }).__spotlightRippleCount ?? 0
				),
			{ timeout: 10000, intervals: [200] }
		)
		.toBeGreaterThan(0);

	clearInterval(overlayWatch);
	clearInterval(switcherWatch);
	expect(overlayEverVisible).toBe(false);
});
