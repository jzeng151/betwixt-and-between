// Cinematic Spotlight (Slice 8) — playback reaction controller. Pins the
// baseline + pin-state semantics WorldMap drives; the FX render is Pixi-only.

import { describe, it, expect } from 'vitest';
import { createPlaybackReaction } from '../../src/lib/features/map/playback-controller.js';
import type {
	RenderedState,
	RenderedRegion,
	RenderedCausalEdge
} from '../../src/lib/features/map/projection.js';

function state(
	regions: Array<{ regionId: string; factionId: string | null }>,
	edgeIds: string[] = []
): RenderedState {
	return {
		tPosition: 0,
		regions: regions.map(
			(r): RenderedRegion => ({ regionId: r.regionId, factionId: r.factionId, color: '#000' })
		),
		artifacts: [],
		cells: [],
		strokes: [],
		artifactOverrides: new Map(),
		causalEdges: edgeIds.map(
			(id): RenderedCausalEdge => ({
				relationshipId: id,
				fromPos: { x: 0.2, y: 0.2 },
				toPos: { x: 0.8, y: 0.8 },
				causeEndpointId: `cause-${id}`
			})
		)
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

// ADR 0007 Fix B — causal ripples across the map-switch boundary. The diff
// baseline still nulls on a switch (conquest/march phantom guard), but ripples
// get a second baseline: the NEW map projected at the PRIOR playhead, supplied
// by the caller via the optional projectAt callback. Only genuine unlit→lit
// transitions across the boundary ripple; #505 (re-announce on cycle-back)
// stays dead.
describe('createPlaybackReaction — map-switch ripple baseline (ADR 0007 Fix B)', () => {
	const noRegions: Array<{ regionId: string; factionId: string | null }> = [];

	it('ripples when the view cycles onto a map where the edge lit AT the boundary', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.4, 'map1');
		// Cycle to map2 at t=0.5. The new map at the prior playhead (0.4) shows
		// the edge UNLIT (that's why the cycle happened — it lights at 0.5).
		const projectAt = (t: number) => state(noRegions, t < 0.5 ? [] : ['edge1']);
		const beats = r.frame(state(noRegions, ['edge1']), 0.5, 'map2', projectAt);
		expect(beats).toEqual([
			{
				type: 'ripple',
				relationshipId: 'edge1',
				fromX: 0.2,
				fromY: 0.2,
				toX: 0.8,
				toY: 0.8,
				staggerMs: 0
			}
		]);
	});

	it('does NOT re-ripple a still-lit edge on cycle-back (#505 stays dead)', () => {
		const r = createPlaybackReaction();
		// Edge lit since t=0.3; the view is elsewhere and cycles back at t=0.6.
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.55, 'map1');
		const projectAt = (t: number) => state(noRegions, t >= 0.3 ? ['edge1'] : []);
		// Prior playhead 0.55 → edge already lit in the baseline → silent.
		const beats = r.frame(state(noRegions, ['edge1']), 0.6, 'map2', projectAt);
		expect(beats).toEqual([]);
	});

	it('a manual map switch while paused fires nothing (prior T == current T)', () => {
		const r = createPlaybackReaction();
		r.frame(state(noRegions, []), 0.4, 'map1');
		// Paused manual switch: playhead unchanged, so the prior projection IS
		// the current state — identical edge set, no beats. (The Fix A regression
		// — ripples on every manual switch — is structurally impossible here.)
		const projectAt = () => state(noRegions, ['edge1']);
		const beats = r.frame(state(noRegions, ['edge1']), 0.4, 'map2', projectAt);
		expect(beats).toEqual([]);
	});

	it('without the projectAt callback the switch frame stays fully silent (back-compat)', () => {
		const r = createPlaybackReaction();
		r.frame(state(noRegions, []), 0.4, 'map1');
		expect(r.frame(state(noRegions, ['edge1']), 0.5, 'map2')).toEqual([]);
	});

	it('the switch baseline is one-shot: later frames diff against lastPlayed, not projectAt', () => {
		const r = createPlaybackReaction();
		r.frame(state(noRegions, []), 0.4, 'map1');
		const projectAt = () => state(noRegions, []);
		r.frame(state(noRegions, ['edge1']), 0.5, 'map2', projectAt); // consumes the baseline
		// Same edge still lit on the next frame → no repeat beat even though
		// projectAt would still report it unlit.
		expect(r.frame(state(noRegions, ['edge1']), 0.6, 'map2', projectAt)).toEqual([]);
	});

	it('a backward jump voids the pending switch baseline (replay re-seeds silently)', () => {
		const r = createPlaybackReaction();
		r.frame(state(noRegions, []), 0.9, 'map1');
		// Replay-from-end: the cycle back to the opening map lands together with
		// the rewind to 0. No burst-ripple of edges lit at the old t=0.9.
		const projectAt = () => state(noRegions, []);
		expect(r.frame(state(noRegions, ['edge1']), 0, 'map2', projectAt)).toEqual([]);
	});

	it('reset() clears the pending switch baseline', () => {
		const r = createPlaybackReaction();
		r.frame(state(noRegions, []), 0.4, 'map1');
		r.frame(state(noRegions, []), null, 'map2'); // switch arrives on an idle frame
		r.reset();
		const projectAt = () => state(noRegions, []);
		expect(r.frame(state(noRegions, ['edge1']), 0.5, 'map2', projectAt)).toEqual([]);
	});

	it('auto-cycle commit: noteCycleCommit supplies the TRUE pre-boundary T (FX frame already advanced lastPlayhead)', () => {
		const r = createPlaybackReaction();
		const projectAt = (t: number) => state(noRegions, t < 0.5 ? [] : ['edge1']);
		// Real flush ordering: the FX effect renders the boundary tick on the OLD
		// map first (lastPlayhead advances to 0.5, PAST the boundary), THEN the
		// cycling driver commits. Without the note, the switch frame would project
		// at 0.5 — edge already lit → swallowed (the bug the first Fix B cut had).
		r.frame(state(noRegions, []), 0.4, 'map1');
		r.frame(state(noRegions, []), 0.5, 'map1'); // boundary tick, still on map1
		r.noteCycleCommit(0.4); // driver: last settled pre-boundary T
		const beats = r.frame(state(noRegions, ['edge1']), 0.5, 'map2', projectAt);
		expect(beats).toHaveLength(1);
		expect(beats[0]).toMatchObject({ type: 'ripple', relationshipId: 'edge1' });
	});

	it('noteCycleCommit is one-shot: a later manual switch falls back to lastPlayhead', () => {
		const r = createPlaybackReaction();
		const projectAt = (t: number) => state(noRegions, t < 0.5 ? [] : ['edge1']);
		r.frame(state(noRegions, []), 0.4, 'map1');
		r.noteCycleCommit(0.3);
		r.frame(state(noRegions, ['edge1']), 0.6, 'map2', projectAt); // consumes the note
		r.frame(state(noRegions, ['edge1']), 0.6, 'map2', projectAt);
		// Manual switch back while paused: prior T = lastPlayhead (0.6), where the
		// edge is lit → silent. The consumed note must not leak into this switch.
		const beats = r.frame(state(noRegions, ['edge1']), 0.6, 'map3', projectAt);
		expect(beats).toEqual([]);
	});

	it('reset() clears a pending noteCycleCommit', () => {
		const r = createPlaybackReaction();
		const projectAt = (t: number) => state(noRegions, t < 0.5 ? [] : ['edge1']);
		r.frame(state(noRegions, []), 0.6, 'map1');
		r.noteCycleCommit(0.4);
		r.reset();
		// Post-reset switch frame: lastPlayhead is null too, so no baseline at all
		// → silent (matches the first-frame-ever contract).
		expect(r.frame(state(noRegions, ['edge1']), 0.6, 'map2', projectAt)).toEqual([]);
	});

	it('conquest stays suppressed on the switch frame (phantom guard unchanged by Fix B)', () => {
		const r = createPlaybackReaction();
		r.frame(state([{ regionId: 'r1', factionId: 'A' }]), 0.4, 'map1');
		const projectAt = (t: number) => state([{ regionId: 'r1', factionId: 'A' }], t < 0.5 ? [] : ['edge1']);
		const beats = r.frame(state([{ regionId: 'r1', factionId: 'Z' }], ['edge1']), 0.5, 'map2', projectAt);
		// The ripple fires; the owner difference vs map1's baseline does NOT.
		expect(beats).toHaveLength(1);
		expect(beats[0].type).toBe('ripple');
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
