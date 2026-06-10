<script lang="ts">
	// WM3 Slice A — freeform brush authoring layer.
	//
	// Sibling of PixiBrushLayer (grid cell painting, kept first-class per amendment
	// §3). This layer is the FREEFORM brush: it records a continuous, un-snapped
	// pointer path and emits ONE paint_stroke event per gesture — a generalization
	// of paint_cells (a grid cell is a quantized stroke). No cellAtPoint snap.
	//
	// Path points are normalized [0,1] of the map extent (same convention as
	// placements + the projection fold). One gesture = one event = one stroke =
	// one undo (command_id). Optimistic: the returned row appends to the event
	// stream, the projection fold emits it in RenderedState.strokes, and
	// PixiArtLayer rasterizes it on the next tick.

	import { getContext, onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { PIXI_STAGE_CONTEXT, MAP_LAYER_Z, type PixiStageContext } from './pixi-context.js';
	import { mapEventsStore } from './map-events-store.js';
	import { playhead } from '$lib/features/timeline/playhead-store.js';
	import { STROKE_MAX_POINTS, type StrokeMode, type StrokeStampParams } from './projection.js';
	import { downsample } from './stroke-geometry.js';
	import type { WorldMap } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;
	type FederatedPointerEvent = import('pixi.js').FederatedPointerEvent;

	let {
		active = false,
		activeMap = null,
		mode = 'fill',
		textureKey = 'Grass',
		brushSize = 0.04,
		softness = 0.5,
		stamp = undefined,
		layerId = null,
		onStrokeComplete = undefined,
		onError = undefined
	}: {
		active?: boolean;
		activeMap?: WorldMap | null;
		mode?: StrokeMode;
		textureKey?: string;
		brushSize?: number;
		softness?: number;
		stamp?: StrokeStampParams;
		// Slice B — target art layer (world_maps.art_layers_jsonb id); null =
		// the implicit base art layer.
		layerId?: string | null;
		onStrokeComplete?: () => void;
		// F17 — the layer has no UI of its own; a rejected/dropped gesture would
		// otherwise vanish with only a console.error. Surface it to the parent.
		onError?: (message: string) => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;
	let previewGraphics: PixiGraphics | null = null;

	let painting = false;
	let strokeId: string | null = null;
	// Recorded path in normalized [0,1] coords.
	let points: Array<{ x: number; y: number }> = [];

	// F12: bound the cost of capture/preview on high-rate pointers (120-240Hz).
	// MIN_SAMPLE_DIST_SQ drops samples closer than ~0.0015 of the map extent to
	// the previous point — fewer points means the O(n) full-polyline redraw runs
	// far less often (and the committed payload is smaller). The preview redraw
	// is additionally coalesced to one per animation frame.
	const MIN_SAMPLE_DIST_SQ = 0.0015 * 0.0015;
	let previewRaf = 0;
	function schedulePreview(): void {
		if (previewRaf) return;
		previewRaf = requestAnimationFrame(() => {
			previewRaf = 0;
			drawPreview();
		});
	}
	function cancelScheduledPreview(): void {
		if (previewRaf) {
			cancelAnimationFrame(previewRaf);
			previewRaf = 0;
		}
	}

	let stagePointerDown: ((e: FederatedPointerEvent) => void) | null = null;
	let stagePointerMove: ((e: FederatedPointerEvent) => void) | null = null;
	let stagePointerUp: ((e: FederatedPointerEvent) => void) | null = null;

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

	function localToNorm(localX: number, localY: number): { x: number; y: number } | null {
		if (!activeMap?.width || !activeMap?.height) return null;
		const x = localX / activeMap.width;
		const y = localY / activeMap.height;
		if (x < 0 || x > 1 || y < 0 || y > 1) return null;
		return { x, y };
	}

	function resetGesture(): void {
		painting = false;
		strokeId = null;
		points = [];
		cancelScheduledPreview();
		if (previewGraphics) previewGraphics.clear();
	}

	function drawPreview(): void {
		if (!previewGraphics || !activeMap?.width || !activeMap?.height || points.length === 0) return;
		const w = activeMap.width;
		const h = activeMap.height;
		previewGraphics.clear();
		const px = points.map((p) => ({ x: p.x * w, y: p.y * h }));
		previewGraphics.moveTo(px[0].x, px[0].y);
		for (let i = 1; i < px.length; i++) previewGraphics.lineTo(px[i].x, px[i].y);
		previewGraphics.stroke({
			width: Math.max(1, brushSize * Math.min(w, h)),
			color: 0xffffff,
			alpha: 0.35,
			cap: 'round',
			join: 'round'
		});
	}

	function commitStroke(): void {
		if (!activeMap || !strokeId || points.length === 0) {
			resetGesture();
			return;
		}
		const mapId = activeMap.id;
		const tPosition = get(playhead) ?? 0;
		const localStrokeId = strokeId;
		// Cap to the server limit — drop excess rather than 400 (a long drag can
		// exceed STROKE_MAX_POINTS; downsampling preserves the gesture shape).
		const path = points.length > STROKE_MAX_POINTS ? downsample(points, STROKE_MAX_POINTS) : points;
		// Erase strokes carry no material (Slice C): textureKey/stamp are
		// rejected by the validator for mode='erase'.
		const payload = {
			path,
			brushSize,
			softness,
			mode,
			...(mode === 'erase' ? {} : { textureKey }),
			...(mode === 'stamp' && stamp ? { stamp } : {}),
			...(layerId ? { layerId } : {})
		};
		resetGesture();

		void (async () => {
			try {
				await mapEventsStore.create(mapId, {
					tPosition,
					kind: 'paint_stroke',
					payloadJsonb: payload,
					commandId: localStrokeId
				});
				onStrokeComplete?.();
			} catch (err) {
				// F17: don't swallow — the preview is already cleared, so a silent
				// drop looks like the brush did nothing. Surface to the parent.
				console.error('paint_stroke commit failed; gesture dropped', err);
				onError?.(err instanceof Error ? err.message : 'Stroke failed to save');
			}
		})();
	}

	$effect(() => {
		const viewport = stageCtx.viewport;
		if (!PIXI || !viewport) return;
		if (!active) return;

		stagePointerDown = (e: FederatedPointerEvent) => {
			if (e.button !== 0) return;
			if (painting) return; // first-pointer-wins (mirror PixiBrushLayer)
			const local = e.getLocalPosition(viewport);
			const n = localToNorm(local.x, local.y);
			if (!n) return;
			painting = true;
			strokeId = crypto.randomUUID();
			points = [n];
			drawPreview();
		};
		stagePointerMove = (e: FederatedPointerEvent) => {
			if (!painting) return;
			const local = e.getLocalPosition(viewport);
			const n = localToNorm(local.x, local.y);
			if (!n) return; // off-map: don't record, don't commit (drag-back allowed)
			// F12: skip samples too close to the last recorded point.
			const last = points[points.length - 1];
			if (last) {
				const dx = n.x - last.x;
				const dy = n.y - last.y;
				if (dx * dx + dy * dy < MIN_SAMPLE_DIST_SQ) return;
			}
			points.push(n);
			schedulePreview();
		};
		stagePointerUp = (_e: FederatedPointerEvent) => {
			if (!painting) return;
			commitStroke();
		};

		viewport.eventMode = 'static';
		// Suspend pan-on-drag while painting (same reason as PixiBrushLayer).
		const dragPlugin = viewport as unknown as {
			plugins?: { pause(name: string): void; resume(name: string): void };
		};
		dragPlugin.plugins?.pause('drag');

		if (!layer) {
			layer = new PIXI.Container();
			layer.zIndex = MAP_LAYER_Z.art + 1; // preview sits just over committed art
			viewport.addChild(layer);
		}
		if (!previewGraphics) {
			previewGraphics = new PIXI.Graphics();
			layer.addChild(previewGraphics);
		}

		viewport.on('pointerdown', stagePointerDown);
		viewport.on('pointermove', stagePointerMove);
		viewport.on('pointerup', stagePointerUp);
		viewport.on('pointerupoutside', stagePointerUp);

		return () => {
			dragPlugin.plugins?.resume('drag');
			// F17: deactivation mid-drag (tool switch, dataLoading toggling) used to
			// discard a complete in-flight gesture silently. Commit a real drag
			// (>1 point) so the user's work is preserved rather than lost without a
			// trace; a single-point tap is noise and is dropped. (commitStroke
			// resets gesture state internally.)
			if (painting && strokeId && points.length > 1) commitStroke();
			else resetGesture();
			try {
				if (stagePointerDown) viewport.off('pointerdown', stagePointerDown);
				if (stagePointerMove) viewport.off('pointermove', stagePointerMove);
				if (stagePointerUp) {
					viewport.off('pointerup', stagePointerUp);
					viewport.off('pointerupoutside', stagePointerUp);
				}
			} catch (_) {
				/* viewport torn down */
			}
			stagePointerDown = null;
			stagePointerMove = null;
			stagePointerUp = null;
		};
	});

	onDestroy(() => {
		cancelScheduledPreview();
		const viewport = stageCtx.viewport;
		try {
			if (viewport && stagePointerDown) viewport.off('pointerdown', stagePointerDown);
			if (viewport && stagePointerMove) viewport.off('pointermove', stagePointerMove);
			if (viewport && stagePointerUp) {
				viewport.off('pointerup', stagePointerUp);
				viewport.off('pointerupoutside', stagePointerUp);
			}
		} catch (_) {
			/* viewport torn down */
		}
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
