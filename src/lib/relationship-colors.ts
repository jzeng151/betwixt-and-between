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
import { CHARACTER_COLORS, HEX_COLOR_RE } from '$lib/timeline-v2-helpers.js';

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
	pov_of: 'var(--color-rel-pov)',
	note_of: 'var(--color-type-note)',
	part_of: 'var(--color-rel-loc)',
	other: 'var(--color-rel-misc)'
};

/**
 * Node color per entity type. Maps to --color-type-* CSS tokens
 * (separate namespace from --color-rel-* so edge vs node coloring
 * stays decoupled). Six distinct hue families so the same entity
 * type never reads as the same color as a nearby edge.
 */
export const NODE_COLOR: Record<EntityType, string> = {
	Character: 'var(--color-type-character)',
	Location: 'var(--color-type-location)',
	Event: 'var(--color-type-event)',
	Act: 'var(--color-type-act)',
	Scene: 'var(--color-type-scene)',
	Note: 'var(--color-type-note)'
};

/**
 * Per-relationship-type edge stroke style. Adds a SECOND visual channel
 * beyond color so users can scan the graph by pattern alone (helpful
 * for color-blind users and on dense graphs where colors crowd). Three
 * pattern families:
 *
 *   - **solid** = present-tense bond (alliance, mentorship, spatial fact)
 *   - **dashed** = tension or temporal chain (rivalry, causality, legacy)
 *   - **dotted** = soft / observational (POV, location attachment)
 *
 * Arrowheads only on the two directed types where direction carries
 * the strongest semantic weight (mentor_of, caused_by). Other directed
 * types skip the arrow so dense multi-rel pairs don't get visually
 * overloaded.
 */
export interface EdgeStyle {
	/** SVG `stroke-dasharray` value, e.g. `'4 3'` for dashed, `'2 3'`
	 *  for dotted. Null means solid. */
	dasharray: string | null;
	/** SVG `stroke-width` in px. Thinner for spatial/anchor types so they
	 *  don't compete visually with character relationships. */
	width: number;
	/** Whether to render an arrowhead at the `to` end. Only set for
	 *  directed types whose direction carries strong meaning. */
	arrow: boolean;
}

export const REL_EDGE_STYLE: Record<RelationshipType, EdgeStyle> = {
	allied_with:    { dasharray: null,  width: 1.5, arrow: false },
	rivals:         { dasharray: '4 3', width: 1.5, arrow: false },
	mentor_of:      { dasharray: null,  width: 1.5, arrow: true  },
	pov_of:         { dasharray: '2 3', width: 1,   arrow: false },
	takes_place_at: { dasharray: null,  width: 1,   arrow: false },
	caused_by:      { dasharray: '4 3', width: 1.5, arrow: true  },
	located_at:     { dasharray: '2 3', width: 1,   arrow: false },
	appears_in:     { dasharray: '4 3', width: 1,   arrow: false },
	note_of:        { dasharray: '2 3', width: 1,   arrow: false },
	part_of:        { dasharray: null,  width: 1,   arrow: true  },
	other:          { dasharray: null,  width: 1.5, arrow: false }
};

/**
 * Ordered list of relationship types for the StoryGraph create-relationship
 * form. Order is intentional — directed types first (most common), then
 * symmetric, with the deprecated `appears_in` last so it's never the
 * default but still selectable for backfill scenarios.
 */
/**
 * Resolve a per-entity node color for the graph apps. Mirrors
 * timeline-v2-helpers.colorFor exactly for Characters so the same
 * entity reads as the same color in both surfaces.
 *
 *   1. A valid `data.color` hex on the entity wins (any type).
 *   2. Characters without a custom color cycle through CHARACTER_COLORS
 *      keyed by `characterIndex` — the entity's position in the
 *      $entities-filtered-to-Character list. Caller computes this so
 *      cycling stays stable across Storygraph + Timeline + FG.
 *   3. Otherwise fall back to the type-default in NODE_COLOR.
 *
 * `characterIndex` is optional so non-character call-paths can omit
 * it; passing it for non-characters is harmless (the cycle branch is
 * gated on `type === 'Character'`).
 */
export function nodeColorFor(
	entity: { type: EntityType; data: Record<string, unknown> | null | undefined },
	characterIndex?: number
): string {
	const custom = entity.data?.color;
	if (typeof custom === 'string' && HEX_COLOR_RE.test(custom)) return custom;
	if (entity.type === 'Character' && characterIndex !== undefined) {
		return CHARACTER_COLORS[characterIndex % CHARACTER_COLORS.length];
	}
	return NODE_COLOR[entity.type] ?? 'var(--color-accent)';
}

export const REL_TYPES: RelationshipType[] = [
	'allied_with',
	'rivals',
	'mentor_of',
	'other',
	'pov_of',
	'takes_place_at',
	'caused_by',
	'located_at',
	'part_of',
	'appears_in'
];
