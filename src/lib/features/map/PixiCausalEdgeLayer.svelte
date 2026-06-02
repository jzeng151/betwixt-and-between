<script lang="ts">
	// World Map v3 Slice 5 PR-C (D2/D5, ADR 0006) — Pixi-native causal-edge layer.
	//
	// Draws the on-map EventChain: each `caused_by` relationship whose both
	// endpoints resolve to a region on this map (computed by projection.ts's
	// foldCausalEdges) becomes one dashed, arrowed quadratic Bezier from the
	// effect region's centroid to the cause region's. Mirrors the graph's
	// caused_by edge language (dashed '4 3', arrowhead at the cause/`to` end,
	// --color-rel-other) so the same link reads the same in both surfaces.
	//
	// Slotted after PixiRegionLayer, before PixiPlacementLayer (edges paint over
	// regions, under markers). Coordinates: RenderedCausalEdge fromPos/toPos are
	// fractional [0,1] against the source-image dims — × activeMap.width/height to
	// canvas pixels, the same convention every other Pixi layer uses.
	//
	// Click → onEdgeClick(relationshipId); WorldMap routes it through the shared
	// jumpToCause helper (one jump semantics across map + both graphs). A timeless
	// edge is still drawn (always visible) and still clickable — jumpToCause makes
	// the click a harmless no-op (D5).

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import type { RenderedCausalEdge } from '$lib/features/map/projection.js';
	import type { WorldMap } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;
	type FederatedPointerEvent = import('pixi.js').FederatedPointerEvent;

	let {
		activeMap,
		causalEdges = [],
		onEdgeClick
	}: {
		activeMap: WorldMap | null;
		causalEdges?: RenderedCausalEdge[];
		// Fired on a left-click of an edge with its relationship id. WorldMap looks
		// up the Relationship and calls jumpToCause (shared with the graphs).
		onEdgeClick?: (relationshipId: string) => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;

	// --color-rel-other (#94a3b8) — the graph's caused_by edge color.
	const EDGE_COLOR = 0x94a3b8;
	const EDGE_WIDTH = 1.5;
	const DASH = 6;
	const GAP = 4;
	const CURVATURE = 0.18; // control-point offset as a fraction of edge length
	const ARROW_LEN = 9;
	const ARROW_HALF_W = 5;
	const HIT_WIDTH = 12; // invisible fat stroke for an easy click target
	const CURVE_SAMPLES = 24;

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

	type Pt = { x: number; y: number };

	// Quadratic Bezier point + its (control→end) endpoint tangent.
	function quad(p0: Pt, p1: Pt, p2: Pt, u: number): Pt {
		const v = 1 - u;
		return {
			x: v * v * p0.x + 2 * v * u * p1.x + u * u * p2.x,
			y: v * v * p0.y + 2 * v * u * p1.y + u * u * p2.y
		};
	}

	// Sample the curve into a polyline so we can dash it (Pixi has no native dash).
	function sampleCurve(p0: Pt, p1: Pt, p2: Pt): Pt[] {
		const pts: Pt[] = [];
		for (let i = 0; i <= CURVE_SAMPLES; i++) pts.push(quad(p0, p1, p2, i / CURVE_SAMPLES));
		return pts;
	}

	function strokeDashedPolyline(g: PixiGraphics, pts: Pt[]): void {
		let carry = 0; // distance carried across segments so dashes flow continuously
		let drawing = true; // start on a dash
		for (let i = 0; i < pts.length - 1; i++) {
			const a = pts[i];
			const b = pts[i + 1];
			const segLen = Math.hypot(b.x - a.x, b.y - a.y);
			if (segLen === 0) continue;
			const ux = (b.x - a.x) / segLen;
			const uy = (b.y - a.y) / segLen;
			let d = 0;
			while (d < segLen) {
				const span = (drawing ? DASH : GAP) - carry;
				const step = Math.min(span, segLen - d);
				if (drawing) {
					g.moveTo(a.x + ux * d, a.y + uy * d);
					g.lineTo(a.x + ux * (d + step), a.y + uy * (d + step));
				}
				d += step;
				carry += step;
				if (carry >= (drawing ? DASH : GAP)) {
					carry = 0;
					drawing = !drawing;
				}
			}
		}
		g.stroke({ color: EDGE_COLOR, width: EDGE_WIDTH, alpha: 0.9 });
	}

	function drawArrowhead(g: PixiGraphics, tip: Pt, fromCtrl: Pt): void {
		const dx = tip.x - fromCtrl.x;
		const dy = tip.y - fromCtrl.y;
		const len = Math.hypot(dx, dy);
		if (len === 0) return;
		const ux = dx / len;
		const uy = dy / len;
		// Two base corners, perpendicular to the tangent, set back ARROW_LEN.
		const bx = tip.x - ux * ARROW_LEN;
		const by = tip.y - uy * ARROW_LEN;
		const px = -uy * ARROW_HALF_W;
		const py = ux * ARROW_HALF_W;
		g.poly([tip.x, tip.y, bx + px, by + py, bx - px, by - py]).fill({
			color: EDGE_COLOR,
			alpha: 0.9
		});
	}

	$effect(() => {
		const app = stageCtx.app;
		const viewport = stageCtx.viewport;
		if (!app || !PIXI || !viewport) return;

		if (!layer) {
			layer = new PIXI.Container();
			viewport.addChild(layer);
		}
		// Clear BEFORE the dimension guard so a transient zero-dim activeMap (e.g.
		// mid map-swap) doesn't leave stale edges on the canvas — matches
		// PixiRegionLayer's clear-then-guard posture.
		for (const child of layer.removeChildren()) child.destroy();
		if (!activeMap?.width || !activeMap?.height) return;

		const mapW = activeMap.width;
		const mapH = activeMap.height;

		for (const edge of causalEdges) {
			const p0: Pt = { x: edge.fromPos.x * mapW, y: edge.fromPos.y * mapH };
			const p2: Pt = { x: edge.toPos.x * mapW, y: edge.toPos.y * mapH };
			const dx = p2.x - p0.x;
			const dy = p2.y - p0.y;
			const len = Math.hypot(dx, dy);
			if (len === 0) continue; // defensive — fold drops self-edges already
			// Control point: midpoint pushed perpendicular for a gentle arc.
			const mid: Pt = { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 };
			const p1: Pt = {
				x: mid.x + (-dy / len) * len * CURVATURE,
				y: mid.y + (dx / len) * len * CURVATURE
			};
			const pts = sampleCurve(p0, p1, p2);

			const edgeG: PixiContainer = new PIXI.Container();
			edgeG.eventMode = 'static';
			edgeG.cursor = 'pointer';

			// Invisible fat hit stroke so the thin dashes are easy to click.
			const hit: PixiGraphics = new PIXI.Graphics();
			hit.moveTo(pts[0].x, pts[0].y);
			for (let i = 1; i < pts.length; i++) hit.lineTo(pts[i].x, pts[i].y);
			hit.stroke({ color: EDGE_COLOR, width: HIT_WIDTH, alpha: 0 });
			edgeG.addChild(hit);

			// Visible dashed curve + arrowhead at the cause end (p2).
			const vis: PixiGraphics = new PIXI.Graphics();
			strokeDashedPolyline(vis, pts);
			drawArrowhead(vis, p2, p1);
			vis.eventMode = 'none';
			edgeG.addChild(vis);

			const relationshipId = edge.relationshipId;
			edgeG.on('pointertap', (e: FederatedPointerEvent) => {
				if (e.button !== 0) return;
				e.stopPropagation();
				onEdgeClick?.(relationshipId);
			});

			layer.addChild(edgeG);
		}
	});

	onDestroy(() => {
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
