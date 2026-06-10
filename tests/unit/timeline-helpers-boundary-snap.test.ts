/**
 * 2026-06 audit (B9) — positionToStartFKs high-side boundary snap.
 *
 * positionToEndFKs has always snapped positions within 1e-9 of an integer
 * boundary on BOTH sides; positionToStartFKs only snapped the low side. For
 * atPosition = k - 5e-10, splitInterval's left half ended exactly at k while
 * its right half started at k - 5e-10 — two same-entity intervals overlapping
 * by an epsilon sliver, with the right half's range effectively starting in
 * the previous act. The snap is now symmetric.
 */
import { describe, it, expect } from 'vitest';
import {
	positionToStartFKs,
	positionToEndFKs
} from '../../src/lib/features/timeline/timeline-helpers.js';

const acts = [{ id: 'act-0' }, { id: 'act-1' }];
const noScenes = new Map<string, { id: string }[]>();

describe('positionToStartFKs — symmetric boundary snap', () => {
	it('snaps a position just below an act boundary to the next act start', () => {
		const fks = positionToStartFKs(1 - 5e-10, acts, noScenes);
		expect(fks).toEqual({ startActId: 'act-1', startSceneId: null, startPosition: 1 });
	});

	it('agrees with positionToEndFKs at the same near-boundary position (no sliver)', () => {
		const p = 1 - 5e-10;
		const start = positionToStartFKs(p, acts, noScenes);
		const end = positionToEndFKs(p, acts, noScenes);
		expect(start?.startPosition).toBe(1);
		expect(end?.endPosition).toBe(1);
	});

	it('returns null when the snap lands past the last act (zero-extent start)', () => {
		expect(positionToStartFKs(2 - 5e-10, acts, noScenes)).toBeNull();
	});

	it('keeps the low-side snap', () => {
		const fks = positionToStartFKs(1 + 5e-10, acts, noScenes);
		expect(fks).toEqual({ startActId: 'act-1', startSceneId: null, startPosition: 1 });
	});

	it('leaves interior free-fraction positions untouched', () => {
		const fks = positionToStartFKs(0.37, acts, noScenes);
		expect(fks).toEqual({ startActId: 'act-0', startSceneId: null, startPosition: 0.37 });
	});
});
