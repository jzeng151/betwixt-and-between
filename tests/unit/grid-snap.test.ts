// Slice 3 T11 — grid-snap pure math unit tests.

import { describe, it, expect } from 'vitest';
import { snapPointToGrid, cellAtPoint } from '../../src/lib/features/map/grid-snap.js';

describe('snapPointToGrid (square)', () => {
	const opts = {
		gridType: 'square' as const,
		gridCellsX: 32,
		gridCellsY: 24,
		canvasWidth: 800,
		canvasHeight: 600
	};

	it('snaps midway-between points to the nearer grid line', () => {
		// Pitch is 1/32 = 0.03125 on x. 0.04 → snaps to 0.03125; 0.05 → 0.0625.
		expect(snapPointToGrid({ x: 0.04, y: 0.5 }, opts).x).toBeCloseTo(0.03125, 5);
		expect(snapPointToGrid({ x: 0.05, y: 0.5 }, opts).x).toBeCloseTo(0.0625, 5);
	});

	it('idempotent on already-snapped corner', () => {
		const point = { x: 0.03125, y: 1 / 24 };
		const snapped = snapPointToGrid(point, opts);
		// Exact same object (returned verbatim per EPSILON check).
		expect(snapped.x).toBe(point.x);
		expect(snapped.y).toBe(point.y);
	});

	it('clamps to [0, 1]', () => {
		const snapped = snapPointToGrid({ x: 1.2, y: -0.1 }, opts);
		expect(snapped.x).toBeLessThanOrEqual(1);
		expect(snapped.y).toBeGreaterThanOrEqual(0);
	});
});

describe('snapPointToGrid (hex)', () => {
	const opts = {
		gridType: 'hex' as const,
		gridCellsX: 32,
		gridCellsY: 24,
		canvasWidth: 800,
		canvasHeight: 600
	};

	it('returns a fractional point in [0, 1]', () => {
		const snapped = snapPointToGrid({ x: 0.5, y: 0.5 }, opts);
		expect(snapped.x).toBeGreaterThanOrEqual(0);
		expect(snapped.x).toBeLessThanOrEqual(1);
		expect(snapped.y).toBeGreaterThanOrEqual(0);
		expect(snapped.y).toBeLessThanOrEqual(1);
	});

	it('snap is idempotent: snapping an already-snapped point returns the same vertex', () => {
		const once = snapPointToGrid({ x: 0.5, y: 0.5 }, opts);
		const twice = snapPointToGrid(once, opts);
		expect(twice.x).toBeCloseTo(once.x, 9);
		expect(twice.y).toBeCloseTo(once.y, 9);
	});
});

describe('cellAtPoint (square)', () => {
	const opts = {
		gridType: 'square' as const,
		gridCellsX: 32,
		gridCellsY: 24,
		canvasWidth: 800,
		canvasHeight: 600
	};

	it('returns cell (0, 0) for a point in the top-left cell', () => {
		expect(cellAtPoint({ x: 5, y: 5 }, opts)).toEqual({ x: 0, y: 0 });
	});

	it('returns cell (31, 23) for a point in the bottom-right cell', () => {
		expect(cellAtPoint({ x: 795, y: 595 }, opts)).toEqual({ x: 31, y: 23 });
	});

	it('returns null for an out-of-bounds point', () => {
		expect(cellAtPoint({ x: -1, y: 0 }, opts)).toBeNull();
		expect(cellAtPoint({ x: 0, y: -1 }, opts)).toBeNull();
		expect(cellAtPoint({ x: 801, y: 0 }, opts)).toBeNull();
		expect(cellAtPoint({ x: 0, y: 601 }, opts)).toBeNull();
	});

	it('cell boundaries land in the correct cell (floor convention)', () => {
		// Pixel (25, 25) = exactly the boundary between cell 0 and 1 at
		// 800/32 = 25px pitch. floor(25/25) = 1 → goes to cell 1.
		expect(cellAtPoint({ x: 25, y: 25 }, opts)).toEqual({ x: 1, y: 1 });
	});
});

describe('cellAtPoint (hex)', () => {
	const opts = {
		gridType: 'hex' as const,
		gridCellsX: 32,
		gridCellsY: 24,
		canvasWidth: 800,
		canvasHeight: 600
	};

	it('returns cell at (0, 0) for the canvas center origin region', () => {
		// Cell (0, 0) center is at (size.width/2, size.height/2) per
		// hexAxialToPixel. A pixel just inside that should resolve to
		// (0, 0).
		const result = cellAtPoint({ x: 12, y: 12 }, opts);
		expect(result).toEqual({ x: 0, y: 0 });
	});

	it('returns null when the point is far above the grid origin', () => {
		// Pixel (-100, -100) is well outside the rhombus grid.
		expect(cellAtPoint({ x: -100, y: -100 }, opts)).toBeNull();
	});
});
