import { describe, it, expect } from 'vitest';
import { resolveActiveVariant, variantsForLocation } from '../../src/lib/world-map-variants.js';
import type { WorldMap } from '../../src/lib/types/world-map.js';

function mkMap(overrides: Partial<WorldMap> & { id: string }): WorldMap {
	return {
		id: overrides.id,
		name: overrides.name ?? `Map ${overrides.id}`,
		baseImageUrl: null,
		width: null,
		height: null,
		locationId: overrides.locationId ?? null,
		locationInactiveAt: null,
		startActId: null,
		startSceneId: null,
		endActId: null,
		endSceneId: null,
		startPosition: overrides.startPosition ?? null,
		endPosition: overrides.endPosition ?? null,
		createdAt: overrides.createdAt ?? '2026-05-01T00:00:00.000Z',
		updatedAt: overrides.updatedAt ?? '2026-05-01T00:00:00.000Z'
	};
}

describe('resolveActiveVariant', () => {
	const LOC_A = 'loc-a';
	const LOC_B = 'loc-b';

	it('returns null when locationId is null', () => {
		const maps = [mkMap({ id: '1', locationId: LOC_A })];
		expect(resolveActiveVariant(maps, null, 5)).toBeNull();
	});

	it('returns null when locationId is undefined', () => {
		const maps = [mkMap({ id: '1', locationId: LOC_A })];
		expect(resolveActiveVariant(maps, undefined, 5)).toBeNull();
	});

	it('returns null when no maps match locationId', () => {
		const maps = [mkMap({ id: '1', locationId: LOC_B })];
		expect(resolveActiveVariant(maps, LOC_A, 5)).toBeNull();
	});

	it('picks scoped variant when playhead is inside [start, end)', () => {
		const def = mkMap({ id: 'def', locationId: LOC_A });
		const scoped = mkMap({ id: 'scoped', locationId: LOC_A, startPosition: 2, endPosition: 5 });
		expect(resolveActiveVariant([def, scoped], LOC_A, 3)?.id).toBe('scoped');
	});

	it('half-open interval: start position is inclusive', () => {
		const scoped = mkMap({ id: 'scoped', locationId: LOC_A, startPosition: 2, endPosition: 5 });
		expect(resolveActiveVariant([scoped], LOC_A, 2)?.id).toBe('scoped');
	});

	it('half-open interval: end position is exclusive', () => {
		const def = mkMap({ id: 'def', locationId: LOC_A });
		const scoped = mkMap({ id: 'scoped', locationId: LOC_A, startPosition: 2, endPosition: 5 });
		expect(resolveActiveVariant([def, scoped], LOC_A, 5)?.id).toBe('def');
	});

	it('falls back to default variant when playhead is outside scoped ranges', () => {
		const def = mkMap({ id: 'def', locationId: LOC_A });
		const scoped = mkMap({ id: 'scoped', locationId: LOC_A, startPosition: 2, endPosition: 5 });
		expect(resolveActiveVariant([def, scoped], LOC_A, 10)?.id).toBe('def');
	});

	it('returns default variant when playhead is null', () => {
		const def = mkMap({ id: 'def', locationId: LOC_A });
		const scoped = mkMap({ id: 'scoped', locationId: LOC_A, startPosition: 2, endPosition: 5 });
		expect(resolveActiveVariant([def, scoped], LOC_A, null)?.id).toBe('def');
	});

	it('returns default variant when playhead is undefined', () => {
		const def = mkMap({ id: 'def', locationId: LOC_A });
		expect(resolveActiveVariant([def], LOC_A, undefined)?.id).toBe('def');
	});

	it('falls back to first candidate when no default and no scoped match', () => {
		const a = mkMap({ id: 'a', locationId: LOC_A, startPosition: 0, endPosition: 1 });
		const b = mkMap({ id: 'b', locationId: LOC_A, startPosition: 5, endPosition: 6 });
		expect(resolveActiveVariant([a, b], LOC_A, 10)?.id).toBe('a');
	});

	it('filters out maps belonging to other locations', () => {
		const aMap = mkMap({ id: 'a', locationId: LOC_A });
		const bMap = mkMap({ id: 'b', locationId: LOC_B, startPosition: 0, endPosition: 100 });
		expect(resolveActiveVariant([aMap, bMap], LOC_A, 50)?.id).toBe('a');
	});
});

describe('variantsForLocation', () => {
	const LOC_A = 'loc-a';
	const LOC_B = 'loc-b';

	it('returns empty array when locationId is null', () => {
		const maps = [mkMap({ id: '1', locationId: LOC_A })];
		expect(variantsForLocation(maps, null)).toEqual([]);
	});

	it('returns empty array when no maps match', () => {
		const maps = [mkMap({ id: '1', locationId: LOC_B })];
		expect(variantsForLocation(maps, LOC_A)).toEqual([]);
	});

	it('places default variant first', () => {
		const scoped = mkMap({ id: 'scoped', locationId: LOC_A, startPosition: 2, endPosition: 5 });
		const def = mkMap({ id: 'def', locationId: LOC_A });
		const result = variantsForLocation([scoped, def], LOC_A);
		expect(result.map((m) => m.id)).toEqual(['def', 'scoped']);
	});

	it('sorts scoped variants by startPosition ascending', () => {
		const v1 = mkMap({ id: 'v1', locationId: LOC_A, startPosition: 10, endPosition: 20 });
		const v2 = mkMap({ id: 'v2', locationId: LOC_A, startPosition: 3, endPosition: 5 });
		const v3 = mkMap({ id: 'v3', locationId: LOC_A, startPosition: 7, endPosition: 9 });
		const result = variantsForLocation([v1, v2, v3], LOC_A);
		expect(result.map((m) => m.id)).toEqual(['v2', 'v3', 'v1']);
	});

	it('default first then scoped sorted', () => {
		const v1 = mkMap({ id: 'v1', locationId: LOC_A, startPosition: 10, endPosition: 20 });
		const def = mkMap({ id: 'def', locationId: LOC_A });
		const v2 = mkMap({ id: 'v2', locationId: LOC_A, startPosition: 3, endPosition: 5 });
		const result = variantsForLocation([v1, def, v2], LOC_A);
		expect(result.map((m) => m.id)).toEqual(['def', 'v2', 'v1']);
	});

	it('filters by locationId', () => {
		const a = mkMap({ id: 'a', locationId: LOC_A });
		const b = mkMap({ id: 'b', locationId: LOC_B });
		expect(variantsForLocation([a, b], LOC_A).map((m) => m.id)).toEqual(['a']);
	});
});
