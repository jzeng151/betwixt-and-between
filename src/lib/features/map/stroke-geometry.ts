// WM3 — pure stroke geometry helpers, extracted from the Pixi layers (F38) so
// they're unit-testable in isolation. No Pixi / DOM dependency.

export type StrokeGeometryPoint = { x: number; y: number };

/**
 * Walk a polyline, returning a point every `stepPx` (plus the first point),
 * capped at `maxPoints`. The cap is enforced INSIDE the walk, not by slicing the
 * finished array (F2): a long path with a tiny `stepPx` would otherwise
 * synthesize millions of placements before any slice ran. `carry` carries the
 * leftover spacing across segment boundaries so points are evenly spaced along
 * the WHOLE polyline rather than restarting at each vertex.
 */
export function pointsAlongPath(
	pts: StrokeGeometryPoint[],
	stepPx: number,
	maxPoints = Infinity
): StrokeGeometryPoint[] {
	if (pts.length === 0) return [];
	if (pts.length === 1 || stepPx <= 0) return [pts[0]];
	const out = [pts[0]];
	let carry = 0;
	for (let i = 1; i < pts.length && out.length < maxPoints; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const segLen = Math.hypot(dx, dy);
		if (segLen === 0) continue;
		let dist = stepPx - carry;
		while (dist <= segLen && out.length < maxPoints) {
			out.push({ x: a.x + (dx * dist) / segLen, y: a.y + (dy * dist) / segLen });
			dist += stepPx;
		}
		carry = segLen - (dist - stepPx);
	}
	return out;
}

/**
 * Even-stride downsample preserving the first + last point. Used to cap a
 * captured gesture path at STROKE_MAX_POINTS without losing its shape.
 */
export function downsample<T extends StrokeGeometryPoint>(pts: T[], max: number): T[] {
	if (pts.length <= max) return pts;
	if (max <= 1) return pts.slice(0, 1); // guard: max=1 → stride Infinity
	const out: T[] = [];
	const stride = (pts.length - 1) / (max - 1);
	for (let i = 0; i < max; i++) out.push(pts[Math.round(i * stride)]);
	return out;
}
