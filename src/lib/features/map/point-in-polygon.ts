// Ray-casting point-in-polygon test. `polygon` is a list of [x, y] vertices
// (open or closed ring — the wrap is handled). Returns true when (px, py) is
// inside. Used by the map's viewport-level right-click routing so a region's
// context menu can be opened by geometry even when another interactive layer
// (e.g. causal edges) sits on top of the region and would otherwise steal the
// hit-test (Pixi has no per-button hit-testing — FU3, Codex #66).
export function pointInPolygon(px: number, py: number, polygon: number[][]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const vi = polygon[i];
		const vj = polygon[j];
		if (!vi || !vj || typeof vi[0] !== 'number' || typeof vi[1] !== 'number') continue;
		const xi = vi[0];
		const yi = vi[1];
		const xj = vj[0];
		const yj = vj[1];
		const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}
