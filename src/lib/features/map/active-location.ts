// Cinematic Spotlight (Slice 8) PR2 — "which Location does the story occupy at
// T?" resolver (pure core).
//
// Between-map cycling needs to answer a question nothing in the codebase
// answered before: as the playhead advances, which Location is the story IN at
// time T — so the view can pan/zoom to that Location's map. Today the map only
// auto-switches off the external `entityId` deep-link prop (WorldMap.svelte:
// 1065-1100); there is no playhead-following resolver. This module is it.
//
// It derives the active Location(s) from `takes_place_at` event data at T —
// reusing the EXACT scope rule `foldCausalEdges` applies per edge endpoint
// (projection.ts:727-746): among an Event's takes_place_at edges, only those
// visible at T count; a scoped (bounded) edge beats a timeless one; lowest
// locationId breaks ties. The same rule lives in two places by deliberate
// choice — projection.ts is the pure render engine and must not import a feature
// module; this module mirrors the rule with a cross-reference rather than couple
// them. The rule is the stable FU1/#66 semantics; if it ever changes, both sites
// change together (the unit tests here pin it).
//
// Eng-review decision #5 (DRY): `groupTakesPlaceAt` is the shared grouping that
// WorldMap's `causalInput` (WorldMap.svelte:609-615) also consumes, so the
// takes_place_at indexing exists once.
//
// Window/Pixi-free (SSR-safe, unit-tested).

import type { Relationship } from '$lib/stores/relationships.js';
import { isEdgeVisibleAtT, isMysteryEdgeAtT } from '$lib/features/timeline/playhead-store.js';
import { buildHierarchyIndex, walkAncestors, type HierarchyIndex } from '$lib/location-hierarchy.js';

// One takes_place_at edge reduced to what the scope rule reads. Matches the
// shape WorldMap's causalInput already builds (and projection's
// ProjectionTakesPlaceAt).
export type TakesPlaceAtEntry = {
	locationId: string;
	startPosition: number | null;
	endPosition: number | null;
	// Mystery reveal gate: while t < revealedAtPosition the edge exists but is
	// hidden from the reader (isMysteryEdgeAtT). Optional so existing fixtures that
	// predate the gate still type-check; absent/null = no gate. (Codex PR #72)
	revealedAtPosition?: number | null;
};

/**
 * Group every `takes_place_at` relationship by its Event endpoint (fromId),
 * carrying the temporal bounds. Pure, t-independent — the t-dependent pick is
 * `eventLocationAtT`. This is the grouping WorldMap's `causalInput` consumes
 * (eng decision #5), so it is built once.
 */
export function groupTakesPlaceAt(relationships: Relationship[]): Map<string, TakesPlaceAtEntry[]> {
	const byEvent = new Map<string, TakesPlaceAtEntry[]>();
	for (const r of relationships) {
		if (r.type !== 'takes_place_at') continue;
		const entry: TakesPlaceAtEntry = {
			locationId: r.toId,
			startPosition: r.startPosition,
			endPosition: r.endPosition,
			revealedAtPosition: r.revealedAtPosition
		};
		const list = byEvent.get(r.fromId);
		if (list) list.push(entry);
		else byEvent.set(r.fromId, [entry]);
	}
	return byEvent;
}

/**
 * The Location an Event is AT during time T, or null if none is active. Mirrors
 * `foldCausalEdges.locationAtT` (projection.ts): visible-at-T only, NOT still
 * reveal-gated (mystery), scoped beats timeless, lowest locationId breaks ties.
 * Pure.
 *
 * The mystery gate matters here too: a `takes_place_at` with a future
 * `revealedAtPosition` must not resolve a Location before its reveal, or the
 * camera/cycling would switch the whole view to the hidden Location's map and the
 * caption layer would title its Event — leaking story information the projection
 * already hides for causal edges (projection.ts mystery policy). (Codex PR #72)
 */
export function eventLocationAtT(entries: TakesPlaceAtEntry[] | undefined, t: number): string | null {
	return resolveEventLocation(entries, t)?.locationId ?? null;
}

/**
 * Like `eventLocationAtT` but also reports whether the winning edge is SCOPED (has
 * a start/end bound) vs timeless. The cycling driver needs this: a scoped beat is a
 * transient "happening now" that should grab the camera, while a timeless edge is
 * visible at every T and must NOT permanently hold the view (Codex PR #72 #384).
 * Same selection rule as `eventLocationAtT` (it delegates here). Pure.
 */
