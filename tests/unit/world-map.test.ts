import { describe, it, expect } from 'vitest';
import { isSelfIntersecting } from '../../src/lib/server/validation.js';

describe('isSelfIntersecting', () => {
	it('returns true for degenerate polygon with < 3 vertices', () => {
		expect(isSelfIntersecting([])).toBe(true);
		expect(isSelfIntersecting([[0, 0]])).toBe(true);
		expect(isSelfIntersecting([[0, 0], [1, 1]])).toBe(true);
	});

	it('returns false for a valid triangle', () => {
		const triangle = [
			[0, 0],
			[100, 0],
			[50, 100]
		];
		expect(isSelfIntersecting(triangle)).toBe(false);
	});

	it('returns false for a valid rectangle', () => {
		const rect = [
			[0, 0],
			[100, 0],
			[100, 100],
			[0, 100]
		];
		expect(isSelfIntersecting(rect)).toBe(false);
	});

	it('returns false for a valid convex pentagon', () => {
		const pentagon = [
			[50, 0],
			[100, 38],
			[81, 90],
			[19, 90],
			[0, 38]
		];
		expect(isSelfIntersecting(pentagon)).toBe(false);
	});

	it('returns true for a figure-8 self-intersecting polygon', () => {
		// Two triangles sharing a vertex, forming a bowtie/figure-8
		const bowtie = [
			[0, 0],
			[100, 100],
			[100, 0],
			[0, 100]
		];
		expect(isSelfIntersecting(bowtie)).toBe(true);
	});

	it('returns true for edges that cross', () => {
		const crossing = [
			[0, 50],
			[100, 50],
			[50, 0],
			[50, 100]
		];
		expect(isSelfIntersecting(crossing)).toBe(true);
	});

	it('returns false for an L-shaped polygon', () => {
		const lShape = [
			[0, 0],
			[50, 0],
			[50, 30],
			[30, 30],
			[30, 100],
			[0, 100]
		];
		expect(isSelfIntersecting(lShape)).toBe(false);
	});
});
