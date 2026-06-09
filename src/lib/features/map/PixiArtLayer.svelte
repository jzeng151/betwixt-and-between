<script lang="ts">
	// WM3 Slice A — freeform brush render layer.
	//
	// Renders RenderedState.strokes (paint_stroke fold output) over the
	// background bitmap, in painter's order. Two modes (spike findings):
	//   • fill  — the resolved terrain tile, tiled and MASKED to the stroke shape
	//             (a round-capped stroke of the vector path), with a feathered
	//             alpha edge scaled by `softness` (BlurFilter on the mask). Default
	//             composite is source-over (NOT multiply — re-spike: multiply
	//             muddies real tiles).
	//   • stamp — the resolved Objects/ sprite scattered along the path at
	//             `spacing` intervals with deterministic `jitter` (so re-renders
	//             don't make stamps jump).
	//
	// Coords: paint_stroke.path is normalized [0,1] of the map extent (same
	// convention as placements). brushSize/spacing/jitter are normalized to
	// min(width,height). Grid-independent — unlike PixiTerrainTileLayer this layer
	// works on hex maps too (freeform doesn't snap to cells).
	//
	// Perf: rebuilds the container on strokes/map change (same pattern as
	// PixiTerrainTileLayer rebuilding on cells). Stroke count is bounded by the
	// auto-anchor bake (AUTO_ANCHOR_K), so the single-baseline path stays cheap.
	// Incremental raster-to-RenderTexture is the perf follow-up if counts grow
	// (design OQ4 / eng-review #6).

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, MAP_LAYER_Z, type PixiStageContext } from './pixi-context.js';
	import {
		loadTerrainManifest,
		tileUrlForKey,
		firstBaseTile,
		stampUrlForKey,
		type TerrainManifest
	} from './terrain-tilesets.js';
	import type { StoredStroke } from './projection.js';
	import type { WorldMap } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiTexture = import('pixi.js').Texture;

	let { activeMap, strokes }: { activeMap: WorldMap | null; strokes: StoredStroke[] } = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	// Render guard: the server validator accepts any stamp spacing > 0, and
	// spacingPx floors at 1px, so a long path with tiny spacing would scatter
	// thousands of sprites — built synchronously and rebuilt on every change.
	// Cap per stroke so a pathological stored payload can't lock up render.
	const MAX_STAMPS_PER_STROKE = 2048;

	let PIXI = $state<PixiModule | null>(null);
	let manifest = $state<TerrainManifest | null>(null);
	let layer: PixiContainer | null = null;

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

	// Resolve a stroke's texture URL by mode. fill → terrain tile (specific key or
	// the category's representative tile); stamp → Objects/ sprite.
	function urlForStroke(s: StoredStroke): string | null {
		if (s.mode === 'stamp') return stampUrlForKey(manifest, s.textureKey);
		return tileUrlForKey(manifest, s.textureKey) ?? firstBaseTile(manifest, s.textureKey);
	}

	// Deterministic per-index jitter in [-0.5, 0.5] (mulberry-ish hash) so a
	// re-render places stamps identically — random would make them dance.
	function jitter01(seed: number): number {
		let t = (seed + 0x6d2b79f5) >>> 0;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) % 1000) / 1000 - 0.5;
	}

	// Walk a polyline, returning a point every `step` px (plus the first point).
	function pointsAlongPath(
		pts: Array<{ x: number; y: number }>,
		stepPx: number
	): Array<{ x: number; y: number }> {
		if (pts.length === 0) return [];
		if (pts.length === 1 || stepPx <= 0) return [pts[0]];
		const out = [pts[0]];
		let carry = 0;
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i - 1];
			const b = pts[i];
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const segLen = Math.hypot(dx, dy);
			if (segLen === 0) continue;
			let dist = stepPx - carry;
			while (dist <= segLen) {
				out.push({ x: a.x + (dx * dist) / segLen, y: a.y + (dy * dist) / segLen });
				dist += stepPx;
			}
			carry = segLen - (dist - stepPx);
		}
		return out;
	}

	function buildStroke(
		s: StoredStroke,
		texMap: Record<string, unknown>,
		width: number,
		height: number,
		strokeIndex: number
	): PixiContainer | null {
		if (!PIXI) return null;
		const url = urlForStroke(s);
		const tex = url ? (texMap[url] as PixiTexture | undefined) : undefined;
		if (!tex) return null; // unknown/unloaded texture → skip (lazy GC)

		const extent = Math.min(width, height);
		const path = s.path.map((p) => ({ x: p.x * width, y: p.y * height }));
		const group = new PIXI.Container();

		if (s.mode === 'fill') {
			const widthPx = Math.max(1, s.brushSize * extent);
			// Stroke the path WITH the tile texture (Pixi v8 fill/stroke styles
			// accept a texture). This renders the tile along the stroke shape
			// directly — the matching codebase pattern is Graphics.stroke/fill,
			// not masking (which is unused here and silently clipped to nothing
			// in the first cut). softness feathers the edge via a BlurFilter on
			// the whole graphics (a proven filter target, unlike a mask).
			const g = new PIXI.Graphics();
			g.moveTo(path[0].x, path[0].y);
			if (path.length === 1) g.lineTo(path[0].x + 0.01, path[0].y);
			else for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
			g.stroke({ width: widthPx, texture: tex, cap: 'round', join: 'round' });
			if (s.softness > 0) {
				g.filters = [new PIXI.BlurFilter({ strength: s.softness * widthPx * 0.25 })];
			}
			group.addChild(g);
		} else {
			// Stamp: scatter the sprite along the path.
			const sizePx = Math.max(2, s.brushSize * extent);
			const spacingPx = Math.max(1, (s.stamp?.spacing ?? s.brushSize) * extent);
			const jitterPx = (s.stamp?.jitter ?? 0) * extent;
			const allPlacements = pointsAlongPath(path, spacingPx);
			const placements =
				allPlacements.length > MAX_STAMPS_PER_STROKE
					? allPlacements.slice(0, MAX_STAMPS_PER_STROKE)
					: allPlacements;
			placements.forEach((pt, i) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const sprite = new PIXI!.Sprite(tex as any);
				sprite.anchor.set(0.5, 0.5);
				sprite.width = sizePx;
				sprite.height = sizePx;
				const seed = strokeIndex * 4096 + i;
				sprite.x = pt.x + jitter01(seed) * jitterPx;
				sprite.y = pt.y + jitter01(seed + 1) * jitterPx;
				group.addChild(sprite);
			});
		}
		return group;
	}

	$effect(() => {
		const viewport = stageCtx.viewport;
		// Reference reactive deps up front.
		const ss = strokes;
		const map = activeMap;
		if (!PIXI || !viewport || !manifest || !map?.width || !map?.height) {
			if (layer) layer.removeChildren().forEach((c) => c.destroy());
			return;
		}

		if (!layer) {
			layer = new PIXI.Container();
			layer.zIndex = MAP_LAYER_Z.art;
			viewport.addChild(layer);
		}

		const width = map.width;
		const height = map.height;

		// Collect texture urls, load (idempotent + cached), then rebuild.
		const urls = new Set<string>();
		for (const s of ss) {
			const u = urlForStroke(s);
			if (u) urls.add(u);
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
			ss.forEach((s, i) => {
				const g = buildStroke(s, texMap, width, height, i);
				if (g) layer!.addChild(g);
			});
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
