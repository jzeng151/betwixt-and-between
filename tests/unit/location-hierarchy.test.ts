import { describe, it, expect } from 'vitest';
import {
	buildHierarchyIndex,
	walkAncestors,
	getChildren,
	getParent
} from '../../src/lib/location-hierarchy.js';
import type { Relationship } from '../../src/lib/stores/relationships.js';

function mkRel(fromId: string, toId: string, type: Relationship['type'] = 'part_of'): Relationship {
	return {
		id: `${type}:${fromId}->${toId}`,
		fromId,
		toId,
		type,
		label: null,
		startActId: null,
		endActId: null,
		startPosition: null,
		endPosition: null,
		revealedAtPosition: null
	};
}

describe('buildHierarchyIndex', () => {
	it('ignores non-part_of relationships', () => {
		const rels = [mkRel('a', 'b', 'allied_with'), mkRel('c', 'd', 'part_of')];
		const idx = buildHierarchyIndex(rels);
		expect(idx.parentOf.size).toBe(1);
		expect(idx.parentOf.get('c')).toBe('d');
		expect(idx.parentOf.has('a')).toBe(false);
	});

	it('maps each child to its single parent', () => {
		const idx = buildHierarchyIndex([mkRel('city', 'kingdom'), mkRel('kingdom', 'world')]);
		expect(idx.parentOf.get('city')).toBe('kingdom');
		expect(idx.parentOf.get('kingdom')).toBe('world');
	});

	it('groups siblings under a shared parent in insertion order', () => {
		const idx = buildHierarchyIndex([
			mkRel('alpha', 'parent'),
			mkRel('beta', 'parent'),
			mkRel('gamma', 'parent')
		]);
		expect(idx.childrenOf.get('parent')).toEqual(['alpha', 'beta', 'gamma']);
	});

	it('returns empty index for empty input', () => {
		const idx = buildHierarchyIndex([]);
		expect(idx.parentOf.size).toBe(0);
		expect(idx.childrenOf.size).toBe(0);
	});
});

describe('walkAncestors', () => {
	it('returns empty array for a root location (no parent)', () => {
		const idx = buildHierarchyIndex([mkRel('city', 'kingdom')]);
		expect(walkAncestors(idx, 'kingdom')).toEqual([]);
	});

	it('returns chain root-to-direct-parent (excludes self)', () => {
		const idx = buildHierarchyIndex([
			mkRel('shop', 'street'),
			mkRel('street', 'city'),
			mkRel('city', 'kingdom')
		]);
		expect(walkAncestors(idx, 'shop')).toEqual(['kingdom', 'city', 'street']);
	});

	it('returns empty for an unknown location', () => {
		const idx = buildHierarchyIndex([mkRel('a', 'b')]);
		expect(walkAncestors(idx, 'zzz')).toEqual([]);
	});

	it('terminates at MAX_DEPTH against a malformed cycle', () => {
		// Server validators prevent this; depth guard is defense-in-depth.
		const cycle: Relationship[] = [mkRel('a', 'b'), mkRel('b', 'a')];
		const idx = buildHierarchyIndex(cycle);
		const result = walkAncestors(idx, 'a');
		expect(result.length).toBeLessThanOrEqual(64);
	});
});

describe('getChildren', () => {
	it('returns children array for a parent', () => {
		const idx = buildHierarchyIndex([mkRel('a', 'p'), mkRel('b', 'p')]);
		expect(getChildren(idx, 'p')).toEqual(['a', 'b']);
	});

	it('returns empty array for a leaf', () => {
		const idx = buildHierarchyIndex([mkRel('a', 'p')]);
		expect(getChildren(idx, 'a')).toEqual([]);
	});

	it('returns empty array for unknown location', () => {
		const idx = buildHierarchyIndex([]);
		expect(getChildren(idx, 'nope')).toEqual([]);
	});
});

describe('getParent', () => {
	it('returns parent id for a child', () => {
		const idx = buildHierarchyIndex([mkRel('city', 'kingdom')]);
		expect(getParent(idx, 'city')).toBe('kingdom');
	});

	it('returns null for a root', () => {
		const idx = buildHierarchyIndex([mkRel('city', 'kingdom')]);
		expect(getParent(idx, 'kingdom')).toBeNull();
	});

	it('returns null for an unknown location', () => {
		const idx = buildHierarchyIndex([]);
		expect(getParent(idx, 'zzz')).toBeNull();
	});
});
