<script lang="ts" module>
	/**
	 * GraphCanvas — pan/zoom/drag SVG canvas primitive.
	 *
	 * Extracted from StoryGraph.svelte (Phase 1B Z4) so FocusedGraph (C2)
	 * and any future graph-canvas consumer can share the viewport logic
	 * without duplicating ~400 LOC of pointer-event plumbing.
	 *
	 * The host component owns DATA (which entities/edges to show, what
	 * is "dimmed" at the current playhead) and PERSISTENCE (where node
	 * positions get saved). GraphCanvas owns INTERACTION (pan, zoom,
	 * drag, connect-line preview) and RENDERING (SVG edges, positioned
	 * node DOM with a slot for per-node overlay UI).
	 *
	 * Per-node overlay UI (connect button, delete button, pin badge,
	 * etc.) is supplied via the `nodeOverlay` snippet so different
	 * consumers can render different chrome without forking this file.
	 */

	export interface GraphNode {
		id: string;
		type: string;
		name: string;
		/**
		 * Optional per-node color override. When set, takes precedence
		 * over the type-default in `NODE_COLOR`. Drives `--nc` on the
		 * node element so border + active-state styling pick up the
		 * custom color. Used by StoryGraph + FocusedGraph to surface
		 * the user-picked timeline color (or the auto-cycle color for
		 * Characters without a custom one) on the graph.
		 */
		color?: string;
		/** Entity is a member of an alias pair (primary or alias side).
		 *  Renders a dashed border to signal constructed identity. */
		aliasMember?: boolean;
	}

	export interface GraphEdge {
		id: string;
		fromId: string;
		toId: string;
		color: string;
		label: string;
		dimmed: boolean;
		/** SVG `stroke-dasharray` value, e.g. `'4 3'` for dashed,
		 *  `'2 3'` for dotted. Omit / null for solid. */
		dasharray?: string | null;
		/** Stroke width in px. Defaults to 1.5. */
		width?: number;
		/** Render an arrowhead at the `to` end. Defaults to false. */
		arrow?: boolean;
		/** Story-time start (inclusive). null/undefined = no lower bound (visible from T=0). */
		startPosition?: number | null;
		/** Story-time end (exclusive). null/undefined = no upper bound (always visible past start). */
		endPosition?: number | null;
		/** Edge exists but hasn't been revealed to the reader at the current playhead position. */
		mysteryMode?: boolean;
		/** Edge is outside the current temporal window (±2 acts). 'past' = ended, 'future' = not yet started. */
		ghostMode?: 'past' | 'future' | null;
	}

	export interface NodeOverlayContext {
		id: string;
		hovered: boolean;
		dragging: boolean;
	}
</script>

