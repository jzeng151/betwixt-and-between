<script lang="ts">
	// Slice 3 T6 — grid overlay layer.
	//
	// Renders a square OR hex grid on top of the base image, based on
	// world_maps.grid_type. When grid_visible is false the layer mounts
	// but does not draw — keeps the lifecycle predictable across user
	// toggles.
	//
	// Pattern matches PixiBackgroundLayer / PixiRegionLayer: dynamic import
	// of pixi.js (CLAUDE.md trust boundary — paper and pixi are client-only
	// on Cloudflare Workers), one Container per layer added to the
	// shared viewport, tear-down on destroy.
	//
	// Grid cells span the canvas dimensions (activeMap.width × .height).
	// Cell pitch = canvas size / grid_cells_x (square) or hexSizeForCanvas
	// (hex). The grid is decoration-only; the cells in anchor.state_jsonb
	// use integer (x, y) keys, not pixels — PixiTerrainLayer maps integer
	// → pixel using the same math.
	//
	// Stroke color: subtle muted gray on dark canvas. Matches the existing
	// Midnight Ink palette (--color-text-muted at ~30% alpha). Pixi
	// Graphics doesn't understand CSS variables; the constants are
	// duplicated here. If DESIGN.md ever exports the palette as TS
	// constants, replace.

	import { getContext, onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import {
		hexSizeForCanvas,
		hexAxialToPixel,
		hexVertices,
		type HexSize
	} from './hex-grid.js';
	import { layerVisibility } from './layer-prefs-store.js';
	import type { WorldMap } from './types.js';

	// Slice 3 E4 — layer toggle. Separate from world_maps.grid_visible
	// (the latter is per-MAP config; this is per-USER preference).
	// Effective visibility = (map.gridVisible) AND $visible.
	const visible = layerVisibility('grid');

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;

	let {
		activeMap
	}: {
		activeMap: WorldMap | null;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);
	const GRID_STROKE_COLOR = 0x6b7280;
	const GRID_STROKE_ALPHA = 0.25;
	const GRID_STROKE_WIDTH = 1;

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;
	let graphics: PixiGraphics | null = null;

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

	$effect(() => {
		const viewport = stageCtx.viewport;
		if (!PIXI || !viewport) return;

		// Lazy-create the layer. Index 1 puts it above the background
		// (index 0) and below regions/placements/chrome.
		if (!layer) {
			layer = new PIXI.Container();
			// codex P2 (PR #58): seed visibility at creation. PIXI imports
			// async, so on the normal first-load order the visibility effect
			// below already ran with layer === null (a no-op) and won't rerun
			// just because layer flipped to set (layer isn't reactive). A
			// layer created afterward would keep Pixi's default visible=true
			// and flash the grid even when it should be hidden (existing maps
			// migrated with gridVisible=false, or a saved pref of false).
			// get(visible) is an UNTRACKED read so this geometry effect does
			// not subscribe to the per-user pref store — toggling visibility
			// must not tear down + rebuild the grid (the separate visibility
			// effect below owns that, to avoid rebuilding up to 16k polygons).
			layer.visible = (activeMap?.gridVisible ?? false) && get(visible);
			// addChildAt(2) so it lives between PixiBackgroundLayer (index
			// 0/1) and the region/placement layers above. Pixi clamps
			// indices that exceed the current child count, so 2 here is
			// safe regardless of which other layers have mounted.
			viewport.addChildAt(layer, Math.min(2, viewport.children.length));
		}

		// Geometry effect: rebuild Graphics only when shape inputs change
		// (gridType, cell counts, canvas dimensions, map identity).
		// Visibility toggling is a separate effect below — flipping the
		// per-user layer pref shouldn't tear down + reconstruct up to 16k
		// hex polygons. Per outside-voice maintainability finding.
		const map = activeMap;
		const w = map?.width ?? null;
		const h = map?.height ?? null;

		// Tear down previous draw before deciding whether to redraw.
		if (graphics) {
			try {
				graphics.destroy();
			} catch (_) {
				/* may have been destroyed by viewport teardown */
			}
			graphics = null;
		}

		if (!map || !w || !h) {
			// No canvas yet — nothing to draw. Visibility still applies via
			// the separate effect below, but with no Graphics there's
			// nothing to hide.
			return;
		}

		const g = new PIXI.Graphics();
		if (map.gridType === 'hex') {
			drawHexGrid(g, map.gridCellsX, map.gridCellsY, w, h);
		} else {
			drawSquareGrid(g, map.gridCellsX, map.gridCellsY, w, h);
		}
		layer.addChild(g);
		graphics = g;
	});

	// Visibility-only effect — flips layer.visible based on map config
	// AND user pref. No Graphics teardown, just a boolean. Matches the
	// pattern in PixiBackgroundLayer / PixiTerrainLayer / etc.
	$effect(() => {
		const map = activeMap;
		const effective = (map?.gridVisible ?? false) && $visible;
		if (layer) layer.visible = effective;
	});

	function drawSquareGrid(
		g: PixiGraphics,
		cellsX: number,
		cellsY: number,
		canvasW: number,
		canvasH: number
	): void {
		const stepX = canvasW / cellsX;
		const stepY = canvasH / cellsY;
		// Vertical lines.
		for (let i = 0; i <= cellsX; i++) {
			const x = i * stepX;
			g.moveTo(x, 0).lineTo(x, canvasH);
		}
		// Horizontal lines.
		for (let i = 0; i <= cellsY; i++) {
			const y = i * stepY;
			g.moveTo(0, y).lineTo(canvasW, y);
		}
		g.stroke({
			color: GRID_STROKE_COLOR,
			alpha: GRID_STROKE_ALPHA,
			width: GRID_STROKE_WIDTH
		});
	}

	function drawHexGrid(
		g: PixiGraphics,
		cellsX: number,
		cellsY: number,
		canvasW: number,
		canvasH: number
	): void {
		const size: HexSize = hexSizeForCanvas(cellsX, cellsY, canvasW, canvasH);
		for (let r = 0; r < cellsY; r++) {
			for (let q = 0; q < cellsX; q++) {
				const center = hexAxialToPixel(q, r, size);
				const verts = hexVertices(center.x, center.y, size);
				g.moveTo(verts[0].x, verts[0].y);
				for (let i = 1; i < verts.length; i++) {
					g.lineTo(verts[i].x, verts[i].y);
				}
				g.lineTo(verts[0].x, verts[0].y);
			}
		}
		g.stroke({
			color: GRID_STROKE_COLOR,
			alpha: GRID_STROKE_ALPHA,
			width: GRID_STROKE_WIDTH
		});
	}

	onDestroy(() => {
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
