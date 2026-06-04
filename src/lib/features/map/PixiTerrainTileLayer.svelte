<script lang="ts">
	// World Map v3 Slice 6 (D15) — sprite-tile terrain render.
	//
	// Renders the asset-folder-driven terrain tiles (static/Sprites/*) on top of
	// the existing flat-color PixiTerrainLayer. Kept as a SEPARATE layer so the
	// proven flat render + its E2E coverage stay untouched; where a cell has a
	// known terrain category, a tile covers the flat fill; where it doesn't, the
	// flat color shows through (graceful fallback). Square grids only for now;
	// hex tiling deferred (Fix-7) → hex cells keep the flat look underneath.
	//
	// Variant per cell is deterministic (pickBaseTile, Fix-6). Textures load via
	// PIXI.Assets (cached); the first pass paints what's already cached and kicks
	// a load for the rest, then bumps `texGen` to repaint once they're ready.
	//
	// TEMP (PoC): LEGACY_ALIAS maps the old biome enum → new categories so your
	// EXISTING painted maps show tiles right away. Open question for later: do
	// legacy maps alias to tiles, or fall back to flat per D15? Flagged, not locked.

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import {
		loadTerrainManifest,
		firstBaseTile,
		tileUrlForKey,
		isWaterKey,
		type TerrainManifest
	} from './terrain-tilesets.js';
	import type { RenderedCell } from './projection.js';
	import type { WorldMap } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;

	let { activeMap, cells }: { activeMap: WorldMap | null; cells: RenderedCell[] } = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let manifest = $state<TerrainManifest | null>(null);

	// Land tiles only — static (no shimmer). Water ripples in PixiWaterLayer.
	let layer: PixiContainer | null = null;

	// TEMP PoC alias — legacy biome enum → asset categories (water has no tile).
	const LEGACY_ALIAS: Record<string, string> = {
		plains: 'Grass',
		forest: 'Grass',
		swamp: 'Grass',
		desert: 'Sand',
		snow: 'Snow',
		mountain: 'Clay',
		urban: 'Paving'
	};

	function resolveCategory(biome: string): string {
		if (manifest?.categories?.[biome]) return biome; // already a real category
		return LEGACY_ALIAS[biome] ?? biome; // legacy alias, else as-is (→ no tile → flat)
	}

	onMount(() => {
		let cancelled = false;
		(async () => {
			const mod = await import('pixi.js');
			if (cancelled) return;
			PIXI = mod;
			const m = await loadTerrainManifest();
			if (cancelled) return;
			manifest = m;
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const viewport = stageCtx.viewport;
		if (!PIXI || !viewport || !manifest || !activeMap?.width || !activeMap?.height) return;
		// Square grids only for the tile render; hex keeps the flat layer's look.
		if (activeMap.gridType === 'hex') return;

		if (!layer) {
			layer = new PIXI.Container();
			// Just above the flat terrain layer (which clamps to index ≤3).
			viewport.addChildAt(layer, Math.min(4, viewport.children.length));
		}

		const w = activeMap.width;
		const h = activeMap.height;
		const cellW = w / activeMap.gridCellsX;
		const cellH = h / activeMap.gridCellsY;

		// Resolve a tile url per paintable cell + the unique set to load.
		const items: { x: number; y: number; url: string }[] = [];
		const urls = new Set<string>();
		for (const cell of cells) {
			if (cell.biome === 'unset' || isWaterKey(cell.biome)) continue; // water → water layer
			// The cell stores a SPECIFIC texture key (D16 — picked in the brush
			// popover); resolve it to that exact tile. Legacy "coherent fill" cells
			// store a bare category name → fall back to its representative tile.
			const url =
				tileUrlForKey(manifest, cell.biome) ?? firstBaseTile(manifest, resolveCategory(cell.biome));
			if (!url) continue; // unknown key → flat layer shows through
			items.push({ x: cell.x, y: cell.y, url });
			urls.add(url);
		}

		// Load THEN build — Assets.load is idempotent + cached and returns the
		// textures keyed by url, so we never probe with Assets.get (which warns
		// on a cache miss). Cancel stale passes when cells/map change mid-load.
		let cancelled = false;
		(async () => {
			let texMap: Record<string, unknown> = {};
			if (urls.size > 0) {
				try {
					texMap = await PIXI!.Assets.load([...urls]);
				} catch (_) {
					texMap = {}; // a bad url just leaves those cells flat
				}
			}
			if (cancelled || !layer) return;
			layer.removeChildren().forEach((c) => c.destroy());
			for (const it of items) {
				const tex = texMap[it.url];
				if (!tex) continue;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const sprite = new PIXI!.Sprite(tex as any);
				sprite.x = it.x * cellW;
				sprite.y = it.y * cellH;
				sprite.width = cellW;
				sprite.height = cellH;
				layer.addChild(sprite);
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		if (layer) {
			try {
				layer.destroy({ children: true });
			} catch (_) {
				/* parent app destroyed first */
			}
			layer = null;
		}
	});
</script>
