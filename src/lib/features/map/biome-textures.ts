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
