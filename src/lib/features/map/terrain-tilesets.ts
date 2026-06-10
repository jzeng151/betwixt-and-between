// World Map v3 Slice 6 (D15) — terrain tileset registry (client-side).
//
// The terrain palette is asset-folder-driven: a generated manifest
// (static/Sprites/terrain-manifest.json, from scripts/generate-terrain-manifest.mjs)
// lists each category (Grass, Sand, ...) and its base/road/waterEdge tile URLs.
// This module loads that manifest once and resolves a (category, cell) → tile URL
// deterministically, so a given cell always renders the same variant across
// reloads (no random-on-reload churn — Fix-6).

export type TerrainCategory = {
	/** Base ground tiles (the paintable fill). */
	base: string[];
	/** Road-edge tiles — catalogued; autotiling wired in a later step. */
	road: string[];
	/** Water-edge tiles — catalogued; autotiling wired in a later step. */
	waterEdge: string[];
};

/** A paintable water color (flat tile in static/Sprites/Water/). */
export type WaterColor = {
	/** Cell key stored when this color is painted, e.g. "water_snow". */
	key: string;
	/** Human label for the palette, e.g. "Snow water". */
	label: string;
	/** Tile URL (through the /api/sprites route). */
	url: string;
};

/** A placeable stamp sprite (static/Sprites/Objects/), scattered by stamp mode. */
export type ObjectStamp = {
	/** Stamp key stored in paint_stroke.textureKey, e.g. "tree_object_01". */
	key: string;
	/** Family group for the palette, e.g. "tree_object". */
	group: string;
	/** Human label, e.g. "Tree". */
	label: string;
	/** Sprite URL (through the /api/sprites route). */
	url: string;
};

export type TerrainManifest = {
	tileSize: number;
	categories: Record<string, TerrainCategory>;
	water?: { colors: WaterColor[] };
	/** WM3 Slice A — stamp sprites for the freeform brush's stamp mode. */
	objects?: ObjectStamp[];
};

/** Is a cell key a water type? (legacy 'water' or an asset water color.) */
export function isWaterKey(key: string): boolean {
	return key === 'water' || key.startsWith('water_');
}

/** The paintable water colors (empty if none in the manifest). */
export function waterColors(manifest: TerrainManifest | null): WaterColor[] {
	return manifest?.water?.colors ?? [];
}

/**
 * Resolve a water cell's tile URL. Specific color keys (e.g. "water_snow") map
 * to their tile; the legacy generic "water" key falls back to the first
 * catalogued color so old maps still get a textured, rippling surface. Null if
 * no water tiles exist (caller falls back to flat blue).
 */
export function waterTileUrl(manifest: TerrainManifest | null, key: string): string | null {
	const colors = waterColors(manifest);
	if (colors.length === 0) return null;
	const exact = colors.find((c) => c.key === key);
	if (exact) return exact.url;
	return key === 'water' ? colors[0].url : null;
}

let cache: TerrainManifest | null = null;
let inflight: Promise<TerrainManifest | null> | null = null;

/** Manifest URL (served from static/). */
export const TERRAIN_MANIFEST_URL = '/Sprites/terrain-manifest.json';

/**
 * Load + cache the terrain manifest. Returns null if it can't be fetched/parsed
 * (callers fall back to flat-color terrain). `fetchImpl` is injectable for tests.
 */
export async function loadTerrainManifest(
	fetchImpl: typeof fetch = fetch
): Promise<TerrainManifest | null> {
	if (cache) return cache;
	if (inflight) return inflight;
	// Only a SUCCESSFUL load is cached. On failure we clear `inflight` so the
	// next call re-fetches — otherwise one transient flake (asset route warming
	// up, network blip) leaves the palette empty + terrain flat for the whole
	// session. A successful manifest never changes mid-session, so caching it is
	// safe; a null is not worth remembering.
	inflight = fetchImpl(TERRAIN_MANIFEST_URL)
		.then((r) => (r.ok ? (r.json() as Promise<TerrainManifest>) : null))
		.then((m) => {
			cache = m;
			if (!m) inflight = null;
			return m;
		})
		.catch(() => {
			inflight = null;
			return null;
		});
	return inflight;
}

/** Test seam: reset the module cache. */
export function __resetTerrainManifestCache(): void {
	cache = null;
	inflight = null;
}

/** The list of paintable category keys (for the brush palette). */
export function terrainCategories(manifest: TerrainManifest | null): string[] {
	return manifest ? Object.keys(manifest.categories) : [];
}

/** The umbrella terrain type the water colors are grouped under in the palette. */
export const WATER_TYPE = 'Water';

/** A single selectable texture in a type's popover (a land tile or a water color). */
export type TerrainTexture = {
	/** Cell key stored when this texture is painted (a tile basename or "water_*"). */
	key: string;
	/** Tile/thumbnail URL (through /api/sprites). */
	url: string;
	/** Short human label for the swatch tooltip. */
	label: string;
};

/** The cell key for a tile URL — its basename sans extension (e.g. "grass_01_tile_256_05"). */
export function keyForUrl(url: string): string {
	return (url.split('/').pop() ?? url).replace(/\.png$/i, '');
}

// key → { url, type } over every paintable texture (land tiles + water colors),
// cached per manifest identity. Powers tileUrlForKey (render) + typeForKey
// (palette armed-state) in O(1) without re-scanning the manifest each call.
const indexCache = new WeakMap<TerrainManifest, Map<string, { url: string; type: string }>>();
function keyIndex(manifest: TerrainManifest): Map<string, { url: string; type: string }> {
	let idx = indexCache.get(manifest);
	if (idx) return idx;
	idx = new Map();
	for (const [type, cat] of Object.entries(manifest.categories)) {
		// base + road + waterEdge are all directly paintable swatches, so every
		// one must resolve to its tile URL (render) and its category (armed chip).
		for (const url of [...cat.base, ...cat.road, ...cat.waterEdge])
			idx.set(keyForUrl(url), { url, type });
	}
	for (const wc of waterColors(manifest)) idx.set(wc.key, { url: wc.url, type: WATER_TYPE });
	indexCache.set(manifest, idx);
	return idx;
}

