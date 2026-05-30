// Slice 3 T11 — snap-to-grid helpers (Slice 2 T8 carry-over).
//
// Polygon authoring (PixiPolygonDraw) calls these when the user holds
// Shift during vertex add/drag. Square grid snaps to nearest cell
// intersection; hex grid snaps to nearest hex vertex.
//
// Coordinates are fractional [0, 1] throughout — same convention as
// region polygons (M11 from v0.7.0.0). Pixel ↔ fractional conversion
// happens at the renderer layer; this module operates in fractional
// space so it's renderer-agnostic.
//
// Brush placement (PixiBrushLayer) does NOT use these. Brush uses
// pixelToCell math (square or hex) directly — the brush is "which
// cell is under the cursor," not "snap a vertex to the nearest
// gridline." Different semantics, even though both consume
// world_maps.grid_*.

import {
	hexAxialToPixel,
	hexPixelToAxial,
	hexSizeForCanvas,
	hexVertices,
	type HexSize
} from './hex-grid.js';
import type { GridType } from './types.js';

/**
 * Snap a fractional point to the nearest grid intersection or hex vertex.
 *
 * `canvasWidth` / `canvasHeight` are the renderer's canvas dimensions in
 * pixels (NOT the fractional [0, 1] range). Helpers convert internally.
 *
 * For square grid: snaps to the nearest cell corner. Cell pitch =
 * 1 / gridCellsX horizontally, 1 / gridCellsY vertically. Corners
 * fall at multiples of those fractions.
 *
 * For hex grid: converts to pixel space, finds the nearest hex via
 * axial-round, picks the nearest vertex of that hex (6 candidates),
 * converts back to fractional.
 *
 * Returns the snapped point. If gridType is 'square' and the input is
 * already on a grid line (within EPSILON), the input is returned
 * verbatim — avoids floating-point drift on idempotent snaps.
 */
export function snapPointToGrid(
	point: { x: number; y: number },
	opts: {
		gridType: GridType;
		gridCellsX: number;
		gridCellsY: number;
		canvasWidth: number;
		canvasHeight: number;
	}
): { x: number; y: number } {
	if (opts.gridType === 'hex') {
		return snapPointToHexGrid(point, opts);
	}
	return snapPointToSquareGrid(point, opts);
}

const EPSILON = 1e-9;

function snapPointToSquareGrid(
	point: { x: number; y: number },
	opts: { gridCellsX: number; gridCellsY: number }
): { x: number; y: number } {
	const pitchX = 1 / opts.gridCellsX;
	const pitchY = 1 / opts.gridCellsY;
	const snappedX = Math.round(point.x / pitchX) * pitchX;
	const snappedY = Math.round(point.y / pitchY) * pitchY;
	// Clamp to [0, 1] so snapping near edges doesn't drift outside.
	const cx = Math.max(0, Math.min(1, snappedX));
	const cy = Math.max(0, Math.min(1, snappedY));
	// Idempotency: if input is already at a grid corner, return it
	// verbatim to avoid tiny rounding drift.
	if (Math.abs(cx - point.x) < EPSILON && Math.abs(cy - point.y) < EPSILON) {
		return { x: point.x, y: point.y };
	}
	return { x: cx, y: cy };
}

function snapPointToHexGrid(
	point: { x: number; y: number },
	opts: {
		gridCellsX: number;
		gridCellsY: number;
		canvasWidth: number;
		canvasHeight: number;
	}
): { x: number; y: number } {
	// Convert fractional → pixel. Hex math lives in pixel space.
	const px = point.x * opts.canvasWidth;
	const py = point.y * opts.canvasHeight;
	const size: HexSize = hexSizeForCanvas(
		opts.gridCellsX,
		opts.gridCellsY,
		opts.canvasWidth,
		opts.canvasHeight
	);
	const { q, r } = hexPixelToAxial(px, py, size);
	const center = hexAxialToPixel(q, r, size);
	const verts = hexVertices(center.x, center.y, size);
	// Find the nearest vertex of the containing hex.
	let bestDist = Number.POSITIVE_INFINITY;
	let best = verts[0];
	for (const v of verts) {
		const dx = v.x - px;
		const dy = v.y - py;
		const d2 = dx * dx + dy * dy;
		if (d2 < bestDist) {
			bestDist = d2;
			best = v;
		}
	}
	// Convert back to fractional and clamp.
	const fx = Math.max(0, Math.min(1, best.x / opts.canvasWidth));
	const fy = Math.max(0, Math.min(1, best.y / opts.canvasHeight));
	return { x: fx, y: fy };
}

/**
 * Pixel-space cell-at-point lookup. Used by the brush layer to find
 * which cell the cursor is over.
 *
 * Returns null if the point falls outside the grid (negative or beyond
 * grid_cells_*). For hex grids the cube-coord round catches near-edge
 * points and yields the correct cell.
 */
export function cellAtPoint(
	point: { x: number; y: number },
	opts: {
		gridType: GridType;
		gridCellsX: number;
		gridCellsY: number;
		canvasWidth: number;
		canvasHeight: number;
	}
): { x: number; y: number } | null {
	const px = point.x;
	const py = point.y;
	if (opts.gridType === 'hex') {
		const size: HexSize = hexSizeForCanvas(
			opts.gridCellsX,
			opts.gridCellsY,
			opts.canvasWidth,
			opts.canvasHeight
		);
		const { q, r } = hexPixelToAxial(px, py, size);
		if (q < 0 || q >= opts.gridCellsX || r < 0 || r >= opts.gridCellsY) {
			return null;
		}
		// JS -0 leaks through if hexAxialRound returns -0 (Math.round of
		// a small negative fraction). Normalize so equality tests treat
		// (0, 0) cells uniformly.
		return { x: q || 0, y: r || 0 };
	}
	const cellW = opts.canvasWidth / opts.gridCellsX;
	const cellH = opts.canvasHeight / opts.gridCellsY;
	const col = Math.floor(px / cellW);
	const row = Math.floor(py / cellH);
	if (col < 0 || col >= opts.gridCellsX || row < 0 || row >= opts.gridCellsY) {
		return null;
	}
	return { x: col, y: row };
}
