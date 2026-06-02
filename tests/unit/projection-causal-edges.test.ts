/**
 * World Map v3 Slice 5 PR-C (D2/D5, ADR 0006) — causal-edge fold.
 *
 * Covers projectState's `causalEdges` output (foldCausalEdges), driven through
 * the public projectState API the same way the movement fold is tested. The six
 * CRITICAL paths from the plan's test-coverage diagram:
 *   - both endpoints on map → edge emitted, scope-gated, cause endpoint correct
 *   - off-map endpoint → omitted (no draw)
 *   - cross-user endpoint (region not in allowedRegions) → dropped (lazy-GC)
 *   - timeless edge → always visible
 *   - span / scene-equality window → visible only within [start, end)
 *   - degenerate self-edge (both endpoints same region) → dropped (Spike S1 gate)
 * Plus: mystery (not-yet-revealed) edge hidden; centroid is the polygon centroid;
 * no caused_by edges / default arg → empty causalEdges (regression).
 */
import { describe, it, expect } from 'vitest';
import {
	projectState,
	type ProjectionAnchor,
	type ProjectionContext,
	type ProjectionCausalEdge,
	type CausalProjectionInput,
	type AnchorRegion
} from '../../src/lib/features/map/projection.js';

const R1 = '11111111-1111-1111-1111-111111111111';
const R2 = '22222222-2222-2222-2222-222222222222';
const LOC_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOC_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LOC_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // never on the map
const EV_EFFECT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const EV_CAUSE = 'cafecafe-cafe-cafe-cafe-cafecafecafe';
const REL = 'de1e7e0d-0000-0000-0000-000000000001';

// Axis-aligned squares; area centroid = geometric center.
const SQUARE_A: number[][] = [
	[0.0, 0.0],
	[0.4, 0.0],
	[0.4, 0.4],
	[0.0, 0.4]
]; // centroid (0.2, 0.2)
const SQUARE_B: number[][] = [
	[0.6, 0.6],
	[1.0, 0.6],
	[1.0, 1.0],
	[0.6, 1.0]
]; // centroid (0.8, 0.8)

function region(over: Partial<AnchorRegion> & { region_id: string }): AnchorRegion {
	return { polygon: SQUARE_A, locationId: null, faction_id: null, ...over };
}

function anchorWith(regions: AnchorRegion[]): ProjectionAnchor {
	return { id: 'anchor-0', tPosition: 0, createdAt: '2026-01-01T00:00:00.000Z', stateJsonb: { regions } };
}

// Both regions present, both allowed, R1→LOC_A, R2→LOC_B.
const TWO_REGION_ANCHOR = anchorWith([
	region({ region_id: R1, locationId: LOC_A, polygon: SQUARE_A }),
	region({ region_id: R2, locationId: LOC_B, polygon: SQUARE_B })
]);

function ctxWith(allowedRegions: string[]): ProjectionContext {
	return { allowedFactions: new Map(), allowedRegions: new Set(allowedRegions) };
}

function edge(over: Partial<ProjectionCausalEdge> = {}): ProjectionCausalEdge {
	return {
		id: REL,
		fromId: EV_EFFECT,
		toId: EV_CAUSE,
		startPosition: null,
		endPosition: null,
		revealedAtPosition: null,
		...over
	};
}

// Default: effect at LOC_A, cause at LOC_B.
function causal(over: Partial<CausalProjectionInput> = {}): CausalProjectionInput {
	return {
		edges: [edge()],
		locationOf: new Map([
			[EV_EFFECT, LOC_A],
			[EV_CAUSE, LOC_B]
		]),
		...over
	};
}

