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

// One mover-segment beat (PR2): a placement that moved between prev and cur
// leaves a fading trail behind it. from/to are FRACTIONAL [0,1] positions (the
// artifactOverrides convention); the renderer multiplies by map dims.
export type MarchTrail = {
	type: 'march';
	placementId: string;
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
	staggerMs: number;
};

// One causal-chain beat (PR2, the headline): a caused_by edge that became newly
// lit at T ripples along its already-drawn arc. from/to are FRACTIONAL [0,1]
// (the causalEdges convention), fromPos = effect centroid, toPos = cause
// centroid (projection.ts:298-308). The ripple travels cause→effect.
export type CausalRipple = {
	type: 'ripple';
	relationshipId: string;
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
	staggerMs: number;
};

// The punctuation union. Consumers switch on `type` so kinds stay additive.
export type Punctuation = ConquestFlip | MarchTrail | CausalRipple;

export type DiffOptions = {
	// Per-beat stagger for simultaneous beats of one kind (design: ~80ms). The
	// Nth beat in the deterministic order starts N×step later. Stagger is applied
	// WITHIN each kind, so the existing conquest staggering is unchanged.
	staggerStepMs?: number;
	// Minimum fractional displacement for a move to register as a march trail —
	// guards sub-pixel interpolation jitter from emitting hairline trails.
	moveEpsilon?: number;
};

const DEFAULT_STAGGER_MS = 80;
const DEFAULT_MOVE_EPSILON = 1e-3; // 0.1% of the map's span

/**
 * Diff two consecutive RenderedStates into punctuation beats. Pure: same inputs
 * → same output, no time/Pixi/DOM. Returns [] when the diff is suppressed (null
 * prev/cur or idle playhead) — see the contract above.
 *
 * Emits, all from the SAME forward frame diff:
 *   - a ConquestFlip for every region whose factionId changed. A region present
 *     in `cur` but absent from `prev` is NOT a flip (no prior owner to flip FROM
 *     — treating it as one would flash every region on the first post-switch
 *     frame, the phantom-FX case the baseline reset guards against);
 *   - a MarchTrail for every placement whose interpolated position moved (in
 *     BOTH frames' artifactOverrides, displaced ≥ moveEpsilon). A placement that
 *     just entered (absent from prev) has no from-position → no trail;
 *   - a CausalRipple for every caused_by edge newly lit in `cur` (present in
 *     cur.causalEdges, absent from prev's) — the edge becoming visible at T is
 *     the beat.
 *
 * Stagger is per-kind so simultaneous beats of one kind read distinctly; the
 * conquest staggering is byte-for-byte what PR1 shipped. (The richer
 * t_position/created_at/id tiebreak needs event data this diff doesn't carry;
 * regionId / placementId / relationshipId give a stable deterministic order.)
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
	const moveEps = opts.moveEpsilon ?? DEFAULT_MOVE_EPSILON;

	// ── Conquest flips (owner change, keyed on factionId not color) ──────────
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
	flips.sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
	for (let i = 0; i < flips.length; i++) flips[i].staggerMs = i * step;

	// ── March trails (placement moved between frames) ────────────────────────
	const marches: MarchTrail[] = [];
	for (const [placementId, to] of cur.artifactOverrides) {
		const from = prev.artifactOverrides.get(placementId);
		if (!from) continue; // just entered → no prior position to trail from
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		if (Math.abs(dx) < moveEps && Math.abs(dy) < moveEps) continue; // jitter
		marches.push({
			type: 'march',
			placementId,
			fromX: from.x,
			fromY: from.y,
			toX: to.x,
			toY: to.y,
			staggerMs: 0
		});
	}
	marches.sort((a, b) => (a.placementId < b.placementId ? -1 : a.placementId > b.placementId ? 1 : 0));
	for (let i = 0; i < marches.length; i++) marches[i].staggerMs = i * step;

	// ── Causal ripples (caused_by edge newly lit at T) ───────────────────────
	const prevEdgeIds = new Set<string>();
	for (const e of prev.causalEdges) prevEdgeIds.add(e.relationshipId);

	const ripples: CausalRipple[] = [];
	for (const e of cur.causalEdges) {
		if (prevEdgeIds.has(e.relationshipId)) continue; // already lit → not a new beat
		ripples.push({
			type: 'ripple',
			relationshipId: e.relationshipId,
			fromX: e.fromPos.x,
			fromY: e.fromPos.y,
			toX: e.toPos.x,
			toY: e.toPos.y,
			staggerMs: 0
		});
	}
	ripples.sort((a, b) =>
		a.relationshipId < b.relationshipId ? -1 : a.relationshipId > b.relationshipId ? 1 : 0
	);
	for (let i = 0; i < ripples.length; i++) ripples[i].staggerMs = i * step;

	return [...flips, ...marches, ...ripples];
}
