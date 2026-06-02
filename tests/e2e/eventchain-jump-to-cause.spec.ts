import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';
import { clearAll } from './helpers/db';

// WM3 Slice 5 PR-D (D5 / ADR 0006) — EventChain click-to-jump, end to end.
//
// The pure jump semantics live in `jump-to-cause.ts` and are unit-tested.
// What no unit test can prove is the WIRING through the SVG surface:
//   - StoryGraph derives `clickable = caused_by && startPosition != null`
//     and plumbs it into GraphCanvas (→ the `.edge-clickable` hit-area);
//   - GraphCanvas's `onEdgeClickHandler` fires `onEdgeClick(id)` on a left
//     click, which StoryGraph maps to `jumpToCause(rel)`;
//   - the playhead actually scrubs to the edge's scoped `startPosition`.
// This spec walks that whole path: click a scoped caused_by edge, assert the
// Timeline playhead jumps to the scene window's start (act 0, middle of 3
// scenes → 1/3).

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function seedScopedCausedBy(request: APIRequestContext) {
	await clearAll(request);

	const act0 = await (
		await request.post('/api/entities', { data: { type: 'Act', name: 'Act 0', position: 0 } })
	).json();
	await request.post('/api/entities', { data: { type: 'Act', name: 'Act 1', position: 1 } });

	// 3 scenes under act0 so the middle scene is a non-trivial third: [1/3, 2/3).
	await request.post('/api/entities', {
		data: { type: 'Scene', name: 'S0', parentId: act0.id, position: 0 }
	});
	const s1 = await (
		await request.post('/api/entities', {
			data: { type: 'Scene', name: 'S1', parentId: act0.id, position: 1 }
		})
	).json();
	await request.post('/api/entities', {
		data: { type: 'Scene', name: 'S2', parentId: act0.id, position: 2 }
	});

	// caused_by connects Event → Event (effect ← cause).
	const cause = await (
		await request.post('/api/entities', { data: { type: 'Event', name: 'Cause' } })
	).json();
	const effect = await (
		await request.post('/api/entities', { data: { type: 'Event', name: 'Effect' } })
	).json();

	// Scope the link to scene S1 → server derives startPosition = 1/3.
	const rel = await (
		await request.post('/api/relationships', {
			data: {
				fromId: effect.id,
				toId: cause.id,
				type: 'caused_by',
				startActId: act0.id,
				startSceneId: s1.id,
				endActId: act0.id,
				endSceneId: s1.id
			}
		})
	).json();
	// Guard the precondition: the scope must resolve to a non-null position,
	// otherwise the edge would be a deliberate no-op and `clickable` false.
	expect(rel.startPosition).toBeCloseTo(1 / 3, 6);

	return { cause, effect };
}

async function openWindow(page: Page, title: string) {
	await page.click(`button[title="${title}"]`);
	const win = page.locator(`.window[aria-label="${title}"]`).first();
	await expect(win).toBeVisible();
	return win;
}

test.describe('EventChain click-to-jump', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	});

	test('clicking a scoped caused_by edge scrubs the playhead to its scene window', async ({
		page,
		request
	}) => {
		await seedScopedCausedBy(request);
		await page.goto('/app');

		// Timeline hosts the PlayheadOverlay (`.playhead`, aria-valuenow = position).
		const timeline = await openWindow(page, 'Timeline');
		// Story Graph is where the caused_by edge lives.
		const storyGraph = await openWindow(page, 'Story Graph');

		// Both Event nodes must be on the graph for the edge to render.
		await expect(storyGraph.locator('.node[aria-label="Open Cause"]')).toBeVisible();
		await expect(storyGraph.locator('.node[aria-label="Open Effect"]')).toBeVisible();

		// The scoped caused_by edge exposes the clickable hit-area. Its presence
		// proves StoryGraph derived `clickable` and plumbed it through GraphCanvas.
		const edge = storyGraph.locator('line.edge-clickable');
		await expect(edge).toHaveCount(1);

		// Playhead is idle before the click — no overlay rendered.
		await expect(timeline.locator('.playhead')).toHaveCount(0);

		await edge.click();

		// jumpToCause scrubbed the playhead to the scene-1 window start (1/3).
		const playhead = timeline.locator('.playhead');
		await expect(playhead).toHaveCount(1);
		const pos = Number(await playhead.getAttribute('aria-valuenow'));
		expect(pos).toBeCloseTo(1 / 3, 6);
	});
});
