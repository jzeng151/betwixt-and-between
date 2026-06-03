import { describe, it, expect } from 'vitest';
import { pointInPolygon } from '../../src/lib/features/map/point-in-polygon.js';

const SQUARE: number[][] = [
	[0, 0],
	[10, 0],
	[10, 10],
	[0, 10]
];

const TRIANGLE: number[][] = [
	[0, 0],
	[10, 0],
	[5, 10]
];

describe('pointInPolygon', () => {
	it('point inside a square', () => {
		expect(pointInPolygon(5, 5, SQUARE)).toBe(true);
	});

	it('point outside a square', () => {
		expect(pointInPolygon(15, 5, SQUARE)).toBe(false);
		expect(pointInPolygon(-1, 5, SQUARE)).toBe(false);
		expect(pointInPolygon(5, 11, SQUARE)).toBe(false);
	});

	it('point inside a triangle, and outside above the slanted edges', () => {
		expect(pointInPolygon(5, 2, TRIANGLE)).toBe(true);
		expect(pointInPolygon(1, 8, TRIANGLE)).toBe(false); // above the left edge
		expect(pointInPolygon(9, 8, TRIANGLE)).toBe(false); // above the right edge
	});

	it('degenerate / malformed vertices are skipped without throwing', () => {
		expect(pointInPolygon(5, 5, [[0, 0], [10, 0]])).toBe(false); // < 3 real edges
		expect(() => pointInPolygon(5, 5, [[0, 0], [10, 0], [10, 10], ['x' as unknown as number, 10]])).not.toThrow();
	});
});
