import { describe, it, expect, beforeEach } from 'vitest';
import {
	loadTerrainManifest,
	__resetTerrainManifestCache,
	pickBaseTile,
	firstBaseTile,
	terrainCategories,
	keyForUrl,
	tileUrlForKey,
	typeForKey,
	texturesForType,
	WATER_TYPE,
	type TerrainManifest
} from '../../src/lib/features/map/terrain-tilesets.js';

const MANIFEST: TerrainManifest = {
	tileSize: 256,
	categories: {
		Grass: { base: ['/g1.png', '/g2.png', '/g3.png'], road: [], waterEdge: [] },
		Sand: { base: ['/s1.png'], road: [], waterEdge: [] },
		Empty: { base: [], road: [], waterEdge: [] }
	}
};

// Mirrors the real manifest shape: nested tile paths + a water section.
const MANIFEST_REAL: TerrainManifest = {
	tileSize: 256,
	categories: {
		Grass: {
			base: [
				'/api/sprites/Grass/grass_01/grass_01_tile_256_01.png',
				'/api/sprites/Grass/grass_02/grass_02_tile_256_03.png'
			],
			road: [],
			waterEdge: []
		}
	},
	water: {
		colors: [
			{ key: 'water_snow', label: 'Snow water', url: '/api/sprites/Water/snow_water_256_04.png' },
			{ key: 'water_grass', label: 'Grass water', url: '/api/sprites/Water/grass_water_256_06.png' }
		]
	}
};

describe('pickBaseTile', () => {
	it('is deterministic per (x,y) across calls', () => {
		const a = pickBaseTile(MANIFEST, 'Grass', 4, 7);
		const b = pickBaseTile(MANIFEST, 'Grass', 4, 7);
		expect(a).toBe(b);
		expect(MANIFEST.categories.Grass.base).toContain(a);
	});

	it('varies across cells (not all the same tile)', () => {
		const picks = new Set<string | null>();
		for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) picks.add(pickBaseTile(MANIFEST, 'Grass', x, y));
		expect(picks.size).toBeGreaterThan(1); // distributes across the 3 variants
	});

	it('returns null for unknown category or empty base (→ flat fallback)', () => {
		expect(pickBaseTile(MANIFEST, 'Lava', 0, 0)).toBeNull(); // not in manifest
		expect(pickBaseTile(MANIFEST, 'Empty', 0, 0)).toBeNull(); // no base tiles
		expect(pickBaseTile(null, 'Grass', 0, 0)).toBeNull(); // no manifest
	});

	it('single-variant category always returns that tile', () => {
		expect(pickBaseTile(MANIFEST, 'Sand', 3, 9)).toBe('/s1.png');
	});
});

describe('firstBaseTile (coherent fill)', () => {
	it('returns the first base tile for a category, null when none', () => {
		expect(firstBaseTile(MANIFEST, 'Grass')).toBe('/g1.png');
		expect(firstBaseTile(MANIFEST, 'Sand')).toBe('/s1.png');
		expect(firstBaseTile(MANIFEST, 'Empty')).toBeNull();
		expect(firstBaseTile(MANIFEST, 'Lava')).toBeNull();
		expect(firstBaseTile(null, 'Grass')).toBeNull();
	});
});

describe('terrainCategories', () => {
	it('lists category keys, empty for null manifest', () => {
		expect(terrainCategories(MANIFEST)).toEqual(['Grass', 'Sand', 'Empty']);
		expect(terrainCategories(null)).toEqual([]);
	});
});

describe('keyForUrl', () => {
	it('is the basename sans .png', () => {
		expect(keyForUrl('/api/sprites/Grass/grass_01/grass_01_tile_256_05.png')).toBe(
			'grass_01_tile_256_05'
		);
		expect(keyForUrl('/g1.png')).toBe('g1');
	});
});

describe('tileUrlForKey (cell key → exact tile)', () => {
	it('resolves a specific land tile key to its url', () => {
		expect(tileUrlForKey(MANIFEST_REAL, 'grass_01_tile_256_01')).toBe(
			'/api/sprites/Grass/grass_01/grass_01_tile_256_01.png'
		);
	});
	it('resolves a water color key to its tile', () => {
		expect(tileUrlForKey(MANIFEST_REAL, 'water_snow')).toBe(
			'/api/sprites/Water/snow_water_256_04.png'
		);
	});
	it('returns null for a legacy bare category name (caller falls back to firstBaseTile)', () => {
		expect(tileUrlForKey(MANIFEST_REAL, 'Grass')).toBeNull();
	});
	it('returns null for unknown keys and null manifest', () => {
		expect(tileUrlForKey(MANIFEST_REAL, 'nope_99')).toBeNull();
		expect(tileUrlForKey(null, 'grass_01_tile_256_01')).toBeNull();
	});
});

