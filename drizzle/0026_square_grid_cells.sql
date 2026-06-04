-- World Map v3 — square existing maps' grid cells to their base-image aspect.
-- Mirrors src/lib/features/map/grid-dims.ts (squareGridCounts) — keep in sync.
--
-- Cells render via width/grid_cells_x × height/grid_cells_y, so they are square
-- only when those pitches match. Every existing map carries the 32×24 default
-- (there is no UI to set per-map counts), so any non-4:3 base image shows
-- rectangular cells. This re-fits the grid: anchor 32 cells on the LONGER axis,
-- derive + clamp (4..128) the shorter. A 4:3 image stays 32×24 (no-op). Maps
-- with no base image yet (width/height NULL) keep the default.
--
-- Painted-cell consequence: shrinking an axis can push some painted cells out
-- of bounds; projection lazy-GCs out-of-range cells at render (sparse-cell
-- invariant), so at most a thin edge strip of terrain is orphaned — the
-- consented tradeoff for square tiles. The bump_updated_at trigger fires on
-- touched rows (acceptable data noise, same posture as 0022).

UPDATE world_maps
SET
	grid_cells_x = CASE
		WHEN width >= height THEN 32
		ELSE GREATEST(4, LEAST(128, ROUND(32.0 * width / height)::int))
	END,
	grid_cells_y = CASE
		WHEN width >= height THEN GREATEST(4, LEAST(128, ROUND(32.0 * height / width)::int))
		ELSE 32
	END
WHERE width IS NOT NULL AND height IS NOT NULL AND width > 0 AND height > 0;
