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

interface LayoutNode {
	id: string;
	type: EntityType;
	width: number;
	height: number;
}

interface LayoutEdge {
	fromId: string;
	toId: string;
}

interface CurrentPosition {
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

	// Group unpinned nodes by entity type. Dagre 0.8.5's `setNode({rank: n})`
	// is silently IGNORED — rank is computed from edge direction, not
	// settable as input. Forcing type-rank ordering through dagre requires
	// either phantom anchor nodes or a layered post-process. We pick the
	// post-process: assign Y per rank manually (typeOrder.indexOf wins),
	// run dagre per-rank to get smart X positions (intra-rank edge-
	// crossing minimization). This keeps dagre's value (per-rank X layout)
	// without fighting its API for cross-rank ranking.
	const nodesByType = new Map<EntityType, LayoutNode[]>();
	for (const n of unpinned) {
		const list = nodesByType.get(n.type) ?? [];
		list.push(n);
		nodesByType.set(n.type, list);
	}
	// Ordered ranks: typeOrder first (only types with actual nodes), then
	// any remaining types not in typeOrder (sink-rank, deterministic by
	// insertion order).
	const presentInOrder = typeOrder.filter((t) => nodesByType.has(t));
	const extraTypes = [...nodesByType.keys()].filter((t) => !typeOrder.includes(t));
	const orderedTypes = [...presentInOrder, ...extraTypes];

	// Per-type horizontal pack. Earlier rounds tried `dagre per-type` to
	// get smart intra-type X ordering, but that required clamping all
	// same-type nodes to a single Y line — and dagre's LR layout
	// frequently puts unrelated nodes at the SAME rank (X), which after
	// the Y-clamp produced perfect overlap at one coordinate. The
	// cascade complaint was real: rank-sharing nodes ended up stacked
	// at one X.
	//
	// We trade dagre's edge-crossing minimization for a deterministic
	// left-to-right pack: each node gets its own X slot at
	// `xCursor += width + NODE_GAP`. No overlap is possible because
	// every node lives at a distinct X. Iteration order = entity store
	// order; if a smarter intra-type ordering becomes a feature ask, it
	// belongs upstream of this layout.
	const NODE_GAP = 60; // horizontal gap between adjacent nodes within a type
	const TYPE_BAND_GAP = 140; // vertical gap between type bands

	const raw: LayoutResult[] = [];
	let rankYCursor = 0;

	for (const type of orderedTypes) {
		const rankNodes = nodesByType.get(type)!;
		const rankHeight = Math.max(...rankNodes.map((n) => n.height));

		let xCursor = 0;
		for (const n of rankNodes) {
			raw.push({
				id: n.id,
				x: xCursor,
				y: rankYCursor
			});
			xCursor += n.width + NODE_GAP;
		}
		rankYCursor += rankHeight + TYPE_BAND_GAP;
	}

	// Note: cross-rank edges are visualized in the canvas but don't
	// constrain layout. This is a deliberate simplification vs. a global
	// dagre layout — the locked T2A algorithm prioritizes type-rank
	// ordering as the dominant signal.

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
