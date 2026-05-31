/**
 * World Map v3 Slice 4 PR-F (D5) — movement fold + keyframe interpolation.
 *
 * Covers the pure engine added in PR-F Step 2:
 *   - interpolatePosition: linear vs ease_in_out (asserted OFF-midpoint —
 *     every symmetric ease passes through 0.5 at u=0.5, so a midpoint
 *     assertion can't distinguish the curves; the quarter point can),
 *     end clamps, zero-span guard.
 *   - projectState's artifactOverrides:
 *       · baseline before first keyframe / clamp after last
 *       · two keyframes → interpolated midpoint
 *       · same-T keyframes collapse last-write-wins (no NaN)  [D-PRF-10a]
 *       · keyframe at the active anchor's T is included        [D-PRF-10b]
 *       · windowed placement not seeded outside its window     [D-PRF-9 mirror]
 *       · same entity placed twice → two independent movers    [D5]
 *       · no placements / no keyframes → empty overrides       [regression]
 */
import { describe, it, expect } from 'vitest';
import {
	interpolatePosition,
	projectState,
	type ProjectionAnchor,
	type ProjectionEvent,
	type ProjectionContext,
	type ProjectionPlacement,
	type EaseKind
} from '../../src/lib/features/map/projection.js';

const emptyCtx: ProjectionContext = {
	allowedFactions: new Map(),
	allowedRegions: new Set()
};

const PL_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PL_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function placement(over: Partial<ProjectionPlacement> & { id: string }): ProjectionPlacement {
	return { x: 0, y: 0, startPosition: null, endPosition: null, ...over };
}

function moveEvent(
	id: string,
	t: number,
	placementId: string,
	x: number,
	y: number,
	tween: EaseKind = 'linear',
	createdAt = '2026-01-01T00:00:00.000Z'
): ProjectionEvent {
	return {
		id,
		tPosition: t,
		kind: 'move_entity',
		createdAt,
		payloadJsonb: { placement_id: placementId, position: { x, y }, tween }
	};
}

describe('interpolatePosition', () => {
	const prev = { tPosition: 0, x: 0, y: 0 };

	it('linear midpoint is the arithmetic mean', () => {
		const p = interpolatePosition(prev, { tPosition: 10, x: 1, y: 1, tween: 'linear' }, 5);
		expect(p.x).toBeCloseTo(0.5, 10);
		expect(p.y).toBeCloseTo(0.5, 10);
	});

	it('linear and ease_in_out agree at the MIDPOINT (symmetric ease through 0.5)', () => {
		const lin = interpolatePosition(prev, { tPosition: 10, x: 1, y: 0, tween: 'linear' }, 5);
		const eio = interpolatePosition(prev, { tPosition: 10, x: 1, y: 0, tween: 'ease_in_out' }, 5);
		expect(eio.x).toBeCloseTo(lin.x, 10); // both 0.5 — this is WHY we test the quarter point below
	});

	it('linear and ease_in_out DIFFER at the quarter point', () => {
		const lin = interpolatePosition(prev, { tPosition: 4, x: 1, y: 0, tween: 'linear' }, 1);
		const eio = interpolatePosition(prev, { tPosition: 4, x: 1, y: 0, tween: 'ease_in_out' }, 1);
		expect(lin.x).toBeCloseTo(0.25, 10); // u=0.25 linear
		expect(eio.x).toBeCloseTo(0.125, 10); // u=0.25 easeInOutQuad = 2*0.25^2
		expect(eio.x).toBeLessThan(lin.x);
	});

	it('clamps u to [0,1] — t before prev returns prev, t after next returns next', () => {
		const seg = { tPosition: 10, x: 1, y: 1, tween: 'linear' as const };
		expect(interpolatePosition(prev, seg, -5).x).toBeCloseTo(0, 10);
		expect(interpolatePosition(prev, seg, 99).x).toBeCloseTo(1, 10);
	});

	it('zero-length span (prevT === nextT) returns next, never NaN', () => {
		const p = interpolatePosition({ tPosition: 5, x: 0, y: 0 }, { tPosition: 5, x: 1, y: 1, tween: 'linear' }, 5);
		expect(Number.isFinite(p.x)).toBe(true);
		expect(p.x).toBe(1);
	});
});

