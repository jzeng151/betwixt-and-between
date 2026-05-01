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
	}

	export interface GraphEdge {
		id: string;
		fromId: string;
		toId: string;
		color: string;
		label: string;
		dimmed: boolean;
	}

	export interface NodePosition {
		x: number;
		y: number;
		w: number;
		h: number;
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
		onContextMenu
	}: Props = $props();

	const NODE_W = 120;
	const NODE_H = 32;

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
	const screenEdges = $derived(
		edges
			.map((e) => {
				const fp = nodePos[e.fromId];
				const tp = nodePos[e.toId];
				if (!fp || !tp) return null;
				const fw = fp.w || NODE_W,
					fh = fp.h || NODE_H;
				const tw = tp.w || NODE_W,
					th = tp.h || NODE_H;
				return {
					...e,
					x1: panX + (fp.x + fw / 2) * zoom,
					y1: panY + (fp.y + fh / 2) * zoom,
					x2: panX + (tp.x + tw / 2) * zoom,
					y2: panY + (tp.y + th / 2) * zoom
				};
			})
			.filter(Boolean) as Array<
			GraphEdge & { x1: number; y1: number; x2: number; y2: number }
		>
	);

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
		// Clamp zoom: 0.7 minimum keeps text readable, 2 maximum avoids over-scaling
		const z = Math.min(2, Math.max(0.7, Math.min((vw - 40) / contentW, (vh - 40) / contentH)));
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
	export function reseed(positions: Record<string, NodePosition>) {
		const merged = { ...nodePos };
		for (const [id, p] of Object.entries(positions)) {
			merged[id] = { ...merged[id], ...p };
		}
		nodePos = merged;
		queueMicrotask(() => fitView(nodePos));
	}

	/** Re-center the viewport on the current set of nodes (e.g. after a host
	    mutation that changed node count or extents). Idempotent. */
	export function refit() {
		fitView(nodePos);
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
		{#each screenEdges as edge (edge.id)}
			{@const mx = (edge.x1 + edge.x2) / 2}
			{@const my = (edge.y1 + edge.y2) / 2}
			<line
				x1={edge.x1}
				y1={edge.y1}
				x2={edge.x2}
				y2={edge.y2}
				stroke={edge.color}
				stroke-width="1.5"
				stroke-opacity={edge.dimmed ? '0.1' : '0.45'}
			/>
			<text
				x={mx}
				y={my - 5}
				fill={edge.color}
				font-size="9"
				text-anchor="middle"
				opacity={edge.dimmed ? '0.15' : '0.75'}
				font-family="Inter, Segoe UI, sans-serif">{edge.label}</text
			>
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
				{@const nc = NODE_COLOR[node.type as keyof typeof NODE_COLOR] ?? 'var(--color-accent)'}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="node"
					class:node-active={hoveredNodeId === node.id || draggingNode?.id === node.id}
					class:node-out-of-scope={dimmedNodes.has(node.id)}
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
		pointer-events: none;
	}

	.canvas {
		position: absolute;
		width: 0;
		height: 0;
	}

	.node {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		background: var(--color-surface-2);
		border: 1.5px solid color-mix(in srgb, var(--nc) 40%, transparent);
		border-radius: 6px;
		box-shadow: 0 0 12px color-mix(in srgb, var(--nc) 12%, transparent);
		cursor: grab;
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-text);
		white-space: nowrap;
		transition: opacity 200ms ease;
	}

	.node-active {
		border-color: var(--nc);
		box-shadow: 0 0 16px color-mix(in srgb, var(--nc) 30%, transparent);
	}

	.node-out-of-scope {
		opacity: 0.18;
	}

	.node-name {
		font-weight: 600;
	}

	.node-type {
		color: var(--color-text-muted);
		font-size: 10px;
	}

	.gc-overlay-host {
		display: contents;
	}

	.gc-badge-host {
		display: contents;
	}
</style>