describe('typeForKey (which chip is armed)', () => {
	it('maps a specific land tile key to its category', () => {
		expect(typeForKey(MANIFEST_REAL, 'grass_02_tile_256_03')).toBe('Grass');
	});
	it('maps any water color key to the Water umbrella type', () => {
		expect(typeForKey(MANIFEST_REAL, 'water_grass')).toBe(WATER_TYPE);
	});
	it('maps a legacy bare category name to itself', () => {
		expect(typeForKey(MANIFEST_REAL, 'Grass')).toBe('Grass');
	});
	it('maps the legacy generic "water" key to Water', () => {
		expect(typeForKey(MANIFEST_REAL, 'water')).toBe(WATER_TYPE);
	});
	it('returns null for unknown keys and null manifest', () => {
		expect(typeForKey(MANIFEST_REAL, 'mystery')).toBeNull();
		expect(typeForKey(null, 'Grass')).toBeNull();
	});
});

describe('texturesForType (popover contents)', () => {
	it('lists one entry per land base tile with key+url+label', () => {
		const t = texturesForType(MANIFEST_REAL, 'Grass');
		expect(t).toEqual([
			{
				key: 'grass_01_tile_256_01',
				url: '/api/sprites/Grass/grass_01/grass_01_tile_256_01.png',
				label: 'grass_01 · 01'
			},
			{
				key: 'grass_02_tile_256_03',
				url: '/api/sprites/Grass/grass_02/grass_02_tile_256_03.png',
				label: 'grass_02 · 03'
			}
		]);
	});
	it('lists the water colors under WATER_TYPE with the trailing "water" stripped', () => {
		const t = texturesForType(MANIFEST_REAL, WATER_TYPE);
		expect(t.map((x) => [x.key, x.label])).toEqual([
			['water_snow', 'Snow'],
			['water_grass', 'Grass']
		]);
	});
	it('is empty for an unknown type or null manifest', () => {
		expect(texturesForType(MANIFEST_REAL, 'Nope')).toEqual([]);
		expect(texturesForType(null, 'Grass')).toEqual([]);
		expect(texturesForType(MANIFEST, WATER_TYPE)).toEqual([]); // no water section
	});

	it('lists base + road + water-edge variants as paintable swatches, base first', () => {
		const manifest: TerrainManifest = {
			tileSize: 256,
			categories: {
				Clay: {
					base: ['/api/sprites/Clay/clay/clay_tile_256_01.png'],
					road: ['/api/sprites/Clay/clay/clay_tile_road_256_01.png'],
					waterEdge: ['/api/sprites/Clay/clay/clay_tile_water_256_01.png']
				}
			}
		};
		const t = texturesForType(manifest, 'Clay');
		expect(t.map((x) => [x.key, x.label])).toEqual([
			['clay_tile_256_01', 'clay · 01'], // base, first
			['clay_tile_road_256_01', 'clay road · 01'], // road variant keeps its kind token
			['clay_tile_water_256_01', 'clay water · 01']
		]);
		// road/water variants must also render + arm their category chip.
		expect(tileUrlForKey(manifest, 'clay_tile_road_256_01')).toBe(
			'/api/sprites/Clay/clay/clay_tile_road_256_01.png'
		);
		expect(typeForKey(manifest, 'clay_tile_water_256_01')).toBe('Clay');
	});
});

describe('loadTerrainManifest', () => {
	beforeEach(() => __resetTerrainManifestCache());

	it('fetches, caches, and returns null on failure', async () => {
		let calls = 0;
		const fakeFetch = (async () => {
			calls++;
			return { ok: true, json: async () => MANIFEST } as Response;
		}) as unknown as typeof fetch;
		const m1 = await loadTerrainManifest(fakeFetch);
		const m2 = await loadTerrainManifest(fakeFetch);
		expect(m1).toEqual(MANIFEST);
		expect(m2).toBe(m1); // cached
		expect(calls).toBe(1);

		__resetTerrainManifestCache();
		const failFetch = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;
		expect(await loadTerrainManifest(failFetch)).toBeNull();
	});

	it('does NOT cache a failure — a later call retries and can recover', async () => {
		let calls = 0;
		// First call fails (e.g. asset route warming up), second succeeds.
		const flakyFetch = (async () => {
			calls++;
			return calls === 1
				? ({ ok: false } as Response)
				: ({ ok: true, json: async () => MANIFEST } as Response);
		}) as unknown as typeof fetch;
		expect(await loadTerrainManifest(flakyFetch)).toBeNull(); // transient failure
		expect(await loadTerrainManifest(flakyFetch)).toEqual(MANIFEST); // retried + recovered
		expect(calls).toBe(2);
	});
});
