// Slice 3 T7 — biome → color mapping unit tests.
//
// Pure lookup. Tests pin the contract: every BIOMES enum value has a
// style; 'unset' is fully transparent; unknown strings fall back to
// 'unset'.

import { describe, it, expect } from 'vitest';
import { BIOMES } from '../../src/lib/features/map/projection.js';
import {
	BIOME_STYLES,
	biomeStyle,
	terrainFlatStyle
} from '../../src/lib/features/map/biome-textures.js';

describe('BIOME_STYLES coverage', () => {
	it('has a style for every BIOMES enum value', () => {
		for (const biome of BIOMES) {
			expect(BIOME_STYLES[biome]).toBeDefined();
			expect(typeof BIOME_STYLES[biome].color).toBe('number');
			expect(typeof BIOME_STYLES[biome].alpha).toBe('number');
		}
	});

	it("'unset' biome has alpha 0 (fully transparent)", () => {
		expect(BIOME_STYLES.unset.alpha).toBe(0);
	});

	it('non-unset biomes have alpha > 0', () => {
		for (const biome of BIOMES) {
			if (biome === 'unset') continue;
			expect(BIOME_STYLES[biome].alpha).toBeGreaterThan(0);
		}
	});
});

describe('biomeStyle()', () => {
	it('returns the matching style for a known biome', () => {
		expect(biomeStyle('forest')).toBe(BIOME_STYLES.forest);
	});

	it("falls back to 'unset' for an unknown biome string (lazy GC)", () => {
		const style = biomeStyle('magma');
		expect(style).toBe(BIOME_STYLES.unset);
		expect(style.alpha).toBe(0);
	});
});

describe('terrainFlatStyle() — asset-key flat fallback (Codex #70)', () => {
	it('resolves legacy biomes via biomeStyle', () => {
		expect(terrainFlatStyle('forest')).toBe(BIOME_STYLES.forest);
		expect(terrainFlatStyle('unset')).toBe(BIOME_STYLES.unset);
	});

	it('gives a visible color to manifest categories', () => {
		for (const cat of ['Grass', 'Sand', 'Clay', 'Ice', 'Lava', 'Paving', 'Snow']) {
			expect(terrainFlatStyle(cat).alpha).toBeGreaterThan(0);
		}
	});

	it('matches a specific tile key to its category color', () => {
		// 'grass_01_tile_256_05' must paint the same as the 'Grass' category.
		expect(terrainFlatStyle('grass_01_tile_256_05')).toEqual(terrainFlatStyle('Grass'));
		expect(terrainFlatStyle('clay_tile_256_03')).toEqual(terrainFlatStyle('Clay'));
	});

	it('leaves water keys transparent (PixiWaterLayer draws water)', () => {
		expect(terrainFlatStyle('water_snow').alpha).toBe(0);
		expect(terrainFlatStyle('water').alpha).toBeGreaterThan(0); // legacy 'water' biome stays colored
	});

	it('leaves a genuinely unknown key transparent', () => {
		expect(terrainFlatStyle('zzz').alpha).toBe(0);
	});
});
