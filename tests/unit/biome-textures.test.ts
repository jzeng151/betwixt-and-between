// Slice 3 T7 — biome → color mapping unit tests.
//
// Pure lookup. Tests pin the contract: every BIOMES enum value has a
// style; 'unset' is fully transparent; unknown strings fall back to
// 'unset'.

import { describe, it, expect } from 'vitest';
import { BIOMES } from '../../src/lib/features/map/projection.js';
import { BIOME_STYLES, biomeStyle } from '../../src/lib/features/map/biome-textures.js';

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
