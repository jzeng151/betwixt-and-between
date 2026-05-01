/**
 * Project-level defaults for the graph layer.
 */

import type { EntityType } from '$lib/server/db/schema.js';

/**
 * Default ordering of entity types for layered ("layout by type") rendering.
 *
 * Reading order = top-to-bottom of the canvas after dagre layout. Scenes
 * sit at the top because they're the most granular story unit and the
 * usual entry point a writer scans for. Acts at the bottom because they
 * scaffold the whole story and rarely need direct manipulation while
 * writing day-to-day. Notes go last as a low-frequency catch-all.
 *
 * Per Phase 1B C7: window override stored per-window (windowStore
 * setTypeOrder); this constant is the seed value when typeOrder is unset.
 *
 * Adding a new EntityType to schema.ts will FAIL the type check on this
 * array literal, forcing a contributor to consciously place it.
 */
export const DEFAULT_TYPE_ORDER: EntityType[] = [
	'Scene',
	'Event',
	'Character',
	'Location',
	'Act',
	'Note'
];
