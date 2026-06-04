// Slice 3 T7 — biome → color/fill mapping for terrain tiles.
//
// 9-value enum from projection.ts BIOMES (plains/forest/water/desert/
// mountain/swamp/snow/urban/unset). MVP visual approach: solid color
// per biome at ~70% alpha so the underlying base image still bleeds
// through. Procedural patterns (hatching for forest, ripples for water)
// land in Slice 6 if "feels alive" feedback warrants them; for Slice 3
// the goal is "user can see paint strokes" not "production-quality
// terrain art."
//
// 'unset' renders fully transparent — eraser strokes write the value
// (per outside-voice A6) but the user sees the canvas through. Stored
// 'unset' and missing cells render identically.
//
// Colors picked to be distinguishable on the Midnight Ink background
// (#0d0f14) AND on a typical beige paper-style imported map. Picked
// from the Tailwind palette so DESIGN.md token additions later can
// reference an established named color.

import type { BiomeKind } from './projection.js';

export type BiomeStyle = {
	color: number;
	alpha: number;
};

export const BIOME_STYLES: Record<BiomeKind, BiomeStyle> = {
	plains: { color: 0x84cc16, alpha: 0.45 }, // lime-500
	forest: { color: 0x16a34a, alpha: 0.55 }, // green-600
	water: { color: 0x0ea5e9, alpha: 0.55 }, // sky-500
	desert: { color: 0xeab308, alpha: 0.45 }, // yellow-500
	mountain: { color: 0x78716c, alpha: 0.6 }, // stone-500
	swamp: { color: 0x4d7c0f, alpha: 0.55 }, // lime-700
	snow: { color: 0xe5e7eb, alpha: 0.55 }, // gray-200
	urban: { color: 0xa1a1aa, alpha: 0.5 }, // zinc-400
	unset: { color: 0x000000, alpha: 0 } // fully transparent
};

/** Returns the style for a biome, defaulting to transparent for unknown
 * strings. Used by PixiTerrainLayer for tile fills. */
export function biomeStyle(biome: string): BiomeStyle {
	return BIOME_STYLES[biome as BiomeKind] ?? BIOME_STYLES.unset;
}

// Slice 6 D15 — flat colors for the asset terrain categories, so the flat
// PixiTerrainLayer can still show land where the sprite tile isn't drawn: hex
// maps (sprite tiling is square-only) and square cells whose tile failed to
// load (missing R2 object / dev checkout without the gitignored pack). Without
// this, asset-vocabulary cells (e.g. 'Grass', 'grass_01_tile_256_05') fall
// through biomeStyle() to transparent and the painted terrain is invisible
// while still being stored (Codex #70). One color per category; specific tile
// keys match by category prefix.
const CATEGORY_STYLES: Record<string, BiomeStyle> = {
	clay: { color: 0xb45309, alpha: 0.5 }, // amber-700
	grass: { color: 0x4d7c0f, alpha: 0.5 }, // lime-700
	ice: { color: 0x67e8f9, alpha: 0.45 }, // cyan-300
	lava: { color: 0xdc2626, alpha: 0.55 }, // red-600
	paving: { color: 0x9ca3af, alpha: 0.5 }, // gray-400
	sand: { color: 0xeab308, alpha: 0.45 }, // yellow-500
	snow: { color: 0xe5e7eb, alpha: 0.55 } // gray-200
};
const CATEGORY_PREFIXES = Object.keys(CATEGORY_STYLES);

/**
 * Flat style for ANY terrain key — the visible fallback under the sprite tiles.
 * Legacy biomes + 'unset' resolve via biomeStyle; an asset key (a manifest
 * category like 'Grass' or a specific tile like 'grass_01_tile_256_05') matches
 * its category by prefix. Water keys stay transparent here (PixiWaterLayer draws
 * water); a genuinely unknown key stays transparent (lazy-GC posture).
 */
export function terrainFlatStyle(biome: string): BiomeStyle {
	const legacy = BIOME_STYLES[biome as BiomeKind];
	if (legacy) return legacy;
	const lower = biome.toLowerCase();
	if (lower.startsWith('water')) return BIOME_STYLES.unset; // water layer owns it
	const cat = CATEGORY_PREFIXES.find((c) => lower.startsWith(c));
	return cat ? CATEGORY_STYLES[cat] : BIOME_STYLES.unset;
}