describe('projectState movement fold — artifactOverrides', () => {
	it('no placements → empty overrides even with move events', () => {
		const events = [moveEvent('e1', 5, PL_A, 1, 1)];
		const s = projectState(10, [], events, emptyCtx, []);
		expect(s.artifactOverrides.size).toBe(0);
	});

	it('placement with no keyframes → no override (renderer uses static x,y)', () => {
		const s = projectState(10, [], [], emptyCtx, [placement({ id: PL_A, x: 0.3, y: 0.4 })]);
		expect(s.artifactOverrides.has(PL_A)).toBe(false);
	});

	it('before the first keyframe → baseline position', () => {
		const events = [moveEvent('e1', 10, PL_A, 0.9, 0.9)];
		const s = projectState(5, [], events, emptyCtx, [placement({ id: PL_A, x: 0.1, y: 0.2 })]);
		expect(s.artifactOverrides.get(PL_A)).toEqual({ x: 0.1, y: 0.2 });
	});

	it('after the last keyframe → clamp to last (no extrapolation)', () => {
		const events = [moveEvent('e1', 2, PL_A, 0.5, 0.5), moveEvent('e2', 6, PL_A, 1, 1)];
		const s = projectState(100, [], events, emptyCtx, [placement({ id: PL_A })]);
		expect(s.artifactOverrides.get(PL_A)).toEqual({ x: 1, y: 1 });
	});

	it('two keyframes → interpolated midpoint at the segment midpoint', () => {
		const events = [moveEvent('e1', 0, PL_A, 0, 0), moveEvent('e2', 10, PL_A, 1, 1)];
		const s = projectState(5, [], events, emptyCtx, [placement({ id: PL_A })]);
		const pos = s.artifactOverrides.get(PL_A)!;
		expect(pos.x).toBeCloseTo(0.5, 10);
		expect(pos.y).toBeCloseTo(0.5, 10);
	});

	it('ease_in_out segment differs from linear at the quarter point', () => {
		const lin = projectState(1, [], [moveEvent('e1', 0, PL_A, 0, 0), moveEvent('e2', 4, PL_A, 1, 0, 'linear')], emptyCtx, [placement({ id: PL_A })]);
		const eio = projectState(1, [], [moveEvent('e1', 0, PL_A, 0, 0), moveEvent('e2', 4, PL_A, 1, 0, 'ease_in_out')], emptyCtx, [placement({ id: PL_A })]);
		expect(lin.artifactOverrides.get(PL_A)!.x).toBeCloseTo(0.25, 10);
		expect(eio.artifactOverrides.get(PL_A)!.x).toBeCloseTo(0.125, 10);
	});

	// D-PRF-10a: two keyframes at the SAME t_position collapse last-write-wins
	// by (created_at, id). The later-committed one survives; prev/next can never
	// share a t (no zero-span → no NaN).
	it('same-T keyframes collapse last-write-wins (no NaN)', () => {
		const events = [
			moveEvent('e_early', 5, PL_A, 0.2, 0.2, 'linear', '2026-01-01T00:00:00.000Z'),
			moveEvent('e_late', 5, PL_A, 0.8, 0.8, 'linear', '2026-01-01T00:00:01.000Z')
		];
		const s = projectState(5, [], events, emptyCtx, [placement({ id: PL_A })]);
		const pos = s.artifactOverrides.get(PL_A)!;
		expect(Number.isFinite(pos.x)).toBe(true);
		expect(pos).toEqual({ x: 0.8, y: 0.8 }); // last write wins
	});

	// D-PRF-10b: a keyframe authored at exactly the active anchor's t_position
	// must STILL be folded (movement isn't in anchor state, so CMT-5's
	// exclude-at-anchor-T rule does not apply). Without this, the marker would
	// teleport at anchor boundaries.
	it('keyframe at the active anchor T is included (no boundary teleport)', () => {
		const anchor: ProjectionAnchor = {
			id: 'anc',
			tPosition: 5,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			stateJsonb: { regions: [], artifacts: [], chains: [], cells: [] }
		};
		// Keyframe at T=5 (== anchor.t) and another at T=15; at T=10 the marker
		// should be halfway between them. If the T=5 keyframe were excluded,
		// there'd be no prev and we'd get baseline (teleport).
		const events = [moveEvent('e1', 5, PL_A, 0, 0), moveEvent('e2', 15, PL_A, 1, 1)];
		const s = projectState(10, [anchor], events, emptyCtx, [placement({ id: PL_A, x: 0.99, y: 0.99 })]);
		const pos = s.artifactOverrides.get(PL_A)!;
		expect(pos.x).toBeCloseTo(0.5, 10); // interpolated, NOT the 0.99 baseline
	});

	// D-PRF-9 mirror in the fold: a windowed placement gets no override when T
	// is outside its [start, end) window, even if keyframes exist.
	it('windowed placement is not seeded outside its [start,end) window', () => {
		const events = [moveEvent('e1', 1, PL_A, 0.3, 0.3), moveEvent('e2', 9, PL_A, 0.7, 0.7)];
		const windowed = placement({ id: PL_A, startPosition: 2, endPosition: 8 });
		expect(projectState(5, [], events, emptyCtx, [windowed]).artifactOverrides.has(PL_A)).toBe(true);
		expect(projectState(8, [], events, emptyCtx, [windowed]).artifactOverrides.has(PL_A)).toBe(false); // end exclusive
		expect(projectState(1, [], events, emptyCtx, [windowed]).artifactOverrides.has(PL_A)).toBe(false); // before start
	});

	// D5: the same entity placed twice = two placements = two independent
	// movers, keyed by placement_id.
	it('same entity placed twice → two independent overrides', () => {
		const events = [
			moveEvent('a1', 0, PL_A, 0, 0),
			moveEvent('a2', 10, PL_A, 1, 1),
			moveEvent('b1', 0, PL_B, 1, 1),
			moveEvent('b2', 10, PL_B, 0, 0)
		];
		const s = projectState(5, [], events, emptyCtx, [placement({ id: PL_A }), placement({ id: PL_B })]);
		expect(s.artifactOverrides.get(PL_A)!.x).toBeCloseTo(0.5, 10);
		expect(s.artifactOverrides.get(PL_B)!.x).toBeCloseTo(0.5, 10);
		// They move in opposite directions; at any non-midpoint T they differ.
		const at2 = projectState(2, [], events, emptyCtx, [placement({ id: PL_A }), placement({ id: PL_B })]);
		expect(at2.artifactOverrides.get(PL_A)!.x).toBeCloseTo(0.2, 10);
		expect(at2.artifactOverrides.get(PL_B)!.x).toBeCloseTo(0.8, 10);
	});

	it('a move_entity for a placement NOT in the list yields no override', () => {
		const events = [moveEvent('e1', 5, PL_B, 1, 1)];
		const s = projectState(10, [], events, emptyCtx, [placement({ id: PL_A })]);
		expect(s.artifactOverrides.size).toBe(0);
	});

	it('malformed move payload is skipped (lazy GC), no crash', () => {
		const bad: ProjectionEvent = {
			id: 'bad',
			tPosition: 5,
			kind: 'move_entity',
			createdAt: '2026-01-01T00:00:00.000Z',
			payloadJsonb: { placement_id: PL_A, position: { x: 'nope' }, tween: 'linear' }
		};
		const s = projectState(10, [], [bad], emptyCtx, [placement({ id: PL_A })]);
		expect(s.artifactOverrides.has(PL_A)).toBe(false);
	});
});
