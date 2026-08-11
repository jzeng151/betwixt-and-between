<script lang="ts">
	// Cinematic Spotlight (Slice 8) PR1 — within-map camera follow.
	//
	// Renders nothing; it drives the shared pixi-viewport. Each frame, while
	// active, it eases the viewport center + zoom toward the target the
	// camera-director computed (the changed-this-frame bbox). The ease is imperative on
	// the shared anim-controller tick — never $state (the PR0 invariant).
	//
	// Pin-on-interact (eng decision #3): any manual pan / pinch / wheel fires
	// `onUserInteract`, which the parent uses to pin the view and suspend follow
	// until playback restarts. Programmatic moveCenter/setZoom below do NOT emit
	// those gesture events, so the camera never pins itself.
	//
	// `active` is a getter called per frame (not a reactive prop) so the parent
	// can fold in its pin and reduced-motion state without this component
	// importing those stores.

	import { getContext, onDestroy } from 'svelte';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import { easeToward } from './ease.js';
	import {
		cameraTargetSettled,
		cameraTauMs,
		type CameraTarget
	} from './camera-director.js';

	let {
		target,
		active,
		secondsPerScene = 4,
		reducedMotion = false,
		onUserInteract
	}: {
		target: CameraTarget | null;
		active: () => boolean;
		secondsPerScene?: number;
		// Reduced motion: keep the user's stable framing; do not auto-pan/zoom.
		reducedMotion?: boolean;
		onUserInteract: () => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);
	// Opt-in diagnostic (same gate as the other Spotlight layers): counts frames
	// the camera actually drove the viewport, so an e2e can confirm follow engages
	// during playback and stops when pinned. Prod stays clean.
	const DIAG =
		import.meta.env.DEV ||
		(typeof window !== 'undefined' &&
			(window as unknown as { __SPOTLIGHT_DIAG__?: boolean }).__SPOTLIGHT_DIAG__ === true);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type Vp = any;
	let settledTarget: CameraTarget | null = null;

	// Pin-on-interact: user gestures on the viewport. pixi-viewport emits these
	// only for real input — programmatic moves don't — so the follow can't trip it.
	$effect(() => {
		const vp = stageCtx.viewport as Vp;
		if (!vp) return;
		const handler = () => onUserInteract();
		// pixi-viewport emits 'wheel-start' on a user scroll-zoom (NOT 'wheel');
		// 'zoomed' is avoided since it also fires on our programmatic setZoom and
		// would self-pin. drag-start/pinch-start fire on real input only.
		vp.on('drag-start', handler);
		vp.on('pinch-start', handler);
		vp.on('wheel-start', handler);
		return () => {
			try {
				vp.off('drag-start', handler);
				vp.off('pinch-start', handler);
				vp.off('wheel-start', handler);
			} catch (_) {
				/* viewport torn down */
			}
		};
	});

	// The ease ticker on the shared controller (single-ticker invariant).
	$effect(() => {
		const app = stageCtx.app;
		const anim = stageCtx.anim;
		const vp = stageCtx.viewport as Vp;
		if (!app || !anim || !vp) return;
		const off = anim.register(() => {
			if (!target) {
				settledTarget = null;
				return;
			}
			if (reducedMotion || !active() || target === settledTarget) return;
			const c = vp.center;
			const current = {
				centerX: c.x,
				centerY: c.y,
				zoom: vp.scale?.x ?? 1
			};
			if (cameraTargetSettled(current, target)) {
				settledTarget = target;
				return;
			}
			if (DIAG && typeof window !== 'undefined') {
				const w = window as unknown as { __spotlightCameraMoves?: number };
				w.__spotlightCameraMoves = (w.__spotlightCameraMoves ?? 0) + 1;
			}
			const dt = app.ticker.deltaMS;
			const tau = cameraTauMs(secondsPerScene);
			// Zoom first (keeping the current screen center fixed), then recenter —
			// so the two eases don't fight over the frame's transform.
			const nz = easeToward(current.zoom, target.zoom, dt, tau);
			vp.setZoom?.(nz, true);
			const nx = easeToward(c.x, target.centerX, dt, tau);
			const ny = easeToward(c.y, target.centerY, dt, tau);
			vp.moveCenter?.(nx, ny);
		});
		return () => off();
	});

	onDestroy(() => {
		/* no children to tear down; the $effect cleanups handle listeners + ticker */
	});
</script>
