/**
 * Project-level defaults for the graph layer.
 */

import type { EntityType } from '$lib/server/db/schema.js';

/**
 * Default rank for each entity type in the layered ("layout by type")
 * rendering. Lower rank = top of the canvas. Reading order top → bottom:
 * Scene (most granular story unit, usual entry point) → Event → Character
 * → Location → Act (story-structure scaffold, rarely manipulated while
 * writing) → Note (low-frequency catch-all).
 *
 * Per Phase 1B C7: window override stored per-window via
 * `windowStore.setTypeOrder`; this map seeds the value when typeOrder is
 * unset.
 *
 * `Record<EntityType, number>` IS the exhaustiveness gate: adding a new
 * EntityType to schema.ts breaks this object literal at compile time
 * until the contributor consciously assigns it a rank. (The previous
 * `EntityType[]` annotation did NOT enforce this — array elements were
 * type-checked individually but the array could omit variants entirely.)
 */
const TYPE_RANK: Record<EntityType, number> = {
	Scene: 0,
	Event: 1,
	Character: 2,
	Location: 3,
	Act: 4,
	Note: 5
};

/**
 * Default ordering of entity types for layered rendering. Derived from
 * `TYPE_RANK` so the exhaustiveness check above is the single source of
 * truth for what types exist + where they sit.
 */
export const DEFAULT_TYPE_ORDER: EntityType[] = (Object.keys(TYPE_RANK) as EntityType[]).sort(
	(a, b) => TYPE_RANK[a] - TYPE_RANK[b]
);
