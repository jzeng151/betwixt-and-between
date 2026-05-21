// Pins the playhead-scope projection logic that was previously inlined
// (and duplicated) in StoryGraph.svelte + FocusedGraph.svelte. Covers the
// fractional-position math for Scenes-within-Acts, the multi-branch out-of-scope
// classifier, and the ghost-trail past/future classification — including the
// codex-flagged edge case where startPosition is null but endPosition is in
// proximity (the current behavior returns 'past', which these tests pin
// rather than change).
import { describe, it, expect } from 'vitest';
import {
	buildEntityIntervalMap,
	buildActIndexById,
	buildSceneRanges,
	extractSortedSceneStarts,
	nearEnoughForGhostTrail,
	computeOutOfScope,
	classifyGhostMode,
	type ScopeContext,
	type EdgeContext,
	type ScopeEntity,
	type Interval
} from '../../src/lib/features/graph/scope.js';

const ACT_1 = 'act-1';
const ACT_2 = 'act-2';
const SCENE_1A = 'scene-1a';
const SCENE_1B = 'scene-1b';
const SCENE_2A = 'scene-2a';
const CHAR_A = 'char-a';
const CHAR_B = 'char-b';

describe('buildEntityIntervalMap', () => {
	it('groups intervals by entityId', () => {
		const intervals: Interval[] = [
			{ entityId: CHAR_A, startPosition: 0, endPosition: 1 },
			{ entityId: CHAR_A, startPosition: 1, endPosition: 2 },
			{ entityId: CHAR_B, startPosition: 0.5, endPosition: 1.5 }
		];
		const m = buildEntityIntervalMap(intervals);
		expect(m.get(CHAR_A)).toHaveLength(2);
		expect(m.get(CHAR_B)).toHaveLength(1);
		expect(m.get('missing')).toBeUndefined();
	});

	it('preserves insertion order within each entity', () => {
		const a = { entityId: CHAR_A, startPosition: 0, endPosition: 1 };
		const b = { entityId: CHAR_A, startPosition: 5, endPosition: 6 };
		const m = buildEntityIntervalMap([a, b]);
		expect(m.get(CHAR_A)).toEqual([a, b]);
	});
});

describe('buildActIndexById', () => {
	it('ranks Acts 0-based by ascending position, skipping null positions and non-Acts', () => {
		const entities: ScopeEntity[] = [
			{ id: ACT_2, type: 'Act', position: 2 },
			{ id: ACT_1, type: 'Act', position: 1 },
			{ id: 'act-null', type: 'Act', position: null },
			{ id: SCENE_1A, type: 'Scene', position: 1 },
			{ id: CHAR_A, type: 'Character', position: null }
		];
		const m = buildActIndexById(entities);
		expect(m.get(ACT_1)).toBe(0);
		expect(m.get(ACT_2)).toBe(1);
		expect(m.has('act-null')).toBe(false);
		expect(m.has(SCENE_1A)).toBe(false);
	});
});

describe('buildSceneRanges', () => {
	const acts = new Map([
		[ACT_1, 0],
		[ACT_2, 1]
	]);

	it('divides each Act into equal fractional sub-ranges, sorted by position', () => {
		const entities: ScopeEntity[] = [
			{ id: SCENE_1B, type: 'Scene', parentId: ACT_1, position: 2 },
			{ id: SCENE_1A, type: 'Scene', parentId: ACT_1, position: 1 },
			{ id: SCENE_2A, type: 'Scene', parentId: ACT_2, position: 1 }
		];
		const ranges = buildSceneRanges(entities, acts);
		// Two scenes in Act 1 → halves of [0, 1)
		expect(ranges.get(SCENE_1A)).toEqual({ start: 0, end: 0.5 });
		expect(ranges.get(SCENE_1B)).toEqual({ start: 0.5, end: 1 });
		// Lone scene in Act 2 → fills [1, 2)
		expect(ranges.get(SCENE_2A)).toEqual({ start: 1, end: 2 });
	});

	it('drops Scenes whose parent Act is not in the index map', () => {
		const entities: ScopeEntity[] = [
			{ id: 'orphan', type: 'Scene', parentId: 'missing-act', position: 1 }
		];
		expect(buildSceneRanges(entities, acts).has('orphan')).toBe(false);
	});

	it('drops Scenes with no parentId', () => {
		const entities: ScopeEntity[] = [{ id: 'parentless', type: 'Scene', position: 1 }];
		expect(buildSceneRanges(entities, acts).size).toBe(0);
	});

	it('falls back to iteration order when positions are mixed null / set', () => {
		// First scene has null position → falls behind a position-set sibling.
		const entities: ScopeEntity[] = [
			{ id: 'null-pos', type: 'Scene', parentId: ACT_1, position: null },
			{ id: 'has-pos', type: 'Scene', parentId: ACT_1, position: 5 }
		];
		const ranges = buildSceneRanges(entities, acts);
		// has-pos sorts before null-pos.
		expect(ranges.get('has-pos')).toEqual({ start: 0, end: 0.5 });
		expect(ranges.get('null-pos')).toEqual({ start: 0.5, end: 1 });
	});
});

