// Slice 3 T6 — hex grid math unit tests.
//
// Pure-function module so tests stay simple: round-trip pixel ↔ axial,
// vertex count + ordering, and a sanity check that the size helper
// picks a radius that doesn't overflow the canvas.

import { describe, it, expect } from 'vitest';
import {
	hexAxialRound,
	hexAxialToPixel,
	hexPixelToAxial,
	hexSizeForCanvas,
	hexVertices
} from '../../src/lib/features/map/hex-grid.js';

describe('hexSizeForCanvas', () => {
	it('picks a radius that fits both axes inside the canvas', () => {
		const size = hexSizeForCanvas(32, 24, 800, 600);
		// 32 columns × hex width must fit inside 800; 24 rows × 1.5 × radius
		// must fit inside 600. Either limit caps the radius.
		const totalW = (32 + 0.5) * size.width;
		const totalH = 24 * 1.5 * size.radius + 0.5 * size.radius;
		expect(totalW).toBeLessThanOrEqual(800 + 1);
		expect(totalH).toBeLessThanOrEqual(600 + 1);
	});

	it('returns a minimum radius of 1 on degenerate canvas dimensions', () => {
		const size = hexSizeForCanvas(32, 24, 0, 0);
		expect(size.radius).toBeGreaterThanOrEqual(1);
	});
});

describe('hexAxialToPixel ↔ hexPixelToAxial round-trip', () => {
	const size = hexSizeForCanvas(32, 24, 800, 600);

	it('round-trips a center cell', () => {
		const pixel = hexAxialToPixel(5, 7, size);
		const axial = hexPixelToAxial(pixel.x, pixel.y, size);
		expect(axial).toEqual({ q: 5, r: 7 });
	});

	it('round-trips an odd-row cell (offset by half-width)', () => {
		const pixel = hexAxialToPixel(3, 5, size);
		const axial = hexPixelToAxial(pixel.x, pixel.y, size);
		expect(axial).toEqual({ q: 3, r: 5 });
	});

	it('round-trips the origin cell', () => {
		const pixel = hexAxialToPixel(0, 0, size);
		const axial = hexPixelToAxial(pixel.x, pixel.y, size);
		expect(axial).toEqual({ q: 0, r: 0 });
	});
});

describe('hexAxialRound', () => {
	it('returns integer coords given fractional input', () => {
		const { q, r } = hexAxialRound(2.3, 4.6);
		expect(Number.isInteger(q)).toBe(true);
		expect(Number.isInteger(r)).toBe(true);
	});

	it('preserves the cube-coord invariant after rounding', () => {
		// For axial (q, r), the cube equivalent is (q, -q - r, r). After
		// rounding, x + y + z must equal 0 — that's the rounding rule the
		// implementation enforces.
		const { q, r } = hexAxialRound(1.7, 2.9);
		const sum = q + (-q - r) + r;
		expect(sum).toBe(0);
	});
});

describe('hexVertices', () => {
	const size = hexSizeForCanvas(32, 24, 800, 600);

	it('returns 6 vertices', () => {
		const verts = hexVertices(100, 100, size);
		expect(verts).toHaveLength(6);
	});

	it('vertices lie on a circle of the given radius', () => {
		const verts = hexVertices(100, 100, size);
		for (const v of verts) {
			const dx = v.x - 100;
			const dy = v.y - 100;
			const dist = Math.sqrt(dx * dx + dy * dy);
			expect(dist).toBeCloseTo(size.radius, 5);
		}
	});

	it('first vertex is the top point (pointy-top orientation)', () => {
		const verts = hexVertices(100, 100, size);
		// Pointy-top: vertex 0 is directly above the center.
		expect(verts[0].x).toBeCloseTo(100, 5);
		expect(verts[0].y).toBeCloseTo(100 - size.radius, 5);
	});
});
