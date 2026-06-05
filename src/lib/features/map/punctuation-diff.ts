// Cinematic Spotlight (Slice 8) — frame-diff punctuation engine.
//
// Events should READ as events during playback: a region flashes when its owner
// flips (conquest), a mover leaves a trail, a causal chain ripples. Per the
// design, punctuation is DERIVED by diffing two consecutive RenderedStates on
// the client — projection.ts stays pure, no new map_event kinds. This module is
// the pure diff; the Pixi layer (PixiPunctuationLayer) renders what it emits.
//
// PR1 emits only the conquest flip (owner change). March trail + causal ripple
// land in PR2; the `Punctuation` union and the RenderedState-in/-out signature
// are shaped so they extend by adding cases, not reshaping.
//
// Window/Pixi-free (SSR-safe, unit-tested).
//
// ── Contract (eng-review decision #6) ──────────────────────────────────────
//   - Key the owner-flip on RenderedRegion.factionId, NOT color — color also
//     changes on a faction recolor or a scope-dim fade, which are not conquests.
//   - Skip entirely when prev OR cur is null, and when the playhead is null
//     (idle): the map shows the -Infinity baseline at idle and must not emit a
//     flash for the idle→first-frame transition.
//   - Reset the baseline on activeMapId change so a map switch can't emit phantom
//     FX from one map's regions against another's. This module is pure, so the
//     CALLER (playback-controller) enforces it by passing prev=null on the first
//     diff after a switch, and by keeping a `lastPlayedRenderedState` baseline so
//     the first transition after idle isn't swallowed.
//   - Simultaneous flips (same T) are staggered into distinct beats so they don't
//     fire as one indistinct blob.

import type { RenderedState } from './projection.js';

// One owner-flip beat. fromFactionId is the previous owner (null = neutral /
// unowned), toFactionId the new one. staggerMs offsets simultaneous flips so
// they read as distinct beats; the renderer delays the FX start by it.
export type ConquestFlip = {
	type: 'conquest';
	regionId: string;
	fromFactionId: string | null;
	toFactionId: string | null;
	staggerMs: number;
};

// The punctuation union. PR2 adds 'march' (trail) and 'ripple' (causal chain);
// consumers switch on `type` so new kinds are additive.
export type Punctuation = ConquestFlip;

export type DiffOptions = {
	// Per-beat stagger for simultaneous flips (design: ~80ms). The Nth flip in
	// the deterministic order starts N×step later.
	staggerStepMs?: number;
};

const DEFAULT_STAGGER_MS = 80;

/**
 * Diff two consecutive RenderedStates into punctuation beats. Pure: same inputs
 * → same output, no time/Pixi/DOM. Returns [] when the diff is suppressed (null
 * prev/cur or idle playhead) — see the contract above.
 *
 * PR1: emits a ConquestFlip for every region whose factionId changed between
 * prev and cur. A region present in `cur` but absent from `prev` is NOT a flip
 * (it has no prior owner to flip FROM — treating it as one would flash every
 * region on the first post-switch frame, the phantom-FX case the baseline reset
 * guards against).
 */
export function diffPunctuation(
	prev: RenderedState | null,
	cur: RenderedState | null,
	playhead: number | null,
	opts: DiffOptions = {}
): Punctuation[] {
	if (prev === null || cur === null) return [];
	if (playhead === null) return []; // idle: no punctuation

	const step = opts.staggerStepMs ?? DEFAULT_STAGGER_MS;

	const prevFactionByRegion = new Map<string, string | null>();
	for (const r of prev.regions) prevFactionByRegion.set(r.regionId, r.factionId);

	const flips: ConquestFlip[] = [];
	for (const r of cur.regions) {
		if (!prevFactionByRegion.has(r.regionId)) continue; // new region, not a flip
		const from = prevFactionByRegion.get(r.regionId) ?? null;
		if (from === r.factionId) continue; // owner unchanged (factionId, not color)
		flips.push({
			type: 'conquest',
			regionId: r.regionId,
			fromFactionId: from,
			toFactionId: r.factionId,
			staggerMs: 0
		});
	}

	// Deterministic order (by regionId) so simultaneous flips stagger stably
	// across runs; assign the per-beat offset. (The richer event-tiebreak order —
	// t_position, created_at, id — needs event data this diff doesn't carry; it
	// matters most for the causal ripple in PR2, where the edge data is present.)
	flips.sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
	for (let i = 0; i < flips.length; i++) flips[i].staggerMs = i * step;

	return flips;
}
