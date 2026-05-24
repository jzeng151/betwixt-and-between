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

	import { onMount } from 'svelte';
	import type { WorldMap } from './types.js';

	type PixiApplication = import('pixi.js').Application;

	let { activeMap }: { activeMap: WorldMap | null } = $props();

	let canvasContainer = $state<HTMLDivElement | null>(null);
	let loadError = $state<string | null>(null);
	let ready = $state(false);

	onMount(() => {
		let cancelled = false;
		let app: PixiApplication | null = null;

		(async () => {
			try {
				const PIXI = await import('pixi.js');
				if (cancelled) return;

				const newApp = new PIXI.Application();
				await newApp.init({
					width: activeMap?.width ?? 1024,
					height: activeMap?.height ?? 768,
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
				}
				ready = true;
			} catch (err) {
				if (cancelled) return;
				loadError = err instanceof Error ? err.message : String(err);
			}
		})();

		return () => {
			cancelled = true;
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
