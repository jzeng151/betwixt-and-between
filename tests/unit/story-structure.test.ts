import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { Entity } from '../../src/lib/stores/entities.js';
import {
	getActs,
	getScenesByActId,
	getSceneBoundaries,
	getSpotlightLabel,
	stepForwardScene,
	stepBackScene
} from '../../src/lib/story-structure.js';
import { playhead } from '../../src/lib/stores/playhead.js';

function mkEntity(overrides: Partial<Entity> & { id: string; type: Entity['type']; name: string }): Entity {
	return {
		data: {},
		parentId: null,
		position: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('getActs', () => {
	it('returns only root-level Acts', () => {
		const ents: Entity[] = [
			mkEntity({ id: 'a1', type: 'Act', name: 'A1', position: 0 }),
			mkEntity({ id: 'a2', type: 'Act', name: 'A2', position: 1 }),
			mkEntity({ id: 's1', type: 'Scene', name: 'S1', parentId: 'a1' }),
			mkEntity({ id: 'a3', type: 'Act', name: 'Nested', parentId: 'a1' }),
			mkEntity({ id: 'c1', type: 'Character', name: 'C1' })
		];
		expect(getActs(ents).map((a) => a.id)).toEqual(['a1', 'a2']);
	});

	it('sorts by position, then createdAt as tiebreaker', () => {
		const ents: Entity[] = [
			mkEntity({ id: 'a1', type: 'Act', name: 'A1', position: 2, createdAt: new Date(3000) }),
			mkEntity({ id: 'a2', type: 'Act', name: 'A2', position: 1, createdAt: new Date(2000) }),
			mkEntity({ id: 'a3', type: 'Act', name: 'A3', position: 1, createdAt: new Date(1000) })
		];
		expect(getActs(ents).map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
	});

	it('treats null position as MAX_SAFE_INTEGER', () => {
		const ents: Entity[] = [
			mkEntity({ id: 'a1', type: 'Act', name: 'A1', position: null }),
			mkEntity({ id: 'a2', type: 'Act', name: 'A2', position: 0 })
		];
		expect(getActs(ents).map((a) => a.id)).toEqual(['a2', 'a1']);
	});
});

describe('getScenesByActId', () => {
	it('groups scenes by parent act and sorts each list', () => {
		const ents: Entity[] = [
			mkEntity({ id: 's1', type: 'Scene', name: 'S1', parentId: 'a1', position: 1 }),
			mkEntity({ id: 's2', type: 'Scene', name: 'S2', parentId: 'a1', position: 0 }),
			mkEntity({ id: 's3', type: 'Scene', name: 'S3', parentId: 'a2', position: 0 })
		];
		const m = getScenesByActId(ents);
		expect(m.get('a1')!.map((s) => s.id)).toEqual(['s2', 's1']);
		expect(m.get('a2')!.map((s) => s.id)).toEqual(['s3']);
	});

	it('skips scenes with no parent', () => {
		const ents: Entity[] = [
			mkEntity({ id: 's1', type: 'Scene', name: 'orphan', parentId: null })
		];
		expect(getScenesByActId(ents).size).toBe(0);
	});

	it('ignores non-Scene entities', () => {
		const ents: Entity[] = [
			mkEntity({ id: 'e1', type: 'Event', name: 'E1', parentId: 'a1' })
		];
		expect(getScenesByActId(ents).size).toBe(0);
	});
});

describe('getSceneBoundaries', () => {
	it('returns [0, acts.length] when acts have no scenes', () => {
		const acts = [
			mkEntity({ id: 'a1', type: 'Act', name: 'A1' }),
			mkEntity({ id: 'a2', type: 'Act', name: 'A2' })
		];
		expect(getSceneBoundaries(acts, new Map())).toEqual([0, 1, 2]);
	});

	it('inserts interior k/m fractions for acts with m>=2 scenes', () => {
		const acts = [mkEntity({ id: 'a1', type: 'Act', name: 'A1' })];
		const scenes = new Map<string, Entity[]>([
			['a1', [
				mkEntity({ id: 's1', type: 'Scene', name: 'S1', parentId: 'a1' }),
				mkEntity({ id: 's2', type: 'Scene', name: 'S2', parentId: 'a1' }),
				mkEntity({ id: 's3', type: 'Scene', name: 'S3', parentId: 'a1' }),
				mkEntity({ id: 's4', type: 'Scene', name: 'S4', parentId: 'a1' })
			]]
		]);
		expect(getSceneBoundaries(acts, scenes)).toEqual([0, 0.25, 0.5, 0.75, 1]);
	});

	it('does not insert interior points for acts with one scene', () => {
		const acts = [mkEntity({ id: 'a1', type: 'Act', name: 'A1' })];
		const scenes = new Map<string, Entity[]>([
			['a1', [mkEntity({ id: 's1', type: 'Scene', name: 'S1', parentId: 'a1' })]]
		]);
		expect(getSceneBoundaries(acts, scenes)).toEqual([0, 1]);
	});

	it('returns [0] for empty acts list', () => {
		expect(getSceneBoundaries([], new Map())).toEqual([0]);
	});
});

describe('getSpotlightLabel', () => {
	const acts = [
		mkEntity({ id: 'a1', type: 'Act', name: 'Setup' }),
		mkEntity({ id: 'a2', type: 'Act', name: 'Confrontation' })
	];
	const scenes = new Map<string, Entity[]>([
		['a1', [
			mkEntity({ id: 's1', type: 'Scene', name: 'Opening', parentId: 'a1' }),
			mkEntity({ id: 's2', type: 'Scene', name: 'Hook', parentId: 'a1' })
		]]
	]);

	it('returns empty string when playhead is null', () => {
		expect(getSpotlightLabel(null, acts, scenes)).toBe('');
	});

	it('returns empty string when there are no acts', () => {
		expect(getSpotlightLabel(0.5, [], new Map())).toBe('');
	});

	it('formats "Act · Scene N: name" when current act has scenes', () => {
		expect(getSpotlightLabel(0, acts, scenes)).toBe('Setup · Scene 1: Opening');
		expect(getSpotlightLabel(0.5, acts, scenes)).toBe('Setup · Scene 2: Hook');
	});

	it('returns just the act name when current act has no scenes', () => {
		expect(getSpotlightLabel(1.2, acts, scenes)).toBe('Confrontation');
	});

	it('clamps playhead beyond the last act to the last act', () => {
		expect(getSpotlightLabel(99, acts, scenes)).toBe('Confrontation');
	});

	it('clamps the scene index when fractional part rounds up out of range', () => {
		// f === 1 would naively pick scenes[2] for a 2-scene act; should clamp to last.
		const justBeforeNextAct = 0.9999999;
		expect(getSpotlightLabel(justBeforeNextAct, acts, scenes)).toBe('Setup · Scene 2: Hook');
	});
});

describe('stepForwardScene / stepBackScene', () => {
	beforeEach(() => {
		playhead.scrubTo(0);
		playhead.pause();
	});

	it('stepForwardScene advances to the next boundary above current playhead', () => {
		playhead.scrubTo(0.3);
		stepForwardScene([0, 0.5, 1, 2], 2);
		expect(get(playhead)).toBeCloseTo(0.5);
	});

	it('stepForwardScene clamps to maxT', () => {
		playhead.scrubTo(0.3);
		stepForwardScene([0, 0.5, 1, 2], 0.4);
		expect(get(playhead)).toBeCloseTo(0.4);
	});

	it('stepForwardScene is a no-op when no boundary is ahead', () => {
		playhead.scrubTo(2);
		stepForwardScene([0, 1, 2], 2);
		expect(get(playhead)).toBeCloseTo(2);
	});

	it('stepBackScene moves to the previous boundary below current playhead', () => {
		playhead.scrubTo(0.7);
		stepBackScene([0, 0.5, 1]);
		expect(get(playhead)).toBeCloseTo(0.5);
	});

	it('stepBackScene clamps to 0', () => {
		playhead.scrubTo(0.1);
		stepBackScene([-1, 0.5]);
		expect(get(playhead)).toBeCloseTo(0);
	});

	it('stepBackScene is a no-op when no boundary is behind', () => {
		playhead.scrubTo(0);
		stepBackScene([0, 1]);
		expect(get(playhead)).toBeCloseTo(0);
	});
});
