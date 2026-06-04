// World Map v3 — derive SQUARE grid cell counts from a base image's pixel
// dimensions.
//
// The grid, terrain and brush all map an integer cell (x, y) → pixels via
// `width / gridCellsX` × `height / gridCellsY`, so cells are square only when
// those two pitches match. Fixed 32×24 counts give square cells ONLY at a 4:3
// image aspect; any other aspect renders rectangles. We anchor ~32 cells on the
// LONGER axis and derive the shorter so cellW ≈ cellH for any aspect (a 4:3
// image reproduces the historical 32×24 default exactly).
//
// Mirrored by drizzle/0026_square_grid_cells.sql, which backfills the same
// formula onto existing maps — keep the two in sync.

const BASE_CELLS = 32; // target cells along the longer axis
const MIN_CELLS = 4; // matches the world_maps grid_cells_{x,y} CHECK (4..128)
const MAX_CELLS = 128;

const clampCells = (n: number): number => Math.max(MIN_CELLS, Math.min(MAX_CELLS, n));

/**
 * Square-ish grid counts for an image of `width` × `height` px. Integer cell
 * counts mean the fit is exact only when the aspect divides evenly; otherwise
 * cells are square to within one row/column of rounding. Degenerate input
 * (non-positive dimensions) falls back to a safe square default.
 */
export function squareGridCounts(
	width: number,
	height: number
): { gridCellsX: number; gridCellsY: number } {
	if (!(width > 0) || !(height > 0)) {
		return { gridCellsX: BASE_CELLS, gridCellsY: BASE_CELLS };
	}
	if (width >= height) {
		return { gridCellsX: BASE_CELLS, gridCellsY: clampCells(Math.round(BASE_CELLS * (height / width))) };
	}
	return { gridCellsX: clampCells(Math.round(BASE_CELLS * (width / height))), gridCellsY: BASE_CELLS };
}
