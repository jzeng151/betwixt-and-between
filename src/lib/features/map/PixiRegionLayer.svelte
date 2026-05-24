<script lang="ts">
	// Pixi-side region renderer — Slice 1b PR 2 commit 4 (the demo unlock).
	//
	// Parallel to RegionLayer.svelte (Leaflet path). Both render the SAME
	// polygons; this one consumes the projection-engine's RenderedState for
	// per-region color overrides (faction ownership shifts via
	// transfer_region events at scrub time). When renderedState.regions[]
	// doesn't override a region (no event has affected it yet), we fall
	// back to map_regions.color (the geometry-author's baseline).
	//
	// Coordinates: regions store polygon as [[lat, lng], ...] per Leaflet
	// convention. MapStage's click handler treats lng as x-pixel and lat
	// as y-pixel against the source-image dimensions. Pixi wants
	// [x1, y1, x2, y2, ...] flat. flatten by [lng, lat] pairs.
	//
	// pixi.js is dynamic-imported inside onMount (mirrors PixiStage's
	// pattern) so PixiRegionLayer's static module load doesn't pull pixi
	// into the Cloudflare Worker SSR bundle — Δ1b-H worker-pixi-import
	// guard depends on this discipline.

	import { getContext, onDestroy, onMount } from 'svelte';
	import {
		PIXI_STAGE_CONTEXT,
		type PixiStageContext
	} from './pixi-context.js';
	import { NEUTRAL_REGION_COLOR, type RenderedState } from './projection.js';
	import type { MapRegion } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;

	let {
		regions,
		renderedState
	}: {
		regions: MapRegion[];
		renderedState: RenderedState | null;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;

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

	// Lookup table: regionId → color from the projection-engine's
	// RenderedState. O(1) per region inside the redraw loop.
	let renderedColorById = $derived.by(() => {
		const m = new Map<string, string>();
		if (renderedState) {
			for (const r of renderedState.regions) m.set(r.regionId, r.color);
		}
		return m;
	});

	function parseHex(input: string): number {
		const s = input.trim().replace(/^#/, '');
		if (s.length === 3) {
			return parseInt(s.split('').map((c) => c + c).join(''), 16);
		}
		const n = parseInt(s, 16);
		return Number.isFinite(n) ? n : 0x9ca3af;
	}

	$effect(() => {
		const app = stageCtx.app;
		if (!app || !PIXI) return;

		if (!layer) {
			layer = new PIXI.Container();
			app.stage.addChild(layer);
		}

		// Clear previous draws. removeChildren returns the removed nodes;
		// destroying them releases GPU buffers (per Pixi v8 docs).
		for (const child of layer.removeChildren()) {
			child.destroy();
		}

		for (const region of regions) {
			const colorStr =
				renderedColorById.get(region.id) ?? region.color ?? NEUTRAL_REGION_COLOR;
			const fill = parseHex(colorStr);

			const flat: number[] = [];
			for (const [lat, lng] of region.polygon) {
				flat.push(lng, lat);
			}
			if (flat.length < 6) continue;

			const g = new PIXI.Graphics();
			g.poly(flat)
				.fill({ color: fill, alpha: 0.35 })
				.stroke({ color: fill, width: 2 });
			layer.addChild(g);
		}
	});

	onDestroy(() => {
		if (layer) {
			try {
				layer.destroy({ children: true });
			} catch (_) {
				/* PixiStage may have destroyed the app first (renderer-flag
				   flip race) — cascade-destroy already released this layer. */
			}
			layer = null;
		}
	});
</script>
