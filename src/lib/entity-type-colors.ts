import type { EntityType } from './server/db/schema.js';

/**
 * Per-entity-type color palette.
 *
 * Single source of truth for "what color represents this entity type" across
 * the app (Wiki section dividers, Palette section labels, Story Graph node
 * strokes via NODE_COLOR in relationship-colors.ts).
 *
 * Values are CSS custom-property references defined in `src/app.css`
 * (`--color-type-*`). Keeping the mapping here gives JS consumers a typed
 * accessor; the CSS layer remains the value source.
 *
 * Customization groundwork: the future settings-app PR will add per-user
 * overrides on the preferences store and either (a) emit a runtime
 * `:root { --color-type-character: #xxx; ... }` stylesheet from preferences
 * so every existing consumer picks up the override for free, or (b) extend
 * getEntityTypeColor() to read prefs and bypass the CSS token. Either way,
 * routing all type-color reads through this module means no call-site
 * refactor is needed when that lands.
 */
export const ENTITY_TYPE_COLOR_VAR: Record<EntityType, string> = {
	Character: 'var(--color-type-character)',
	Location: 'var(--color-type-location)',
	Event: 'var(--color-type-event)',
	Scene: 'var(--color-type-scene)',
	Act: 'var(--color-type-act)',
	Note: 'var(--color-type-note)'
};

export function getEntityTypeColor(type: EntityType): string {
	return ENTITY_TYPE_COLOR_VAR[type];
}
