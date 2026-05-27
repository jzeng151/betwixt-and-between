/**
 * T10 — projection fixture-coverage test.
 *
 * Scope (per docs/plans/world-map-v3-slice-2-plan.md § D4 prep / T10):
 * 20 playhead values × a hand-built fixture map; deep-equal against a
 * golden JSON. Proves projectState() determinism — same inputs produce
 * the same RenderedState across renderer rewrites, anchor backfills,
 * and event-kind extensions.
 *
 * Originally framed as "RenderedState parity between Leaflet and Pixi"
 * in the design doc, but there's no shared RenderedState pipeline
 * today (Leaflet reads $mapRegions directly; only Pixi consumes
 * projectState's output). Rescoped to projection determinism per
 * codex finding #10 — visual parity testing would require a shared
 * adapter both renderers read from, which is out of Slice 2's scope.
 *
 * Regenerate the golden after intentional projection changes:
 *   UPDATE_GOLDEN=1 npx vitest run tests/integration/projection-fixture.test.ts
 * The test reruns and rewrites the golden JSON to disk. Inspect the
 * diff before committing — that's the regression check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	projectState,
	type ProjectionAnchor,
	type ProjectionEvent,
	type ProjectionContext,
	type RenderedState
} from '../../src/lib/features/map/projection.js';

const GOLDEN_PATH = join(__dirname, '..', 'fixtures', 'world-map-v3-projection-golden.json');

// ── Fixture ────────────────────────────────────────────────────────────────
// Stable ids (literal UUIDs, not crypto.randomUUID) so the golden's id
// strings stay byte-identical across runs.

const FACTION_A = '11111111-1111-1111-1111-111111111111';
const FACTION_B = '22222222-2222-2222-2222-222222222222';
const FACTION_NEUTRAL = '33333333-3333-3333-3333-333333333333';

const REGION_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REGION_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REGION_3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const REGION_GHOST = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; // not in allowedRegions

const POLY = [
	[0, 0],
	[10, 0],
	[10, 10]
];

const anchors: ProjectionAnchor[] = [
	{
		id: 'a0-baseline',
		tPosition: Number.NEGATIVE_INFINITY,
		createdAt: '2026-01-01T00:00:00.000Z',
		stateJsonb: {
			regions: [
				{ region_id: REGION_1, faction_id: FACTION_NEUTRAL, polygon: POLY, locationId: null },
				{ region_id: REGION_2, faction_id: FACTION_NEUTRAL, polygon: POLY, locationId: null },
				{ region_id: REGION_3, faction_id: FACTION_NEUTRAL, polygon: POLY, locationId: null }
			],
			artifacts: [],
			chains: []
		}
	},
	{
		id: 'a1-snapshot-t5',
		tPosition: 5,
		createdAt: '2026-01-02T00:00:00.000Z',
		stateJsonb: {
			regions: [
				{ region_id: REGION_1, faction_id: FACTION_A, polygon: POLY, locationId: null },
				{ region_id: REGION_2, faction_id: FACTION_B, polygon: POLY, locationId: null },
				{ region_id: REGION_3, faction_id: FACTION_NEUTRAL, polygon: POLY, locationId: null }
			],
			artifacts: [],
			chains: []
		}
	}
];

const events: ProjectionEvent[] = [
	// Pre-anchor-1 events: ownership at REGION_1 flips A then B before t=5
	{
		id: 'e1',
		tPosition: 1,
		kind: 'transfer_region',
		createdAt: '2026-01-01T01:00:00.000Z',
		payloadJsonb: { region_id: REGION_1, new_faction_id: FACTION_A }
	},
	{
		id: 'e2',
		tPosition: 3,
		kind: 'transfer_region',
		createdAt: '2026-01-01T03:00:00.000Z',
		payloadJsonb: { region_id: REGION_1, new_faction_id: FACTION_B }
	},
	// Post-anchor-1 events
	{
		id: 'e3',
		tPosition: 6,
		kind: 'transfer_region',
		createdAt: '2026-01-02T06:00:00.000Z',
		payloadJsonb: { region_id: REGION_3, new_faction_id: FACTION_A }
	},
	{
		id: 'e4',
		tPosition: 8,
		kind: 'transfer_region',
		createdAt: '2026-01-02T08:00:00.000Z',
		payloadJsonb: { region_id: REGION_2, new_faction_id: FACTION_NEUTRAL }
	},
	// Same-T commit-order test: two events at t=9, B first by createdAt
	{
		id: 'e5',
		tPosition: 9,
		kind: 'transfer_region',
		createdAt: '2026-01-02T09:00:00.000Z',
		payloadJsonb: { region_id: REGION_1, new_faction_id: FACTION_A }
	},
	{
		id: 'e6',
		tPosition: 9,
		kind: 'transfer_region',
		createdAt: '2026-01-02T09:00:01.000Z',
		payloadJsonb: { region_id: REGION_1, new_faction_id: FACTION_B }
	},
	// Cross-user defense: event references a region NOT in allowedRegions
	{
		id: 'e7',
		tPosition: 11,
		kind: 'transfer_region',
		createdAt: '2026-01-02T11:00:00.000Z',
		payloadJsonb: { region_id: REGION_GHOST, new_faction_id: FACTION_A }
	},
	// Unknown kind: should be skipped silently
	{
		id: 'e8',
		tPosition: 12,
		kind: 'move_entity',
		createdAt: '2026-01-02T12:00:00.000Z',
		payloadJsonb: { region_id: REGION_1, x: 5, y: 5 }
	},
	// Foreign faction reference (faction not in allowedFactions): lazy GC
	{
		id: 'e9',
		tPosition: 13,
		kind: 'transfer_region',
		createdAt: '2026-01-02T13:00:00.000Z',
		payloadJsonb: { region_id: REGION_2, new_faction_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }
	}
];

const ctx: ProjectionContext = {
	allowedFactions: new Map([
		[FACTION_A, { id: FACTION_A, color: '#aa0000' }],
		[FACTION_B, { id: FACTION_B, color: '#0000bb' }],
		[FACTION_NEUTRAL, { id: FACTION_NEUTRAL, color: '#9ca3af' }]
	]),
	allowedRegions: new Set([REGION_1, REGION_2, REGION_3])
};

// 20 playhead values covering: pre-history, baseline-only, between baseline
// and first snapshot, exactly at events, between events, post-history.
const PLAYHEADS = [
	-1,
	0,
	0.5,
	1,
	2,
	3,
	4,
	4.999,
	5,
	5.5,
	6,
	7,
	8,
	8.5,
	9,
	9.999,
	10,
	11,
	12,
	13
];

// Stabilize RenderedRegion ordering before serialization. projectState
// builds the regions Map by insertion order; that order is deterministic
// here but documenting + sorting in the fixture removes one source of
// noise if Map iteration order ever wobbles.
function sortRegions(state: RenderedState): RenderedState {
	return {
		...state,
		regions: [...state.regions].sort((a, b) => a.regionId.localeCompare(b.regionId))
	};
}

describe('projection determinism — fixture coverage (T10)', () => {
	const results = PLAYHEADS.map((t) => ({
		t,
		state: sortRegions(projectState(t, anchors, events, ctx))
	}));

	// Replace any non-finite tPositions (Number.NEGATIVE_INFINITY in anchor
	// 0) with a string sentinel for JSON serialization, then restore on
	// read. The fixture doesn't include the anchor tPosition in output,
	// so this mostly affects PLAYHEAD = -1 which IS finite — no special
	// handling needed. The RenderedState.tPosition mirrors the input t.
	const serialized = JSON.stringify(results, null, 2);

	const updateGolden = process.env.UPDATE_GOLDEN === '1';

	if (updateGolden || !existsSync(GOLDEN_PATH)) {
		writeFileSync(GOLDEN_PATH, serialized + '\n');
		it('golden written (rerun without UPDATE_GOLDEN to assert)', () => {
			expect(existsSync(GOLDEN_PATH)).toBe(true);
		});
		return;
	}

	const golden = readFileSync(GOLDEN_PATH, 'utf8').trimEnd();

	it('20 playheads × fixture map match golden JSON byte-for-byte', () => {
		expect(serialized).toBe(golden);
	});

	// Spot-check semantic invariants on top of the byte-equal check —
	// these catch a malformed regenerated golden that happens to be
	// byte-equal but semantically nonsense (e.g. someone hand-edited
	// the JSON).
	it('REGION_1 at t=4 reflects event chain (Neutral → A → B before anchor-1)', () => {
		const at4 = projectState(4, anchors, events, ctx);
		const r1 = at4.regions.find((r) => r.regionId === REGION_1);
		expect(r1?.factionId).toBe(FACTION_B);
		expect(r1?.color).toBe('#0000bb');
	});

	it('same-T commit order: e6 wins over e5 at t=9 (later createdAt)', () => {
		const at9 = projectState(9, anchors, events, ctx);
		const r1 = at9.regions.find((r) => r.regionId === REGION_1);
		expect(r1?.factionId).toBe(FACTION_B);
	});

	it('cross-user defense: GHOST region never appears in rendered state', () => {
		for (const t of PLAYHEADS) {
			const state = projectState(t, anchors, events, ctx);
			expect(state.regions.find((r) => r.regionId === REGION_GHOST)).toBeUndefined();
		}
	});

	it('foreign faction reference at t=13 falls back to Neutral color', () => {
		const at13 = projectState(13, anchors, events, ctx);
		const r2 = at13.regions.find((r) => r.regionId === REGION_2);
		expect(r2?.factionId).toBeNull();
		expect(r2?.color).toBe('#9ca3af'); // NEUTRAL_REGION_COLOR
	});

	it('unknown event kind (move_entity at t=12) is skipped without error', () => {
		const at12 = projectState(12, anchors, events, ctx);
		// REGION_1 ownership at t=12: anchor-1 set A; events e3-e6 don't
		// touch R1 again except the same-T e5/e6 (B wins). So R1 = B at
		// any t >= 9 up to t=12 (no further R1 events).
		const r1 = at12.regions.find((r) => r.regionId === REGION_1);
		expect(r1?.factionId).toBe(FACTION_B);
	});
});
