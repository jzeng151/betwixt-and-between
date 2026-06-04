<script lang="ts">
	// World Map v3 Slice 6 — water layer.
	//
	// ONLY water ripples. This dedicated layer draws water cells and applies the
	// shimmer to just them; land (flat colors + sprite tiles) is static. Water
	// cells render their actual color TILE (per-cell key like "water_snow" via
	// the manifest), shimmered — a textured, moving surface. Falls back to flat
	// blue when there's no tile (hex grids, or a key with no art). Shimmer is
	// driven by the shared anim-controller on PixiStage (D6) — subscribe, never
	// own/destroy it.

	import { getContext, onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { PIXI_STAGE_CONTEXT, MAP_LAYER_Z, type PixiStageContext } from './pixi-context.js';
	import { layerVisibility } from './layer-prefs-store.js';
	import { createTerrainShimmerFilter } from './terrain-shimmer.js';
	import {
		loadTerrainManifest,
		waterTileUrl,
		isWaterKey,
		type TerrainManifest
	} from './terrain-tilesets.js';
	import { hexSizeForCanvas, hexAxialToPixel, hexVertices, type HexSize } from './hex-grid.js';
	import type { RenderedCell } from './projection.js';
	import type { WorldMap } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;

	let { activeMap, cells }: { activeMap: WorldMap | null; cells: RenderedCell[] } = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	const WATER_COLOR = 0x0ea5e9; // sky-500 — flat fallback when no tile
	const WATER_ALPHA = 0.85;

	// Water is part of the Terrain layer — toggling "Terrain" off hides it too
	// (Codex #70). Seeded at creation; flipped by the visibility effect below.
	const visible = layerVisibility('terrain');

	let PIXI = $state<PixiModule | null>(null);
	let manifest = $state<TerrainManifest | null>(null);
	let layer: PixiContainer | null = null;
	let shimmer: import('./terrain-shimmer.js').TerrainShimmer | null = null;
	let offShimmer: (() => void) | null = null;
	let shimmerAttached = false;

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
		if (!PIXI || !viewport || !activeMap?.width || !activeMap?.height) {
			// Switched to an image-less map: drop the previous map's water so it
			// doesn't ghost over the blank canvas (Codex #70).
			if (layer) layer.removeChildren().forEach((c) => c.destroy());
			return;
		}

		if (!layer) {
			layer = new PIXI.Container();
			layer.visible = get(visible); // honor the saved Terrain-layer pref
			layer.zIndex = MAP_LAYER_Z.water; // above land tiles, below overlays
			viewport.addChild(layer);
		}
		if (!shimmerAttached && stageCtx.anim) {
			try {
				shimmer = createTerrainShimmerFilter(PIXI);
				layer.filters = [shimmer.filter];
				offShimmer = stageCtx.anim.register((t) => shimmer!.setTime(t));
				shimmerAttached = true;
			} catch (_) {
				/* renderer unsupported — water still draws, just static */
			}
		}

		const w = activeMap.width;
		const h = activeMap.height;
		const waterCells = cells.filter((c) => isWaterKey(c.biome));

		// Hex grids (or no water tiles) → flat-blue fill, rippled. Square grids
		// with tiles → textured tile sprites (+ flat fallback per cell).
		if (activeMap.gridType === 'hex' || waterTileUrl(manifest, 'water') === null) {
			const PX = PIXI;
			const g = new PX.Graphics();
			if (activeMap.gridType === 'hex') {
				const size: HexSize = hexSizeForCanvas(activeMap.gridCellsX, activeMap.gridCellsY, w, h);
				for (const cell of waterCells) {
					const c = hexAxialToPixel(cell.x, cell.y, size);
					const verts = hexVertices(c.x, c.y, size);
					g.moveTo(verts[0].x, verts[0].y);
					for (let i = 1; i < verts.length; i++) g.lineTo(verts[i].x, verts[i].y);
					g.closePath();
					g.fill({ color: WATER_COLOR, alpha: WATER_ALPHA });
				}
			} else {
				const cw = w / activeMap.gridCellsX;
				const ch = h / activeMap.gridCellsY;
				for (const cell of waterCells)
					g.rect(cell.x * cw, cell.y * ch, cw, ch).fill({ color: WATER_COLOR, alpha: WATER_ALPHA });
			}
			layer.removeChildren().forEach((c) => c.destroy());
			layer.addChild(g);
			return;
		}

		const cellW = w / activeMap.gridCellsX;
		const cellH = h / activeMap.gridCellsY;
		const items: { x: number; y: number; url: string | null }[] = [];
		const urls = new Set<string>();
		for (const cell of waterCells) {
			const url = waterTileUrl(manifest, cell.biome);
			items.push({ x: cell.x, y: cell.y, url });
			if (url) urls.add(url);
		}

		let cancelled = false;
		(async () => {
			let texMap: Record<string, unknown> = {};
			if (urls.size > 0) {
				try {
					texMap = await PIXI!.Assets.load([...urls]);
				} catch (_) {
					texMap = {};
				}
			}
			if (cancelled || !layer) return;
			layer.removeChildren().forEach((c) => c.destroy());
			// Flat fallback (cells whose tile didn't load) drawn under the sprites.
			const g = new PIXI!.Graphics();
			for (const it of items) {
				const tex = it.url ? texMap[it.url] : null;
				if (tex) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const sprite = new PIXI!.Sprite(tex as any);
					sprite.x = it.x * cellW;
					sprite.y = it.y * cellH;
					sprite.width = cellW;
					sprite.height = cellH;
					layer.addChild(sprite);
				} else {
					g.rect(it.x * cellW, it.y * cellH, cellW, cellH).fill({
						color: WATER_COLOR,
						alpha: WATER_ALPHA
					});
				}
			}
			layer.addChildAt(g, 0);
		})();
		return () => {
			cancelled = true;
		};
	});

	// Visibility-only effect — flips layer.visible from the Terrain pref. Read
	// $visible unconditionally so it subscribes even while layer is still null.
	$effect(() => {
		const v = $visible;
		if (layer) layer.visible = v;
	});

	onDestroy(() => {
		if (offShimmer) {
			offShimmer();
			offShimmer = null;
		}
		// Shared controller owned by PixiStage (D6) — do not destroy it.
		if (shimmer) {
			try {
				shimmer.destroy();
			} catch (_) {
				/* ignore */
			}
			shimmer = null;
		}
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
