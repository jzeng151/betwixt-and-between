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

/**
 * Resolved base hex per entity type — the literal source the world map cascade
 * (style-cascade.ts) needs (Pixi can't read `var(--color-type-*)`; those resolve
 * only in `:root`). Settings customization Phase 2, Item 1.
 *
 * SINGLE SOURCE: the `--color-type-*` block in `src/app.css` is GENERATED from
 * this constant (`npm run gen:palette-css`, sentinel-wrapped) and a regression
 * test asserts the committed CSS equals the generator output, so the DOM palette
 * (graph/wiki/timeline via `var()`) and the canvas palette (map sprites via this
 * hex) can never silently drift. The runtime per-user override path
 * (palette-vars.ts → `:root{--color-type-*}`) still overrides this base.
 */
export const ENTITY_TYPE_HEX: Record<EntityType, string> = {
	Character: '#c8942a',
	Location: '#15803d',
	Event: '#d946ef',
	Scene: '#38bdf8',
	Act: '#8b5cf6',
	Note: '#a8a29e',
	Artifact: '#ea580c',
	Item: '#ca8a04'
};

/**
 * The type-default layer of the map cascade: the base `ENTITY_TYPE_HEX` merged
 * with the active user's partial `appearance.entityTypeColors` overrides. Shared
 * conceptually with `palette-vars.ts` (which emits the same overrides as CSS
 * vars for the DOM consumers). Pure — pass the active `Appearance` (or undefined).
 */
export function resolvePaletteHex(appearance?: {
	entityTypeColors?: Partial<Record<EntityType, string>>;
}): Record<EntityType, string> {
	return { ...ENTITY_TYPE_HEX, ...(appearance?.entityTypeColors ?? {}) };
}
