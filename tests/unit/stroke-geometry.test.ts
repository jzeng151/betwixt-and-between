import { describe, it, expect } from 'vitest';
import { pointsAlongPath, downsample } from '../../src/lib/features/map/stroke-geometry.js';

// F38 — these were pure logic buried in PixiArtLayer / PixiFreeformBrushLayer,
// untestable as written. Extracted to stroke-geometry.ts so the F2 cap and the
// spacing/continuation behavior have real coverage.

describe('pointsAlongPath', () => {
	it('returns [] for an empty path', () => {
		expect(pointsAlongPath([], 1)).toEqual([]);
	});

	it('returns just the first point for a single-point path or non-positive step', () => {
		expect(pointsAlongPath([{ x: 1, y: 2 }], 5)).toEqual([{ x: 1, y: 2 }]);
		expect(pointsAlongPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0)).toEqual([{ x: 0, y: 0 }]);
	});

	it('places a point every step along a straight segment (plus the first)', () => {
		// 0..10 step 2 → first (0) + 2,4,6,8,10 = 6 points
		const out = pointsAlongPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
		expect(out.map((p) => p.x)).toEqual([0, 2, 4, 6, 8, 10]);
	});

	it('carries spacing across segment boundaries (even spacing along the whole polyline)', () => {
		// Two unit segments forming an L; step 1 should walk continuously, not
		// restart spacing at the vertex.
		const out = pointsAlongPath(
			[{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }],
			1
		);
		// first(0,0) then 1,2 along x, then continuing up y at 1,2
		expect(out).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 1 },
			{ x: 2, y: 2 }
		]);
	});

	it('F2: stops emitting at maxPoints instead of materializing the full array', () => {
		// A pathological tiny step over a long segment would emit ~1e6 points;
		// the cap must bound the output regardless.
		const out = pointsAlongPath([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 0.001, 2048);
		expect(out).toHaveLength(2048);
	});

	it('F2: the cap never exceeds maxPoints across multiple segments', () => {
		const path = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
		const out = pointsAlongPath(path, 0.01, 100);
		expect(out.length).toBeLessThanOrEqual(100);
	});
});

describe('downsample', () => {
	it('returns the input unchanged when already at/under the cap', () => {
		const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
		expect(downsample(pts, 5)).toBe(pts);
	});

	it('guards max <= 1 (no NaN-index undefined)', () => {
		const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
		expect(downsample(pts, 1)).toEqual([{ x: 0, y: 0 }]);
	});

	it('caps to max and preserves the first + last point', () => {
		const pts = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
		const out = downsample(pts, 10);
		expect(out).toHaveLength(10);
		expect(out[0]).toEqual({ x: 0, y: 0 });
		expect(out[out.length - 1]).toEqual({ x: 99, y: 0 });
	});
});
