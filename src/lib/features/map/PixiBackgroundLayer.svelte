<script lang="ts">
	// T13 parity: Pixi-side equivalent of Leaflet's `L.imageOverlay`. The
	// deleted MapStage.svelte was the only consumer of `activeMap.baseImageUrl`;
	// once T13 removed Leaflet, Pixi rendered a gray canvas because no layer
	// painted the imported bitmap. This component loads the image via
	// PIXI.Assets and renders it as a Sprite anchored at (0, 0) sized to
	// (activeMap.width, activeMap.height). It's inserted at index 0 of the
	// stage so all other layers (regions, placements, polygon-draw) render
	// on top.
	//
	// Dynamic import keeps pixi.js out of the Cloudflare Worker SSR bundle —
	// see PixiRegionLayer.svelte's matching pattern.

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, MAP_LAYER_Z, type PixiStageContext } from './pixi-context.js';
	import { layerVisibility } from './layer-prefs-store.js';
	import type { WorldMap } from './types.js';

	// Slice 3 E4 — per-user-per-map layer visibility. Toggled off ⇒ the
	// layer's Pixi Container has .visible = false so the sprite stays
	// instantiated but doesn't paint. Cheap to flip back on.
	const visible = layerVisibility('background');

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiSprite = import('pixi.js').Sprite;
	type PixiTexture = import('pixi.js').Texture;

	let {
		activeMap
	}: {
		activeMap: WorldMap | null;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;
	let sprite: PixiSprite | null = null;
	let loadedTexture: PixiTexture | null = null;
	let loadedUrl: string | null = null;

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
		const app = stageCtx.app;
		const viewport = stageCtx.viewport;
		if (!app || !PIXI || !viewport) return;

		// Lazy-create the layer and ensure it sits at the bottom of the
		// viewport (so regions / placements / polygon-draw render on top).
		if (!layer) {
			layer = new PIXI.Container();
			layer.zIndex = MAP_LAYER_Z.background; // bottom of the stack
			viewport.addChild(layer);
		}
		// Slice 3 E4 — apply user visibility toggle.
		layer.visible = $visible;

		const url = activeMap?.baseImageUrl ?? null;
		const w = activeMap?.width ?? null;
		const h = activeMap?.height ?? null;

		// No image or no dimensions → tear down any existing sprite and stop.
		if (!url || !w || !h) {
			if (sprite) {
				try {
					sprite.destroy();
				} catch (_) {
					/* sprite or texture may have been destroyed */
				}
				sprite = null;
			}
			loadedUrl = null;
			return;
		}

		// Same image as last render → just resize the sprite if dimensions changed.
		if (sprite && loadedUrl === url) {
			sprite.width = w;
			sprite.height = h;
			return;
		}

		// New image: tear down the prior sprite (if any) and load the new texture.
		if (sprite) {
			try {
				sprite.destroy();
			} catch (_) {
				/* ignore */
			}
			sprite = null;
		}

		const targetUrl = url;
		let mounted = true;
		void (async () => {
			try {
				const texture = await PIXI!.Assets.load<PixiTexture>(targetUrl);
				// Bail if the activeMap changed (or layer was torn down) while
				// the texture was loading. Stale-load defense — without this,
				// switching maps mid-load could paint the wrong image.
				if (!mounted) return;
				if (!layer) return;
				if (activeMap?.baseImageUrl !== targetUrl) return;
				const s = new PIXI!.Sprite(texture);
				s.x = 0;
				s.y = 0;
				s.width = activeMap.width ?? w;
				s.height = activeMap.height ?? h;
				layer.addChild(s);
				sprite = s;
				loadedTexture = texture;
				loadedUrl = targetUrl;
			} catch (_) {
				// Image failed to load (network error, 404, CORS). Leave the
				// gray canvas in place — better than crashing. The user's
				// upload UX surfaces the URL separately.
			}
		})();

		return () => {
			mounted = false;
		};
	});

	onDestroy(() => {
		if (sprite) {
			try {
				sprite.destroy();
			} catch (_) {
				/* ignore */
			}
			sprite = null;
		}
		// Texture is owned by PIXI.Assets cache; leave it for reuse on remount.
		loadedTexture = null;
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