function resolveEventLocation(
	entries: TakesPlaceAtEntry[] | undefined,
	t: number
): { locationId: string; scoped: boolean } | null {
	if (!entries || entries.length === 0) return null;
	let best: TakesPlaceAtEntry | null = null;
	for (const tp of entries) {
		if (!isEdgeVisibleAtT(tp, t)) continue;
		if (isMysteryEdgeAtT(tp, t)) continue; // reveal-gated: hidden until revealedAtPosition
		if (best === null) {
			best = tp;
			continue;
		}
		const tpScoped = tp.startPosition != null || tp.endPosition != null;
		const bestScoped = best.startPosition != null || best.endPosition != null;
		if (tpScoped !== bestScoped) {
			if (tpScoped) best = tp; // scoped beats timeless (more specific)
		} else if (tp.locationId < best.locationId) {
			best = tp; // deterministic tie-break
		}
	}
	if (best === null) return null;
	return { locationId: best.locationId, scoped: best.startPosition != null || best.endPosition != null };
}

/**
 * An active Location at T, plus whether it is active via a SCOPED (bounded) edge.
 * `scoped` is true if ANY active Event resolves to this Location through a bounded
 * `takes_place_at` at T.
 */
export type ActiveLocation = { locationId: string; scoped: boolean };

/**
 * The distinct Locations the story occupies at T, ranked MOST-SPECIFIC first
 * (deepest in the `part_of` hierarchy), locationId breaking depth ties. Pure.
 *
 * "Active" = some Event with a `takes_place_at` edge visible at T resolves to it
 * (via `eventLocationAtT`). Returns [] at idle-equivalent T only if no event is
 * active; otherwise the caller (`pickCyclingTarget`) maps these to a map-bearing
 * Location and applies hysteresis.
 */
export function activeLocationsAtT(
	relationships: Relationship[],
	t: number,
	index?: HierarchyIndex,
	byEventIndex?: Map<string, TakesPlaceAtEntry[]>
): ActiveLocation[] {
	const byEvent = byEventIndex ?? groupTakesPlaceAt(relationships);
	const idx = index ?? buildHierarchyIndex(relationships);

	// locationId → scoped (true if ANY active Event reaches it via a bounded edge).
	const active = new Map<string, boolean>();
	for (const entries of byEvent.values()) {
		const res = resolveEventLocation(entries, t);
		if (!res) continue;
		active.set(res.locationId, (active.get(res.locationId) ?? false) || res.scoped);
	}

	// Rank deepest-first (most specific); depth = ancestor-chain length.
	return [...active.entries()]
		.map(([locationId, scoped]) => ({ locationId, scoped }))
		.sort((a, b) => {
			const da = walkAncestors(idx, a.locationId).length;
			const db = walkAncestors(idx, b.locationId).length;
			if (da !== db) return db - da; // deeper first
			return a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0; // tie-break
		});
}

/**
 * The Event ids "active" at T — those with a `takes_place_at` edge visible at T
 * (via the same `eventLocationAtT` rule the camera/FX/cycling use). Pure. The
 * caption layer (T9) diffs this set frame-to-frame and titles the newly-active
 * Events, reusing the resolver instead of a second selection model.
 */
export function activeEventIdsAtT(
	relationships: Relationship[],
	t: number,
	byEventIndex?: Map<string, TakesPlaceAtEntry[]>
): string[] {
	const byEvent = byEventIndex ?? groupTakesPlaceAt(relationships);
	const ids: string[] = [];
	for (const [eventId, entries] of byEvent) {
		if (eventLocationAtT(entries, t) !== null) ids.push(eventId);
	}
	return ids;
}

/**
 * Frame-to-frame diff for the diegetic caption layer (T9): the Event ids in
 * `ids` that were NOT already active in `prev`. Pure — the caller owns the
 * baseline Set (and resets it to empty at idle so the next play re-titles the
 * opening beats). Order follows `ids` so captions fire in resolver order; the
 * card layer supersedes, so a simultaneous burst leaves the last one up.
 */
export function diffNewlyActiveEvents(prev: ReadonlySet<string>, ids: string[]): string[] {
	const fresh: string[] = [];
	for (const id of ids) {
		if (!prev.has(id)) fresh.push(id);
	}
	return fresh;
}