describe('extractSortedSceneStarts', () => {
	it('returns scene start positions in ascending order', () => {
		const ranges = new Map([
			[SCENE_1A, { start: 0, end: 0.5 }],
			[SCENE_2A, { start: 1, end: 2 }],
			[SCENE_1B, { start: 0.5, end: 1 }]
		]);
		expect(extractSortedSceneStarts(ranges)).toEqual([0, 0.5, 1]);
	});
});

describe('nearEnoughForGhostTrail', () => {
	const sceneStarts = [0, 0.5, 1, 1.5, 2];

	it('returns true when at most 2 scene boundaries fall in (lo, hi]', () => {
		expect(nearEnoughForGhostTrail(0, 0.5, sceneStarts)).toBe(true);
		expect(nearEnoughForGhostTrail(0, 1, sceneStarts)).toBe(true);
		expect(nearEnoughForGhostTrail(0, 1.5, sceneStarts)).toBe(false);
	});

	it('falls back to one-act unit when no scenes exist', () => {
		expect(nearEnoughForGhostTrail(0, 1, [])).toBe(true);
		expect(nearEnoughForGhostTrail(0, 1.01, [])).toBe(false);
	});

	it('uses an open-low / closed-high window so lo itself does not count', () => {
		// 0.5 must NOT count for [lo=0.5, hi=1.0].
		expect(nearEnoughForGhostTrail(0.5, 1.0, sceneStarts)).toBe(true);
	});
});

describe('computeOutOfScope', () => {
	const acts = new Map([
		[ACT_1, 0],
		[ACT_2, 1]
	]);
	const sceneRanges = new Map([
		[SCENE_1A, { start: 0, end: 0.5 }],
		[SCENE_1B, { start: 0.5, end: 1 }]
	]);
	const charAIvs = [{ startPosition: 0, endPosition: 1 }];
	const charBIvs = [{ startPosition: 1, endPosition: 2 }];
	const intervalMap = new Map([
		[CHAR_A, charAIvs],
		[CHAR_B, charBIvs]
	]);
	const entities: ScopeEntity[] = [
		{ id: ACT_1, type: 'Act' },
		{ id: ACT_2, type: 'Act' },
		{ id: SCENE_1A, type: 'Scene' },
		{ id: SCENE_1B, type: 'Scene' },
		{ id: CHAR_A, type: 'Character' },
		{ id: CHAR_B, type: 'Character' }
	];

	it('returns empty set when t is null (idle scrubber)', () => {
		expect(computeOutOfScope(null, intervalMap, acts, sceneRanges, entities).size).toBe(0);
	});

	it('flags entities with intervals that do not contain t', () => {
		const set = computeOutOfScope(0.25, intervalMap, acts, sceneRanges, entities);
		expect(set.has(CHAR_A)).toBe(false); // [0, 1) contains 0.25
		expect(set.has(CHAR_B)).toBe(true); // [1, 2) does not
	});

	it('flags Acts whose [idx, idx+1) window does not contain t', () => {
		const set = computeOutOfScope(0.25, intervalMap, acts, sceneRanges, entities);
		expect(set.has(ACT_1)).toBe(false); // [0, 1)
		expect(set.has(ACT_2)).toBe(true); // [1, 2)
	});

	it('flags Scenes whose fractional range does not contain t', () => {
		const set = computeOutOfScope(0.6, intervalMap, acts, sceneRanges, entities);
		expect(set.has(SCENE_1A)).toBe(true); // [0, 0.5)
		expect(set.has(SCENE_1B)).toBe(false); // [0.5, 1)
	});
});

