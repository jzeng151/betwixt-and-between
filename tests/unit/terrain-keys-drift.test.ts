import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
	STAMP_ASSET_KEYS,
	STAMP_GROUP_KEYS,
	TERRAIN_ASSET_KEYS
} from '../../src/lib/features/map/terrain-keys.generated.js';

// F20 — the generated key sets (terrain-keys.generated.ts) and the runtime
// terrain manifest (static/Sprites/terrain-manifest.json) are consumed by
// DIFFERENT code paths: the server paint_stroke validator gates on the generated
// keys (isKnownStampKey / isKnownTerrainKey), while the renderer + palette read
// the manifest. If `npm run gen` regenerates one but not the other they drift,
// and a stroke the renderer can draw would 400 server-side (or vice versa). This
// test fails loudly on that drift.

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(
	readFileSync(join(__dirname, '..', '..', 'static', 'Sprites', 'terrain-manifest.json'), 'utf8')
) as {
	categories: Record<string, unknown>;
	objects: Array<{ key: string; group: string }>;
};

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

describe('terrain key-set / manifest drift', () => {
	it('STAMP_ASSET_KEYS matches the manifest objects[].key set', () => {
		expect(sorted(STAMP_ASSET_KEYS)).toEqual(sorted(manifest.objects.map((o) => o.key)));
	});

	it('STAMP_GROUP_KEYS matches the manifest objects[].group set', () => {
		expect(sorted(STAMP_GROUP_KEYS)).toEqual(sorted(manifest.objects.map((o) => o.group)));
	});

	it('TERRAIN_ASSET_KEYS covers the manifest terrain categories', () => {
		// Every manifest category must be a known terrain key (the validator's
		// fill-mode gate). TERRAIN_ASSET_KEYS may also carry water/edge variants
		// beyond the bare category names, so this is a subset check.
		const terrainSet = new Set<string>(TERRAIN_ASSET_KEYS);
		for (const cat of Object.keys(manifest.categories)) {
			expect(terrainSet.has(cat)).toBe(true);
		}
	});
});
