import { derived } from 'svelte/store';
import { playhead } from './playhead.js';
import { intervals } from './intervals.js';
import { entities } from './entities.js';

/**
 * Derived store: the set of entities whose intervals contain the current
 * playhead position. Empty when playhead is null (idle = show everything).
 *
 * Uses half-open interval check: startPosition <= T < endPosition
 * (matches intervalContainsT in playhead.ts).
 */
const currentScope = derived(
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
