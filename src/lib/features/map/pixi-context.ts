// Svelte context contract between PixiStage (provider) and descendant
// Pixi layers (consumers). The PixiStage publishes a $state-backed object
// whose `app` property mutates as the PIXI.Application is created and
// torn down across renderer-flag toggles; descendants get a reactive
// reference without going through $bindable (which hit
// props_invalid_value at the orchestrator layer — see commit 2 history).
//
// Usage:
//   PixiStage:        setContext(PIXI_STAGE_CONTEXT, stageCtx) where
//                     stageCtx = $state<PixiStageContext>({ app: null })
//   PixiRegionLayer:  const ctx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);
//                     let app = $derived(ctx.app);

import type { Application, Container } from 'pixi.js';
import type { AnimController } from './anim-controller.js';

export const PIXI_STAGE_CONTEXT = Symbol('pixi-stage');

// z-index band for the map's BASE layers (Codex #70). These layers mount
// asynchronously — each awaits import('pixi.js'), and the sprite-tile + water
// layers also await the texture manifest — so the old addChildAt(Math.min(N,
// children.length)) scheme was order-dependent: a late base layer could land
// above an overlay (e.g. land tiles painting over the region/faction tint).
// The base layers now carry these NEGATIVE zIndexes and the viewport sorts
// (sortableChildren = true), so they always paint UNDERNEATH the overlay layers
// (region/causalEdge/placement/brush/polygon), which keep the default zIndex 0
// and sort among themselves by insertion order (they aren't manifest-delayed).
// Lower paints first (further underneath).
export const MAP_LAYER_Z = {
	background: -100,
	grid: -90,
	terrain: -80, // flat color terrain
	terrainTiles: -70, // sprite tiles (over the flat fill)
	water: -60
} as const;

export type PixiStageContext = {
	app: Application | null;
	// Slice 6 D6 — ONE shared animation controller (single ticker + uTime clock)
	// owned by PixiStage. Animated layers (terrain shimmer, decoration sway,
	// future placement idle) subscribe via anim.register(); they must NOT call
	// anim.destroy() — PixiStage owns its lifecycle. Null pre-init / post-destroy.
	anim: AnimController | null;
	// T13 parity (codex PR#57 iter3): pixi-viewport provides pan/zoom.
	// PixiStage creates a Viewport and adds it to app.stage; descendant
	// layers addChild to `viewport` (typed as Container so consumers
	// don't need to import the pixi-viewport types directly) so they
	// pan and zoom together with the map image. Null when the viewport
	// hasn't been instantiated yet (pre-mount or post-destroy).
	viewport: Container | null;
};
