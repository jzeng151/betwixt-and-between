// Cinematic Spotlight (Slice 8) — punctuation diff contract. The on-canvas FX
// are Pixi-only; this pins the pure owner-flip derivation the renderer consumes.

import { describe, it, expect } from 'vitest';
import { diffPunctuation } from '../../src/lib/features/map/punctuation-diff.js';
import type { RenderedState, RenderedRegion } from '../../src/lib/features/map/projection.js';

// Minimal RenderedState carrying only what the diff reads (regions). The other
// fields are present so the type is satisfied and PR2 kinds can extend the same
// fixtures.
function state(regions: Array<Partial<RenderedRegion> & { regionId: string }>): RenderedState {
	return {
		tPosition: 0,
		regions: regions.map((r) => ({
			regionId: r.regionId,
			factionId: r.factionId ?? null,
			color: r.color ?? '#000000'
		})),
		artifacts: [],
		cells: [],
		artifactOverrides: new Map(),
		causalEdges: []
	};
}

describe('diffPunctuation — suppression guards', () => {
	const s = state([{ regionId: 'r1', factionId: 'A' }]);

	it('returns [] when prev is null', () => {
		expect(diffPunctuation(null, s, 0)).toEqual([]);
	});

	it('returns [] when cur is null', () => {
		expect(diffPunctuation(s, null, 0)).toEqual([]);
	});

	it('returns [] when the playhead is idle (null) — no idle→first-frame flash', () => {
		const prev = state([{ regionId: 'r1', factionId: 'A' }]);
		const cur = state([{ regionId: 'r1', factionId: 'B' }]);
		expect(diffPunctuation(prev, cur, null)).toEqual([]);
	});
});

describe('diffPunctuation — owner flips', () => {
	it('emits a conquest flip when factionId changes', () => {
		const prev = state([{ regionId: 'r1', factionId: 'A' }]);
		const cur = state([{ regionId: 'r1', factionId: 'B' }]);
		expect(diffPunctuation(prev, cur, 0.5)).toEqual([
			{ type: 'conquest', regionId: 'r1', fromFactionId: 'A', toFactionId: 'B', staggerMs: 0 }
		]);
	});

	it('treats neutral (null) as a real owner: null→A and A→null both flip', () => {
		const gain = diffPunctuation(
			state([{ regionId: 'r1', factionId: null }]),
			state([{ regionId: 'r1', factionId: 'A' }]),
			0.5
		);
		expect(gain[0]).toMatchObject({ fromFactionId: null, toFactionId: 'A' });

		const loss = diffPunctuation(
			state([{ regionId: 'r1', factionId: 'A' }]),
			state([{ regionId: 'r1', factionId: null }]),
			0.5
		);
		expect(loss[0]).toMatchObject({ fromFactionId: 'A', toFactionId: null });
	});

	it('does NOT flip when only the color changed (recolor/scope-fade) but factionId is the same', () => {
		const prev = state([{ regionId: 'r1', factionId: 'A', color: '#111111' }]);
		const cur = state([{ regionId: 'r1', factionId: 'A', color: '#eeeeee' }]);
		expect(diffPunctuation(prev, cur, 0.5)).toEqual([]);
	});

	it('does NOT flip a region that is new in cur (no prior owner to flip from)', () => {
		const prev = state([{ regionId: 'r1', factionId: 'A' }]);
		const cur = state([
			{ regionId: 'r1', factionId: 'A' },
			{ regionId: 'r2', factionId: 'B' }
		]);
		expect(diffPunctuation(prev, cur, 0.5)).toEqual([]);
	});

	it('ignores a region that disappeared in cur (only cur regions are diffed)', () => {
		const prev = state([
			{ regionId: 'r1', factionId: 'A' },
			{ regionId: 'r2', factionId: 'B' }
		]);
		const cur = state([{ regionId: 'r1', factionId: 'A' }]);
		expect(diffPunctuation(prev, cur, 0.5)).toEqual([]);
	});
});

describe('diffPunctuation — simultaneous-flip stagger', () => {
	it('staggers multiple flips deterministically by regionId at 80ms steps', () => {
		const prev = state([
			{ regionId: 'rB', factionId: 'X' },
			{ regionId: 'rA', factionId: 'X' },
			{ regionId: 'rC', factionId: 'X' }
		]);
		const cur = state([
			{ regionId: 'rB', factionId: 'Y' },
			{ regionId: 'rA', factionId: 'Y' },
			{ regionId: 'rC', factionId: 'Y' }
		]);
		const out = diffPunctuation(prev, cur, 0.5);
		expect(out.map((f) => [(f as { regionId: string }).regionId, f.staggerMs])).toEqual([
			['rA', 0],
			['rB', 80],
			['rC', 160]
		]);
	});

	it('honors a custom stagger step', () => {
		const prev = state([
			{ regionId: 'rA', factionId: 'X' },
			{ regionId: 'rB', factionId: 'X' }
		]);
		const cur = state([
			{ regionId: 'rA', factionId: 'Y' },
			{ regionId: 'rB', factionId: 'Y' }
		]);
		const out = diffPunctuation(prev, cur, 0.5, { staggerStepMs: 30 });
		expect(out.map((f) => f.staggerMs)).toEqual([0, 30]);
	});
});

