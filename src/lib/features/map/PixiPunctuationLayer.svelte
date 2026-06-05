<script lang="ts">
	// Cinematic Spotlight (Slice 8) — punctuation FX overlay (PR1: conquest flash).
	//
	// Renders the frame-diff punctuation beats (punctuation-diff.ts) as decaying
	// additive Graphics over the map. PR1 ships the CONQUEST FLASH: when a region's
	// owner flips, its polygon flashes white-additive and fades over ~300ms. March
	// trail + causal ripple land in PR2 on the same layer + lifecycle.
	//
	// Imperative by design (the PR0 invariant): WorldMap calls `spawnConquest()`
	// when the playback controller emits beats; each FX is a plain Graphics whose
	// alpha is eased down in the shared anim-controller tick — never $state. FX are
	// destroyed on decay-complete, map switch, replay/interrupt (clearAll), and
	// teardown, and are scoped to the active mapId.
	//
	// pixi.js is dynamic-imported in onMount so this component's static module load
	// doesn't pull pixi into the Cloudflare Worker SSR bundle (same discipline as
	// the other Pixi layers).

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import type { MapRegion } from './types.js';
	import type { ConquestFlip } from './punctuation-diff.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;

	let {
		regions,
		mapId,
		reducedMotion = false
	}: {
		regions: MapRegion[];
		mapId: string | null;
		// prefers-reduced-motion: jump-cut. The owner change is still visible via
		// the region tint (which snaps under reduced motion); the flashing FX is
		// suppressed so there's no motion to trigger on.
		reducedMotion?: boolean;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	const FLASH_MS = 300; // decay duration per flash (design ~300ms)
	const FLASH_PEAK = 0.85; // starting additive alpha
	// Opt-in diagnostic (same gate as PixiRegionLayer): in the preview/E2E build
	// only when window.__SPOTLIGHT_DIAG__ is set, so the ship-gate spec can assert
	// a flash actually fired under playback. Prod stays clean.
	const DIAG =
		import.meta.env.DEV ||
		(typeof window !== 'undefined' &&
			(window as unknown as { __SPOTLIGHT_DIAG__?: boolean }).__SPOTLIGHT_DIAG__ === true);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;

	// Active flashes. Plain array (not $state) — advanced imperatively in the
	// ticker. delayMs implements the simultaneous-flip stagger.
	type Flash = { g: PixiGraphics; ageMs: number; delayMs: number };
	let flashes: Flash[] = [];

	function regionPolyById(id: string): MapRegion | undefined {
		return regions.find((r) => r.id === id);
	}

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

	// Create the overlay container once the app + viewport + pixi are ready, and
	// register the decay ticker on the SHARED anim-controller (single-ticker
	// invariant). Each frame ages every flash, eases its alpha down, and destroys
	// it on completion.
	$effect(() => {
		const app = stageCtx.app;
		const anim = stageCtx.anim;
		const viewport = stageCtx.viewport;
		if (!app || !PIXI || !anim || !viewport) return;

		if (!layer) {
			layer = new PIXI.Container();
			// Non-interactive: FX must never steal a hit-test from regions/markers.
			layer.eventMode = 'none';
			viewport.addChild(layer);
		}

		const off = anim.register(() => {
			if (!flashes.length) return;
			const dt = app.ticker.deltaMS;
			const survivors: Flash[] = [];
			for (const fx of flashes) {
				if (fx.g.destroyed) continue;
				fx.ageMs += dt;
				const t = fx.ageMs - fx.delayMs;
				if (t < 0) {
					fx.g.alpha = 0; // staggered: not started yet
					survivors.push(fx);
				} else if (t >= FLASH_MS) {
					fx.g.destroy(); // decay complete
				} else {
					fx.g.alpha = FLASH_PEAK * (1 - t / FLASH_MS);
					survivors.push(fx);
				}
			}
			flashes = survivors;
		});
		return () => off();
	});

	// FX are scoped to a map: a map switch destroys any in-flight flashes so they
	// can't bleed onto the new map. Reading mapId makes this $effect re-run on
	// switch.
	$effect(() => {
		void mapId;
		clearAll();
	});

	/**
	 * Spawn a flash for each conquest flip. Called imperatively by WorldMap when
	 * the playback controller emits beats. No-op under reduced motion (jump-cut)
	 * or before pixi/layer are ready.
	 */
	export function spawnConquest(flips: ConquestFlip[]): void {
		if (reducedMotion || !PIXI || !layer) return;
		for (const flip of flips) {
			const region = regionPolyById(flip.regionId);
			if (!region?.polygon || region.polygon.length < 3) continue;
			const flat: number[] = [];
			for (const [lat, lng] of region.polygon) flat.push(lng, lat); // → world [x, y]
			if (flat.length < 6) continue;
			const g: PixiGraphics = new PIXI.Graphics();
			g.poly(flat).fill({ color: 0xffffff, alpha: 1 });
			g.blendMode = 'add'; // additive → reads as a light flash, not a repaint
			g.alpha = 0; // ticker raises it; staggered flips wait out their delay
			g.eventMode = 'none';
			layer.addChild(g);
			flashes.push({ g, ageMs: 0, delayMs: flip.staggerMs });
			if (DIAG && typeof window !== 'undefined') {
				const w = window as unknown as { __spotlightFlashCount?: number };
				w.__spotlightFlashCount = (w.__spotlightFlashCount ?? 0) + 1;
			}
		}
	}

	/** Destroy every in-flight flash (map switch, replay-from-start, interrupt). */
	export function clearAll(): void {
		for (const fx of flashes) {
			if (!fx.g.destroyed) fx.g.destroy();
		}
		flashes = [];
	}

	onDestroy(() => {
		clearAll();
		if (layer) {
			try {
				layer.destroy({ children: true });
			} catch (_) {
				/* PixiStage may have destroyed the app first */
			}
			layer = null;
		}
	});
</script>
