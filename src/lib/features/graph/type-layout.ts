import type { EntityType } from '$lib/server/db/schema.js';

interface LayoutNode {
	id: string;
	type: EntityType;
	width: number;
	height: number;
}

interface CurrentPosition {
	id: string;
	x: number;
	y: number;
}

export interface LayoutByTypeInput {
	/** Visible set (post-traversal). All nodes that should be considered. */
	nodes: LayoutNode[];
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
 * Pack unpinned nodes into rows by type and return their NEW positions. Pinned
 * nodes are NOT included in the result (their existing positions are
 * authoritative; the caller need not write them).
 *
 * Returns an empty array if every node is pinned (nothing to lay out).
 */
export function layoutByType(input: LayoutByTypeInput): LayoutResult[] {
	const { nodes, pinnedIds, currentPositions, typeOrder, viewportCenter } = input;

	const unpinned = nodes.filter((n) => !pinnedIds.has(n.id));
	if (unpinned.length === 0) return [];

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
