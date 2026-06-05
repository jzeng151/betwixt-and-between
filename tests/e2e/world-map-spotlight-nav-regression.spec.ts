/**
 * Cinematic Spotlight (Slice 8) — CRITICAL nav regression (eng decision #8 / T7).
 *
 * The mandatory guard: the playback reaction must NOT clobber manual map
 * navigation. With cycling off (PR1 ships no cycling; PR2's cycling must keep
 * this true when off/pinned), the existing one-shot auto-select + deep-link
 * watcher (WorldMap.svelte:942-997) behaves exactly as today, and a map the user
 * picked by hand stays picked — even while the playhead is auto-advancing.
 *
 * This pins the baseline before PR2 adds between-map cycling on top of the same
 * nav arbiter. PR1's pin-on-interact wrapper pins the view on a manual select, so
 * any future cycling is suspended and can't override the choice.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
}

async function makeMap(request: APIRequestContext, name: string) {
	const map = await (await request.post('/api/maps', { data: { name } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 600, height: 400 }
	});
	return map as { id: string; name: string };
}

test('manual map selection is not clobbered by the playback reaction (cycling off)', async ({
	page,
	request
}) => {
	await clearAll(request);

	// A playable timeline so the playhead can auto-advance (2 acts × 2 scenes).
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

	// Two maps. The user will hand-pick the one auto-select did NOT choose.
	await makeMap(request, 'Northmarch');
	await makeMap(request, 'Greyhold');

	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();
	await expect(win.locator('.pixi-stage canvas')).toBeVisible({ timeout: 10000 });

	const switcher = win.locator('.map-switcher');
	await expect(switcher).toBeVisible();
	// Both maps are options; auto-select picked one.
	await expect(switcher.locator('option')).toHaveCount(2);
	const initial = await switcher.inputValue();
	const optionValues = await switcher.locator('option').evaluateAll((els) =>
		els.map((e) => (e as HTMLOptionElement).value)
	);
	const other = optionValues.find((v) => v !== initial);
	expect(other).toBeTruthy();

	// Hand-pick the other map.
	await switcher.selectOption(other!);
	await expect(switcher).toHaveValue(other!);

	// Start playback and let the playhead advance several boundaries.
	await page.click('button[title="Timeline"]');
	const tlWin = page.locator('.window[aria-label="Timeline"]');
	await tlWin.locator('.scrub-toggle').click();
	const playerWin = page.locator('.window[aria-label="Story Player"]');
	await playerWin.locator('.speed-select').selectOption('2');
	await playerWin.locator('.play-btn').click();
	await expect(playerWin.locator('.play-btn')).toHaveClass(/playing/);
	await expect(tlWin.locator('.playhead')).toBeVisible();

	// Through multiple scene advances, the hand-picked map stays selected — the
	// reaction never clobbers it.
	await expect
		.poll(async () => Number(await tlWin.locator('.playhead').getAttribute('aria-valuenow')), {
			timeout: 12000,
			intervals: [200]
		})
		.toBeGreaterThan(0.4);
	await expect(switcher).toHaveValue(other!);
});
