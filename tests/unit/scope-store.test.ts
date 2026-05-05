import { describe, it, expect } from 'vitest';
import { writable, derived, get } from 'svelte/store';
import type { Interval } from '../../src/lib/stores/intervals.js';
import type { Entity } from '../../src/lib/stores/entities.js';

/**
 * Unit tests for the scope-store derivation logic.
 *
 * Rather than importing the singleton `currentScope` (which depends on
 * singleton stores that require fetch mocking), we recreate the same
 * derivation function against local writables. This tests the pure logic
 * without I/O.
 */

type ScopedEntity = { id: string; type: string; name: string };

function mkEntity(overrides: Partial<Entity> & { id: string }): Entity {
	return {
		type: 'Character',
		name: 'Test',
		data: {},
		parentId: null,
		position: null,
		createdAt: '',
		updatedAt: '',
		...overrides
	};
}

function mkInterval(overrides: Partial<Interval> = {}): Interval {
	return {
		id: 'i1',
		entityId: 'e1',
		startActId: 'act1',
		startSceneId: null,
		endActId: 'act1',
		endSceneId: null,
		startPosition: 1.0,
		endPosition: 2.0,
		createdAt: '',
		updatedAt: '',
		...overrides
	};
}

/** The same derivation function used by src/lib/stores/scope.ts */
function deriveScope(
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

describe('scope store derivation', () => {
	it('returns all entities when playhead is null (idle)', () => {
		const entities = [
			mkEntity({ id: 'e1', name: 'Alice' }),
			mkEntity({ id: 'e2', name: 'Bob' })
		];
		const result = deriveScope(null, [], entities);
		expect(result).toEqual([
			{ id: 'e1', type: 'Character', name: 'Alice' },
			{ id: 'e2', type: 'Character', name: 'Bob' }
		]);
	});

	it('returns only entities whose intervals contain the playhead position', () => {
		const entities = [
			mkEntity({ id: 'e1', name: 'Alice' }),
			mkEntity({ id: 'e2', name: 'Bob' }),
			mkEntity({ id: 'e3', name: 'Carol' })
		];
		const intervals = [
			mkInterval({ id: 'i1', entityId: 'e1', startPosition: 0, endPosition: 2 }),
			mkInterval({ id: 'i2', entityId: 'e3', startPosition: 3, endPosition: 5 })
		];
		const result = deriveScope(1, intervals, entities);
		expect(result).toEqual([{ id: 'e1', type: 'Character', name: 'Alice' }]);
	});

	it('excludes entities with no intervals when playhead is active', () => {
		const entities = [mkEntity({ id: 'e1', name: 'Alice' })];
		const result = deriveScope(1, [], entities);
		expect(result).toEqual([]);
	});

	it('includes entity at exact startPosition (boundary)', () => {
		const entities = [mkEntity({ id: 'e1', name: 'Alice' })];
		const intervals = [mkInterval({ entityId: 'e1', startPosition: 1.0, endPosition: 2.0 })];
		const result = deriveScope(1.0, intervals, entities);
		expect(result).toEqual([{ id: 'e1', type: 'Character', name: 'Alice' }]);
	});

	it('excludes entity at exact endPosition (half-open)', () => {
		const entities = [mkEntity({ id: 'e1', name: 'Alice' })];
		const intervals = [mkInterval({ entityId: 'e1', startPosition: 1.0, endPosition: 2.0 })];
		const result = deriveScope(2.0, intervals, entities);
		expect(result).toEqual([]);
	});

	it('reactively updates when playhead moves (derived store)', () => {
		const playhead = writable<number | null>(null);
		const intervals = writable<Interval[]>([
			mkInterval({ entityId: 'e1', startPosition: 0, endPosition: 2 })
		]);
		const entities = writable<Entity[]>([mkEntity({ id: 'e1', name: 'Alice' })]);

		const scope = derived([playhead, intervals, entities], ([$ph, $iv, $ent]) =>
			deriveScope($ph, $iv, $ent)
		);

		// idle: all entities
		expect(get(scope)).toEqual([{ id: 'e1', type: 'Character', name: 'Alice' }]);

		// activate at position 1: in interval [0, 2)
		playhead.set(1);
		expect(get(scope)).toEqual([{ id: 'e1', type: 'Character', name: 'Alice' }]);

		// move to position 3: outside interval
		playhead.set(3);
		expect(get(scope)).toEqual([]);

		// dismiss: back to all
		playhead.set(null);
		expect(get(scope)).toEqual([{ id: 'e1', type: 'Character', name: 'Alice' }]);
	});
});
