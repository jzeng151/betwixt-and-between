/**
 * "Layout by type" — dagre-driven layered layout (Phase 1B C5).
 *
 * Algorithm (locked T2A in CONSIDERATIONS):
 *   1. unpinned ← visibleSet − pinnedSet (per the calling window)
 *   2. for each n in unpinned: dagreNode.rank = typeOrder.indexOf(n.type)
 *   3. dagre.layout(unpinned, edges_among_unpinned) → positions
 *   4. shift = centroid(pinnedSet current positions) − centroid(positions)
 *               if pinnedSet empty: shift to viewport center via existing fitView
 *   5. apply shift to all unpinned positions
 *   6. write unpinned to window_canvas_state via A3 batch endpoint (caller does this)
 *
 * Pinned-stays-put is the sacred invariant. Edges crossing pinned ↔ unpinned
 * may render visually ugly post-layout — the locked plan accepts that cost
 * rather than re-layouting pinned nodes.
 *
 * Bundle cost: dagre is ~80 KB minified. The host should dynamic-import this
 * module on first call so the cost is paid once on demand, not on every
 * page load. Caller pattern:
 *
 *   const { layoutByType } = await import('$lib/graph/dagre-layout.js');
 *   const positions = await layoutByType({ ... });
 */

import type { EntityType } from '$lib/server/db/schema.js';

export interface LayoutNode {
	id: string;
	type: EntityType;
	width: number;
	height: number;
}

export interface LayoutEdge {
	fromId: string;
	toId: string;
}

export interface CurrentPosition {
	id: string;
	x: number;
	y: number;
}

export interface LayoutByTypeInput {
	/** Visible set (post-traversal). All nodes that should be considered. */
	nodes: LayoutNode[];
	/** Edges among the nodes. Edges whose endpoints aren't in `nodes` are dropped. */
	edges: LayoutEdge[];
	/** Set of node ids that are pinned (must NOT move during layout). */
	pinnedIds: Set<string>;
	/** Current positions for ALL nodes (used to compute the shift; pinned values
	    are read, unpinned only matter if pinnedIds is empty for fitView centering). */
	currentPositions: CurrentPosition[];
	/** Caller's typeOrder array. Each unpinned node's rank = typeOrder.indexOf(node.type). */
	typeOrder: EntityType[];
	/** Optional viewport center to use when pinnedSet is empty. If unset, layout
	    is centered around (0, 0); the caller's existing fitView usually handles
	    centering after the write so this is fine to omit. */
	viewportCenter?: { x: number; y: number };
}

export interface LayoutResult {
	id: string;
	x: number;
	y: number;
}

/**
 * Run dagre on the unpinned subset and return their NEW positions. Pinned
 * nodes are NOT included in the result (their existing positions are
 * authoritative; the caller need not write them).
 *
 * Returns an empty array if every node is pinned (nothing to lay out).
 */
export async function layoutByType(input: LayoutByTypeInput): Promise<LayoutResult[]> {
	const { nodes, edges, pinnedIds, currentPositions, typeOrder, viewportCenter } = input;

	const unpinned = nodes.filter((n) => !pinnedIds.has(n.id));
	if (unpinned.length === 0) return [];

	const unpinnedIds = new Set(unpinned.map((n) => n.id));
	const edgesAmongUnpinned = edges.filter(
		(e) => unpinnedIds.has(e.fromId) && unpinnedIds.has(e.toId)
	);

	// Dynamic-import keeps the ~80KB bundle cost off the page-load path.
	// Vite resolves this at build time so the chunk lands as a separate JS
	// file pulled on first call.
	const dagre = await import('dagre');

	// Top-down layered layout. ranksep: vertical gap between type ranks.
	// nodesep: horizontal gap within a rank. Tuned for ~120×32 nodes (the
	// GraphCanvas default size) — a tight 40px nodesep keeps related nodes
	// visually close without overlap; 80px ranksep gives the type bands
	// breathing room.
	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40, marginx: 20, marginy: 20 });
	g.setDefaultEdgeLabel(() => ({}));

	for (const n of unpinned) {
		// Dagre supports per-node rank assignment; rank 0 is the topmost band.
		// indexOf returning -1 (type not in typeOrder) defaults to the bottom
		// rather than the top so the user's intended ordering for known types
		// always wins.
		const rank = typeOrder.indexOf(n.type);
		g.setNode(n.id, {
			label: n.id,
			width: n.width,
			height: n.height,
			rank: rank === -1 ? typeOrder.length : rank
		});
	}

	for (const e of edgesAmongUnpinned) {
		g.setEdge(e.fromId, e.toId);
	}

	dagre.layout(g);

	// dagre returns CENTER positions for nodes; convert to top-left for our
	// coord system (matches the rest of the canvas which positions by
	// top-left).
	const raw: LayoutResult[] = unpinned.map((n) => {
		const dn = g.node(n.id) as { x: number; y: number; width: number; height: number };
		return {
			id: n.id,
			x: dn.x - dn.width / 2,
			y: dn.y - dn.height / 2
		};
	});

	// Shift step: align the new layout's centroid with either (a) the pinned
	// set's centroid (when there is a pinnedSet) or (b) the viewport center
	// (when pinnedSet is empty — falls back to the caller's existing fitView
	// if viewportCenter is unset).
	const newCentroid = centroid(raw.map((p) => ({ x: p.x, y: p.y })));
	let shift = { x: -newCentroid.x, y: -newCentroid.y };

	if (pinnedIds.size > 0) {
		const pinnedPositions = currentPositions.filter((p) => pinnedIds.has(p.id));
		if (pinnedPositions.length > 0) {
			const pinnedCentroid = centroid(pinnedPositions);
			shift = {
				x: pinnedCentroid.x - newCentroid.x,
				y: pinnedCentroid.y - newCentroid.y
			};
		}
	} else if (viewportCenter) {
		shift = {
			x: viewportCenter.x - newCentroid.x,
			y: viewportCenter.y - newCentroid.y
		};
	}

	return raw.map((p) => ({ id: p.id, x: p.x + shift.x, y: p.y + shift.y }));
}

function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
	if (points.length === 0) return { x: 0, y: 0 };
	let sx = 0,
		sy = 0;
	for (const p of points) {
		sx += p.x;
		sy += p.y;
	}
	return { x: sx / points.length, y: sy / points.length };
}
