import type { RelationshipType } from '$lib/server/db/schema.js';
import { DIRECTION } from './edge-policy.js';

export interface Edge {
	fromId: string;
	toId: string;
	type: RelationshipType;
}

export interface TraversalOptions {
	/**
	 * If true, structural entity types (Act / Scene) are walkable just
	 * like any other node. If false (default), edges TO/FROM a structural
	 * node are skipped during traversal — prevents huge appears_in /
	 * caused_by fan-outs from dominating the result set.
	 *
	 * The caller passes a Set<string> of "structural ids" since the
	 * traversal layer doesn't have access to entity types — keep the
	 * lookup O(1) and side-effect-free.
	 */
	includeStructural?: boolean;
	structuralIds?: Set<string>;
	/**
	 * If true, every edge is walked in both directions regardless of its
	 * type's `DIRECTION` policy. Useful for "everything connected to me
	 * somehow" views (e.g. FocusedGraph's `reachable` mode), where a
	 * focal Character should reach a Scene that is `pov_of` THEM — not
	 * just nodes the Character points AT.
	 *
	 * Default false: directed edges walk only in their declared
	 * direction, which is the correct semantic for causal views like
	 * "downstream of cause X" or "transitive mentees of Y."
	 */
	undirected?: boolean;
}

/**
 * True if this edge should be walked under the given options. When
 * structural exclusion is on and the structural set is provided, edges
 * touching a structural node are filtered out wholesale (both ends).
 */
function isWalkable(edge: Edge, opts: TraversalOptions | undefined): boolean {
	if (opts?.includeStructural) return true;
	const structural = opts?.structuralIds;
	if (!structural) return true;
	if (structural.has(edge.fromId) || structural.has(edge.toId)) return false;
	return true;
}

/**
 * Build an adjacency map from a flat edge list, honoring the directed/
 * symmetric policy: a symmetric edge adds both A→B and B→A.
 */
function buildAdjacency(
	edges: Edge[],
	opts: TraversalOptions | undefined
): Map<string, Set<string>> {
	const adj = new Map<string, Set<string>>();
	const add = (from: string, to: string) => {
		let s = adj.get(from);
		if (!s) {
			s = new Set();
			adj.set(from, s);
		}
		s.add(to);
	};
	const undirected = opts?.undirected === true;
	for (const e of edges) {
		if (!isWalkable(e, opts)) continue;
		add(e.fromId, e.toId);
		if (undirected || DIRECTION[e.type] === 'symmetric') {
			add(e.toId, e.fromId);
		}
	}
	return adj;
}

/** Set of ids reachable in exactly one hop FROM ANY id in focalSet. */
export function oneHopUnion(
	focalSet: Set<string>,
	edges: Edge[],
	opts?: TraversalOptions
): Set<string> {
	const result = new Set<string>();
	if (focalSet.size === 0) return result;
	const adj = buildAdjacency(edges, opts);
	for (const id of focalSet) {
		const neighbors = adj.get(id);
		if (!neighbors) continue;
		for (const n of neighbors) result.add(n);
	}
	return result;
}

/**
 * Set of ids reachable in exactly one hop from EVERY id in focalSet
 * (intersection across focal nodes — a "shared neighbor" view).
 * If focalSet is empty, returns an empty set. If focalSet has one
 * element, returns its 1-hop neighbors (degenerate intersection).
 */
export function sharedNeighbors(
	focalSet: Set<string>,
	edges: Edge[],
	opts?: TraversalOptions
): Set<string> {
	if (focalSet.size === 0) return new Set();
	const adj = buildAdjacency(edges, opts);
	const focals = [...focalSet];
	const first = adj.get(focals[0]) ?? new Set<string>();
	if (focals.length === 1) return new Set(first);
	const result = new Set<string>();
	for (const candidate of first) {
		let inAll = true;
		for (let i = 1; i < focals.length; i++) {
			const neighbors = adj.get(focals[i]);
			if (!neighbors || !neighbors.has(candidate)) {
				inAll = false;
				break;
			}
		}
		if (inAll) result.add(candidate);
	}
	return result;
}

/**
 * All ids reachable from any id in focalSet via cycle-safe BFS.
 * Includes focal ids themselves in the result.
 */
export function reachable(
	focalSet: Set<string>,
	edges: Edge[],
	opts?: TraversalOptions
): Set<string> {
	const visited = new Set<string>();
	if (focalSet.size === 0) return visited;
	const adj = buildAdjacency(edges, opts);
	const queue: string[] = [];
	for (const id of focalSet) {
		visited.add(id);
		queue.push(id);
	}
	while (queue.length > 0) {
		const id = queue.shift()!;
		const neighbors = adj.get(id);
		if (!neighbors) continue;
		for (const n of neighbors) {
			if (!visited.has(n)) {
				visited.add(n);
				queue.push(n);
			}
		}
	}
	return visited;
}
