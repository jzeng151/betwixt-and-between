// Client-side helper for the Slice 1b projection pipeline.
//
//   server-only fetchProjectionContext (DB cross-user JOIN)
//          │
//          ▼
//   GET /api/maps/[id]/projection-context  → {allowedFactions: Array, allowedRegions: Array}
//          │
//          ▼
//   fetchProjectionContextForMap(mapId)   → ProjectionContext {Map, Set}   ← THIS MODULE
//          │
//          ▼
//   projectState(t, anchors, events, ctx) → RenderedState                  (pure, projection.ts)
//
// The endpoint returns plain arrays (JSON-friendly); projectState wants
// Map<id, faction> + Set<region_id> (lookup-friendly). toProjectionContext
// is the shape converter and the unit-testable seam.
//
// Reactivity: kept OUT of this module. Consumers (WorldMap.svelte and
// commit 4's PixiRegionLayer) own the $effect that re-fetches on mapId
// change and the $derived that runs projectState per playhead tick. The
// helper is a pure data shim so it's drop-in testable without mocking
// Svelte's reactivity runtime.

import { errorMessage } from '$lib/util/api-error-message.js';
import type {
	AllowedFaction,
	ProjectionContext
} from '$lib/features/map/projection.js';

export type ProjectionContextPayload = {
	allowedFactions: Array<{ id: string; color: string }>;
	allowedRegions: string[];
};

/**
 * Convert the endpoint's array-shaped payload into the Map/Set shape that
 * projectState expects. Pure; no fetch, no Svelte. Easy to unit-test.
 */
export function toProjectionContext(payload: ProjectionContextPayload): ProjectionContext {
	const allowedFactions = new Map<string, AllowedFaction>();
	for (const f of payload.allowedFactions) {
		allowedFactions.set(f.id, { id: f.id, color: f.color });
	}
	const allowedRegions = new Set<string>(payload.allowedRegions);
	return { allowedFactions, allowedRegions };
}

/**
 * Fetch the projection-context for one map and return it in projectState's
 * native shape. Throws on any non-2xx so callers can surface the error
 * uniformly (404 = wrong user or missing map; same defense-in-depth as
 * the endpoint itself).
 */
export async function fetchProjectionContextForMap(
	mapId: string
): Promise<ProjectionContext> {
	const res = await fetch(`/api/maps/${mapId}/projection-context`);
	if (!res.ok) {
		throw new Error(`Failed to load projection context: ${await errorMessage(res)}`);
	}
	const payload = (await res.json()) as ProjectionContextPayload;
	return toProjectionContext(payload);
}
