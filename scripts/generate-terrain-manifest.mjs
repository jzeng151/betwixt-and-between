// Generate the terrain-tileset manifest from static/Sprites/ (Slice 6, D15).
//
// The terrain palette is asset-folder-driven: each top-level category under
// static/Sprites/ (Clay, Grass, Ice, Lava, Paving, Sand, Snow) becomes a
// paintable terrain type. This scan classifies the PNG tiles and emits a
// manifest the client loads to (a) build the brush palette and (b) resolve a
// category → tile texture URL at render time.
//
// Excluded: `Objects/` (placeables, deferred), `.meta`/.DS_Store cruft.
// Tile size: 256 base tiles (smaller/lighter; 512 versions exist for later zoom).
// road/water-edge tiles are catalogued but not yet consumed (autotiling later).
//
// Run: node scripts/generate-terrain-manifest.mjs
// Output: static/Sprites/terrain-manifest.json  (served at /Sprites/terrain-manifest.json)

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SPRITES_DIR = join(ROOT, 'static', 'Sprites');
const SIZE = 256; // base tile size we render with
// Objects = placeables (deferred to the stamp system). Water is handled
// separately (flat color tiles, each a distinct paintable water color).
const EXCLUDE_CATEGORIES = new Set(['Objects', 'Water']);
const OUT = join(SPRITES_DIR, 'terrain-manifest.json');

// Walk a directory recursively, returning absolute PNG paths.
function walkPngs(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		const st = statSync(p);
		if (st.isDirectory()) out.push(...walkPngs(p));
		else if (entry.toLowerCase().endsWith('.png')) out.push(p);
	}
	return out;
}

// Tiles are served through the /api/sprites/[...path] route (prod: R2
// TERRAIN_ASSETS bucket; dev: static/Sprites/) — the licensed pack is NOT
// committed, so it can't be a plain /Sprites/ static URL in prod. The path
// after /api/sprites/ is the key relative to static/Sprites (== the R2 key).
const toUrl = (absPath) => '/api/sprites/' + relative(SPRITES_DIR, absPath).split('\\').join('/');

// Classify a filename by the size + kind tokens (e.g. `_tile_256_`,
// `_tile_road_256_`, `_tile_water_256_`). Returns 'base' | 'road' | 'water' | null.
function classify(name) {
	if (!name.includes(`_${SIZE}_`)) return null; // wrong size
	if (name.includes('_tile_road_')) return 'road';
	if (name.includes('_tile_water_')) return 'water';
	if (name.includes('_tile_')) return 'base';
	return null;
}

const categories = {};
const topDirs = readdirSync(SPRITES_DIR).filter((d) => {
	try {
		return statSync(join(SPRITES_DIR, d)).isDirectory() && !EXCLUDE_CATEGORIES.has(d);
	} catch {
		return false;
	}
});

for (const cat of topDirs.sort()) {
	const pngs = walkPngs(join(SPRITES_DIR, cat));
	const base = [];
	const road = [];
	const water = [];
	for (const abs of pngs) {
		const name = abs.split('/').pop();
		const kind = classify(name);
		if (kind === 'base') base.push(toUrl(abs));
		else if (kind === 'road') road.push(toUrl(abs));
		else if (kind === 'water') water.push(toUrl(abs));
	}
	if (base.length === 0) continue; // a category with no base tiles isn't paintable
	categories[cat] = {
		base: base.sort(),
		road: road.sort(), // catalogued; autotiling wired later
		waterEdge: water.sort() // catalogued; autotiling wired later
	};
}

// Water: flat color tiles in static/Sprites/Water/ (one per color, named
// <origin>_water_<size>_NN.png — e.g. grass_water_256_06.png). Each is a
// distinct paintable water color, grouped under "Water" in the palette. A
// painted water cell stores the `key` (e.g. "water_grass"); the renderer routes
// any "water_*" key to the shimmer layer.
const waterColors = [];
const waterDir = join(SPRITES_DIR, 'Water');
try {
	for (const f of readdirSync(waterDir).sort()) {
		if (!f.toLowerCase().endsWith('.png')) continue;
		if (!f.includes(`_${SIZE}_`)) continue; // size filter
		const origin = f.replace(new RegExp(`_water_${SIZE}_\\d+\\.png$`, 'i'), '');
		if (origin === f) continue; // didn't match the <origin>_water_ pattern
		waterColors.push({
			key: `water_${origin.toLowerCase()}`,
			label: `${origin.charAt(0).toUpperCase()}${origin.slice(1)} water`,
			url: toUrl(join(waterDir, f))
		});
	}
} catch {
	/* no Water/ dir yet */
}

const manifest = {
	generatedBy: 'scripts/generate-terrain-manifest.mjs',
	tileSize: SIZE,
	categories,
	water: { colors: waterColors }
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

// Emit the authoritative allowlist of asset-backed terrain keys (category
// names + base-tile basenames + water color keys). The server validator and
// the projection fold check painted biomes against this set so a junk key
// can't be stored as invisible, grid-blocking terrain (Slice 6 D15 + /review
// #3). Declaration-only `as const` → safe to import from server code.
const keyOf = (u) => u.split('/').pop().replace(/\.png$/i, '');
const assetKeys = [
	...Object.keys(categories),
	...Object.values(categories).flatMap((c) => c.base.map(keyOf)),
	...waterColors.map((wc) => wc.key)
].sort();
const KEYS_OUT = join(ROOT, 'src', 'lib', 'features', 'map', 'terrain-keys.generated.ts');
const keysTs =
	'// GENERATED by scripts/generate-terrain-manifest.mjs — DO NOT EDIT BY HAND.\n' +
	'// Re-run `node scripts/generate-terrain-manifest.mjs` after changing the\n' +
	'// terrain tile pack (static/Sprites/). Authoritative set of asset-backed\n' +
	'// terrain keys: category names, base-tile basenames, and water color keys.\n' +
	'export const TERRAIN_ASSET_KEYS = [\n' +
	assetKeys.map((k) => `\t${JSON.stringify(k)}`).join(',\n') +
	'\n] as const;\n';
writeFileSync(KEYS_OUT, keysTs);

// Summary to stdout.
const cats = Object.keys(categories);
console.log(`terrain-keys.generated.ts written: ${assetKeys.length} asset keys`);
console.log(`terrain-manifest.json written: ${cats.length} land categories + ${waterColors.length} water colors`);
for (const c of cats) {
	const v = categories[c];
	console.log(`  ${c.padEnd(8)} base:${v.base.length}  road:${v.road.length}  waterEdge:${v.waterEdge.length}`);
}
for (const wc of waterColors) console.log(`  Water/${wc.key.padEnd(14)} ${wc.url}`);
