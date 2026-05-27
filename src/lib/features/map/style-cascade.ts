// Slice 3 D5 + outside-voice B6 — style cascade resolver.
//
// Three-layer merge for rendering placement styles:
//
//   GLOBAL_STYLE_DEFAULT
//     ⊕ STYLE_DEFAULTS[entity.type]
//     ⊕ entity.data.style
//
// User-style-prefs (the 4th layer in the original A7) is deferred to
// Slice 4 with the editor UI (B4). When Slice 4 lands, it inserts
// between STYLE_DEFAULTS and entity.data.style.
//
// Per outside-voice B6, this module is a PURE FUNCTION. projection.ts
// does NOT know about entities or placements — it only folds anchors +
// events. The cascade is called from the renderer (PixiPlacementLayer)
// at draw time, with the source Entity in hand. Keeping cascade out of
// projection means projection stays cheap and decoupled.
//
// Validation: the server's PATCH /api/entities and POST/PATCH
// /api/maps/[id]/placements validate style jsonb against the same
// whitelist before persisting (style-validation.ts). resolveStyle here
// trusts its inputs — if a malformed entity.data.style slips through
// (legacy data, manual SQL), unknown keys are silently dropped via the
// explicit copy of known fields only.

import type { Entity } from '$lib/stores/entities.js';
import type { EntityType } from '$lib/server/db/schema.js';

export type ResolvedStyle = {
	/** CSS hex color like '#aabbcc'. Used for sprite tint / marker fill. */
	color: string;
	/** Icon URL or null. Renderer falls back to a default glyph when null. */
	icon: string | null;
	/** Sprite scale multiplier; clamped to [0.1, 10]. */
	scale: number;
	/** Sprite opacity; clamped to [0, 1]. */
	opacity: number;
};

export type StyleOverride = Partial<ResolvedStyle>;

// Per-instance fallback. When NOTHING else in the cascade supplies a key,
// resolveStyle returns these. Picked to be visually inoffensive on the
// Midnight Ink canvas (#0d0f14) without competing with biome tiles.
export const GLOBAL_STYLE_DEFAULT: ResolvedStyle = {
	color: '#9ca3af', // gray-400 — matches NEUTRAL_REGION_COLOR
	icon: null,
	scale: 1,
	opacity: 1
};

// Per-EntityType defaults. Only the placement-relevant types (Character /
// Artifact / Item per PlaceableEntityType) are tuned with distinct colors;
// non-placement types (Act, Scene, Note, Event, Location) keep GLOBAL
// because they don't appear as map sprites. They CAN still be listed in
// the asset library if data.is_asset=true (PlaceableEntityType remains
// the type-level guard at the placement-write layer).
export const STYLE_DEFAULTS: Partial<Record<EntityType, StyleOverride>> = {
	Character: { color: '#3b82f6', scale: 1 }, // blue-500
	Artifact: { color: '#f59e0b', scale: 0.9 }, // amber-500
	Item: { color: '#22c55e', scale: 0.8 } // green-500
};

/**
 * Resolve the final style for an entity by cascading through GLOBAL →
 * TYPE_DEFAULTS → instance overrides. Unknown keys in entity.data.style
 * are silently dropped (the merge only copies the four known fields).
 */
export function resolveStyle(entity: Entity): ResolvedStyle {
	const typeDefault = STYLE_DEFAULTS[entity.type] ?? {};
	const rawOverride = extractStyleOverride(entity.data?.style);
	return {
		color: pickString(rawOverride.color, typeDefault.color, GLOBAL_STYLE_DEFAULT.color),
		icon: pickIcon(rawOverride.icon, typeDefault.icon, GLOBAL_STYLE_DEFAULT.icon),
		scale: clampNumber(
			pickNumber(rawOverride.scale, typeDefault.scale, GLOBAL_STYLE_DEFAULT.scale),
			0.1,
			10
		),
		opacity: clampNumber(
			pickNumber(rawOverride.opacity, typeDefault.opacity, GLOBAL_STYLE_DEFAULT.opacity),
			0,
			1
		)
	};
}

// -- internals ---------------------------------------------------------------

function extractStyleOverride(raw: unknown): StyleOverride {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const r = raw as Record<string, unknown>;
	const out: StyleOverride = {};
	if (typeof r.color === 'string') out.color = r.color;
	if (typeof r.icon === 'string' || r.icon === null) out.icon = r.icon as string | null;
	if (typeof r.scale === 'number' && Number.isFinite(r.scale)) out.scale = r.scale;
	if (typeof r.opacity === 'number' && Number.isFinite(r.opacity)) out.opacity = r.opacity;
	return out;
}

function pickString(...candidates: Array<string | undefined>): string {
	for (const c of candidates) {
		if (typeof c === 'string') return c;
	}
	return GLOBAL_STYLE_DEFAULT.color;
}

function pickIcon(...candidates: Array<string | null | undefined>): string | null {
	for (const c of candidates) {
		if (c === null || typeof c === 'string') return c;
	}
	return null;
}

function pickNumber(...candidates: Array<number | undefined>): number {
	for (const c of candidates) {
		if (typeof c === 'number' && Number.isFinite(c)) return c;
	}
	return 1;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
