<script lang="ts">
	// World Map v3 Slice 6 (T1) — decorative prop layer (PREMISE EXPERIMENT, part 2).
	//
	// The terrain shimmer proved flat TERRAIN can breathe with a shader (D13).
	// This proves the other half: a discrete PROP sprite can breathe too — the
	// thing shaders-on-terrain can't give you (individual swaying objects).
	//
	// PoC scope: render a few PLACEHOLDER "trees" (procedural Graphics, not real
	// art) at fixed positions and sway each from its base, with a per-instance
	// phase offset so they desync naturally (the "puppet rig" idea from the shader
	// discussion, done cheaply via per-object transform — fine for a handful of
	// props; the mesh/batch question only matters at hundreds, per A4/D5).
	//
	// What this is NOT yet (tracked, deferred to later T-tasks):
	//   - real asset sprites (T5 asset pipeline) — these are placeholder shapes
	//   - the map_decorations / artifacts[] storage + authoring (T2, gated D11)
	//   - the shared animation controller (D6): this creates its OWN controller,
	//     mirroring PixiTerrainLayer's PoC. HOIST both to one controller on
	//     PixiStage/stage-context next — TODO(slice6-d6-hoist).

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import type { WorldMap } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;

	let { activeMap }: { activeMap: WorldMap | null } = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;
	let offAnim: (() => void) | null = null;
	// The map id the current props were built for. PixiStage stays mounted across
	// map switches, so we rebuild when this changes rather than building once
	// (else map 1's trees linger at map 1's coords on map 2 — Codex #70).
	let builtFor: string | null = null;

	// Per-tree state: static trunk + a canopy that sways. Only the canopy
	// rotates (pivots where it meets the trunk), so the trunk stays planted —
	// trees sway at the leaves, not the base.
	let trees: { trunk: PixiGraphics; canopy: PixiGraphics; phase: number }[] = [];

	const SWAY_AMPLITUDE = 0.11; // radians (~6°) at the canopy
	const SWAY_SPEED = 1.4; // radians/sec

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

	// Tear down the current props (canopy/trunk graphics + the anim subscription)
	// but keep the layer container for reuse.
	function clearTrees() {
		if (offAnim) {
			offAnim();
			offAnim = null;
		}
		for (const { trunk, canopy } of trees) {
			try {
				trunk.destroy();
				canopy.destroy();
			} catch (_) {
				/* may already be destroyed with the layer */
			}
		}
		trees = [];
	}

	// (Re)build the placeholder props for the active map. Rebuilds on map switch.
	$effect(() => {
		const viewport = stageCtx.viewport;
		const anim = stageCtx.anim; // shared controller (D6); implies app ready
		if (!PIXI || !viewport || !anim || !activeMap?.width || !activeMap?.height) {
			// No usable map (e.g. switched to an image-less one): drop the props.
			clearTrees();
			builtFor = null;
			return;
		}
		if (builtFor === activeMap.id) return; // already built for this map
		clearTrees(); // switching maps — clear the previous map's props first

		const w = activeMap.width;
		const h = activeMap.height;

		if (!layer) {
			layer = new PIXI.Container();
			// Props sit above terrain + region tint, below placements (Fix-12 z-order).
			viewport.addChild(layer);
		}
		builtFor = activeMap.id;

		// A short row of placeholder trees across the lower third of the map.
		const COUNT = 6;
		const trunkW = 6;
		const trunkH = 26;
		const canopyH = 46;
		const canopyW = 40;
		for (let i = 0; i < COUNT; i++) {
			const baseX = w * (0.12 + (0.76 * i) / (COUNT - 1));
			const baseY = h * 0.62;

			// Trunk: static, drawn from its base (0,0) upward, placed at the base.
			const trunk = new PIXI.Graphics();
			trunk.rect(-trunkW / 2, -trunkH, trunkW, trunkH).fill({ color: 0x6b4f2a });
			trunk.x = baseX;
			trunk.y = baseY;
			layer.addChild(trunk);

			// Canopy: its local origin (0,0) is the point where it meets the trunk
			// top, so rotation sways the leaves around that join, trunk unaffected.
			const canopy = new PIXI.Graphics();
			canopy.moveTo(0, -canopyH);
			canopy.lineTo(-canopyW / 2, 0);
			canopy.lineTo(canopyW / 2, 0);
			canopy.closePath();
			canopy.fill({ color: 0x2f7d3a });
			canopy.x = baseX;
			canopy.y = baseY - trunkH; // sit on top of the trunk
			layer.addChild(canopy);

			trees.push({ trunk, canopy, phase: (i * Math.PI) / 3 }); // staggered → desync
		}

		// Subscribe to the shared controller (D6) — do not create/own one here.
		offAnim = anim.register((t) => {
			for (const { canopy, phase } of trees) {
				canopy.rotation = Math.sin(t * SWAY_SPEED + phase) * SWAY_AMPLITUDE;
			}
		});
	});

	onDestroy(() => {
		// Do NOT destroy the controller — PixiStage owns it (D6); just unsubscribe
		// + drop the props (clearTrees), then the layer.
		clearTrees();
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
