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
	import { pointsAlongPath } from './stroke-geometry.js';
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
		reducedMotion = false,
		onReady
	}: {
		activeMap: WorldMap | null;
		strokes: StoredStroke[];
		// Slice D2 — the current playhead. A stroke-set change WITH a playhead
		// move is a terrain BEAT (forest→ash crossing its T) and dissolves;
		// a change at a constant playhead is authoring (paint/undo) and snaps.
		playheadT?: number | null;
		// prefers-reduced-motion → jump-cut (matches the FX layer convention).
		reducedMotion?: boolean;
		onReady?: (mapId: string) => void;
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
	// Slice D2 dissolve keeps the OLD build's RTs alive while the new one fades
	// in, so a fully-layered map (base + up to MAX_ART_LAYERS) momentarily holds
	// ~2× the RTs (~16 MiB each at RT_MAX²×4). Above this combined count, SNAP
	// the transition instead of crossfading — a jump-cut is far better than a
	// WebGL context loss / OOM crash on a memory-constrained device.
	const RT_DISSOLVE_BUDGET = 12;

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
	// Identity of the strokes array at the last build. The baked-fold memo (F11)
	// returns a referentially STABLE strokes array across a constant-window
	// playhead scrub, so an identity match lets us skip the O(points) strokeKey
	// digest entirely on the hot per-tick path.
	let lastStrokesRef: ReadonlyArray<StoredStroke> | null = null;

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

	// Pixi v8 Container.destroy({children:true}) destroys child display objects
	// but NOT filters attached via `.filters`. pathGraphics() assigns a fresh
	// BlurFilter per soft (softness>0) stroke; that filter holds GPU uniform bind
	// groups and composes two BlurFilterPass sub-filters its own destroy() does
	// not cascade to. The transient render container is discarded on every
	// rebuild (renderBucket), which fires at terrain-beat rate during playback,
	// so without explicit teardown soft-brush rebuilds orphan filter GPU
	// resources. destroy() with no args never touches the shared shader program
	// (Pixi Shader.destroy defaults destroyPrograms=false) — it frees only this
	// instance's bind groups. (F13's deferred BlurFilter pooling supersedes this.)
	function destroyStrokeFilters(node: PixiContainer): void {
		const f = node.filters;
		if (f) {
			const arr = Array.isArray(f) ? f : [f];
			for (const filter of arr) {
				const blur = filter as {
					blurXFilter?: { destroy(): void };
					blurYFilter?: { destroy(): void };
					destroy?: () => void;
				};
				try {
					blur.blurXFilter?.destroy();
					blur.blurYFilter?.destroy();
					blur.destroy?.();
				} catch (_) {
					/* already torn down */
				}
			}
			node.filters = null;
		}
		for (const child of node.children) destroyStrokeFilters(child as PixiContainer);
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

	// codex P2: a stable per-stroke scatter seed derived from the stroke's
	// CONTENT (texture key + path), not its position in the projected array.
	// Seeding off the array index made inserting/removing an earlier stroke (a
	// retroactive terrain beat) reshuffle the member/size/jitter of every later
	// stamp stroke. Content hashing keeps each stroke's scatter fixed regardless
	// of what else was authored before it. Masked to 19 bits so seed*4096 + i (i
	// < MAX_STAMPS_PER_STROKE) stays < 2^32 — jitter01 coerces to uint32, so
	// per-placement seed blocks must not wrap into another stroke's block.
	function strokeScatterSeed(s: StoredStroke): number {
		let h = 0;
		const key = s.textureKey ?? '';
		for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
		for (const pt of s.path) {
			h = (Math.imul(h, 31) + ((pt.x * 4096) | 0)) | 0;
			h = (Math.imul(h, 31) + ((pt.y * 4096) | 0)) | 0;
		}
		return (h >>> 0) & 0x7ffff;
	}

	// Deterministic per-index jitter in [-0.5, 0.5] (mulberry-ish hash) so a
	// re-render places stamps identically — random would make them dance.
	function jitter01(seed: number): number {
		let t = (seed + 0x6d2b79f5) >>> 0;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) % 1000) / 1000 - 0.5;
	}

	// Round-capped path Graphics shared by fill (texture stroke) and erase
	// (white stroke + 'erase' blend) — the path geometry is identical.
	function pathGraphics(
		path: Array<{ x: number; y: number }>,
		widthPx: number,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		strokeStyle: any,
		softness: number,
		blendMode: 'normal' | 'erase' = 'normal'
	): import('pixi.js').Graphics {
		const g = new PIXI!.Graphics();
		g.moveTo(path[0].x, path[0].y);
		if (path.length === 1) g.lineTo(path[0].x + 0.01, path[0].y);
		else for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
		g.stroke({ width: widthPx, cap: 'round', join: 'round', ...strokeStyle });
		// F9: a filtered object composites with the FILTER's blend mode, not the
		// object's (Pixi v8). So a soft erase (softness > 0 → BlurFilter) silently
		// ignored g.blendMode='erase' and composited 'normal' — a white smear
		// instead of an erase. Set the blend on BOTH: g.blendMode covers the
		// hard-edged (no-filter) case, the filter's blendMode covers the soft case.
		g.blendMode = blendMode;
		if (softness > 0) {
			g.filters = [new PIXI!.BlurFilter({ strength: softness * widthPx * 0.25, blendMode })];
		}
		return g;
	}

	function buildStroke(
		s: StoredStroke,
		texMap: Record<string, unknown>,
		width: number,
		height: number
	): PixiContainer | null {
		if (!PIXI) return null;
		const extent = Math.min(width, height);
		const path = s.path.map((p) => ({ x: p.x * width, y: p.y * height }));
		const group = new PIXI.Container();

		if (s.mode === 'erase') {
			// Slice C — erase within the layer's RenderTexture. The blend applies
			// during the RT pass, so it only removes THIS layer's art.
			const widthPx = Math.max(1, s.brushSize * extent);
			const g = pathGraphics(path, widthPx, { color: 0xffffff }, s.softness, 'erase');
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
		// Cap is enforced INSIDE pointsAlongPath (it stops emitting at the cap)
		// so a tiny-spacing payload can't materialize millions of placements
		// before the bound applies.
		const placements = pointsAlongPath(path, spacingPx, MAX_STAMPS_PER_STROKE);
		const strokeSeedBase = strokeScatterSeed(s);
		placements.forEach((pt, i) => {
			// F35: 4096 must stay > MAX_STAMPS_PER_STROKE so per-stroke seed ranges
			// (strokeSeedBase*4096 .. +i) never overlap between distinct strokes —
			// otherwise two strokes would share jitter/member-pick seeds. Don't lower
			// it below the cap; changing it reshuffles the deterministic scatter.
			const seed = strokeSeedBase * 4096 + i;
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
				lastStrokesRef = null;
			}
			return;
		}

		const width = map.width;
		const height = map.height;

		// Rebuild-skip keys. viewKey captures how the art is displayed; strokeKey
		// captures what's painted. viewKey is cheap (a handful of layer fields),
		// so compute it first and use it in the identity fast-path below.
		const viewKey =
			layerView.map((v) => `${v.id}:${v.blendMode}:${v.opacity}:${v.visible}`).join('|') +
			`#base:${baseVisible}#${width}x${height}`;

		// Identity fast-path (perf). The baked-fold memo (F11) returns a
		// referentially STABLE strokes array across a constant-window playhead
		// scrub — only t changes, the applicable-event set doesn't — so the same
		// array reuse here means nothing painted changed. Skip the O(points)
		// strokeKey digest entirely on this hot per-tick path. The content-keyed
		// check below still runs when identity differs (e.g. a genuinely fresh
		// array with identical content), preserving F8 collision-safety.
		if (ss === lastStrokesRef && viewKey === lastViewKey) {
			lastPlayheadT = atT;
			onReady?.(map.id);
			return; // nothing visual changed — keep the displayed build
		}

		const strokeKey =
			map.id +
			'#' +
			ss
				.map((s) => {
					// F8: the key must change whenever anything the renderer consumes
					// changes, or a rebuild is skipped and stale art shows. The old
					// key omitted stamp.spacing/jitter and every path point after the
					// first, so two distinct strokes agreeing on mode/material/layer/
					// length/first-point collided (e.g. undo+repaint a stamp with new
					// spacing, or scrubbing across an anchor that swaps stroke sets).
					// Add the stamp params, the last point, and a cheap whole-path
					// coordinate digest — O(points) arithmetic, far cheaper than the
					// GPU rebuild it gates.
					const p0 = s.path[0];
					const pN = s.path[s.path.length - 1];
					// codex P2: the rebuild cache key must change whenever the path
					// changes. A linear reduction (Σ(x+y), or any weighted axis sum)
					// collides — Σ(x+y) on [(.2,.2),(.8,.8)] vs [(.2,.8),(.8,.2)], and
					// 2x+3y on [(.2,.2),(.8,.8)] vs [(.5,.5),(.6,.6)]. Use an order- and
					// axis-sensitive polynomial rolling hash over every quantized
					// coordinate (×4096 grid; multiplier 31, Math.imul 32-bit wrap)
					// instead — distinct ordered paths digest distinctly, so scrubbing
					// between stroke sets can't hit the early-return on stale art.
					let digest = 0;
					for (let pi = 0; pi < s.path.length; pi++) {
						const pt = s.path[pi];
						digest = (Math.imul(digest, 31) + ((pt.x * 4096) | 0)) | 0;
						digest = (Math.imul(digest, 31) + ((pt.y * 4096) | 0)) | 0;
					}
					return `${s.mode}:${s.textureKey ?? ''}:${s.layerId ?? ''}:${s.path.length}:${p0?.x},${p0?.y}:${pN?.x},${pN?.y}:${s.brushSize}:${s.softness}:${s.stamp?.spacing ?? ''}:${s.stamp?.jitter ?? ''}:${digest}`;
				})
				.join('|');
		const strokesChanged = strokeKey !== lastStrokeKey;
		if (!strokesChanged && viewKey === lastViewKey) {
			lastPlayheadT = atT;
			lastStrokesRef = ss; // refresh identity so the next tick takes the fast-path
			onReady?.(map.id);
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

		// codex P2: on a genuine map SWITCH, wipe the previous map's art
		// synchronously — before the async texture load below. Otherwise the old
		// strokes stay attached to the shared viewport and remain visibly overlaid
		// on the new background until every new texture resolves (indefinitely if a
		// new asset 404s/stalls). A same-map rebuild keeps the old build for the
		// Slice D2 crossfade; only a real map change clears immediately (isBeat is
		// already false here since it requires lastMapId === map.id).
		if (lastMapId !== null && lastMapId !== map.id) {
			finishFade?.();
			disposeBuild(currentBuild);
		}

		if (!layer) {
			layer = new PIXI.Container();
			layer.zIndex = MAP_LAYER_Z.art;
			viewport.addChild(layer);
		}

		// Collect texture urls, load (idempotent + cached), then rebuild.
		const urls = new Set<string>();
		for (const s of ss) for (const u of urlsForStroke(s)) urls.add(u);

		let cancelled = false;
		const targetMapId = map.id;
		(async () => {
			// Load per-URL (allSettled), NOT Assets.load([...urls]) as one batch:
			// the batch promise is all-or-nothing, so a single 404'd sprite would
			// reject the whole load and blank EVERY stroke this frame. Per-URL,
			// only the missing texture's strokes skip (buildStroke returns null on
			// a missing tex) — the rest render. Pixi's Assets cache dedups + caches
			// failures, so a permanent 404 doesn't re-hit the network on rebuild.
			const texMap: Record<string, unknown> = {};
			if (urls.size > 0) {
				const urlList = [...urls];
				const results = await Promise.allSettled(
					urlList.map((u) => PIXI!.Assets.load(u))
				);
				results.forEach((r, i) => {
					if (r.status === 'fulfilled') texMap[urlList[i]] = r.value;
				});
			}
			if (cancelled || !layer) return;
			// An in-flight dissolve finishes instantly before the next build.
			finishFade?.();
			const oldBuild = currentBuild;
			const newBuild: ArtBuild = { sprites: [], textures: [] };

			// Group strokes: base (layerId-less / orphaned) + one bucket per def.
			// TODO(F13 perf): this rebuilds EVERY bucket's RenderTexture on any
			// stroke/view change — a new stroke re-renders the whole painting.
			// The high-value optimizations (rebuild only the bucket whose strokes
			// changed; append a single new stroke with render({clear:false});
			// pool BlurFilters by quantized strength) are deferred — they have to
			// coexist with the Slice D2 dissolve (which crossfades whole builds)
			// and with F5 re-bucketing when a layer is deleted, so they are a
			// real refactor of this path, not a local tweak. The transient-RT
			// budget guard below caps the worst-case memory in the meantime.
			const knownIds = new Set(layerView.map((v) => v.id));
			const buckets = new Map<string | null, StoredStroke[]>();
			ss.forEach((s) => {
				const orphaned = s.layerId != null && !knownIds.has(s.layerId);
				// F5: a fill/stamp stroke whose layer was deleted falls back to the
				// base group (art preserved, only the grouping is lost — the lazy-GC
				// posture). But an ERASE stroke carries an 'erase' blend; re-homing
				// it to base would erase BASE art it never targeted (deterministic
				// corruption: paint erase on layer L, delete L). Drop orphaned erase
				// strokes instead of re-homing them — an eraser with no surviving
				// layer to mask is a no-op, not a base-layer eraser.
				if (orphaned && s.mode === 'erase') return;
				const key = orphaned ? null : (s.layerId ?? null);
				const b = buckets.get(key) ?? [];
				b.push(s);
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
			const renderBucket = (entries: StoredStroke[]): PixiSprite | null => {
				if (entries.length === 0) return null;
				const tmp = new PIXI!.Container();
				tmp.scale.set(rtScale);
				for (const s of entries) {
					const g = buildStroke(s, texMap, width, height);
					if (g) tmp.addChild(g);
				}
				if (tmp.children.length === 0) {
					tmp.destroy({ children: true });
					return null;
				}
				const rt = PIXI!.RenderTexture.create({ width: rtW, height: rtH });
				app.renderer.render({ container: tmp, target: rt, clear: true });
				destroyStrokeFilters(tmp); // release BlurFilter GPU resources first
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
			lastStrokesRef = ss;

			// Slice D2 — terrain-transition dissolve. Old build stays on stage
			// (beneath the new sprites) and crossfades out while the new fades
			// in, driven by the shared anim ticker. Reduced motion → jump-cut.
			const anim = stageCtx.anim;
			const hasArtChange = oldBuild.sprites.length > 0 || newBuild.sprites.length > 0;
			// Bound transient GPU memory: a crossfade holds both builds' RTs at
			// once. Above the budget, snap (dispose old now) rather than risk OOM.
			const withinRtBudget =
				oldBuild.textures.length + newBuild.textures.length <= RT_DISSOLVE_BUDGET;
			if (isBeat && hasArtChange && !noMotion && anim && withinRtBudget) {
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
			onReady?.(targetMapId);
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
