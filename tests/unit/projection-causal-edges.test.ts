/**
 * World Map v3 Slice 5 PR-C (D2/D5, ADR 0006) — causal-edge fold.
 *
 * Covers projectState's `causalEdges` output (foldCausalEdges), driven through
 * the public projectState API the same way the movement fold is tested. Geometry
 * (centroidByLocation) is supplied by the caller from the live region store, so
 * these tests pass it via the causal input directly (the centroid MATH is tested
 * separately against the exported polygonCentroid). CRITICAL paths:
 *   - both endpoints resolve → edge emitted, scope-gated, cause endpoint correct
 *   - endpoint Location absent from centroidByLocation (off-map / cross-user /
 *     no-polygon region) → omitted (lazy-GC)
 *   - timeless edge → always visible
 *   - span / scene-equality window → visible only within [start, end)
 *   - degenerate self-edge (both endpoints same Location) → dropped (Spike S1)
 *   - mystery (not-yet-revealed) edge hidden, then shown after reveal
 *   - idle (t = -Infinity, no active anchor) → nothing drawn
 */
import { describe, it, expect } from 'vitest';
import {
	projectState,
	polygonCentroid,
	type ProjectionAnchor,
	type ProjectionContext,
	type ProjectionCausalEdge,
	type CausalProjectionInput,
	type ArtifactPosition
} from '../../src/lib/features/map/projection.js';

const LOC_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOC_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LOC_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // never on the map
const EV_EFFECT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const EV_CAUSE = 'cafecafe-cafe-cafe-cafe-cafecafecafe';
const REL = 'de1e7e0d-0000-0000-0000-000000000001';

const CENTROID_A: ArtifactPosition = { x: 0.2, y: 0.2 };
const CENTROID_B: ArtifactPosition = { x: 0.8, y: 0.8 };

// Causal edges only render when an anchor is active at t (the map's idle
// convention). The anchor's contents are irrelevant to the causal fold now —
// geometry comes from centroidByLocation — so a minimal anchor at t=0 suffices.
const ANCHOR: ProjectionAnchor = {
	id: 'anchor-0',
	tPosition: 0,
	createdAt: '2026-01-01T00:00:00.000Z',
	stateJsonb: { regions: [] }
};
const emptyCtx: ProjectionContext = { allowedFactions: new Map(), allowedRegions: new Set() };

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

// One timeless takes_place_at edge (no bounds) for an Event → Location.
function tpa(
	locationId: string,
	startPosition: number | null = null,
	endPosition: number | null = null,
	revealedAtPosition: number | null = null
) {
	return [{ locationId, startPosition, endPosition, revealedAtPosition }];
}

// Default: effect at LOC_A, cause at LOC_B, both timeless, both with centroids.
function causal(over: Partial<CausalProjectionInput> = {}): CausalProjectionInput {
	return {
		edges: [edge()],
		takesPlaceAt: new Map([
			[EV_EFFECT, tpa(LOC_A)],
			[EV_CAUSE, tpa(LOC_B)]
		]),
		centroidByLocation: new Map([
			[LOC_A, CENTROID_A],
			[LOC_B, CENTROID_B]
		]),
		...over
	};
}

describe('polygonCentroid', () => {
	it('axis-aligned square → geometric center', () => {
		const c = polygonCentroid([
			[0, 0],
			[0.4, 0],
			[0.4, 0.4],
			[0, 0.4]
		]);
		expect(c?.x).toBeCloseTo(0.2, 10);
		expect(c?.y).toBeCloseTo(0.2, 10);
	});

	it('degenerate (collinear, zero area) → vertex average, not NaN', () => {
		const c = polygonCentroid([
			[0, 0],
			[1, 0],
			[2, 0]
		]);
		expect(c?.x).toBeCloseTo(1, 10);
		expect(c?.y).toBeCloseTo(0, 10);
	});

	it('fewer than 3 vertices / malformed → null', () => {
		expect(polygonCentroid([[0, 0], [1, 1]])).toBeNull();
		expect(polygonCentroid([[0, 0], [1, 1], [2, 'x' as unknown as number]])).toBeNull();
	});
});

