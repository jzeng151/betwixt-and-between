/**
 * T8 — client polygon-validation parity with the server validator.
 *
 * The Pixi draw tool runs isSelfIntersecting on every preview tick to
 * red-flag the offending segment before commit. The server still
 * validates on POST. These two implementations must agree, otherwise
 * the UI rejects a polygon the server would accept (or vice versa).
 *
 * Cross-checks both modules against the same fixture set.
 */

import { describe, it, expect } from 'vitest';
import { isSelfIntersecting as clientCheck, firstSelfIntersection } from '../../src/lib/features/map/polygon-validation.js';
import { isSelfIntersecting as serverCheck } from '../../src/lib/server/validation.js';

const fixtures: Array<{ name: string; polygon: number[][]; expected: boolean }> = [
	{
		name: 'triangle (simple)',
		polygon: [
			[0, 0],
			[10, 0],
			[5, 10]
		],
		expected: false
	},
	{
		name: 'square (simple)',
		polygon: [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		],
		expected: false
	},
	{
		name: 'figure-8 (bowtie)',
		polygon: [
			[0, 0],
			[10, 10],
			[10, 0],
			[0, 10]
		],
		expected: true
	},
	{
		name: 'degenerate: 2 vertices',
		polygon: [
			[0, 0],
			[10, 10]
		],
		expected: true
	},
	{
		name: 'concave pentagon (still simple)',
		polygon: [
			[0, 0],
			[10, 0],
			[10, 10],
			[5, 5],
			[0, 10]
		],
		expected: false
	},
	{
		name: 'self-intersecting at vertex 3',
		polygon: [
			[0, 0],
			[10, 0],
			[5, -5],
			[5, 5]
		],
		expected: true
	}
];

describe('polygon-validation client/server parity', () => {
	for (const f of fixtures) {
		it(`agree on: ${f.name}`, () => {
			const c = clientCheck(f.polygon);
			const s = serverCheck(f.polygon);
			expect(c).toBe(f.expected);
			expect(s).toBe(f.expected);
		});
	}
});

describe('firstSelfIntersection', () => {
	it('returns null for simple polygons', () => {
		expect(firstSelfIntersection([
			[0, 0], [10, 0], [10, 10], [0, 10]
		])).toBeNull();
	});

	it('locates the offending edge indices for a bowtie', () => {
		const result = firstSelfIntersection([
			[0, 0], [10, 10], [10, 0], [0, 10]
		]);
		expect(result).not.toBeNull();
		// Edges are (0→1), (1→2), (2→3), (3→0). Bowtie crosses edge 0 and 2.
		expect(result!.a).toBe(0);
		expect(result!.b).toBe(2);
	});

	it('returns null on degenerate input (< 3 vertices)', () => {
		expect(firstSelfIntersection([[0, 0]])).toBeNull();
		expect(firstSelfIntersection([[0, 0], [1, 1]])).toBeNull();
	});
});
