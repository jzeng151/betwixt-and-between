import type { EntityType } from './server/db/schema.js';

/**
 * Per-entity-type color palette.
 *
 * Single source of truth for "what color represents this entity type" across
 * the app: Wiki section dividers, Palette section labels, AND Story Graph node
 * strokes — relationship-colors.ts `NODE_COLOR` IS this object (eng-review 4A
 * collapsed the former duplicate).
 *
 * Values are CSS custom-property references defined in `src/app.css`
 * (`--color-type-*`). Keeping the mapping here gives JS consumers a typed
 * accessor; the CSS layer remains the value source.
 *
 * Customization (shipped, Settings Phase 1): per-user overrides on the
 * preferences store are emitted as a runtime `:root { --color-type-*: … }`
 * override via palette-vars.ts, so every consumer that reads these tokens picks
 * up the override for free — no call-site refactor needed.
 */
export const ENTITY_TYPE_COLOR_VAR: Record<EntityType, string> = {
	Character: 'var(--color-type-character)',
	Location: 'var(--color-type-location)',
	Event: 'var(--color-type-event)',
	Scene: 'var(--color-type-scene)',
	Act: 'var(--color-type-act)',
	Note: 'var(--color-type-note)',
	Artifact: 'var(--color-type-artifact)',
	Item: 'var(--color-type-item)'
};

export function getEntityTypeColor(type: EntityType): string {
	return ENTITY_TYPE_COLOR_VAR[type];
}