/**
 * What the cycling driver should do once it has resolved a target map for T.
 * Pure — the caller (WorldMap's cycling $effect) supplies the resolved target,
 * the currently-shown map, and whether the target's regions are already cached.
 * Encodes the switch-only-when-ready invariant (eng decision #1/#3):
 *
 *   - 'hold'     — no target, or the target is already the active map: do nothing.
 *   - 'commit'   — target differs AND its regions are cached: switch now (no flash).
 *   - 'prefetch' — target differs but is NOT cached: keep the current map and
 *                  fetch the target's regions; the commit happens on a later tick
 *                  once the cache lands (so a switch never shows a half-loaded map).
 *
 * Whether to run at all (playing, not pinned, non-idle playhead) is the caller's
 * gate; that state lives in the component and the playback controller.
 */
export type CycleAction = 'hold' | 'commit' | 'prefetch';
export function decideCycleAction(
	targetMapId: string | null,
	activeMapId: string | null,
	targetCached: boolean
): CycleAction {
	if (!targetMapId || targetMapId === activeMapId) return 'hold';
	return targetCached ? 'commit' : 'prefetch';
}

/**
 * Nearest map-bearing Location at or above `loc` — `loc` itself if it has a map,
 * else the closest ancestor that does, else null. The Edge-Cases "no map at T →
 * nearest ancestor with a map (walkAncestors)" fallback. Pure.
 */
function resolveMapBearing(
	loc: string,
	hasMap: (locationId: string) => boolean,
	index: HierarchyIndex
): string | null {
	if (hasMap(loc)) return loc;
	// walkAncestors returns root→parent; nearest ancestor is the LAST element.
	const ancestors = walkAncestors(index, loc);
	for (let i = ancestors.length - 1; i >= 0; i--) {
		if (hasMap(ancestors[i])) return ancestors[i];
	}
	return null;
}

/**
 * Choose the map-bearing Location the view should cycle to at T, or `prevTarget`
 * to HOLD. Pure: no worldMaps / switchMap / timing — the caller (Step D) supplies
 * `hasMap` (from resolveActiveVariant over worldMaps) and owns the switch-on-ready
 * commit. Embodies eng-review decision #5's three resolver requirements:
 *
 *   - specificity: `rankedActive` is most-specific-first, so the deepest active
 *     Location wins;
 *   - ancestor fallback: each candidate resolves to its nearest map-bearing
 *     self-or-ancestor (`resolveMapBearing`);
 *   - scoped precedence (product decision 2026-06-06): a SCOPED (defined-window)
 *     map displays over a timeless one. A scoped beat active at T grabs the view;
 *     when no scoped target remains the view returns to the timeless map. This is
 *     also the fix for the timeless-lock (#384): a timeless edge is visible at
 *     EVERY T, so the old "hold prevTarget while it covers any active Location"
 *     rule, applied to a timeless edge, locked the camera permanently.
 *   - hysteresis (anti-strobe): applies ONLY among scoped overlaps — if `prevTarget`
 *     is still one of the scoped targets, keep it so two briefly-co-active scoped
 *     maps don't strobe. Timeless targets never trigger hysteresis (they are always
 *     active, so a deterministic most-specific pick is already stable). (Time-based
 *     anti-thrash is layered on in Step D via switch-only-when-ready.)
 *
 * Returns null only when there is no active map-bearing Location AND no prior
 * target — i.e. nothing to show; the caller holds the current map.
 */
export function pickCyclingTarget(
	rankedActive: ActiveLocation[],
	hasMap: (locationId: string) => boolean,
	index: HierarchyIndex,
	prevTarget: string | null
): string | null {
	// Resolve each active Location to its nearest map-bearing self/ancestor, split by
	// whether the Location is active via a scoped (transient) or timeless edge.
	// rankedActive is most-specific-first, so each list preserves that order.
	const scopedTargets: string[] = [];
	const timelessTargets: string[] = [];
	for (const { locationId, scoped } of rankedActive) {
		const target = resolveMapBearing(locationId, hasMap, index);
		if (!target) continue;
		(scoped ? scopedTargets : timelessTargets).push(target);
	}
	// Anti-strobe: hold prevTarget while it's still a SCOPED target.
	if (prevTarget !== null && scopedTargets.includes(prevTarget)) return prevTarget;
	// Scoped maps take precedence over timeless ones.
	if (scopedTargets.length > 0) return scopedTargets[0];
	// No scoped target active: fall back to the most-specific timeless map.
	if (timelessTargets.length > 0) return timelessTargets[0];
	// Nothing active resolves to a map: hold the current map.
	return prevTarget;
}
