// Slice 3 T6 — hex grid math from primitives.
//
// Open Question #1 (design doc) resolved 2026-05-21: default grid is
// square. Hex available per-map via world_maps.grid_type = 'hex'.
// Outside-voice #11 flagged that hex "isn't a small variant of square" —
// cell indexing, neighbor calculation, brush footprint, and snap targets
// all differ. This module isolates the hex math so the rest of the
// renderer (PixiGridLayer, PixiTerrainLayer, grid-snap) can swap between
// square and hex by calling shared helpers.
//
// Convention: axial coordinates with `pointy-top` orientation. Cell (q,
// r) where q is the "column" and r is the "row" — but skewed because
// hexes interlock. Pointy-top means the hex's points face up and down,
// flat edges face left/right. Picked over flat-top because pointy-top
// matches the way Western tabletop maps (Inkarnate, Dungeondraft) draw
// hex grids most often.
//
// The world_maps.grid_cells_x / grid_cells_y columns store axial extent
// directly: x = number of columns (q range), y = number of rows (r
// range). At default 32×24 = 768 hex cells, same as square.
//
// Pixel math reference: https://www.redblobgames.com/grids/hexagons/
// (Amit Patel's hex-grids primer is the canonical source).

// Hex cell side length is derived from the renderer canvas size and grid
// extent. The renderer passes canvas width/height to the helpers below
// — that way the grid scales with the underlying base image, the same
// way square grid does.

export type HexSize = {
	/** side length (center to vertex). */
	radius: number;
	/** width of a hex (radius * sqrt(3)). */
	width: number;
	/** height of a hex (radius * 2). */
	height: number;
};

/**
 * Compute the hex side length so that `cellsX × cellsY` hexes fill the
 * given canvas dimensions. Picks the smaller of width-fit and height-fit
 * so neither axis overflows.
 */
export function hexSizeForCanvas(
	cellsX: number,
	cellsY: number,
	canvasWidth: number,
	canvasHeight: number
): HexSize {
	// Pointy-top: total width = (cellsX + 0.5) * sqrt(3) * radius,
	//             total height = (cellsY * 1.5 + 0.5) * radius.
	// Solve for the radius that fits both axes; smallest wins.
	const sqrt3 = Math.sqrt(3);
	const rByWidth = canvasWidth / ((cellsX + 0.5) * sqrt3);
	const rByHeight = canvasHeight / (cellsY * 1.5 + 0.5);
	const radius = Math.max(1, Math.min(rByWidth, rByHeight));
	return {
		radius,
		width: radius * sqrt3,
		height: radius * 2
	};
}

/**
 * Convert axial coordinates (q, r) to the pixel center of the hex.
 * Pointy-top axial layout (Red Blob Games standard): each row's hexes
 * shift right by HALF a row's r-value, so the resulting grid is a
 * parallelogram (rhombus), not a rectangle. Picked over odd-r offset
 * because the math round-trips cleanly without parity special-cases.
 *
 * (0, 0) is centered at (size.width/2, size.height/2) so cell (0, 0)
 * sits flush against the canvas top-left. Increasing q moves right;
 * increasing r moves down-and-right.
 */
export function hexAxialToPixel(q: number, r: number, size: HexSize): { x: number; y: number } {
	// x: size.width * (q + r/2) gives a rhombus that tilts right as r grows.
	// y: 1.5 * radius per row (the vertical pitch of pointy-top hexes).
	const x = size.width * (q + r / 2) + size.width / 2;
	const y = 1.5 * size.radius * r + size.height / 2;
	return { x, y };
}

/**
 * Convert a pixel position to the nearest hex axial coords. Used by the
 * brush layer (drag → cells touched) and snap-to-grid (vertex drop →
 * nearest hex vertex).
 *
 * Implementation: convert to cube coords, round to nearest, convert back.
 * Direct axial round produces incorrect cells near vertices because the
 * grid is non-orthogonal.
 */
export function hexPixelToAxial(
	x: number,
	y: number,
	size: HexSize
): { q: number; r: number } {
	const sqrt3 = Math.sqrt(3);
	// Shift to put cell (0, 0) at origin (inverse of the +size.width/2
	// and +size.height/2 in hexAxialToPixel).
	const cx = x - size.width / 2;
	const cy = y - size.height / 2;
	// Inverse of x = size.width * (q + r/2), y = 1.5 * radius * r.
	// size.width = radius * sqrt(3), so dividing by size.radius normalizes.
	const qFrac = (cx * sqrt3 / 3 - cy / 3) / size.radius;
	const rFrac = (cy * 2 / 3) / size.radius;
	return hexAxialRound(qFrac, rFrac);
}

/**
 * Round fractional axial coords to the nearest integer cell. The cube-
 * coord trick keeps rounding faithful: the axis with the largest
 * fractional error gets adjusted so the cube-sum invariant (x + y + z =
 * 0) holds after rounding.
 */
export function hexAxialRound(qFrac: number, rFrac: number): { q: number; r: number } {
	// Convert axial (q, r) → cube (x, y, z) where x = q, z = r, y = -x - z.
	let x = qFrac;
	let z = rFrac;
	let y = -x - z;
	let rx = Math.round(x);
	let ry = Math.round(y);
	let rz = Math.round(z);
	const xDiff = Math.abs(rx - x);
	const yDiff = Math.abs(ry - y);
	const zDiff = Math.abs(rz - z);
	if (xDiff > yDiff && xDiff > zDiff) {
		rx = -ry - rz;
	} else if (yDiff > zDiff) {
		ry = -rx - rz;
	} else {
		rz = -rx - ry;
	}
	return { q: rx, r: rz };
}

/**
 * Vertices of the hex centered at (cx, cy). Returns 6 corner points in
 * clockwise order starting at the top. Used by PixiGridLayer to draw
 * outlines and by snap-to-grid to find the nearest vertex.
 */
export function hexVertices(
	cx: number,
	cy: number,
	size: HexSize
): Array<{ x: number; y: number }> {
	const verts: Array<{ x: number; y: number }> = [];
	// Pointy-top: start at the top (angle = -90deg), step 60deg each.
	for (let i = 0; i < 6; i++) {
		const angle = ((-90 + 60 * i) * Math.PI) / 180;
		verts.push({
			x: cx + size.radius * Math.cos(angle),
			y: cy + size.radius * Math.sin(angle)
		});
	}
	return verts;
}