/**
 * Resolve a painted cell's key → its exact tile URL. Returns null for keys with
 * no specific tile (legacy category names like "Grass", legacy biomes, water —
 * the caller falls back to firstBaseTile / the water layer / flat color).
 */
export function tileUrlForKey(manifest: TerrainManifest | null, key: string): string | null {
	if (!manifest) return null;
	return keyIndex(manifest).get(key)?.url ?? null;
}

/**
 * The terrain TYPE a cell key belongs to (a land category name or WATER_TYPE) —
 * drives which palette chip reads as armed. Back-compat: a bare category name
 * (old "coherent fill" cells) maps to itself; any water_* key maps to Water.
 */
export function typeForKey(manifest: TerrainManifest | null, key: string): string | null {
	if (!manifest) return null;
	const hit = keyIndex(manifest).get(key);
	if (hit) return hit.type;
	if (manifest.categories[key]) return key; // legacy coherent-fill cell
	if (isWaterKey(key)) return WATER_TYPE; // legacy generic "water"
	return null;
}

// "grass_01_tile_256_05" → "grass_01 · 05"; road/water variants keep the kind
// token ("clay_tile_road_256_01" → "clay road · 01"). Falls back to the raw key.
function landTextureLabel(key: string): string {
	const m = key.match(/^(.*)_tile(?:_(road|water))?_\d+_(\d+)$/);
	if (!m) return key;
	const [, name, kind, num] = m;
	return kind ? `${name} ${kind} · ${num}` : `${name} · ${num}`;
}

/**
 * The selectable textures for a terrain type (the popover contents). Land types
 * yield one entry per base tile; WATER_TYPE yields the water colors.
 */
export function texturesForType(manifest: TerrainManifest | null, type: string): TerrainTexture[] {
	if (!manifest) return [];
	if (type === WATER_TYPE) {
		return waterColors(manifest).map((c) => ({
			key: c.key,
			url: c.url,
			label: c.label.replace(/\s*water$/i, '')
		}));
	}
	const cat = manifest.categories[type];
	if (!cat) return [];
	// All tiles in the category are paintable: base fill, then road + water-edge
	// variants (grouped after the base tiles in the popover).
	return [...cat.base, ...cat.road, ...cat.waterEdge].map((url) => {
		const key = keyForUrl(url);
		return { key, url, label: landTextureLabel(key) };
	});
}

// Stable 2D integer hash (xorshift-ish mix of two coordinates). Deterministic
// per (x,y) so a cell's variant never changes across reloads.
function hash2(x: number, y: number): number {
	let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) >>> 0;
	h ^= h >>> 13;
	h = Math.imul(h, 0x5bd1e995) >>> 0;
	h ^= h >>> 15;
	return h >>> 0;
}

/**
 * Coherent fill: the single representative base tile for a category (null if
 * none). This is what the renderer uses today — one consistent tile per terrain
 * type, so a painted region reads as that terrain rather than a noisy patchwork.
 */
export function firstBaseTile(manifest: TerrainManifest | null, category: string): string | null {
	const cat = manifest?.categories?.[category];
	return cat && cat.base.length > 0 ? cat.base[0] : null;
}

/**
 * RESERVED (variant-mixing, Fix-6): deterministic per-(x,y) variant pick for
 * natural within-terrain variation. NOT used by the renderer yet — proper
 * variant mixing needs a per-cell seed STORED on the cell (so a stroke's look is
 * stable + author-controlled), not a render-time hash. Kept + tested for that
 * future step. Returns null when the category has no tiles.
 */
export function pickBaseTile(
	manifest: TerrainManifest | null,
	category: string,
	x: number,
	y: number
): string | null {
	const cat = manifest?.categories?.[category];
	if (!cat || cat.base.length === 0) return null;
	return cat.base[hash2(x, y) % cat.base.length];
}

// -- WM3 Slice A: stamp sprites (freeform brush stamp mode) -------------------

/** All stamp sprites (empty if the manifest has none). */
export function objectStamps(manifest: TerrainManifest | null): ObjectStamp[] {
	return manifest?.objects ?? [];
}

/** Stamp sprites grouped by family ("tree_object" → [...]), for the palette. */
export function objectStampGroups(
	manifest: TerrainManifest | null
): Array<{ group: string; label: string; stamps: ObjectStamp[] }> {
	const byGroup = new Map<string, { label: string; stamps: ObjectStamp[] }>();
	for (const s of objectStamps(manifest)) {
		const g = byGroup.get(s.group) ?? { label: s.label, stamps: [] };
		g.stamps.push(s);
		byGroup.set(s.group, g);
	}
	return [...byGroup.entries()].map(([group, v]) => ({ group, label: v.label, stamps: v.stamps }));
}

/**
 * WM3 Slice C — varied scatter. Resolve a stamp-mode textureKey to its
 * member sprites: a FAMILY key ("tree_object") yields every member (the
 * renderer picks one deterministically per placement); an individual key
 * yields just that sprite. Empty when unknown (lazy GC).
 */
export function stampsForKey(manifest: TerrainManifest | null, key: string): ObjectStamp[] {
	const all = objectStamps(manifest);
	const members = all.filter((s) => s.group === key);
	if (members.length > 0) return members;
	const exact = all.find((s) => s.key === key);
	return exact ? [exact] : [];
}
