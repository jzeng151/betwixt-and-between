<script lang="ts">
	// PixiStage — imperative Pixi.Application owner for Slice 1b PR 2.
	//
	// Earlier attempt used svelte-pixi's <Application> wrapper. Even with
	// the patch-package patches applied and our own pre-init/await pattern,
	// rapid renderer-flag toggles leaked WebGL contexts (~1-2 per cycle,
	// hits the browser's ~16-context cap after a dozen toggles). Root
	// cause: lifecycle is split between PixiStage (we new+init the app)
	// and svelte-pixi's <Renderer> child (it appends the canvas to DOM
	// and triggers destroy on unmount). The split creates ordering
	// scenarios where destroy() runs before the canvas is fully bound to
	// its WebGL context, and Pixi's destroy({context: true}) can't
	// release a context that wasn't fully created yet.
	//
	// Fix: skip svelte-pixi entirely at this layer. Own everything —
	// instance creation, init, canvas append, destroy. Single owner = no
	// race. Matches the spike's documented prescription
	// (docs/plans/world-map-v3-pre-slice-0-spike-findings.md § "Pixi-
	// controller.ts skeleton"): orchestrator-level imperative ownership,
	// svelte-pixi's declarative components reserved for leaf rendering
	// inside future layers (RegionLayer / MarkerLayer / EdgeLayer).
	//
	// Commit 4 (PixiRegionLayer) will either draw polygons via raw
	// PIXI.Graphics against `app.stage`, or re-introduce svelte-pixi
	// INSIDE this canvas's subtree where the lifecycle split is contained.

	import { onMount, setContext, type Snippet } from 'svelte';
	import type { WorldMap } from './types.js';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';

	type PixiApplication = import('pixi.js').Application;

	let {
		activeMap,
		children
	}: {
		activeMap: WorldMap | null;
		children?: Snippet;
	} = $props();

	let canvasContainer = $state<HTMLDivElement | null>(null);
	let loadError = $state<string | null>(null);
	let ready = $state(false);

	// Reactive context wrapper so descendants can read the live Application
	// and viewport via getContext(PIXI_STAGE_CONTEXT). $state-backed object:
	// PixiRegionLayer's $effect re-runs when `app` or `viewport` mutates.
	const stageCtx = $state<PixiStageContext>({ app: null, viewport: null });
	setContext(PIXI_STAGE_CONTEXT, stageCtx);

	onMount(() => {
		let cancelled = false;
		let app: PixiApplication | null = null;

		(async () => {
			try {
				const [PIXI, pvMod] = await Promise.all([
					import('pixi.js'),
					import('pixi-viewport')
				]);
				if (cancelled) return;

				const mapW = activeMap?.width ?? 1024;
				const mapH = activeMap?.height ?? 768;
				const newApp = new PIXI.Application();
				await newApp.init({
					width: mapW,
					height: mapH,
					background: 0x222222,
					antialias: true
				});

				if (cancelled) {
					// Unmounted mid-init — destroy immediately, no DOM append.
					try {
						newApp.destroy(true, {
							children: true,
							texture: true,
							textureSource: true,
							context: true
						});
					} catch (_) {
						/* context may have failed to initialize cleanly */
					}
					return;
				}

				app = newApp;
				if (canvasContainer) {
					canvasContainer.appendChild(app.canvas);
					// Slice 1b commit 6: PixiRegionLayer wires right-click ↔ custom
					// ContextMenu. Suppress the browser's native context menu over
					// the canvas so our menu is the only one users see.
					app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
				}

				// T13 parity (codex PR#57 iter3): pixi-viewport provides
				// wheel-zoom, drag-pan, and pinch. Mount once per app; all
				// other layers addChild to this viewport (via stageCtx) so
				// they pan/zoom together with the bitmap.
				const viewport = new pvMod.Viewport({
					screenWidth: mapW,
					screenHeight: mapH,
					worldWidth: mapW,
					worldHeight: mapH,
					events: newApp.renderer.events
				});
				viewport.drag().pinch().wheel().clampZoom({ minScale: 0.25, maxScale: 8 });
				newApp.stage.addChild(viewport);

				stageCtx.app = newApp;
				stageCtx.viewport = viewport;
				ready = true;
			} catch (err) {
				if (cancelled) return;
				loadError = err instanceof Error ? err.message : String(err);
			}
		})();

		return () => {
			cancelled = true;
			stageCtx.app = null;
			stageCtx.viewport = null;
			if (app) {
				try {
					app.destroy(true, {
						children: true,
						texture: true,
						textureSource: true,
						context: true
					});
				} catch (_) {
					/* destroy on a partially-torn-down app may throw */
				}
				app = null;
			}
		};
	});

	// Codex P2 on PR #55: PixiStage stays mounted across the toolbar map
	// switcher, so the canvas dimensions need to follow activeMap. Without
	// this, switching to a map with different width/height leaves the
	// renderer sized for the previous map and polygon coordinates land at
	// the wrong screen positions. Skip the resize when activeMap is null
	// or hasn't been initialized yet (init in onMount already used the
	// then-current dimensions).
	$effect(() => {
		const app = stageCtx.app;
		const viewport = stageCtx.viewport;
		if (!app || !activeMap?.width || !activeMap?.height) return;
		const w = activeMap.width;
		const h = activeMap.height;
		if (app.renderer.width !== w || app.renderer.height !== h) {
			app.renderer.resize(w, h);
		}
		// Keep the viewport's screen + world dimensions in sync with the
		// active map so wheel zoom + pan bounds reference the new image.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const vp = viewport as any;
		if (vp) {
			vp.screenWidth = w;
			vp.screenHeight = h;
			vp.worldWidth = w;
			vp.worldHeight = h;
			// Reset transform so we're not stuck mid-zoom on the previous map.
			vp.setZoom?.(1, true);
			vp.moveCenter?.(w / 2, h / 2);
		}
	});

	// A4 HMR fallback — `import.meta.hot.invalidate()` doesn't escalate to
	// a full page reload in this app's HMR graph (an ancestor accepts the
	// update). Force an explicit reload so editing this file doesn't
	// silently accumulate orphan WebGL contexts. Stripped from prod.
	if (import.meta.hot) {
		import.meta.hot.accept(() => {
			window.location.reload();
		});
	}
</script>

<div class="pixi-stage" bind:this={canvasContainer}>
	{#if loadError}
		<div class="pixi-error" role="alert">
			<p class="pixi-error-title">Pixi failed to load</p>
			<p class="pixi-error-msg">{loadError}</p>
		</div>
	{:else if !ready}
		<div class="pixi-loading">
			<p>Loading Pixi renderer…</p>
		</div>
	{:else}
		{@render children?.()}
	{/if}
</div>

<style>
	.pixi-stage {
		flex: 1;
		width: 100%;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface);
		overflow: hidden;
	}
	.pixi-stage :global(canvas) {
		display: block;
		max-width: 100%;
		max-height: 100%;
	}
	.pixi-loading,
	.pixi-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		color: var(--color-text-muted);
		font-size: 13px;
	}
	.pixi-error-title {
		margin: 0;
		color: var(--color-rel-rival, #ef4444);
		font-weight: 600;
	}
	.pixi-error-msg {
		margin: 0;
		font-size: 12px;
		max-width: 360px;
		text-align: center;
	}
</style>
