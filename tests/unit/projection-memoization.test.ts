/**
 * projectState baked-fold memoization (perf audit 2026-06-10).
 *
 * During a playhead scrub the active anchor + applicable event window are
 * usually unchanged between ticks; projectState caches the baked portion
 * (regions/cells/strokes/artifacts) and returns REFERENTIALLY STABLE arrays
 * so downstream Pixi layers can skip display-list rebuilds via identity
 * checks. These tests pin:
 *   1. identity stability across ticks within the same event window,
 *   2. recompute (with correct content) when the window gains an event,
 *      the ctx changes, or the inputs' identities change,
 *   3. stable shared identities for empty artifactOverrides / causalEdges.
 */
import { describe, it, expect } from 'vitest';
import {
	projectState,
	type ProjectionAnchor,
	type ProjectionContext,
	type ProjectionEvent
} from '../../src/lib/features/map/projection.js';

const REGION_ID = '00000000-0000-0000-0000-000000000001';
const FACTION_RED = '00000000-0000-0000-0000-0000000000aa';

function ctx(): ProjectionContext {
	return {
		allowedFactions: new Map([[FACTION_RED, { id: FACTION_RED, color: '#ff0000' }]]),
		allowedRegions: new Set([REGION_ID])
	};
}

const ANCHOR_AT_0: ProjectionAnchor = {
	id: 'anchor-0',
	tPosition: 0,
	createdAt: new Date('2026-01-01T00:00:00Z'),
	stateJsonb: {
		regions: [{ region_id: REGION_ID, faction_id: FACTION_RED }],
		cells: [{ x: 1, y: 1, biome: 'Grass' }]
	}
};

const PAINT_AT_2: ProjectionEvent = {
	id: 'paint-2',
	tPosition: 2,
	kind: 'paint_cells',
	createdAt: new Date('2026-01-01T01:00:00Z'),
	payloadJsonb: { cells: [{ x: 3, y: 3, biome: 'Grass' }] }
};

describe('projectState — baked-fold memoization', () => {
	it('returns identical array identities across ticks within one event window', () => {
		const anchors = [ANCHOR_AT_0];
		const events = [PAINT_AT_2];
		const c = ctx();
		const s1 = projectState(0.5, anchors, events, c);
		const s2 = projectState(1.5, anchors, events, c);
		// Window is (0, t]; no event enters between 0.5 and 1.5 → baked reuse.
		expect(s2.cells).toBe(s1.cells);
		expect(s2.strokes).toBe(s1.strokes);
		expect(s2.regions).toBe(s1.regions);
		expect(s2.artifacts).toBe(s1.artifacts);
		// t itself still updates.
		expect(s1.tPosition).toBe(0.5);
		expect(s2.tPosition).toBe(1.5);
	});

	it('refolds (new identity, correct content) when the window gains an event', () => {
		const anchors = [ANCHOR_AT_0];
		const events = [PAINT_AT_2];
		const c = ctx();
		const before = projectState(1.5, anchors, events, c);
		const after = projectState(2, anchors, events, c);
		expect(after.cells).not.toBe(before.cells);
		expect(before.cells).toHaveLength(1);
		expect(after.cells).toHaveLength(2);
		expect(after.cells.map((x) => `${x.x},${x.y}`).sort()).toEqual(['1,1', '3,3']);
	});

	it('refolds when scrubbing backwards out of an event window', () => {
		const anchors = [ANCHOR_AT_0];
		const events = [PAINT_AT_2];
		const c = ctx();
		const at2 = projectState(2, anchors, events, c);
		expect(at2.cells).toHaveLength(2);
		const back = projectState(1, anchors, events, c);
		expect(back.cells).toHaveLength(1);
		expect(back.cells[0]).toMatchObject({ x: 1, y: 1 });
	});

	it('refolds when the ctx identity changes', () => {
		const anchors = [ANCHOR_AT_0];
		const events: ProjectionEvent[] = [];
		const s1 = projectState(1, anchors, events, ctx());
		const s2 = projectState(1, anchors, events, ctx());
		expect(s2.regions).not.toBe(s1.regions);
		expect(s2.regions).toEqual(s1.regions);
	});

	it('refolds when the events array identity changes', () => {
		const anchors = [ANCHOR_AT_0];
		const c = ctx();
		const s1 = projectState(1, anchors, [PAINT_AT_2], c);
		const s2 = projectState(1, anchors, [PAINT_AT_2], c);
		expect(s2.cells).not.toBe(s1.cells);
		expect(s2.cells).toEqual(s1.cells);
	});

	it('shares a stable identity for empty artifactOverrides and causalEdges', () => {
		const anchors = [ANCHOR_AT_0];
		const events = [PAINT_AT_2];
		const c = ctx();
		const s1 = projectState(0.5, anchors, events, c);
		const s2 = projectState(1.5, anchors, events, c);
		expect(s1.artifactOverrides.size).toBe(0);
		expect(s2.artifactOverrides).toBe(s1.artifactOverrides);
		expect(s1.causalEdges).toHaveLength(0);
		expect(s2.causalEdges).toBe(s1.causalEdges);
	});
});
