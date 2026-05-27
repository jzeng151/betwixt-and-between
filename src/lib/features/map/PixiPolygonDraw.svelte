<script lang="ts">
	// Slice 2 D4 prep (T8) — Pixi-native polygon-draw tooling.
	//
	// Replaces leaflet-draw's polygon tool under ?renderer=pixi. Variant D
	// ("Cartographer's tool") from docs/plans/world-map-v3-slice-2-plan.md
	// § T8: right-click → "Draw region here" context menu entry kicks the
	// component into drawing mode. Inside the mode:
	//
	//   - Left-click       → add vertex
	//   - Mouse-move       → phantom segment from last vertex to cursor
	//   - Double-click     → commit (≥3 vertices, polygon must be simple)
	//   - Snap-close       → click within 8px of first vertex (≥3 vertices)
	//                        also commits
	//   - Esc              → cancel
	//   - Backspace/Delete → remove the last vertex (drops to 0 then auto-
	//                        exits if no vertices remain)
	//
	// The self-intersection check (mirror of src/lib/server/validation.ts) runs
	// on every state change. When the polygon would be invalid if committed,
	// the offending segment renders rust-red and the commit gestures are
	// disabled. The server still validates on POST as defense in depth.
	//
	// Coordinates: vertices stored as [y, x] = [lat, lng] internally so the
	// committed payload matches the [[lat, lng], …] convention the rest of
	// the codebase uses (region.polygon, PixiRegionLayer's flatten loop,
	// /api/maps/[id]/regions POST body).

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import { firstSelfIntersection, isSelfIntersecting } from './polygon-validation.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;
	type FederatedPointerEvent = import('pixi.js').FederatedPointerEvent;

	let {
		active = $bindable(false),
		seedPoint = null,
		onCommit,
		onCancel
	}: {
		active?: boolean;
		// Optional first vertex captured at the moment the user picked
		// "Draw region here" from the context menu. When set, the polygon
		// starts with this vertex already placed.
		seedPoint?: { x: number; y: number } | null;
		onCommit: (polygon: number[][]) => void;
		onCancel?: () => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	const VERTEX_FILL = 0xc8942a;
	const VERTEX_RIM = 0x8a651c;
	const LINE_COLOR = 0xc8942a;
	const ERROR_COLOR = 0xa04a3a; // rust-red — distinct from #ef4444 error red
	const SNAP_RADIUS = 8; // pixels in image space

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;
	let stagePointerDown: ((e: FederatedPointerEvent) => void) | null = null;
	let stagePointerMove: ((e: FederatedPointerEvent) => void) | null = null;
	let stageDblClick: ((e: FederatedPointerEvent) => void) | null = null;
	let windowKeyDown: ((e: KeyboardEvent) => void) | null = null;

	// Vertices stored as [y, x] (lat, lng) — committed payload format.
	let vertices = $state<number[][]>([]);
	let cursor = $state<{ x: number; y: number } | null>(null);
	// Track which `active` session we've already consumed the seed for.
	// Without this, the seed-point effect re-seeds the first vertex any
	// time `vertices` becomes empty (e.g. user presses Backspace on a
	// freshly-seeded polygon), trapping the user in a "vertex respawns"
	// loop. We seed exactly once per active=true transition.
	let seedConsumed = $state(false);

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

	function commit() {
		// vertices is [y, x][] — the canonical [lat, lng] convention.
		if (vertices.length < 3) return;
		if (isSelfIntersecting(vertices)) return;
		const payload = vertices.map(([y, x]) => [y, x]);
		vertices = [];
		cursor = null;
		onCommit(payload);
	}

	function cancel() {
		vertices = [];
		cursor = null;
		onCancel?.();
	}

	function snappingToFirst(): boolean {
		if (vertices.length < 3 || !cursor) return false;
		const [y0, x0] = vertices[0];
		const dx = cursor.x - x0;
		const dy = cursor.y - y0;
		return dx * dx + dy * dy <= SNAP_RADIUS * SNAP_RADIUS;
	}

	function addVertex(x: number, y: number) {
		// Magnetic snap: clicking near the first vertex with ≥3 vertices
		// already placed closes + commits.
		if (snappingToFirst()) {
			commit();
			return;
		}
		vertices = [...vertices, [y, x]];
	}

	function popVertex() {
		if (vertices.length === 0) {
			cancel();
			return;
		}
		vertices = vertices.slice(0, -1);
	}

	// Seed the first vertex when the parent supplies one (right-click flow).
	// Consume the seed exactly once per `active` session so Backspace can
	// fully clear the polygon without the seed re-appearing.
	$effect(() => {
		if (active && seedPoint && !seedConsumed) {
			vertices = [[seedPoint.y, seedPoint.x]];
			seedConsumed = true;
		}
		if (!active) {
			vertices = [];
			cursor = null;
			seedConsumed = false;
		}
	});

	// Stage event wiring. Listeners attach when `active` flips true and
	// detach on false / unmount.
	$effect(() => {
		const app = stageCtx.app;
		if (!app || !PIXI) return;
		if (!active) return;

		stagePointerDown = (e: FederatedPointerEvent) => {
			// Only left-click adds vertices. Right-click is reserved for the
			// region/snapshot context menu (handled by PixiRegionLayer).
			if (e.button !== 0) return;
			addVertex(e.global.x, e.global.y);
		};
		stagePointerMove = (e: FederatedPointerEvent) => {
			cursor = { x: e.global.x, y: e.global.y };
		};
		stageDblClick = (_e: FederatedPointerEvent) => {
			commit();
		};
		windowKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				cancel();
			} else if (e.key === 'Backspace' || e.key === 'Delete') {
				e.preventDefault();
				popVertex();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				commit();
			}
		};

		app.stage.eventMode = 'static';
		app.stage.hitArea = app.screen;
		// Register the click handler on `pointertap` only — it fires once
		// per click (pointerdown + pointerup at the same spot, not on drag)
		// and won't double-up the way ('pointerdown' + 'pointertap') would.
		app.stage.on('pointertap', stagePointerDown);
		app.stage.on('pointermove', stagePointerMove);
		app.stage.on('dblclick', stageDblClick);
		window.addEventListener('keydown', windowKeyDown);

		return () => {
			try {
				if (stagePointerDown) app.stage.off('pointertap', stagePointerDown);
				if (stagePointerMove) app.stage.off('pointermove', stagePointerMove);
				if (stageDblClick) app.stage.off('dblclick', stageDblClick);
			} catch (_) {
				/* stage may be torn down */
			}
			if (windowKeyDown) window.removeEventListener('keydown', windowKeyDown);
			stagePointerDown = null;
			stagePointerMove = null;
			stageDblClick = null;
			windowKeyDown = null;
		};
	});

	// Redraw on every vertices/cursor change.
	$effect(() => {
		const app = stageCtx.app;
		if (!app || !PIXI) return;

		// Reference reactive deps so the effect re-runs on change.
		const verts = vertices;
		const cur = cursor;
		const isActive = active;

		if (!layer) {
			layer = new PIXI.Container();
			// Place above all sibling layers — Pixi z-order is insertion
			// order, and PixiRegionLayer adds its container earlier. The
			// stage's children list isn't ordered explicitly by us, but
			// addChild appends, so the draw layer naturally lands on top
			// when this component mounts after the region layer.
			app.stage.addChild(layer);
		}

		for (const child of layer.removeChildren()) {
			child.destroy();
		}

		if (!isActive) return;

		// Locate any self-intersection so we can color the offending segment.
		const intersect = verts.length >= 3 ? firstSelfIntersection(verts) : null;

		// Closed-edge style when snapping to first vertex (≥3 vertices and
		// cursor within snap radius).
		const snapping = snappingToFirst();

		// Edges between vertices.
		for (let i = 0; i < verts.length - 1; i++) {
			const isBad =
				intersect !== null && (i === intersect.a || i === intersect.b);
			drawSegment(verts[i], verts[i + 1], isBad ? ERROR_COLOR : LINE_COLOR);
		}

		// Phantom segment from last vertex to cursor (during drawing).
		if (verts.length > 0 && cur) {
			const last = verts[verts.length - 1];
			drawSegment(last, [cur.y, cur.x], LINE_COLOR, 0.7);
		}

		// Closing segment preview: snapping to first OR commit-validated.
		if (verts.length >= 3 && cur && snapping) {
			drawSegment(verts[verts.length - 1], verts[0], LINE_COLOR);
		}

		// Vertices: ink-well style.
		for (let i = 0; i < verts.length; i++) {
			const [y, x] = verts[i];
			const isFirst = i === 0;
			const highlight = isFirst && snapping;
			const g: PixiGraphics = new PIXI.Graphics();
			g.circle(x, y, highlight ? 11 : 9)
				.fill({ color: VERTEX_FILL, alpha: 1 })
				.stroke({ color: VERTEX_RIM, width: 1.5 });
			layer.addChild(g);
		}
	});

	function drawSegment(a: number[], b: number[], color: number, alpha = 1) {
		if (!PIXI || !layer) return;
		const g: PixiGraphics = new PIXI.Graphics();
		// vertices are [y, x]; Pixi takes (x, y).
		g.moveTo(a[1], a[0]).lineTo(b[1], b[0]).stroke({
			color,
			width: 1.5,
			alpha
		});
		layer.addChild(g);
	}

	onDestroy(() => {
		const app = stageCtx.app;
		try {
			if (app && stagePointerDown) app.stage.off('pointertap', stagePointerDown);
			if (app && stagePointerMove) app.stage.off('pointermove', stagePointerMove);
			if (app && stageDblClick) app.stage.off('dblclick', stageDblClick);
		} catch (_) {
			/* stage may have been destroyed */
		}
		if (windowKeyDown) window.removeEventListener('keydown', windowKeyDown);
		if (layer) {
			try {
				layer.destroy({ children: true });
			} catch (_) {
				/* parent app may have been destroyed first */
			}
			layer = null;
		}
	});
</script>
