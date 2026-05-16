/**
 * Client-side adjacency helpers over the Location parent/child hierarchy
 * modelled as `part_of` relationships (WorldMap v2 Step 2).
 *
 * Pure functions over the in-memory relationship snapshot. Caller passes the
 * full relationships list; helpers index it once per call and return adjacency
 * lookups. For hot paths (breadcrumb walks, drill-down probes on every region
 * click) wrap with `buildHierarchyIndex` and reuse the index — same shape, one
 * pass instead of N.
 *
 * Server-side invariants (location-hierarchy.ts on the server) guarantee:
 *   - both endpoints are Location entities
 *   - each child has at most one parent
 *   - no cycles
 * Helpers here trust those invariants and do not re-validate. The depth guard
 * is defence against malformed data only (e.g. a future schema regression).
 */
import type { Relationship } from './stores/relationships.js';

const MAX_DEPTH = 64;

export type HierarchyIndex = {
	/** Map from child locationId → parent locationId. */
	parentOf: Map<string, string>;
	/** Map from parent locationId → array of child locationIds (insertion order). */
	childrenOf: Map<string, string[]>;
};

export function buildHierarchyIndex(relationships: Relationship[]): HierarchyIndex {
	const parentOf = new Map<string, string>();
	const childrenOf = new Map<string, string[]>();
	for (const r of relationships) {
		if (r.type !== 'part_of') continue;
		parentOf.set(r.fromId, r.toId);
		const siblings = childrenOf.get(r.toId);
		if (siblings) siblings.push(r.fromId);
		else childrenOf.set(r.toId, [r.fromId]);
	}
	return { parentOf, childrenOf };
}

/**
 * Walk ancestors of `locationId`, returning the chain from root to direct
 * parent (the `locationId` itself is NOT included). Empty array if root.
 */
export function walkAncestors(index: HierarchyIndex, locationId: string): string[] {
	const chain: string[] = [];
	let cursor: string | undefined = index.parentOf.get(locationId);
	for (let i = 0; i < MAX_DEPTH && cursor; i++) {
		chain.unshift(cursor);
		cursor = index.parentOf.get(cursor);
	}
	return chain;
}

export function getChildren(index: HierarchyIndex, locationId: string): string[] {
	return index.childrenOf.get(locationId) ?? [];
}

export function getParent(index: HierarchyIndex, locationId: string): string | null {
	return index.parentOf.get(locationId) ?? null;
}