describe('projectState causal-edge fold — causalEdges', () => {
	it('both endpoints on an allowed region → one edge, cause endpoint + centroids correct', () => {
		const s = projectState(0, [TWO_REGION_ANCHOR], [], ctxWith([R1, R2]), [], causal());
		expect(s.causalEdges).toHaveLength(1);
		const e = s.causalEdges[0];
		expect(e.relationshipId).toBe(REL);
		expect(e.causeEndpointId).toBe(EV_CAUSE); // toId = cause (edge-policy effect ← cause)
		expect(e.fromPos.x).toBeCloseTo(0.2, 10); // effect → LOC_A centroid
		expect(e.fromPos.y).toBeCloseTo(0.2, 10);
		expect(e.toPos.x).toBeCloseTo(0.8, 10); // cause → LOC_B centroid
		expect(e.toPos.y).toBeCloseTo(0.8, 10);
	});

	it('off-map endpoint (no region for its location) → omitted, no draw', () => {
		const c = causal({
			locationOf: new Map([
				[EV_EFFECT, LOC_A],
				[EV_CAUSE, LOC_C] // not on the map
			])
		});
		const s = projectState(0, [TWO_REGION_ANCHOR], [], ctxWith([R1, R2]), [], c);
		expect(s.causalEdges).toHaveLength(0);
	});

	it('cross-user endpoint (region not in allowedRegions) → dropped (lazy-GC)', () => {
		// R2 exists in the anchor but is NOT allowed → LOC_B has no centroid.
		const s = projectState(0, [TWO_REGION_ANCHOR], [], ctxWith([R1]), [], causal());
		expect(s.causalEdges).toHaveLength(0);
	});

	it('timeless edge (no scope) → visible at any T', () => {
		const ctx = ctxWith([R1, R2]);
		expect(projectState(0, [TWO_REGION_ANCHOR], [], ctx, [], causal()).causalEdges).toHaveLength(1);
		expect(projectState(99, [TWO_REGION_ANCHOR], [], ctx, [], causal()).causalEdges).toHaveLength(1);
	});

	it('span / scene-equality window → visible only within [start, end)', () => {
		const ctx = ctxWith([R1, R2]);
		const windowed = causal({ edges: [edge({ startPosition: 1 / 3, endPosition: 2 / 3 })] });
		// inside
		expect(projectState(0.5, [TWO_REGION_ANCHOR], [], ctx, [], windowed).causalEdges).toHaveLength(1);
		// at the half-open start (inclusive)
		expect(projectState(1 / 3, [TWO_REGION_ANCHOR], [], ctx, [], windowed).causalEdges).toHaveLength(1);
		// before
		expect(projectState(0.1, [TWO_REGION_ANCHOR], [], ctx, [], windowed).causalEdges).toHaveLength(0);
		// at the open end (exclusive) and after
		expect(projectState(2 / 3, [TWO_REGION_ANCHOR], [], ctx, [], windowed).causalEdges).toHaveLength(0);
		expect(projectState(0.9, [TWO_REGION_ANCHOR], [], ctx, [], windowed).causalEdges).toHaveLength(0);
	});

	it('degenerate self-edge (both endpoints in the same region) → dropped', () => {
		const c = causal({
			locationOf: new Map([
				[EV_EFFECT, LOC_A],
				[EV_CAUSE, LOC_A] // same place → no spatial arrow
			])
		});
		const s = projectState(0, [TWO_REGION_ANCHOR], [], ctxWith([R1, R2]), [], c);
		expect(s.causalEdges).toHaveLength(0);
	});

	it('mystery edge (not yet revealed at T) → hidden, then shown once revealed', () => {
		const ctx = ctxWith([R1, R2]);
		const mystery = causal({ edges: [edge({ revealedAtPosition: 5 })] }); // timeless but reveal-gated
		expect(projectState(3, [TWO_REGION_ANCHOR], [], ctx, [], mystery).causalEdges).toHaveLength(0);
		expect(projectState(6, [TWO_REGION_ANCHOR], [], ctx, [], mystery).causalEdges).toHaveLength(1);
	});

	it('no caused_by edges / default arg → empty causalEdges (regression for existing callers)', () => {
		const ctx = ctxWith([R1, R2]);
		expect(projectState(0, [TWO_REGION_ANCHOR], [], ctx).causalEdges).toEqual([]);
		expect(
			projectState(0, [TWO_REGION_ANCHOR], [], ctx, [], { edges: [], locationOf: new Map() }).causalEdges
		).toEqual([]);
	});

	it('idle (t = -Infinity, WorldMap convention): no active anchor → no causal edges at all', () => {
		// WorldMap passes t = -Infinity when the scrubber is idle. The anchor sits
		// at tPosition 0, and pickActiveAnchor skips anchors with tPosition > t, so
		// NOTHING is active before the first anchor — the map draws no regions and
		// hence no causal edges, regardless of edge scope. (This is also why the
		// map/graph mystery-at-idle divergence is unreachable: when causal edges can
		// render, an anchor is active and t is finite ≥ its tPosition.)
		const ctx = ctxWith([R1, R2]);
		const idle = Number.NEGATIVE_INFINITY;
		expect(projectState(idle, [TWO_REGION_ANCHOR], [], ctx, [], causal()).causalEdges).toHaveLength(0);
		const span = causal({ edges: [edge({ startPosition: 1 / 3, endPosition: 2 / 3 })] });
		expect(projectState(idle, [TWO_REGION_ANCHOR], [], ctx, [], span).causalEdges).toHaveLength(0);
	});

	it('T7 memo: same (anchor, ctx) across ticks reuses centroid objects; new anchor recomputes', () => {
		const ctx = ctxWith([R1, R2]);
		// Same anchor + same ctx object, different t → cache hit → identical
		// centroid object refs (a fresh build would yield new {x,y} objects).
		const a = projectState(0, [TWO_REGION_ANCHOR], [], ctx, [], causal());
		const b = projectState(5, [TWO_REGION_ANCHOR], [], ctx, [], causal());
		expect(a.causalEdges[0].fromPos).toBe(b.causalEdges[0].fromPos);
		expect(a.causalEdges[0].toPos).toBe(b.causalEdges[0].toPos);
		// A distinct anchor object (even with identical content) is a cache miss →
		// freshly-built centroid objects, equal by value but not by reference.
		const clone = anchorWith([
			region({ region_id: R1, locationId: LOC_A, polygon: SQUARE_A }),
			region({ region_id: R2, locationId: LOC_B, polygon: SQUARE_B })
		]);
		const c = projectState(0, [clone], [], ctx, [], causal());
		expect(c.causalEdges[0].fromPos).not.toBe(a.causalEdges[0].fromPos);
		expect(c.causalEdges[0].fromPos).toEqual(a.causalEdges[0].fromPos);
	});

	it('region with no polygon → not a centroid source, edge to it omitted', () => {
		const noPoly = anchorWith([
			region({ region_id: R1, locationId: LOC_A, polygon: SQUARE_A }),
			region({ region_id: R2, locationId: LOC_B, polygon: undefined })
		]);
		const s = projectState(0, [noPoly], [], ctxWith([R1, R2]), [], causal());
		expect(s.causalEdges).toHaveLength(0);
	});
});
