// Cinematic Spotlight (Slice 8) — playback reaction controller. Pins the
// baseline + pin-state semantics WorldMap drives; the FX render is Pixi-only.

import { describe, it, expect } from 'vitest';
import { createPlaybackReaction } from '../../src/lib/features/map/playback-controller.js';
import type { RenderedState, RenderedRegion } from '../../src/lib/features/map/projection.js';

function state(regions: Array<{ regionId: string; factionId: string | null }>): RenderedState {
	return {
		tPosition: 0,
		regions: regions.map(
			(r): RenderedRegion => ({ regionId: r.regionId, factionId: r.factionId, color: '#000' })
		),
		artifacts: [],
		cells: [],
		strokes: [],
		artifactOverrides: new Map(),
		causalEdges: []
	};
}

describe('createPlaybackReaction — frame diffing', () => {
	it('emits nothing on the first frame (no baseline yet), then diffs the next', () => {
		const r = createPlaybackReaction();
		const f0 = state([{ regionId: 'r1', factionId: 'A' }]);
		expect(r.frame(f0, 0.1, 'map1')).toEqual([]);
		const f1 = state([{ regionId: 'r1', factionId: 'B' }]);
		const beats = r.frame(f1, 0.2, 'map1');
		expect(beats).toEqual([
			{ type: 'conquest', regionId: 'r1', fromFactionId: 'A', toFactionId: 'B', staggerMs: 0 }
		]);
	});

	it('emits nothing when the playhead is idle, and preserves the baseline across idle', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.1, 'map1'); // baseline = A
		// Idle: no emit, baseline NOT updated to the idle state.
		expect(r.frame(state([{ regionId: 'r1', factionId: 'A' }]), null, 'map1')).toEqual([]);
		// Back to active at B → the first post-idle transition still registers.
		const beats = r.frame(state([{ regionId: 'r1', factionId: 'B' }]), 0.3, 'map1');
		expect(beats[0]).toMatchObject({ fromFactionId: 'A', toFactionId: 'B' });
	});

	it('resets the baseline on activeMapId change (no phantom FX across maps)', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.1, 'map1'); // baseline on map1
		// Switch to map2: the first frame there diffs against null → no flash, even
		// though the regionId/faction differ from map1's baseline.
		const beats = r.frame(state([{ regionId: 'r1', factionId: 'Z' }]), 0.1, 'map2');
		expect(beats).toEqual([]);
	});

	it('reset() drops the baseline so the next frame does not flash (replay-from-start)', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.1, 'map1');
		r.reset();
		expect(r.frame(state([{ regionId: 'r1', factionId: 'B' }]), 0.2, 'map1')).toEqual([]);
	});

	it('a backward playhead jump (replay-from-end) drops the baseline → no reverse flash', () => {
		const r = createPlaybackReaction();
		// Play forward to an ending state where r1 is owned by B.
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.2, 'map1');
		r.frame(state([{ regionId: 'r1', factionId: 'B' }]), 0.9, 'map1');
		// Press Play at the end → playhead rewinds to 0, rendered state is the
		// initial A. Diffing A against the B baseline would be a phantom B→A
		// "reverse conquest"; the backward jump must suppress it.
		expect(r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0, 'map1')).toEqual([]);
		// Forward motion from the rewound baseline diffs normally again.
		const beats = r.frame(state([{ regionId: 'r1', factionId: 'B' }]), 0.2, 'map1');
		expect(beats[0]).toMatchObject({ fromFactionId: 'A', toFactionId: 'B' });
	});

	it('a forward playhead step after a backward jump still emits (baseline re-seeds)', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.5, 'map1');
		// Reverse scrub: backward jump suppresses the un-conquest flash and re-seeds.
		expect(r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.1, 'map1')).toEqual([]);
		// Scrubbing forward again past a real flip fires.
		const beats = r.frame(state([{ regionId: 'r1', factionId: 'C' }]), 0.4, 'map1');
		expect(beats[0]).toMatchObject({ fromFactionId: 'A', toFactionId: 'C' });
	});

	it('emits nothing for a null rendered state', () => {
		const r = createPlaybackReaction();
		expect(r.frame(null, 0.1, 'map1')).toEqual([]);
	});

	it('idle → map-switch → active emits no phantom flash (baseline reset wins over preserve-across-idle)', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.1, 'map1'); // baseline on map1
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), null, 'map1'); // idle (baseline kept)
		// First active frame on map2 must diff against null (map reset), not map1's
		// preserved baseline — no phantom even though factionId differs.
		expect(r.frame(state([{ regionId: 'r1', factionId: 'Q' }]), 0.2, 'map2')).toEqual([]);
	});

	it('rapid map1 → map2 → map1 re-resets the baseline each switch (no stale phantom)', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.1, 'map1');
		r.frame(state([{ regionId: 'r1', factionId: 'B' }]), 0.1, 'map2'); // reset → []
		// Back to map1: baseline was reset on the map2 switch, so the first frame
		// here diffs against null again — no flash from map1's old 'A' baseline.
		expect(r.frame(state([{ regionId: 'r1', factionId: 'C' }]), 0.1, 'map1')).toEqual([]);
	});
});

describe('createPlaybackReaction — pin state', () => {
	it('starts unpinned; pin()/unpin() toggle it', () => {
		const r = createPlaybackReaction();
		expect(r.pinned).toBe(false);
		r.pin();
		expect(r.pinned).toBe(true);
		r.unpin();
		expect(r.pinned).toBe(false);
	});

	it('pinning does NOT suppress punctuation (FX still fire on a manual scrub)', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.1, 'map1');
		r.pin();
		const beats = r.frame(state([{ regionId: 'r1', factionId: 'B' }]), 0.2, 'map1');
		expect(beats).toHaveLength(1);
	});
});
