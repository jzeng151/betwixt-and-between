<script lang="ts">
	// WM3 Slice A — freeform brush render layer.
	// WM3 Slice B — layered canvas: strokes route into per-layer groups
	// (world_maps.art_layers_jsonb order; base group at the bottom for
	// layerId-less / orphaned strokes), each carrying the layer's blendMode +
	// opacity + per-user visibility pref (`art:<id>` / static 'art' for base).
	// WM3 Slice C — each group renders into its own RenderTexture (eng-review
	// #6 direction): erase strokes ('erase' blend) clip WITHIN their layer's
	// texture — the freeform layer-mask — and can never eat the background or
	// other layers. The RT also removes per-frame filter cost: strokes render
	// once per rebuild, the displayed Sprite is static between rebuilds.
	//
	// Renders RenderedState.strokes (paint_stroke fold output) over the
	// background bitmap, in painter's order. Three modes (spike findings):
	//   • fill  — the resolved terrain tile stroked along the path (Pixi v8
	//             texture stroke), feathered alpha edge via BlurFilter scaled by
	//             `softness`. Default composite is source-over (NOT multiply —
	//             re-spike: multiply muddies real tiles).
	//   • stamp — the resolved Objects/ sprite scattered along the path at
	//             `spacing` intervals with deterministic `jitter`. Slice C: a
	//             FAMILY textureKey ("tree_object") scatters varied members with
	//             deterministic size variation — painterly, not repeated.
	//   • erase — a round-capped 'erase'-blend pass that removes art beneath it
	//             within the SAME layer (Slice C mask mechanism).
	//
	// Coords: paint_stroke.path is normalized [0,1] of the map extent (same
	// convention as placements). brushSize/spacing/jitter are normalized to
	// min(width,height). Grid-independent — unlike PixiTerrainTileLayer this layer
	// works on hex maps too (freeform doesn't snap to cells).
	//
	// Perf: rebuilds the RenderTextures on strokes/defs/prefs change. Stroke
	// count is bounded by the auto-anchor bake (AUTO_ANCHOR_K); RT size is
	// capped at RT_MAX on the long side so a huge base image can't allocate an
	// unbounded texture (strokes are vectors — they scale cleanly).

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, MAP_LAYER_Z, type PixiStageContext } from './pixi-context.js';
	import {
		loadTerrainManifest,
		tileUrlForKey,
		firstBaseTile,
		stampsForKey,
		type TerrainManifest
	} from './terrain-tilesets.js';
	import { layerPrefs } from './layer-prefs-store.js';
	import { artLayerPrefKey } from './layers.js';
	import type { MapArtLayer, StoredStroke } from './projection.js';
	import type { WorldMap } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiTexture = import('pixi.js').Texture;
	type PixiRenderTexture = import('pixi.js').RenderTexture;
	type PixiSprite = import('pixi.js').Sprite;

	let {
		activeMap,
		strokes,
		playheadT = null,
		reducedMotion = false
	}: {
		activeMap: WorldMap | null;
		strokes: StoredStroke[];
		// Slice D2 — the current playhead. A stroke-set change WITH a playhead
		// move is a terrain BEAT (forest→ash crossing its T) and dissolves;
		// a change at a constant playhead is authoring (paint/undo) and snaps.
		playheadT?: number | null;
		// prefers-reduced-motion → jump-cut (matches the FX layer convention).
		reducedMotion?: boolean;
	} = $props();

	// Slice D2 diag counter (mirrors PixiPunctuationLayer's __spotlight*Count):
	// bumps once per terrain-transition dissolve so the E2E can assert the FX
	// fired without sampling mid-fade pixels.
	const DIAG =
		typeof window !== 'undefined' &&
		(window as unknown as { __SPOTLIGHT_DIAG__?: boolean }).__SPOTLIGHT_DIAG__ === true;
	function bumpTransitionDiag(): void {
		if (!DIAG) return;
		const w = window as unknown as { __artTransitionCount?: number };
		w.__artTransitionCount = (w.__artTransitionCount ?? 0) + 1;
	}

	// Slice B — ordered art-layer defs ride the world_maps row. Array order is
	// render order (index 0 bottom); strokes without a (known) layerId render in
	// the implicit base group beneath all defined layers.
	let artLayers = $derived<MapArtLayer[]>(activeMap?.artLayersJsonb ?? []);
	// Per-art-layer visibility (prefs key `art:<id>`). While prefs are loading,
	// hide (matches layerVisibility's loading contract for the static keys).
	function artLayerVisible(id: string): boolean {
		if ($layerPrefs.status === 'loading') return false;
		const v = $layerPrefs.prefs.get(artLayerPrefKey(id));
		return v === undefined ? true : v;
	}

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	// Render guard: the server validator accepts any stamp spacing > 0, and
	// spacingPx floors at 1px, so a long path with tiny spacing would scatter
	// thousands of sprites — built synchronously and rebuilt on every change.
	// Cap per stroke so a pathological stored payload can't lock up render.
	const MAX_STAMPS_PER_STROKE = 2048;
	// RenderTexture long-side cap (Slice C). Strokes are resolution-independent
	// vectors; the RT scale-down on a >2048px base image is visually negligible
	// at map zoom and bounds GPU memory per layer.
	const RT_MAX = 2048;

	let PIXI = $state<PixiModule | null>(null);
	let manifest = $state<TerrainManifest | null>(null);
	let layer: PixiContainer | null = null;
	// Sprites + RTs owned by the displayed build. A Slice D2 dissolve keeps the
	// OLD build alive while the new one fades in, then disposes it — so
	// ownership is per-build, not module-global.
	type ArtBuild = { sprites: PixiSprite[]; textures: PixiRenderTexture[] };
	let currentBuild: ArtBuild = { sprites: [], textures: [] };
	// Finish-now hook for an in-flight dissolve (unregisters the ticker fn,
	// snaps alphas to target, disposes the old build). Null when idle.
	let finishFade: (() => void) | null = null;
	// Rebuild-skip + transition-detection keys (set at build commit).
	let lastMapId: string | null = null;
	let lastStrokeKey: string | null = null;
	let lastViewKey: string | null = null;
	let lastPlayheadT: number | null = null;

	function disposeBuild(b: ArtBuild): void {
		for (const s of b.sprites) {
			try {
				layer?.removeChild(s);
				s.destroy();
			} catch (_) {
				/* renderer torn down first */
			}
		}
		for (const rt of b.textures) {
			try {
				rt.destroy(true);
			} catch (_) {
				/* renderer torn down first */
			}
		}
		b.sprites = [];
		b.textures = [];
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

	// Texture URLs a stroke needs loaded. fill → one tile; stamp → every member
	// of the (possibly family) key; erase → none.
	function urlsForStroke(s: StoredStroke): string[] {
		if (s.mode === 'erase' || s.textureKey === undefined) return [];
		if (s.mode === 'stamp') return stampsForKey(manifest, s.textureKey).map((m) => m.url);
		const u = tileUrlForKey(manifest, s.textureKey) ?? firstBaseTile(manifest, s.textureKey);
		return u ? [u] : [];
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

	// Round-capped path Graphics shared by fill (texture stroke) and erase
	// (white stroke + 'erase' blend) — the path geometry is identical.
	function pathGraphics(
		path: Array<{ x: number; y: number }>,
		widthPx: number,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		strokeStyle: any,
		softness: number
	): import('pixi.js').Graphics {
		const g = new PIXI!.Graphics();
		g.moveTo(path[0].x, path[0].y);
		if (path.length === 1) g.lineTo(path[0].x + 0.01, path[0].y);
		else for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
		g.stroke({ width: widthPx, cap: 'round', join: 'round', ...strokeStyle });
		if (softness > 0) {
			g.filters = [new PIXI!.BlurFilter({ strength: softness * widthPx * 0.25 })];
		}
		return g;
	}

	function buildStroke(
		s: StoredStroke,
		texMap: Record<string, unknown>,
		width: number,
		height: number,
		strokeIndex: number
	): PixiContainer | null {
		if (!PIXI) return null;
		const extent = Math.min(width, height);
		const path = s.path.map((p) => ({ x: p.x * width, y: p.y * height }));
		const group = new PIXI.Container();

		if (s.mode === 'erase') {
			// Slice C — erase within the layer's RenderTexture. The blend applies
			// during the RT pass, so it only removes THIS layer's art.
			const widthPx = Math.max(1, s.brushSize * extent);
			const g = pathGraphics(path, widthPx, { color: 0xffffff }, s.softness);
			g.blendMode = 'erase';
			group.addChild(g);
			return group;
		}

		if (s.mode === 'fill') {
			const url = s.textureKey
				? (tileUrlForKey(manifest, s.textureKey) ?? firstBaseTile(manifest, s.textureKey))
				: null;
			const tex = url ? (texMap[url] as PixiTexture | undefined) : undefined;
			if (!tex) return null; // unknown/unloaded texture → skip (lazy GC)
			const widthPx = Math.max(1, s.brushSize * extent);
			// Stroke the path WITH the tile texture (Pixi v8 fill/stroke styles
			// accept a texture). softness feathers the edge via a BlurFilter.
			// Default composite source-over (re-spike: multiply muddies real tiles).
			group.addChild(pathGraphics(path, widthPx, { texture: tex }, s.softness));
			return group;
		}

		// Stamp: scatter sprites along the path. A family key scatters varied
		// members with deterministic per-placement pick + size variation
		// (Slice C); an individual key keeps the uniform Slice A look.
		const members = s.textureKey ? stampsForKey(manifest, s.textureKey) : [];
		const textures = members
			.map((m) => texMap[m.url] as PixiTexture | undefined)
			.filter((t): t is PixiTexture => !!t);
		if (textures.length === 0) return null;
		const varied = textures.length > 1;
		const sizePx = Math.max(2, s.brushSize * extent);
		const spacingPx = Math.max(1, (s.stamp?.spacing ?? s.brushSize) * extent);
		const jitterPx = (s.stamp?.jitter ?? 0) * extent;
		const allPlacements = pointsAlongPath(path, spacingPx);
		const placements =
			allPlacements.length > MAX_STAMPS_PER_STROKE
				? allPlacements.slice(0, MAX_STAMPS_PER_STROKE)
				: allPlacements;
		placements.forEach((pt, i) => {
			const seed = strokeIndex * 4096 + i;
			const tex = varied
				? textures[Math.floor((jitter01(seed + 2) + 0.5) * textures.length) % textures.length]
				: textures[0];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const sprite = new PIXI!.Sprite(tex as any);
			sprite.anchor.set(0.5, 0.5);
			// ±20% deterministic size variation for family scatters.
			const sizeScale = varied ? 1 + jitter01(seed + 3) * 0.4 : 1;
			sprite.width = sizePx * sizeScale;
			sprite.height = sizePx * sizeScale;
			sprite.x = pt.x + jitter01(seed) * jitterPx;
			sprite.y = pt.y + jitter01(seed + 1) * jitterPx;
			group.addChild(sprite);
		});
		return group;
	}

	// Slice D2 — dissolve duration (seconds). Short enough that the existing
	// pixel-equality E2Es (which settle ≥600ms after a scrub) see the final
	// frame; long enough to read as a transition, not a flicker.
	const FADE_SECONDS = 0.45;

	$effect(() => {
		const viewport = stageCtx.viewport;
		const app = stageCtx.app;
		// Reference reactive deps up front.
		const ss = strokes;
		const map = activeMap;
		const defs = artLayers;
		const atT = playheadT;
		const noMotion = reducedMotion;
		// Snapshot per-layer view state so the effect re-runs on prefs/def edits.
		const layerView = defs.map((d) => ({
			id: d.id,
			blendMode: d.blendMode,
			opacity: d.opacity,
			visible: artLayerVisible(d.id)
		}));
		// Base (Slice A implicit layer) toggle — the static 'art' pref key.
		const baseVisible =
			$layerPrefs.status === 'loading' ? false : ($layerPrefs.prefs.get('art') ?? true);
		if (!PIXI || !viewport || !app || !manifest || !map?.width || !map?.height) {
			if (layer) {
				// finishFade disposes a mid-dissolve old build; disposeBuild the
				// displayed one. Every layer child is a build sprite, so this
				// clears the stage without a blanket removeChildren.
				finishFade?.();
				disposeBuild(currentBuild);
				lastMapId = null;
				lastStrokeKey = null;
				lastViewKey = null;
			}
			return;
		}

		const width = map.width;
		const height = map.height;

		// Rebuild-skip keys. projectState returns FRESH arrays every playhead
		// tick, so the strokes prop changes identity at frame rate during
		// playback — keying on content (not identity) is what keeps the RT
		// pipeline from re-rendering 60×/s. strokeKey captures what's painted;
		// viewKey captures how it's displayed.
		const strokeKey =
			map.id +
			'#' +
			ss
				.map(
					(s) =>
						`${s.mode}:${s.textureKey ?? ''}:${s.layerId ?? ''}:${s.path.length}:${s.path[0]?.x},${s.path[0]?.y}:${s.brushSize}:${s.softness}`
				)
				.join('|');
		const viewKey =
			layerView.map((v) => `${v.id}:${v.blendMode}:${v.opacity}:${v.visible}`).join('|') +
			`#base:${baseVisible}#${width}x${height}`;
		const strokesChanged = strokeKey !== lastStrokeKey;
		if (!strokesChanged && viewKey === lastViewKey) {
			lastPlayheadT = atT;
			return; // nothing visual changed — keep the displayed build
		}
		// A terrain BEAT: the stroke set changed because the playhead moved over
		// it (same map). Authoring (paint/undo at a constant T), map switches,
		// and pure view edits snap instead.
		const isBeat =
			strokesChanged &&
			lastStrokeKey !== null &&
			lastMapId === map.id &&
			atT !== null &&
			atT !== lastPlayheadT;

		if (!layer) {
			layer = new PIXI.Container();
			layer.zIndex = MAP_LAYER_Z.art;
			viewport.addChild(layer);
		}

		// Collect texture urls, load (idempotent + cached), then rebuild.
		const urls = new Set<string>();
		for (const s of ss) for (const u of urlsForStroke(s)) urls.add(u);

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
			// An in-flight dissolve finishes instantly before the next build.
			finishFade?.();
			const oldBuild = currentBuild;
			const newBuild: ArtBuild = { sprites: [], textures: [] };

			// Group strokes: base (layerId-less / orphaned) + one bucket per def.
			const knownIds = new Set(layerView.map((v) => v.id));
			const buckets = new Map<string | null, Array<{ s: StoredStroke; i: number }>>();
			ss.forEach((s, i) => {
				const key = s.layerId && knownIds.has(s.layerId) ? s.layerId : null;
				const b = buckets.get(key) ?? [];
				b.push({ s, i });
				buckets.set(key, b);
			});

			// RT scale: cap the long side so a huge base image can't allocate an
			// unbounded texture. Strokes are vectors — they render cleanly scaled.
			const rtScale = Math.min(1, RT_MAX / Math.max(width, height));
			const rtW = Math.max(1, Math.round(width * rtScale));
			const rtH = Math.max(1, Math.round(height * rtScale));

			// Render one bucket into a RenderTexture, displayed as a Sprite. The
			// 'erase' blend on erase strokes applies inside this pass — masking
			// stays scoped to the layer.
			const renderBucket = (
				entries: Array<{ s: StoredStroke; i: number }>
			): PixiSprite | null => {
				if (entries.length === 0) return null;
				const tmp = new PIXI!.Container();
				tmp.scale.set(rtScale);
				for (const { s, i } of entries) {
					const g = buildStroke(s, texMap, width, height, i);
					if (g) tmp.addChild(g);
				}
				if (tmp.children.length === 0) {
					tmp.destroy({ children: true });
					return null;
				}
				const rt = PIXI!.RenderTexture.create({ width: rtW, height: rtH });
				app.renderer.render({ container: tmp, target: rt, clear: true });
				tmp.destroy({ children: true });
				newBuild.textures.push(rt);
				const sprite = new PIXI!.Sprite(rt);
				sprite.scale.set(1 / rtScale);
				newBuild.sprites.push(sprite);
				return sprite;
			};

			// Base group first (bottom), then defs in array order. Sprite carries
			// the layer's blendMode/opacity/visibility.
			const baseSprite = renderBucket(buckets.get(null) ?? []);
			if (baseSprite) {
				baseSprite.visible = baseVisible;
				layer.addChild(baseSprite);
			}
			for (const v of layerView) {
				const sprite = renderBucket(buckets.get(v.id) ?? []);
				if (!sprite) continue;
				sprite.blendMode = v.blendMode;
				sprite.alpha = v.opacity;
				sprite.visible = v.visible;
				layer.addChild(sprite);
			}

			currentBuild = newBuild;
			lastMapId = map.id;
			lastStrokeKey = strokeKey;
			lastViewKey = viewKey;
			lastPlayheadT = atT;

			// Slice D2 — terrain-transition dissolve. Old build stays on stage
			// (beneath the new sprites) and crossfades out while the new fades
			// in, driven by the shared anim ticker. Reduced motion → jump-cut.
			const anim = stageCtx.anim;
			const hasArtChange = oldBuild.sprites.length > 0 || newBuild.sprites.length > 0;
			if (isBeat && hasArtChange && !noMotion && anim) {
				bumpTransitionDiag();
				const targets = newBuild.sprites.map((s) => s.alpha);
				newBuild.sprites.forEach((s) => (s.alpha = 0));
				const oldStarts = oldBuild.sprites.map((s) => s.alpha);
				const startT = anim.clock.time;
				let off: (() => void) | null = null;
				const finish = () => {
					off?.();
					off = null;
					finishFade = null;
					newBuild.sprites.forEach((s, i) => (s.alpha = targets[i]));
					disposeBuild(oldBuild);
				};
				finishFade = finish;
				off = anim.register((t) => {
					// Clock wrap (t < startT) → just complete the dissolve.
					const k = t < startT ? 1 : (t - startT) / FADE_SECONDS;
					if (k >= 1) {
						finish();
						return;
					}
					newBuild.sprites.forEach((s, i) => (s.alpha = targets[i] * k));
					oldBuild.sprites.forEach((s, i) => (s.alpha = oldStarts[i] * (1 - k)));
				});
			} else {
				disposeBuild(oldBuild);
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		finishFade?.();
		if (layer) {
			try {
				layer.destroy({ children: true });
			} catch (_) {
				/* parent app destroyed first */
			}
			layer = null;
		}
		disposeBuild(currentBuild);
	});
</script>
