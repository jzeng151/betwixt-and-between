/**
 * Centralized color maps for relationship types and entity types.
 *
 * Extracted from StoryGraph.svelte (Phase 1B Z3) so FocusedGraph,
 * legend UI, and any future graph-canvas consumer share one source of
 * truth. The Record<X, string> typing forces an exhaustiveness check
 * at compile time: adding a new RelationshipType or EntityType to the
 * schema breaks this file until the corresponding token is wired.
 *
 * Token values reference CSS custom properties in `src/app.css` so
 * theme changes happen in one place.
 */

import type { EntityType, RelationshipType } from '$lib/server/db/schema.js';

/**
 * Edge color per relationship type. Maps to --color-rel-* CSS tokens.
 *
 * `appears_in` is deprecated for new writes (V1 retirement, 2026-04-28)
 * but kept for legacy reads — its color stays so old data still renders
 * meaningfully.
 */
export const REL_COLOR: Record<RelationshipType, string> = {
	allied_with: 'var(--color-rel-ally)',
	rivals: 'var(--color-rel-rival)',
	appears_in: 'var(--color-rel-arc)',
	takes_place_at: 'var(--color-rel-event)',
	caused_by: 'var(--color-rel-other)',
	located_at: 'var(--color-rel-loc)',
	mentor_of: 'var(--color-rel-mentor)',
	pov_of: 'var(--color-rel-pov)'
};

/**
 * Node color per entity type. Maps to --color-* CSS tokens. Defaults
 * to the accent token for any case that should never reach here at
 * runtime — but the Record<EntityType, string> type already proves
 * that's impossible.
 */
export const NODE_COLOR: Record<EntityType, string> = {
	Character: 'var(--color-accent)',
	Location: 'var(--color-rel-loc)',
	Event: 'var(--color-rel-event)',
	Act: 'var(--color-rel-arc)',
	Scene: 'var(--color-rel-arc)',
	Note: 'var(--color-rel-other)'
};

/**
 * Ordered list of relationship types for the StoryGraph create-relationship
 * form. Order is intentional — directed types first (most common), then
 * symmetric, with the deprecated `appears_in` last so it's never the
 * default but still selectable for backfill scenarios.
 */
export const REL_TYPES: RelationshipType[] = [
	'allied_with',
	'rivals',
	'mentor_of',
	'pov_of',
	'takes_place_at',
	'caused_by',
	'located_at',
	'appears_in'
];