<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { NODE_COLOR } from '$lib/relationship-colors.js';
	import type { NodePosition } from '$lib/graph/radial-layout.js';

	interface Props {
		nodes: GraphNode[];
		edges: GraphEdge[];
		/** Entity ids that should render with reduced opacity (out-of-scope at the playhead). */
		dimmedNodes: Set<string>;
		/** Initial positions seeded by the host (e.g. from /api/canvas-positions). */
		initialPositions: Record<string, NodePosition>;
		/** Empty-state UI shown when nodes is empty. */
		emptyState?: Snippet;
		/** Per-node overlay UI (connect button, delete button, pin badge, etc.). */
		nodeOverlay?: Snippet<[NodeOverlayContext]>;
		/** Per-node always-visible chrome (pin badges, status icons, etc.).
		    Unlike `nodeOverlay` which renders only on hover, this snippet
		    renders for every node, every frame. Keep the content cheap. */
		nodeBadge?: Snippet<[NodeOverlayContext]>;
		/** Fires when a user drags from a node to another node. screenX/screenY are
		    viewport-local coords, useful for positioning a follow-up form. */
		onConnect?: (fromId: string, toId: string, screenX: number, screenY: number) => void;
		/** Fires when a user double-clicks a node (typically "open in editor"). */
		onNodeOpen?: (id: string) => void;
		/** Fires after a drag completes; host can persist the position. Debounce
		    is the host's responsibility. */
		onNodePositionChange?: (id: string, position: NodePosition) => void;
		/** Fires on right-click of a node. clientX/clientY are BROWSER-VIEWPORT
		    coords (NOT canvas-local) so a `position: fixed` ContextMenu lands
		    at the cursor regardless of how the host window is positioned.
		    Cancels any in-progress connect-drag automatically (per the locked
		    C3 UX collision rule). */
		onContextMenu?: (id: string, clientX: number, clientY: number) => void;
		/** When false, suppresses the per-edge label `<text>` element.
		    Defaults to true for back-compat. Hosts wire a toggle UI to
		    flip this — useful for dense graphs where edge labels stack
		    on top of each other and become noise. */
		showEdgeLabels?: boolean;
		/** Fires on right-click of an edge. clientX/clientY are BROWSER-VIEWPORT
		    coords so a `position: fixed` ContextMenu lands at the cursor.
		    The id is the GraphEdge id (relationship id). */
		onEdgeContextMenu?: (id: string, clientX: number, clientY: number) => void;
	}

	let {
		nodes,
		edges,
		dimmedNodes,
		initialPositions,
		emptyState,
		nodeOverlay,
		nodeBadge,
		onConnect,
		onNodeOpen,
		onNodePositionChange,
		onContextMenu,
		showEdgeLabels = true,
		onEdgeContextMenu
	}: Props = $props();

	const NODE_W = 120;
	const NODE_H = 32;

	// Per-instance marker id. Multiple GraphCanvas instances coexist
	// in the same document (StoryGraph + N FocusedGraph windows); a
	// hardcoded `id="gc-arrow"` would duplicate, and on any instance
	// closing its <defs>, surviving instances' `marker-end="url(#…)"`
	// references would dangle and arrowheads would silently disappear.
	// `crypto.randomUUID()` runs once per component init.
	const arrowMarkerId = `gc-arrow-${crypto.randomUUID().slice(0, 8)}`;

	// ── Viewport transform ─────────────────────────────────────────────────────
	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(1);

	// ── Node positions (canvas coords) ─────────────────────────────────────────
	let nodePos = $state<Record<string, NodePosition>>({});
	// One-shot guard: when /api/canvas-positions returns AFTER nodes have
	// auto-placed (the common race — entity store is local-fast, the canvas
	// fetch is network), we still need to apply server positions exactly
	// once. A `nodePos.length === 0` guard would silently miss this.
	let seededFromServer = $state(false);

	$effect(() => {
		// Server seed: apply once, the first time initialPositions arrives
		// non-empty. Server positions override auto-placed positions for
		// nodes that have a stored entry; auto-placed nodes without a
		// server position keep their layout.
		if (!seededFromServer && Object.keys(initialPositions).length > 0) {
			seededFromServer = true;
			const current = untrack(() => nodePos);
			nodePos = { ...current, ...initialPositions };
			// Re-fit so the viewport centers on the restored layout, not
			// the brief auto-placed one we just overwrote.
			queueMicrotask(() => fitView(untrack(() => nodePos)));
			return;
		}
		// Auto-place nodes that don't yet have a position. Falls back to
		// initialPositions[id] if the server happens to know about a node
		// that the auto-place loop is processing (rare but possible if
		// a new entity arrives between seed and now).
		const missing = nodes.filter((n) => !untrack(() => nodePos[n.id]));
		if (missing.length > 0) {
			const current = untrack(() => nodePos);
			const idx = Object.keys(current).length;
			const additions: Record<string, NodePosition> = {};
			missing.forEach((n, i) => {
				additions[n.id] = initialPositions[n.id] ?? {
					x: 60 + ((idx + i) % 4) * 180,
					y: 60 + Math.floor((idx + i) / 4) * 100,
					w: NODE_W,
					h: NODE_H
				};
			});
			nodePos = { ...current, ...additions };
		}
	});

	// ── Interaction state ──────────────────────────────────────────────────────
	let draggingNode = $state<{ id: string; offX: number; offY: number } | null>(null);
	let connecting = $state<{ fromId: string; screenX: number; screenY: number } | null>(null);
	let panning = $state<{
		startMX: number;
		startMY: number;
		startPX: number;
		startPY: number;
	} | null>(null);
	let hoveredNodeId = $state<string | null>(null);

	let viewport: HTMLDivElement = $state(null!);

	// ── Screen-coord edge geometry ─────────────────────────────────────────────
	// Two entities can have multiple relationships of different types between
	// them (e.g. Character pov_of Event AND Character mentor_of Event). The
	// schema's UNIQUE(from_id, to_id, type) allows this — the rendering layer
	// has to fan them out so they're visually distinguishable. Without
	// fan-out the lines stack at the same coords and only the topmost edge
	// renders meaningfully.
	const PARALLEL_OFFSET_PX = 8;
	const screenEdges = $derived.by(() => {
		// Pass 1: compute base geometry for each edge.
		type Geom = GraphEdge & {
			x1: number;
			y1: number;
			x2: number;
			y2: number;
		};
		const base: Geom[] = [];
		for (const e of edges) {
			const fp = nodePos[e.fromId];
			const tp = nodePos[e.toId];
			if (!fp || !tp) continue;
			const fw = fp.w || NODE_W,
				fh = fp.h || NODE_H;
			const tw = tp.w || NODE_W,
				th = tp.h || NODE_H;
			base.push({
				...e,
				x1: panX + (fp.x + fw / 2) * zoom,
				y1: panY + (fp.y + fh / 2) * zoom,
				x2: panX + (tp.x + tw / 2) * zoom,
				y2: panY + (tp.y + th / 2) * zoom
			});
		}

		// Pass 2: group by undirected pair-key. Edges A→B and B→A share a
		// pair so they fan together (both lines connect the same two nodes
		// visually).
		const groups = new Map<string, Geom[]>();
		for (const g of base) {
			const key = g.fromId < g.toId ? `${g.fromId}|${g.toId}` : `${g.toId}|${g.fromId}`;
			const list = groups.get(key) ?? [];
			list.push(g);
			groups.set(key, list);
		}

		// Pass 3: for each group with > 1 edge, distribute perpendicular
		// offsets centered around the original line. For a group of N edges,
		// offset i is (i - (N-1)/2) * PARALLEL_OFFSET_PX. Sort within the
		// group by edge id for stable ordering across re-renders so an edge
		// doesn't visually swap sides when sibling edges are added/removed.
		const out: Geom[] = [];
		for (const group of groups.values()) {
			if (group.length === 1) {
				out.push(group[0]);
				continue;
			}
			group.sort((a, b) => a.id.localeCompare(b.id));
			const n = group.length;
			for (let i = 0; i < n; i++) {
				const g = group[i];
				const dx = g.x2 - g.x1;
				const dy = g.y2 - g.y1;
				const len = Math.hypot(dx, dy);
				if (len < 1) {
					// Coincident endpoints — can't compute a perpendicular
					// without dividing by zero. Render at base position.
					out.push(g);
					continue;
				}
				// Perpendicular unit vector (rotate 90° CCW).
				const px = -dy / len;
				const py = dx / len;
				const offset = (i - (n - 1) / 2) * PARALLEL_OFFSET_PX;
				out.push({
					...g,
					x1: g.x1 + px * offset,
					y1: g.y1 + py * offset,
					x2: g.x2 + px * offset,
					y2: g.y2 + py * offset
				});
			}
		}
		return out;
	});

	const connectLineStart = $derived(
		connecting
			? (() => {
					const fp = nodePos[connecting.fromId];
					if (!fp) return null;
					return {
						x: panX + (fp.x + (fp.w || NODE_W) / 2) * zoom,
						y: panY + (fp.y + (fp.h || NODE_H) / 2) * zoom
					};
				})()
			: null
	);

	// ── Fit-to-view ────────────────────────────────────────────────────────────
	function fitView(np: Record<string, NodePosition>) {
		if (!viewport) return;
		if (nodes.length === 0) return;
		const vw = viewport.clientWidth,
			vh = viewport.clientHeight;
		const xs = nodes.map((n) => np[n.id]?.x ?? 0);
		const ys = nodes.map((n) => np[n.id]?.y ?? 0);
		const minX = Math.min(...xs),
			minY = Math.min(...ys);
		const maxX = Math.max(...xs) + NODE_W,
			maxY = Math.max(...ys) + NODE_H;
		const contentW = maxX - minX + 80,
			contentH = maxY - minY + 80;
		// Clamp zoom: 0.2 minimum matches the wheel-zoom floor so an
		// auto-fit can always shrink to contain the full bounding box.
		// (Previously 0.7, which left wide layouts clipped — FG windows
		// inheriting StoryGraph-spread positions would render edges
		// through the viewport center while nodes sat offscreen.)
		// 2× max avoids over-scaling tight layouts.
		const z = Math.min(2, Math.max(0.2, Math.min((vw - 40) / contentW, (vh - 40) / contentH)));
		zoom = z;
		panX = (vw - contentW * z) / 2 - (minX - 40) * z;
		panY = (vh - contentH * z) / 2 - (minY - 40) * z;
	}

	onMount(() => {
		const ro = new ResizeObserver(() => {
			fitView(untrack(() => nodePos));
		});
		ro.observe(viewport);
		// Fit once after the initial seed lands.
		queueMicrotask(() => fitView(untrack(() => nodePos)));
		return () => ro.disconnect();
	});

	// ── Coord helpers ──────────────────────────────────────────────────────────
	function screenToCanvas(clientX: number, clientY: number) {
		const rect = viewport.getBoundingClientRect();
		return {
			x: (clientX - rect.left - panX) / zoom,
			y: (clientY - rect.top - panY) / zoom
		};
	}

	function viewportXY(clientX: number, clientY: number) {
		const rect = viewport.getBoundingClientRect();
		return { x: clientX - rect.left, y: clientY - rect.top };
	}

	// ── Pointer handlers ───────────────────────────────────────────────────────
	function onViewportPointerDown(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('.node') || target.closest('.gc-overlay-host')) return;
		panning = { startMX: e.clientX, startMY: e.clientY, startPX: panX, startPY: panY };
		viewport.setPointerCapture(e.pointerId);
	}

	function onNodePointerDown(e: PointerEvent, id: string) {
		const t = e.target as HTMLElement;
		// Don't start drag if the press began on overlay UI (connect handle, etc.)
		if (t.closest('.gc-no-drag')) return;
		e.stopPropagation();
		const p = nodePos[id];
		if (!p) return;
		const rect = viewport.getBoundingClientRect();
		draggingNode = {
			id,
			offX: e.clientX - rect.left - (panX + p.x * zoom),
			offY: e.clientY - rect.top - (panY + p.y * zoom)
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (draggingNode) {
			const rect = viewport.getBoundingClientRect();
			const nx = (e.clientX - rect.left - draggingNode.offX - panX) / zoom;
			const ny = (e.clientY - rect.top - draggingNode.offY - panY) / zoom;
			nodePos = {
				...nodePos,
				[draggingNode.id]: { ...nodePos[draggingNode.id], x: nx, y: ny }
			};
		} else if (panning) {
			panX = panning.startPX + (e.clientX - panning.startMX);
			panY = panning.startPY + (e.clientY - panning.startMY);
		} else if (connecting) {
			const vp = viewportXY(e.clientX, e.clientY);
			connecting = { ...connecting, screenX: vp.x, screenY: vp.y };
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (draggingNode) {
			const id = draggingNode.id;
			const p = nodePos[id];
			if (p && onNodePositionChange) onNodePositionChange(id, p);
			draggingNode = null;
		} else if (panning) {
			panning = null;
		} else if (connecting) {
			const c = screenToCanvas(e.clientX, e.clientY);
			const target = nodes.find((n) => {
				if (n.id === connecting!.fromId) return false;
				const p = nodePos[n.id];
				if (!p) return false;
				const w = p.w || NODE_W,
					h = p.h || NODE_H;
				return c.x >= p.x && c.x <= p.x + w && c.y >= p.y && c.y <= p.y + h;
			});
			if (target && onConnect) {
				const vp = viewportXY(e.clientX, e.clientY);
				onConnect(connecting.fromId, target.id, vp.x, vp.y);
			}
			connecting = null;
		}
	}

	// pointercancel fires when the OS or browser interrupts the gesture
	// (touch interrupted by a scroll, stylus lift, browser taking over).
	// Clear all in-progress state without committing — connecting in
	// particular must NOT fire onConnect even if the cancel point happens
	// to be over a target node.
	function onPointerCancel() {
		draggingNode = null;
		panning = null;
		connecting = null;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const rect = viewport.getBoundingClientRect();
		const mx = e.clientX - rect.left,
			my = e.clientY - rect.top;
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		const newZoom = Math.max(0.2, Math.min(4, zoom * factor));
		panX = mx - (mx - panX) * (newZoom / zoom);
		panY = my - (my - panY) * (newZoom / zoom);
		zoom = newZoom;
	}

	function onNodeDblClick(e: MouseEvent, id: string) {
		e.stopPropagation();
		onNodeOpen?.(id);
	}

	function onNodeContextMenu(e: MouseEvent, id: string) {
		e.preventDefault();
		e.stopPropagation();
		// UX collision rule (locked C3): right-clicking during a connect-drag
		// CANCELS the connect and does NOT open the menu. Drop any in-progress
		// connect state before deciding whether to fire onContextMenu.
		if (connecting) {
			connecting = null;
			return;
		}
		// Pass BROWSER-VIEWPORT coords (clientX/clientY) — ContextMenu uses
		// position: fixed and needs viewport coords, not canvas-local. Greptile
		// P1 on PR #12: the previous viewportXY() return value (canvas-local)
		// made the menu appear offset by the host window's position.
		onContextMenu?.(id, e.clientX, e.clientY);
	}

	function onEdgeContextMenuHandler(e: MouseEvent, id: string) {
		e.preventDefault();
		e.stopPropagation();
		onEdgeContextMenu?.(id, e.clientX, e.clientY);
	}

	/**
	 * Force-merge external position updates into the canvas's internal nodePos
	 * and re-fit. Used by hosts that mutate positions out-of-band (e.g.
	 * FocusedGraph's "Layout by type") — the host can't reach into nodePos
	 * directly because GraphCanvas's seededFromServer guard runs once. This
	 * is the well-defined escape hatch.
	 *
	 * Reassigns nodePos so Svelte 5 $derived deps (screenEdges) invalidate;
	 * fitView runs on the next microtask so layout effects settle first.
	 */
	export function getPosition(id: string): NodePosition | undefined {
		return nodePos[id];
	}

	export function reseed(positions: Record<string, NodePosition>, { fit = true }: { fit?: boolean } = {}) {
		const merged = { ...nodePos };
		for (const [id, p] of Object.entries(positions)) {
			merged[id] = { ...merged[id], ...p };
		}
		nodePos = merged;
		if (fit) queueMicrotask(() => fitView(nodePos));
	}

	/** Re-center the viewport on the current set of nodes (e.g. after a host
	    mutation that changed node count or extents). Idempotent. */
	export function refit() {
		fitView(nodePos);
	}

	/**
	 * Clear all internal positions. The auto-place `$effect` re-runs and
	 * fills any "missing" nodes (which is now all of them) with grid
	 * defaults. Hosts use this for a "reset to unstructured state"
	 * affordance — the user wants to discard the current layout and
	 * start over from the canvas's natural fallback.
	 */
	export function resetPositions() {
		nodePos = {};
		seededFromServer = false;
	}

	// Public-via-snippet method: overlay UI calls this to start a connection drag.
	export function startConnect(e: PointerEvent, fromId: string) {
		e.stopPropagation();
		const vp = viewportXY(e.clientX, e.clientY);
		connecting = { fromId, screenX: vp.x, screenY: vp.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
</script>

<div
	class="viewport"
	role="application"
	aria-label="Graph canvas"
	bind:this={viewport}
	onpointerdown={onViewportPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerCancel}
	onwheel={onWheel}
	style:cursor={panning ? 'grabbing' : 'default'}
>
	<!-- Edge SVG fills the viewport in screen coords — no transform needed -->
	<svg class="edges" aria-hidden="true">
		<!-- One arrowhead marker, color-inheriting via context-stroke so a
		     single marker definition works for every relationship type
		     instead of N markers in defs. SVG 2 feature; supported in
		     Chrome 119+ / Firefox 121+ / Safari 16.2+. Fallback renders
		     black, which is wrong but still visible. -->
		<defs>
			<marker
				id={arrowMarkerId}
				viewBox="0 0 10 10"
				refX="10"
				refY="5"
				markerWidth="6"
				markerHeight="6"
				orient="auto"
				markerUnits="strokeWidth"
			>
				<path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
			</marker>
		</defs>
		{#each screenEdges as edge (edge.id)}
			{@const isMystery = edge.mysteryMode === true}
			{@const isGhost = !isMystery && (edge.ghostMode === 'past' || edge.ghostMode === 'future')}
			{@const strokeColor = isMystery
				? 'var(--color-rel-mystery)'
				: edge.color}
			{@const strokeOpacity = isMystery
				? 0.2
				: isGhost
					? edge.ghostMode === 'past'
						? 0.40
						: 0.28
					: edge.dimmed
						? 0.1
						: 0.45}
			{@const strokeDash = isMystery
				? '2 4'
				: isGhost
					? edge.ghostMode === 'past'
						? '8 3'
						: '2 5'
					: (edge.dasharray ?? undefined)}
			{@const mx = (edge.x1 + edge.x2) / 2}
			{@const my = (edge.y1 + edge.y2) / 2}
			<line
				x1={edge.x1}
				y1={edge.y1}
				x2={edge.x2}
				y2={edge.y2}
				stroke={strokeColor}
				stroke-width={edge.width ?? 1.5}
				stroke-opacity={strokeOpacity}
				stroke-dasharray={strokeDash}
				marker-end={edge.arrow && !isMystery ? `url(#${arrowMarkerId})` : undefined}
				pointer-events="none"
			/>
			<!-- Invisible wider hit-area for right-click. Always rendered so the
			     pointer-events layer doesn't depend on a prop check in the loop. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<line
				x1={edge.x1}
				y1={edge.y1}
				x2={edge.x2}
				y2={edge.y2}
				stroke="currentColor"
				stroke-width="10"
				stroke-opacity="0"
				pointer-events="stroke"
				oncontextmenu={(e) => onEdgeContextMenuHandler(e, edge.id)}
				onpointerdown={(e) => e.stopPropagation()}
			/>
			{#if showEdgeLabels && !isMystery && !isGhost}
				<text
					x={mx}
					y={my - 5}
					fill={edge.color}
					font-size="10"
					text-anchor="middle"
					opacity={edge.dimmed ? '0.15' : '0.75'}
					font-family="Inter, Segoe UI, sans-serif">{edge.label}</text
				>
			{/if}
		{/each}
		{#if connecting && connectLineStart}
			<line
				x1={connectLineStart.x}
				y1={connectLineStart.y}
				x2={connecting.screenX}
				y2={connecting.screenY}
				stroke="var(--color-accent)"
				stroke-width="1.5"
				stroke-dasharray="5 3"
				stroke-opacity="0.6"
			/>
		{/if}
	</svg>

	<!-- Node canvas layer: pan/zoom applied here -->
	<div
		class="canvas"
		style="transform: translate({panX}px,{panY}px) scale({zoom}); transform-origin: 0 0"
	>
		{#each nodes as node (node.id)}
			{@const p = nodePos[node.id]}
			{#if p}
				{@const nc = node.color ?? NODE_COLOR[node.type as keyof typeof NODE_COLOR] ?? 'var(--color-accent)'}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="node"
					data-entity-id={node.id}
					class:node-active={hoveredNodeId === node.id || draggingNode?.id === node.id}
					class:node-out-of-scope={dimmedNodes.has(node.id)}
					class:node-alias-member={node.aliasMember}
					style="left:{p.x}px; top:{p.y}px; --nc:{nc}"
					onpointerdown={(e) => onNodePointerDown(e, node.id)}
					ondblclick={(e) => onNodeDblClick(e, node.id)}
					oncontextmenu={(e) => onNodeContextMenu(e, node.id)}
					onpointerenter={() => (hoveredNodeId = node.id)}
					onpointerleave={() => {
						if (draggingNode?.id !== node.id) hoveredNodeId = null;
					}}
					role="button"
					tabindex="0"
					aria-label="Open {node.name}"
				>
					<span class="node-name">{node.name}</span>
					<span class="node-type">{node.type}</span>
					{#if nodeBadge}
						<span class="gc-badge-host">
							{@render nodeBadge({
								id: node.id,
								hovered: hoveredNodeId === node.id,
								dragging: draggingNode?.id === node.id
							})}
						</span>
					{/if}
					{#if nodeOverlay && hoveredNodeId === node.id && !draggingNode && !panning}
						<div class="gc-overlay-host gc-no-drag">
							{@render nodeOverlay({
								id: node.id,
								hovered: true,
								dragging: false
							})}
						</div>
					{/if}
				</div>
			{/if}
		{/each}
	</div>

	{#if nodes.length === 0 && emptyState}
		{@render emptyState()}
	{/if}
</div>

<style>
	.viewport {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--color-surface);
		touch-action: none;
		user-select: none;
	}

	.edges {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.canvas {
		position: absolute;
		width: 0;
		height: 0;
	}

	/* Mirrors the timeline bar styling (IntervalBar.svelte): 18%
	   translucent fill of the entity color, 50% translucent stroke,
	   name text in the full entity color. Same entity now reads as
	   the same color across Timeline + StoryGraph + FocusedGraph. */
	.node {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		background: color-mix(in srgb, var(--nc) 18%, transparent);
		border: 1.5px solid color-mix(in srgb, var(--nc) 50%, transparent);
		border-radius: 6px;
		box-shadow: 0 0 12px color-mix(in srgb, var(--nc) 12%, transparent);
		cursor: grab;
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--nc);
		white-space: nowrap;
		transition: opacity 200ms ease;
	}

	.node-active {
		border-color: var(--nc);
		background: color-mix(in srgb, var(--nc) 28%, transparent);
		box-shadow: 0 0 16px color-mix(in srgb, var(--nc) 30%, transparent);
	}

	.node-out-of-scope {
		opacity: 0.18;
	}

	.node-alias-member {
		border-style: dashed;
	}

	.node-name {
		font-weight: 600;
		color: var(--nc);
	}

	/* Type label sits as a quieter tint of the same color so the node
	   reads as one unit but the type chip doesn't fight the name. */
	.node-type {
		color: color-mix(in srgb, var(--nc) 70%, var(--color-text-muted));
		font-size: 11px;
	}

	.gc-overlay-host {
		display: contents;
	}

	.gc-badge-host {
		display: contents;
	}
</style>
