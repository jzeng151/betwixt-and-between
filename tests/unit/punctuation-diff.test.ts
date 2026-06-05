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
		expect(out.map((f) => [f.regionId, f.staggerMs])).toEqual([
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
