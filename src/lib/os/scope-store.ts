import { derived } from 'svelte/store';
import { playhead } from '$lib/features/timeline/playhead-store.js';
import { intervals, type Interval } from '$lib/features/timeline/intervals-store.js';
import { entities, type Entity } from '$lib/stores/entities.js';

export type ScopedEntity = { id: string; type: Entity['type']; name: string };

/**
 * Pure derivation of in-scope entities. Exported so tests can exercise it
 * without mocking the singleton stores. Half-open interval check matches
 * intervalContainsT in playhead.ts.
 */
export function deriveScope(
	$playhead: number | null,
	$intervals: Interval[],
	$entities: Entity[]
): ScopedEntity[] {
	if ($playhead === null) {
		return $entities.map((e) => ({ id: e.id, type: e.type, name: e.name }));
	}
	const inScopeIds = new Set<string>();
	for (const iv of $intervals) {
		if (iv.startPosition <= $playhead && $playhead < iv.endPosition) {
			inScopeIds.add(iv.entityId);
		}
	}
	return $entities
		.filter((e) => inScopeIds.has(e.id))
		.map((e) => ({ id: e.id, type: e.type, name: e.name }));
}

/**
 * Derived store: the set of entities whose intervals contain the current
 * playhead position. Empty when playhead is null (idle = show everything).
 */
const currentScope = derived(
	[playhead, intervals, entities],
	([$playhead, $intervals, $entities]) => deriveScope($playhead, $intervals, $entities)
);

/** Convenience: is a given entity ID in scope right now? */
export const isInScope = derived(currentScope, ($scope) => {
	const ids = new Set($scope.map((e) => e.id));
	return (entityId: string) => ids.has(entityId);
});
