/**
 * Client-side polygon validation for the Pixi polygon-draw tool (T8).
 *
 * Mirrors `src/lib/server/validation.ts → isSelfIntersecting` so the draw
 * preview can flag a self-intersection visually before the user commits.
 * The server validator still runs at POST time — this is purely for the
 * live red-segment preview.
 *
 * Algorithm is identical: O(n^2) non-adjacent edge-crossing test. Keep
 * the two implementations behaviorally equivalent — the unit test in
 * tests/unit/polygon-validation.test.ts cross-checks them against the
 * same fixture set.
 */

export function isSelfIntersecting(polygon: number[][]): boolean {
	const n = polygon.length;
	if (n < 3) return true;
	for (let i = 0; i < n; i++) {
		const a1 = polygon[i];
		const a2 = polygon[(i + 1) % n];
		for (let j = i + 2; j < n; j++) {
			if (i === 0 && j === n - 1) continue;
			const b1 = polygon[j];
			const b2 = polygon[(j + 1) % n];
			if (segmentsCross(a1, a2, b1, b2)) return true;
		}
	}
	return false;
}

/**
 * Locate the first pair of crossing non-adjacent edges. Returns the
 * indices of the two edges (each is the index of its starting vertex),
 * or null if the polygon is simple. Used by the live preview to render
 * the offending segment in rust-red without recomputing intersections.
 */
export function firstSelfIntersection(polygon: number[][]): { a: number; b: number } | null {
	const n = polygon.length;
	if (n < 3) return null;
	for (let i = 0; i < n; i++) {
		const a1 = polygon[i];
		const a2 = polygon[(i + 1) % n];
		for (let j = i + 2; j < n; j++) {
			if (i === 0 && j === n - 1) continue;
			const b1 = polygon[j];
			const b2 = polygon[(j + 1) % n];
			if (segmentsCross(a1, a2, b1, b2)) return { a: i, b: j };
		}
	}
	return null;
}

function segmentsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
	const d1 = cross(c, d, a);
	const d2 = cross(c, d, b);
	const d3 = cross(a, b, c);
	const d4 = cross(a, b, d);
	if (
		((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
		((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
	)
		return true;
	return false;
}

function cross(o: number[], a: number[], b: number[]): number {
	return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
