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
import { CHARACTER_COLORS, HEX_COLOR_RE } from '$lib/features/timeline/timeline-helpers.js';
import { ENTITY_TYPE_COLOR_VAR } from '$lib/entity-type-colors.js';

/**
 * Edge color per relationship type. Maps to --color-rel-* CSS tokens.
 */
export const REL_COLOR: Record<RelationshipType, string> = {
	allied_with: 'var(--color-rel-ally)',
	rivals: 'var(--color-rel-rival)',
	takes_place_at: 'var(--color-rel-event)',
	caused_by: 'var(--color-rel-other)',
	located_at: 'var(--color-rel-loc)',
	note_of: 'var(--color-type-note)',
	part_of: 'var(--color-rel-loc)',
	other: 'var(--color-rel-misc)'
};

/**
 * Node color per entity type — the SAME mapping as ENTITY_TYPE_COLOR_VAR
 * (eng-review 4A: these were byte-identical duplicates; collapsed to one
 * source of truth). Both still map to the --color-type-* namespace, kept
 * separate from --color-rel-* so edge vs node coloring stays decoupled.
 * Re-exported under this name so existing graph call-sites are untouched.
 */
export const NODE_COLOR: Record<EntityType, string> = ENTITY_TYPE_COLOR_VAR;

/**
 * Per-relationship-type edge stroke style. Adds a SECOND visual channel
 * beyond color so users can scan the graph by pattern alone (helpful
 * for color-blind users and on dense graphs where colors crowd). Three
 * pattern families:
 *
 *   - **solid** = present-tense bond (alliance, spatial fact)
 *   - **dashed** = tension or temporal chain (rivalry, causality)
 *   - **dotted** = soft / observational (location attachment, note attachment)
 *
 * Arrowhead only on `caused_by` + `part_of` where direction carries the
 * strongest semantic weight. Other directed types skip the arrow so dense
 * multi-rel pairs don't get visually overloaded.
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
	takes_place_at: { dasharray: null,  width: 1,   arrow: false },
	caused_by:      { dasharray: '4 3', width: 1.5, arrow: true  },
	located_at:     { dasharray: '2 3', width: 1,   arrow: false },
	note_of:        { dasharray: '2 3', width: 1,   arrow: false },
	part_of:        { dasharray: null,  width: 1,   arrow: true  },
	other:          { dasharray: null,  width: 1.5, arrow: false }
};

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

/**
 * Ordered list of relationship types for the StoryGraph create-relationship
 * form. Symmetric and directed flavor types first (most-common authoring
 * choices), then spatial/structural, then the `other` escape hatch last.
 *
 * Intentionally excludes:
 *   - note_of: owned by NotesSection (Note → parent direction is
 *     structural — not authored via the generic picker). No endpoint-
 *     type validator in the API layer means a Character→Character
 *     note_of row would insert successfully but NotesSection would
 *     silently drop it. Re-add only after the validator lands.
 */
export const REL_TYPES: RelationshipType[] = [
	'allied_with',
	'rivals',
	'takes_place_at',
	'caused_by',
	'located_at',
	'part_of',
	'other'
];