describe('projectState causal-edge fold — causalEdges', () => {
	it('both endpoints resolve → one edge, cause endpoint + centroids correct', () => {
		const s = projectState(0, [ANCHOR], [], emptyCtx, [], causal());
		expect(s.causalEdges).toHaveLength(1);
		const e = s.causalEdges[0];
		expect(e.relationshipId).toBe(REL);
		expect(e.causeEndpointId).toBe(EV_CAUSE); // toId = cause (edge-policy effect ← cause)
		expect(e.fromPos).toEqual(CENTROID_A); // effect → LOC_A centroid
		expect(e.toPos).toEqual(CENTROID_B); // cause → LOC_B centroid
	});

	it('off-map endpoint (Location has no centroid) → omitted, no draw', () => {
		const c = causal({
			takesPlaceAt: new Map([
				[EV_EFFECT, tpa(LOC_A)],
				[EV_CAUSE, tpa(LOC_C)] // LOC_C not in centroidByLocation
			])
		});
		expect(projectState(0, [ANCHOR], [], emptyCtx, [], c).causalEdges).toHaveLength(0);
	});

	it('cross-user / off-map endpoint (Location absent from centroidByLocation) → dropped', () => {
		// The caller (WorldMap) sources centroids from its scoped region view, so a
		// cross-user or off-map region is simply absent — here LOC_B has no centroid.
		const c = causal({ centroidByLocation: new Map([[LOC_A, CENTROID_A]]) });
		expect(projectState(0, [ANCHOR], [], emptyCtx, [], c).causalEdges).toHaveLength(0);
	});

	it('timeless edge (no scope) → visible at any T with an active anchor', () => {
		expect(projectState(0, [ANCHOR], [], emptyCtx, [], causal()).causalEdges).toHaveLength(1);
		expect(projectState(99, [ANCHOR], [], emptyCtx, [], causal()).causalEdges).toHaveLength(1);
	});

	it('span / scene-equality window → visible only within [start, end)', () => {
		const windowed = causal({ edges: [edge({ startPosition: 1 / 3, endPosition: 2 / 3 })] });
		expect(projectState(0.5, [ANCHOR], [], emptyCtx, [], windowed).causalEdges).toHaveLength(1);
		expect(projectState(1 / 3, [ANCHOR], [], emptyCtx, [], windowed).causalEdges).toHaveLength(1); // half-open start
		expect(projectState(0.1, [ANCHOR], [], emptyCtx, [], windowed).causalEdges).toHaveLength(0); // before
		expect(projectState(2 / 3, [ANCHOR], [], emptyCtx, [], windowed).causalEdges).toHaveLength(0); // open end
		expect(projectState(0.9, [ANCHOR], [], emptyCtx, [], windowed).causalEdges).toHaveLength(0); // after
	});

	it('degenerate self-edge (both endpoints same Location) → dropped', () => {
		const c = causal({
			takesPlaceAt: new Map([
				[EV_EFFECT, tpa(LOC_A)],
				[EV_CAUSE, tpa(LOC_A)] // same place → no spatial arrow
			])
		});
		expect(projectState(0, [ANCHOR], [], emptyCtx, [], c).causalEdges).toHaveLength(0);
	});

	it('T-aware location: a scoped takes_place_at only anchors the edge inside its window (FU2)', () => {
		// The cause Event is at LOC_B only during [1/3, 2/3); outside that window it
		// has no active location, so the (timeless) causal edge can't be placed.
		const c = causal({
			takesPlaceAt: new Map([
				[EV_EFFECT, tpa(LOC_A)],
				[EV_CAUSE, tpa(LOC_B, 1 / 3, 2 / 3)] // scoped location
			])
		});
		expect(projectState(0.5, [ANCHOR], [], emptyCtx, [], c).causalEdges).toHaveLength(1); // inside
		expect(projectState(0.1, [ANCHOR], [], emptyCtx, [], c).causalEdges).toHaveLength(0); // before window
		expect(projectState(0.9, [ANCHOR], [], emptyCtx, [], c).causalEdges).toHaveLength(0); // after window
	});

	it('T-aware location: a scoped takes_place_at wins over a timeless one inside its window (FU2)', () => {
		// Cause Event is at LOC_B by default but temporarily at LOC_C during [1/3,2/3).
		const c = causal({
			takesPlaceAt: new Map([
				[EV_EFFECT, tpa(LOC_A)],
				[EV_CAUSE, [...tpa(LOC_B), { locationId: LOC_C, startPosition: 1 / 3, endPosition: 2 / 3 }]]
			]),
			centroidByLocation: new Map([
				[LOC_A, CENTROID_A],
				[LOC_B, CENTROID_B],
				[LOC_C, { x: 0.5, y: 0.5 }]
			])
		});
		// Outside the window → timeless LOC_B; inside → scoped LOC_C wins.
		expect(projectState(0.1, [ANCHOR], [], emptyCtx, [], c).causalEdges[0].toPos).toEqual(CENTROID_B);
		expect(projectState(0.5, [ANCHOR], [], emptyCtx, [], c).causalEdges[0].toPos).toEqual({ x: 0.5, y: 0.5 });
	});

	it('mystery edge (not yet revealed at T) → hidden, then shown once revealed', () => {
		const mystery = causal({ edges: [edge({ revealedAtPosition: 5 })] }); // timeless but reveal-gated
		expect(projectState(3, [ANCHOR], [], emptyCtx, [], mystery).causalEdges).toHaveLength(0);
		expect(projectState(6, [ANCHOR], [], emptyCtx, [], mystery).causalEdges).toHaveLength(1);
	});

	it('endpoint resolved through a reveal-gated takes_place_at → omitted until revealed (Codex PR #72)', () => {
		// The causal edge itself is public, but the cause endpoint's only location
		// link is reveal-gated. Before the reveal the endpoint must not resolve, or a
		// drawn arrow would spatially leak the hidden Location.
		const gated = causal({
			takesPlaceAt: new Map([
				[EV_EFFECT, tpa(LOC_A)],
				[EV_CAUSE, tpa(LOC_B, null, null, 5)] // reveal-gated takes_place_at
			])
		});
		expect(projectState(3, [ANCHOR], [], emptyCtx, [], gated).causalEdges).toHaveLength(0);
		expect(projectState(6, [ANCHOR], [], emptyCtx, [], gated).causalEdges).toHaveLength(1);
	});

	it('idle (t = -Infinity): no active anchor → no causal edges at all', () => {
		// WorldMap passes t = -Infinity at idle; pickActiveAnchor returns nothing
		// before the first anchor's tPosition (0 here), so the map draws nothing.
		const idle = Number.NEGATIVE_INFINITY;
		expect(projectState(idle, [ANCHOR], [], emptyCtx, [], causal()).causalEdges).toHaveLength(0);
		const span = causal({ edges: [edge({ startPosition: 1 / 3, endPosition: 2 / 3 })] });
		expect(projectState(idle, [ANCHOR], [], emptyCtx, [], span).causalEdges).toHaveLength(0);
	});

	it('no caused_by edges / default arg → empty causalEdges (regression for existing callers)', () => {
		expect(projectState(0, [ANCHOR], [], emptyCtx).causalEdges).toEqual([]);
		expect(
			projectState(0, [ANCHOR], [], emptyCtx, [], {
				edges: [],
				takesPlaceAt: new Map(),
				centroidByLocation: new Map()
			}).causalEdges
		).toEqual([]);
	});
});