// ── PR2 kinds ───────────────────────────────────────────────────────────────

// State with mover overrides (fractional placement positions).
function movers(overrides: Record<string, { x: number; y: number }>): RenderedState {
	const s = state([]);
	s.artifactOverrides = new Map(Object.entries(overrides));
	return s;
}

// State with lit causal edges (fractional centroids).
function edges(
	list: Array<{ id: string; from: { x: number; y: number }; to: { x: number; y: number } }>
): RenderedState {
	const s = state([]);
	s.causalEdges = list.map((e) => ({
		relationshipId: e.id,
		fromPos: e.from,
		toPos: e.to,
		causeEndpointId: `cause:${e.id}`
	}));
	return s;
}

describe('diffPunctuation — march trails', () => {
	it('emits a march for a placement that moved between frames', () => {
		const prev = movers({ p1: { x: 0.1, y: 0.1 } });
		const cur = movers({ p1: { x: 0.4, y: 0.2 } });
		expect(diffPunctuation(prev, cur, 0.5)).toEqual([
			{ type: 'march', placementId: 'p1', fromX: 0.1, fromY: 0.1, toX: 0.4, toY: 0.2, staggerMs: 0 }
		]);
	});

	it('does NOT emit for a placement that just entered (no prior position)', () => {
		const prev = movers({});
		const cur = movers({ p1: { x: 0.4, y: 0.2 } });
		expect(diffPunctuation(prev, cur, 0.5)).toEqual([]);
	});

	it('ignores sub-epsilon jitter', () => {
		const prev = movers({ p1: { x: 0.1, y: 0.1 } });
		const cur = movers({ p1: { x: 0.1 + 1e-5, y: 0.1 - 1e-5 } });
		expect(diffPunctuation(prev, cur, 0.5)).toEqual([]);
	});

	it('staggers simultaneous marches deterministically by placementId', () => {
		const prev = movers({ pB: { x: 0, y: 0 }, pA: { x: 0, y: 0 } });
		const cur = movers({ pB: { x: 0.5, y: 0.5 }, pA: { x: 0.5, y: 0.5 } });
		const out = diffPunctuation(prev, cur, 0.5);
		expect(out.map((m) => [(m as { placementId: string }).placementId, m.staggerMs])).toEqual([
			['pA', 0],
			['pB', 80]
		]);
	});
});

describe('diffPunctuation — causal ripples', () => {
	it('emits a ripple for a caused_by edge newly lit in cur', () => {
		const prev = edges([]);
		const cur = edges([{ id: 'rel1', from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.7 } }]);
		expect(diffPunctuation(prev, cur, 0.5)).toEqual([
			{ type: 'ripple', relationshipId: 'rel1', fromX: 0.2, fromY: 0.3, toX: 0.8, toY: 0.7, staggerMs: 0 }
		]);
	});

	it('does NOT re-ripple an edge already lit in prev', () => {
		const lit = { id: 'rel1', from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.7 } };
		expect(diffPunctuation(edges([lit]), edges([lit]), 0.5)).toEqual([]);
	});

	it('staggers simultaneous new ripples deterministically by relationshipId', () => {
		const prev = edges([]);
		const cur = edges([
			{ id: 'relB', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
			{ id: 'relA', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }
		]);
		const out = diffPunctuation(prev, cur, 0.5);
		expect(out.map((r) => [(r as { relationshipId: string }).relationshipId, r.staggerMs])).toEqual([
			['relA', 0],
			['relB', 80]
		]);
	});

	it('is suppressed at idle (null playhead) like the other kinds', () => {
		const cur = edges([{ id: 'rel1', from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.7 } }]);
		expect(diffPunctuation(edges([]), cur, null)).toEqual([]);
	});
});

describe('diffPunctuation — combined kinds in one frame', () => {
	it('emits conquest, march, and ripple together, grouped by kind', () => {
		const prev: RenderedState = {
			...state([{ regionId: 'r1', factionId: 'A' }]),
			artifactOverrides: new Map([['p1', { x: 0.1, y: 0.1 }]]),
			causalEdges: []
		};
		const cur: RenderedState = {
			...state([{ regionId: 'r1', factionId: 'B' }]),
			artifactOverrides: new Map([['p1', { x: 0.5, y: 0.5 }]]),
			causalEdges: [
				{
					relationshipId: 'rel1',
					fromPos: { x: 0, y: 0 },
					toPos: { x: 1, y: 1 },
					causeEndpointId: 'c'
				}
			]
		};
		const out = diffPunctuation(prev, cur, 0.5);
		expect(out.map((b) => b.type)).toEqual(['conquest', 'march', 'ripple']);
	});
});
