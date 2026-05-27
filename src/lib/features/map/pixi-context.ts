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

export const PIXI_STAGE_CONTEXT = Symbol('pixi-stage');

export type PixiStageContext = {
	app: Application | null;
	// T13 parity (codex PR#57 iter3): pixi-viewport provides pan/zoom.
	// PixiStage creates a Viewport and adds it to app.stage; descendant
	// layers addChild to `viewport` (typed as Container so consumers
	// don't need to import the pixi-viewport types directly) so they
	// pan and zoom together with the map image. Null when the viewport
	// hasn't been instantiated yet (pre-mount or post-destroy).
	viewport: Container | null;
};
