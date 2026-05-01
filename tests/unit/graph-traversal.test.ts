import { describe, it, expect } from 'vitest';
import {
	oneHopUnion,
	sharedNeighbors,
	reachable,
	type Edge
} from '../../src/lib/graph/traversal.js';

const directed = (fromId: string, toId: string): Edge => ({
	fromId,
	toId,
	type: 'caused_by' // directed
});

const symmetric = (fromId: string, toId: string): Edge => ({
	fromId,
	toId,
	type: 'allied_with' // symmetric
});

describe('oneHopUnion', () => {
	it('returns empty for an empty focalSet', () => {
		const result = oneHopUnion(new Set(), [directed('A', 'B')]);
		expect([...result]).toEqual([]);
	});

	it('directed edge A→B: focalSet=[A] yields {B}, focalSet=[B] yields {} (direction matters)', () => {
		const edges = [directed('A', 'B')];
		expect([...oneHopUnion(new Set(['A']), edges)]).toEqual(['B']);
		expect([...oneHopUnion(new Set(['B']), edges)]).toEqual([]);
	});

	it('symmetric edge A↔B walks both directions', () => {
		const edges = [symmetric('A', 'B')];
		expect([...oneHopUnion(new Set(['A']), edges)]).toEqual(['B']);
		expect([...oneHopUnion(new Set(['B']), edges)]).toEqual(['A']);
	});

	it('unions neighbors across multiple focal nodes', () => {
		const edges = [directed('A', 'X'), directed('B', 'Y'), directed('C', 'Z')];
		const out = oneHopUnion(new Set(['A', 'B']), edges);
		expect([...out].sort()).toEqual(['X', 'Y']);
	});
});

describe('sharedNeighbors', () => {
	it('returns empty for an empty focalSet', () => {
		const result = sharedNeighbors(new Set(), [directed('A', 'X')]);
		expect([...result]).toEqual([]);
	});

	it('three focals all connected to X via directed edges → {X}', () => {
		const edges = [directed('A', 'X'), directed('B', 'X'), directed('C', 'X')];
		const out = sharedNeighbors(new Set(['A', 'B', 'C']), edges);
		expect([...out]).toEqual(['X']);
	});

	it('two focals with no common neighbor → empty', () => {
		const edges = [directed('A', 'X'), directed('B', 'Y')];
		const out = sharedNeighbors(new Set(['A', 'B']), edges);
		expect([...out]).toEqual([]);
	});

	it('single-focal degenerate case returns its 1-hop neighbors', () => {
		const edges = [directed('A', 'X'), directed('A', 'Y')];
		const out = sharedNeighbors(new Set(['A']), edges);
		expect([...out].sort()).toEqual(['X', 'Y']);
	});
});

describe('reachable', () => {
	it('returns empty for an empty focalSet', () => {
		const result = reachable(new Set(), [directed('A', 'B')]);
		expect([...result]).toEqual([]);
	});

	it('includes the focal nodes themselves', () => {
		const edges = [directed('A', 'B')];
		const out = reachable(new Set(['A']), edges);
		expect(out.has('A')).toBe(true);
		expect(out.has('B')).toBe(true);
	});

	it('cycle-safe BFS terminates and visits each node once', () => {
		// A → B → C → A (cycle) plus a branch C → D
		const edges = [
			directed('A', 'B'),
			directed('B', 'C'),
			directed('C', 'A'),
			directed('C', 'D')
		];
		const out = reachable(new Set(['A']), edges);
		expect([...out].sort()).toEqual(['A', 'B', 'C', 'D']);
	});

	it('multi-hop traversal across mixed directed and symmetric edges', () => {
		const edges = [
			directed('A', 'B'),
			symmetric('B', 'C'), // walks both ways
			directed('D', 'C') // not walkable from C since directed
		];
		const out = reachable(new Set(['A']), edges);
		expect([...out].sort()).toEqual(['A', 'B', 'C']);
	});
});

describe('structural exclusion', () => {
	it('default (includeStructural=false) skips edges touching a structural node', () => {
		const edges = [directed('A', 'Act1')];
		const structuralIds = new Set(['Act1']);
		const out = reachable(new Set(['A']), edges, { structuralIds });
		expect(out.has('Act1')).toBe(false);
		expect([...out]).toEqual(['A']);
	});

	it('includeStructural=true walks edges into structural nodes', () => {
		const edges = [directed('A', 'Act1')];
		const structuralIds = new Set(['Act1']);
		const out = reachable(new Set(['A']), edges, {
			structuralIds,
			includeStructural: true
		});
		expect(out.has('Act1')).toBe(true);
	});

	it('structural exclusion applies symmetrically across helpers', () => {
		const edges = [directed('A', 'Act1'), directed('A', 'B')];
		const structuralIds = new Set(['Act1']);
		const out = oneHopUnion(new Set(['A']), edges, { structuralIds });
		expect([...out]).toEqual(['B']);
	});
});
