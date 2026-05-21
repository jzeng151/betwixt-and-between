// Tests for the pure helpers in src/lib/features/graph/view-builders.ts.
// Covers node/edge view-model construction extracted from StoryGraph and
// FocusedGraph — character index, present-rel-types, alias entity set,
// visible-relationships filter, and the scenes-for-reveal projection.
import { describe, it, expect } from 'vitest';
import {
	buildCharacterIndexById,
	buildPresentRelTypes,
	buildAliasEntityIdSet,
	filterVisibleRelationships,
	buildScenesForReveal,
	type NamedSceneEntity
} from '../../src/lib/features/graph/view-builders.js';
import type { RelationshipType } from '../../src/lib/server/db/schema.js';

describe('buildCharacterIndexById', () => {
	it('indexes only Characters, in iteration order', () => {
		const entities = [
			{ id: 'a', type: 'Act' },
			{ id: 'char-1', type: 'Character' },
			{ id: 's', type: 'Scene' },
			{ id: 'char-2', type: 'Character' },
			{ id: 'char-3', type: 'Character' }
		];
		const idx = buildCharacterIndexById(entities);
		expect(idx.get('char-1')).toBe(0);
		expect(idx.get('char-2')).toBe(1);
		expect(idx.get('char-3')).toBe(2);
		expect(idx.has('a')).toBe(false);
		expect(idx.has('s')).toBe(false);
	});

	it('returns empty map when no Characters exist', () => {
		expect(buildCharacterIndexById([{ id: 'a', type: 'Act' }]).size).toBe(0);
	});
});

describe('buildPresentRelTypes', () => {
	const display = new Set(['a', 'b']);
	type R = { fromId: string; toId: string; type: RelationshipType };

	it('collects types whose endpoints are both displayed', () => {
		const rels: R[] = [
			{ fromId: 'a', toId: 'b', type: 'allied_with' },
			{ fromId: 'a', toId: 'b', type: 'rivals' }
		];
		const present = buildPresentRelTypes(rels, display);
		expect(present.has('allied_with')).toBe(true);
		expect(present.has('rivals')).toBe(true);
	});

	it('ignores relationships with off-screen endpoints', () => {
		const rels: R[] = [{ fromId: 'a', toId: 'gone', type: 'allied_with' }];
		expect(buildPresentRelTypes(rels, display).size).toBe(0);
	});
});

describe('buildAliasEntityIdSet', () => {
	it('unions primary and alias ids', () => {
		const aliases = [
			{ primaryEntityId: 'p1', aliasEntityId: 'a1' },
			{ primaryEntityId: 'p2', aliasEntityId: 'a2' }
		];
		const set = buildAliasEntityIdSet(aliases);
		expect(set).toEqual(new Set(['p1', 'a1', 'p2', 'a2']));
	});
});

describe('filterVisibleRelationships', () => {
	const rendered = new Set(['a', 'b']);
	it('keeps relationships with both endpoints rendered', () => {
		const rels = [
			{ id: 1, fromId: 'a', toId: 'b' },
			{ id: 2, fromId: 'a', toId: 'gone' },
			{ id: 3, fromId: 'b', toId: 'a' }
		];
		const out = filterVisibleRelationships(rels, rendered);
		expect(out).toHaveLength(2);
		expect(out.map((r) => r.id)).toEqual([1, 3]);
	});

	it('preserves the full relationship shape (generic over R)', () => {
		const rels = [{ id: 1, fromId: 'a', toId: 'b', extra: 'data' }];
		const out = filterVisibleRelationships(rels, rendered);
		expect(out[0].extra).toBe('data');
	});
});

describe('buildScenesForReveal', () => {
	const sceneRanges = new Map([
		['scene-2', { start: 0.5, end: 1 }],
		['scene-1', { start: 0, end: 0.5 }],
		['scene-3', { start: 1, end: 2 }]
	]);
	const entities: NamedSceneEntity[] = [
		{ id: 'act-1', name: 'Act One' },
		{ id: 'scene-1', name: 'Opening', parentId: 'act-1' },
		{ id: 'scene-2', name: 'Inciting', parentId: 'act-1' },
		{ id: 'scene-3', name: 'Climax', parentId: 'act-2' }
	];

	it('projects sceneRanges into {id, name, actId, position}, sorted by position', () => {
		const result = buildScenesForReveal(sceneRanges, entities);
		expect(result).toEqual([
			{ id: 'scene-1', name: 'Opening', actId: 'act-1', position: 0 },
			{ id: 'scene-2', name: 'Inciting', actId: 'act-1', position: 0.5 },
			{ id: 'scene-3', name: 'Climax', actId: 'act-2', position: 1 }
		]);
	});

	it('drops scene ranges whose entity is missing or has no parentId', () => {
		const orphanRanges = new Map([
			['scene-1', { start: 0, end: 0.5 }],
			['orphan', { start: 0.5, end: 1 }]
		]);
		const orphanEntities: NamedSceneEntity[] = [
			{ id: 'scene-1', name: 'Opening', parentId: 'act-1' },
			{ id: 'orphan', name: 'Orphan' } // no parentId
		];
		const result = buildScenesForReveal(orphanRanges, orphanEntities);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('scene-1');
	});

	it('returns empty when sceneRanges is empty', () => {
		expect(buildScenesForReveal(new Map(), entities)).toEqual([]);
	});
});
