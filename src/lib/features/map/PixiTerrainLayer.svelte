<script lang="ts">
	// Slice 3 T7 — terrain tile renderer.
	//
	// Consumes RenderedState.cells (from projection.ts) and paints each
	// non-transparent biome as a tinted polygon over the corresponding
	// grid cell. Square cells become rects; hex cells use the hexVertices
	// helper. Cells with biome='unset' are skipped (renders transparent —
	// outside-voice A6 says stored 'unset' and missing cells must look
	// identical).
	//
	// Layer order (PixiGridLayer comment): background (0) → grid (1) →
	// terrain (2) → regions/placements/chrome on top. Terrain paints
	// UNDER region polygons so a region's faction tint sits visually on
	// top of the biome. The plan calls this out explicitly (D6 layer
	// stack).
	//
	// Per outside-voice B6, projection.ts is pure: it doesn't know about
	// entities or placements, only anchors + events. This component
	// reads RenderedState (an output of projectState) and the active
	// map's grid_* columns; it doesn't reach into the DB.
	//
	// Re-draw cadence: every $effect tick rebuilds the Graphics from
	// scratch. For 32×24 = 768 cells max, this is cheap (one Graphics
	// instance, batched draw calls). When cell counts grow (200×200 =
	// 40k via the CHECK bound), revisit; per-cell sprite caching may be
	// needed. Not premature here.

	import { getContext, onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import { biomeStyle } from './biome-textures.js';
	import { layerVisibility } from './layer-prefs-store.js';
	import { createTerrainShimmerFilter } from './terrain-shimmer.js';

	// Slice 3 E4 — layer toggle.
	const visible = layerVisibility('terrain');
	import {
		hexSizeForCanvas,
		hexAxialToPixel,
		hexVertices,
		type HexSize
	} from './hex-grid.js';
	import type { RenderedCell } from './projection.js';
	import type { WorldMap } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;

	let {
		activeMap,
		cells
	}: {
		activeMap: WorldMap | null;
		cells: RenderedCell[];
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;
	let graphics: PixiGraphics | null = null;

	// Slice 6 T1 — subtle UV ripple making flat terrain "breathe" (D13: terrain
	// stays flat-color + shader; sprite rewrite deferred). Driven by the SHARED
	// anim-controller on PixiStage (D6) — this layer subscribes, never owns it.
	let shimmer: import('./terrain-shimmer.js').TerrainShimmer | null = null;
	let offShimmer: (() => void) | null = null;
	let shimmerAttached = false;

	onMount(() => {
		let cancelled = false;
		(async () => {
			const mod = await import('pixi.js');
			if (cancelled) return;
			PIXI = mod;
		})();
		return () => {
			cancelled = true;
		};
	});

	// Geometry effect: rebuild Graphics on cells/map/dimensions change.
	// /review perf — visibility toggle is a SEPARATE effect (below) so
	// flipping the Layers checkbox doesn't tear down + rebuild up to 16k
	// cell polygons. Same pattern as PixiGridLayer.
	$effect(() => {
		const viewport = stageCtx.viewport;
		if (!PIXI || !viewport) return;

		if (!layer) {
			layer = new PIXI.Container();
			// codex P2 (PR #58): seed visibility at creation. PIXI imports
			// async, so on the normal first-load order the visibility effect
			// below already ran with layer === null (a no-op) and won't rerun
			// just because layer flipped to set (layer isn't reactive). A layer
			// created afterward would keep Pixi's default visible=true and show
			// terrain even when the saved pref is false. get(visible) is an
			// UNTRACKED read so this geometry effect does not subscribe to the
			// pref store (toggling visibility stays the separate effect's job —
			// it must not rebuild up to 16k cell polygons).
			layer.visible = get(visible);
			// Terrain layer sits at viewport.children[3] if grid layer
			// mounted, viewport.children[2] otherwise. addChildAt with a
			// clamped index works either way.
			viewport.addChildAt(layer, Math.min(3, viewport.children.length));
		}

		// Slice 6 T1: attach the shimmer filter ONCE, fed by the shared clock.
		// Outside the `if (!layer)` block + guarded by shimmerAttached so that if
		// the shared controller wasn't ready on the first pass, a later geometry
		// re-run (cells/map change) still wires it. Subscribes to stageCtx.anim;
		// does NOT create or destroy the controller (PixiStage owns it).
		if (PIXI && layer && stageCtx.anim && !shimmerAttached) {
			try {
				shimmer = createTerrainShimmerFilter(PIXI);
				layer.filters = [shimmer.filter];
				offShimmer = stageCtx.anim.register((t) => shimmer!.setTime(t));
				shimmerAttached = true;
			} catch (_) {
				/* filter unsupported on this renderer — terrain still draws */
			}
		}

		if (graphics) {
			try {
				graphics.destroy();
			} catch (_) {
				/* may have been destroyed */
			}
			graphics = null;
		}

		const map = activeMap;
		const w = map?.width ?? null;
		const h = map?.height ?? null;
		if (!map || !w || !h || cells.length === 0) {
			return;
		}

		const g = new PIXI.Graphics();
		if (map.gridType === 'hex') {
			drawHexCells(g, cells, map.gridCellsX, map.gridCellsY, w, h);
		} else {
			drawSquareCells(g, cells, map.gridCellsX, map.gridCellsY, w, h);
		}
		layer.addChild(g);
		graphics = g;
	});

	// Visibility-only effect — flips layer.visible without touching the
	// Graphics. Toggling the Layers checkbox is O(1). Read $visible
	// UNCONDITIONALLY (not inside the `if (layer)`): on the first run `layer`
	// is still null (Pixi imports async), so reading it inside the guard would
	// never subscribe the effect to the pref store — the toggle would never
	// reach the canvas.
	$effect(() => {
		const v = $visible;
		if (layer) layer.visible = v;
	});

	function drawSquareCells(
		g: PixiGraphics,
		rendered: RenderedCell[],
		cellsX: number,
		cellsY: number,
		canvasW: number,
		canvasH: number
	): void {
		const cellW = canvasW / cellsX;
		const cellH = canvasH / cellsY;
		for (const cell of rendered) {
			if (cell.biome === 'unset') continue;
			const style = biomeStyle(cell.biome);
			if (style.alpha === 0) continue;
			const px = cell.x * cellW;
			const py = cell.y * cellH;
			g.rect(px, py, cellW, cellH).fill({
				color: style.color,
				alpha: style.alpha
			});
		}
	}

	function drawHexCells(
		g: PixiGraphics,
		rendered: RenderedCell[],
		cellsX: number,
		cellsY: number,
		canvasW: number,
		canvasH: number
	): void {
		const size: HexSize = hexSizeForCanvas(cellsX, cellsY, canvasW, canvasH);
		for (const cell of rendered) {
			if (cell.biome === 'unset') continue;
			const style = biomeStyle(cell.biome);
			if (style.alpha === 0) continue;
			const center = hexAxialToPixel(cell.x, cell.y, size);
			const verts = hexVertices(center.x, center.y, size);
			g.moveTo(verts[0].x, verts[0].y);
			for (let i = 1; i < verts.length; i++) {
				g.lineTo(verts[i].x, verts[i].y);
			}
			g.closePath();
			g.fill({ color: style.color, alpha: style.alpha });
		}
	}

	onDestroy(() => {
		// Slice 6 T1 — tear down the shimmer filter + its ticker subscription
		// before the layer/app so we don't leak a ticker callback on unmount.
		if (offShimmer) {
			offShimmer();
			offShimmer = null;
		}
		// Do NOT destroy the controller — PixiStage owns it (D6). Just unsubscribe
		// (above) and drop our filter.
		if (shimmer) {
			shimmer.destroy();
			shimmer = null;
		}
		if (graphics) {
			try {
				graphics.destroy();
			} catch (_) {
				/* ignore */
			}
			graphics = null;
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