describe('classifyGhostMode', () => {
	const baseScope: ScopeContext = {
		t: 1.0,
		sortedSceneStarts: [0, 0.5, 1, 1.5, 2],
		entityIntervalMap: new Map(),
		outOfScope: new Set()
	};
	const ghostingEdge: EdgeContext = {
		inWindow: false,
		mystery: false,
		showGhostTrails: true
	};

	it('returns null when ghost trails are off', () => {
		const r = { fromId: CHAR_A, toId: CHAR_B };
		expect(
			classifyGhostMode(r, baseScope, { ...ghostingEdge, showGhostTrails: false })
		).toBeNull();
	});

	it('returns null in mystery mode regardless of proximity', () => {
		const r = { fromId: CHAR_A, toId: CHAR_B, startPosition: 0.7 };
		expect(classifyGhostMode(r, baseScope, { ...ghostingEdge, mystery: true })).toBeNull();
	});

	it('returns null when edge is in-window and no endpoint is out of scope', () => {
		const r = { fromId: CHAR_A, toId: CHAR_B };
		expect(classifyGhostMode(r, baseScope, { ...ghostingEdge, inWindow: true })).toBeNull();
	});

	it('returns "future" when startPosition is set and lies in the near future', () => {
		const r = { fromId: CHAR_A, toId: CHAR_B, startPosition: 1.5, endPosition: 2.5 };
		expect(classifyGhostMode(r, baseScope, ghostingEdge)).toBe('future');
	});

	it('returns "past" when startPosition is set and lies in the near past', () => {
		const r = { fromId: CHAR_A, toId: CHAR_B, startPosition: 0.5, endPosition: 0.7 };
		expect(classifyGhostMode(r, baseScope, ghostingEdge)).toBe('past');
	});

	// Codex-flagged behavior — locked, NOT changed by this refactor.
	// When startPosition is null and only endPosition matches the proximity
	// test, the inline logic returns 'past'. That may or may not be intended.
	// Pinning the current behavior here so any future change is intentional.
	it('returns "past" when startPosition is null but endPosition is in near future (locked behavior)', () => {
		const r = { fromId: CHAR_A, toId: CHAR_B, startPosition: null, endPosition: 1.5 };
		expect(classifyGhostMode(r, baseScope, ghostingEdge)).toBe('past');
	});

	// Proximity is "≤ 2 scene boundaries crossed", NOT absolute distance.
	// With no scene starts, the fallback is "hi - lo <= 1 act unit". This
	// case uses the empty-scenes fallback so "out of proximity" is testable
	// deterministically; a positions-only proximity check on the populated
	// scene-starts fixture can still pass for large gaps that happen to
	// straddle ≤ 2 boundaries.
	it('returns null when scene boundaries crossed exceeds threshold (empty-scenes fallback)', () => {
		const scope: ScopeContext = { ...baseScope, sortedSceneStarts: [] };
		const r = { fromId: CHAR_A, toId: CHAR_B, startPosition: 5, endPosition: 6 };
		expect(classifyGhostMode(r, scope, ghostingEdge)).toBeNull();
	});

	it('falls back to endpoint intervals when relationship has no temporal positions', () => {
		const scope: ScopeContext = {
			...baseScope,
			entityIntervalMap: new Map([
				[CHAR_A, [{ startPosition: 0, endPosition: 0.5 }]] // past interval ending before t=1.0
			])
		};
		const r = { fromId: CHAR_A, toId: CHAR_B };
		expect(classifyGhostMode(r, scope, ghostingEdge)).toBe('past');
	});

	it('falls back to "future" when endpoint interval starts in near future', () => {
		const scope: ScopeContext = {
			...baseScope,
			entityIntervalMap: new Map([[CHAR_B, [{ startPosition: 1.5, endPosition: 2 }]]])
		};
		const r = { fromId: CHAR_A, toId: CHAR_B };
		expect(classifyGhostMode(r, scope, ghostingEdge)).toBe('future');
	});
});
