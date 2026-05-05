import { derived } from 'svelte/store';
import { playhead } from './playhead.js';
import { intervals } from './intervals.js';
import { entities } from './entities.js';

/** A single entity that is "in scope" at the current playhead position. */
export interface ScopedEntity {
	id: string;
	type: string;
	name: string;
}

/**
 * Derived store: the set of entities whose intervals contain the current
 * playhead position. Empty when playhead is null (idle = show everything).
 *
 * Uses half-open interval check: startPosition <= T < endPosition
 * (matches intervalContainsT in playhead.ts).
 *
 * Consumers subscribe to `currentScope` and get reactive updates
 * whenever playhead moves or intervals change.
 */
export const currentScope = derived(
	[playhead, intervals, entities],
	([$playhead, $intervals, $entities]) => {
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
);

/** Convenience: is a given entity ID in scope right now? */
export const isInScope = derived(currentScope, ($scope) => {
	const ids = new Set($scope.map((e) => e.id));
	return (entityId: string) => ids.has(entityId);
});

/** Convenience: how many entities are in scope (0 = idle or empty). */
export const scopeCount = derived(currentScope, ($scope) => $scope.length);
