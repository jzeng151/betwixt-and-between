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
import { isEdgeVisibleAtT } from '$lib/features/timeline/playhead-store.js';
import { buildHierarchyIndex, walkAncestors, type HierarchyIndex } from '$lib/location-hierarchy.js';

// One takes_place_at edge reduced to what the scope rule reads. Matches the
// shape WorldMap's causalInput already builds (and projection's
// ProjectionTakesPlaceAt).
export type TakesPlaceAtEntry = {
	locationId: string;
	startPosition: number | null;
	endPosition: number | null;
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
			endPosition: r.endPosition
		};
		const list = byEvent.get(r.fromId);
		if (list) list.push(entry);
		else byEvent.set(r.fromId, [entry]);
	}
	return byEvent;
}

/**
 * The Location an Event is AT during time T, or null if none is active. Mirrors
 * `foldCausalEdges.locationAtT` (projection.ts:727-746): visible-at-T only,
 * scoped beats timeless, lowest locationId breaks ties. Pure.
 */
export function eventLocationAtT(entries: TakesPlaceAtEntry[] | undefined, t: number): string | null {
	if (!entries || entries.length === 0) return null;
	let best: TakesPlaceAtEntry | null = null;
	for (const tp of entries) {
		if (!isEdgeVisibleAtT(tp, t)) continue;
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
	return best?.locationId ?? null;
}

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
	index?: HierarchyIndex
): string[] {
	const byEvent = groupTakesPlaceAt(relationships);
	const idx = index ?? buildHierarchyIndex(relationships);

	const active = new Set<string>();
	for (const entries of byEvent.values()) {
		const loc = eventLocationAtT(entries, t);
		if (loc) active.add(loc);
	}

	// Rank deepest-first (most specific); depth = ancestor-chain length.
	return [...active].sort((a, b) => {
		const da = walkAncestors(idx, a).length;
		const db = walkAncestors(idx, b).length;
		if (da !== db) return db - da; // deeper first
		return a < b ? -1 : a > b ? 1 : 0; // deterministic tie-break
	});
}

/**
 * The Event ids "active" at T — those with a `takes_place_at` edge visible at T
 * (via the same `eventLocationAtT` rule the camera/FX/cycling use). Pure. The
 * caption layer (T9) diffs this set frame-to-frame and titles the newly-active
 * Events, reusing the resolver instead of a second selection model.
 */
export function activeEventIdsAtT(relationships: Relationship[], t: number): string[] {
	const byEvent = groupTakesPlaceAt(relationships);
	const ids: string[] = [];
	for (const [eventId, entries] of byEvent) {
		if (eventLocationAtT(entries, t) !== null) ids.push(eventId);
	}
	return ids;
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
 *   - hysteresis: if `prevTarget` is still the map-resolution of ANY currently
 *     active Location, keep it — this is what stops a brief simultaneous-scope
 *     flicker from strobing the view between two maps. Only when no active
 *     Location still resolves to `prevTarget` does the view move, and then to the
 *     most-specific active Location's map. (Time-based anti-thrash debounce is
 *     layered on in Step D via switch-only-when-ready; this is the structural
 *     hysteresis.)
 *
 * Returns null only when there is no active map-bearing Location AND no prior
 * target — i.e. nothing to show; the caller holds the current map.
 */
export function pickCyclingTarget(
	rankedActive: string[],
	hasMap: (locationId: string) => boolean,
	index: HierarchyIndex,
	prevTarget: string | null
): string | null {
	// Hysteresis: hold prevTarget while it still covers an active Location.
	if (prevTarget !== null) {
		for (const loc of rankedActive) {
			if (resolveMapBearing(loc, hasMap, index) === prevTarget) return prevTarget;
		}
	}
	// Otherwise move to the most-specific active Location that resolves to a map.
	for (const loc of rankedActive) {
		const target = resolveMapBearing(loc, hasMap, index);
		if (target) return target;
	}
	// No active Location has a map (or no active Locations at all): hold.
	return prevTarget;
}
