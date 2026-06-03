// Slice 3 D5 + outside-voice B6 — style cascade resolver.
//
// Color cascade for rendering placement styles (highest priority first):
//
//   placement.data.style.color   (per-instance override)
//     ▸ entity.data.style.color  (per-entity map override)
//     ▸ data.color / character cycle  (characterColorFor — shared with the graph)
//     ▸ resolvedTypeHex[type]    (the customizable palette — Phase 2, Item 1)
//     ▸ GLOBAL_STYLE_DEFAULT
//
// Settings customization Phase 2, Item 1 (full unify): the type-default COLOR
// layer is no longer the hardcoded STYLE_DEFAULTS map — it is the resolved
// palette (`resolvePaletteHex(appearance)` from entity-type-colors.ts), the SAME
// source the DOM consumers read via `var(--color-type-*)`. So recoloring a type
// in Settings recolors the map sprites too. STYLE_DEFAULTS keeps ONLY its
// non-color scale tuning; its color role is fully replaced (F3a — the color keys
// are DELETED so they can't out-rank the palette).
//
// codex P2 (PR #58): the placement endpoints accept + validate a
// per-instance `placement.data.style`, but the renderer only resolved
// entity-level style and ignored it, so a customized single-placement
// color/scale/opacity persisted but never rendered. The optional
// `placementStyle` arg threads that instance override in as the
// top-priority layer.
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
import { characterColorFor } from '$lib/relationship-colors.js';

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

// Per-EntityType non-color tuning. Item 1 (full unify) DELETED the per-type
// color entries — the type-default color now comes from the customizable palette
// (`resolvedTypeHex`), not from here, so a surviving color key would silently
// out-rank the palette for the exact placeable types (F3a). Only the scale
// tuning that distinguishes Artifact/Item sprites survives.
export const STYLE_DEFAULTS: Partial<Record<EntityType, StyleOverride>> = {
	Artifact: { scale: 0.9 },
	Item: { scale: 0.8 }
};

/**
 * Resolve the final style for an entity. The color layer cascades
 * placement override → entity `data.style.color` → per-entity color
 * (`characterColorFor`: `data.color` then the character cycle) → the resolved
 * palette `resolvedTypeHex[type]` → GLOBAL. Non-color fields keep the prior
 * GLOBAL → STYLE_DEFAULTS(scale) → entity → placement merge.
 *
 * @param resolvedTypeHex the type-default color layer — `resolvePaletteHex(appearance)`
 *   (entity-type-colors.ts), so a Settings recolor reaches the sprite.
 * @param placementStyle the raw `placement.data.style` of the rendered instance.
 * @param characterIndex the entity's index in the Character-filtered list, for
 *   the shared cycle (must match the graph's index — see characterColorFor).
 */
export function resolveStyle(
	entity: Entity,
	resolvedTypeHex: Record<EntityType, string>,
	placementStyle?: unknown,
	characterIndex?: number
): ResolvedStyle {
	const typeDefault = STYLE_DEFAULTS[entity.type] ?? {};
	const entityOverride = extractStyleOverride(entity.data?.style);
	const instanceOverride = extractStyleOverride(placementStyle);
	return {
		color: pickString(
			instanceOverride.color,
			entityOverride.color,
			characterColorFor(entity, characterIndex),
			resolvedTypeHex[entity.type],
			GLOBAL_STYLE_DEFAULT.color
		),
		icon: pickIcon(instanceOverride.icon, entityOverride.icon, GLOBAL_STYLE_DEFAULT.icon),
		scale: clampNumber(
			pickNumber(
				instanceOverride.scale,
				entityOverride.scale,
				typeDefault.scale,
				GLOBAL_STYLE_DEFAULT.scale
			),
			0.1,
			10
		),
		opacity: clampNumber(
			pickNumber(
				instanceOverride.opacity,
				entityOverride.opacity,
				GLOBAL_STYLE_DEFAULT.opacity
			),
			0,
			1
		)
	};
}

// ── contrast guard (Item 1 / D4) ─────────────────────────────────────────────
//
// Full unify lets a user pick an arbitrarily dark type/entity color, which can
// vanish against the dark map canvas. The guard adds a FIXED light ring around
// the sprite when the resolved fill is too dark — it only ADDS a ring, never
// substitutes the fill, so an intentional dark/neutral color still renders as
// chosen (codex-P2 neutral-swatch invariant).

/** The map canvas background (src/app.css map surface). */
export const MAP_CANVAS_BG = '#0d0f14';

/**
 * Fixed ring color for the contrast guard — the Midnight Ink text color. NOT
 * derived from the (possibly dark) fill, so it always reads against the canvas
 * and typical terrain (≥3:1, D4 a11y).
 */
export const CONTRAST_RING_COLOR = '#e8e0d0';

/** Minimum fill-vs-canvas contrast ratio before the guard kicks in (WCAG-style). */
export const CONTRAST_MIN_RATIO = 3;

function srgbToLinear(channel: number): number {
	const c = channel / 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * WCAG relative luminance of a CSS hex in [0,1]; unknown input → 1 (bright, no
 * ring). MUST accept every hex shape the renderer draws and the server accepts
 * (3/4/6/8-digit — style-bounds HEX_COLOR_RE), normalized identically to the
 * Pixi `parseHex` expansion, or the guard silently misses e.g. `#000` (a 3-digit
 * black entered via the StyleEditor would render dark with no ring — codex P1).
 */
export function relativeLuminance(hex: string): number {
	let s = (typeof hex === 'string' ? hex.trim() : '').replace(/^#/, '');
	if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
	if (s.length === 8) s = s.slice(0, 6); // drop alpha — luminance is RGB-only
	if (!/^[0-9a-f]{6}$/i.test(s)) return 1;
	const n = parseInt(s, 16);
	return (
		0.2126 * srgbToLinear((n >> 16) & 255) +
		0.7152 * srgbToLinear((n >> 8) & 255) +
		0.0722 * srgbToLinear(n & 255)
	);
}

/** WCAG contrast ratio between two hex colors (≥1). */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/** True when `fillHex` is too low-contrast against the map canvas to read alone. */
export function needsContrastRing(fillHex: string): boolean {
	return contrastRatio(fillHex, MAP_CANVAS_BG) < CONTRAST_MIN_RATIO;
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
