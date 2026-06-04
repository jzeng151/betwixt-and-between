-- World Map v3 — square existing maps' grid cells to their base-image aspect.
-- Mirrors src/lib/features/map/grid-dims.ts (squareGridCounts) — keep in sync.
--
-- Cells render via width/grid_cells_x × height/grid_cells_y, so they are square
-- only when those pitches match. Maps carrying the 32×24 default show rectangular
-- cells on any non-4:3 image. This re-fits the grid: anchor 32 cells on the
-- LONGER axis, derive + clamp (4..128) the shorter. A 4:3 image stays 32×24.
--
-- SAFETY (matches the PATCH grid guard, which refuses to shrink below painted
-- terrain): this only touches grid_type='square' maps (hex tiling is a different
-- geometry), and SKIPS any map where the new counts would push a painted
-- (non-'unset') cell out of bounds — projection does NOT bounds-clip stored
-- cells, so an orphaned cell would render off-grid and could not be erased
-- (out-of-bounds writes are rejected). Leaving such maps rectangular is the
-- conservative choice; they can be re-fit after the out-of-range terrain is
-- erased. bump_updated_at fires on touched rows (acceptable noise, see 0022).

WITH dims AS (
	SELECT
		id,
		CASE WHEN width >= height THEN 32
			 ELSE GREATEST(4, LEAST(128, ROUND(32.0 * width / height)::int)) END AS nx,
		CASE WHEN width >= height THEN GREATEST(4, LEAST(128, ROUND(32.0 * height / width)::int))
			 ELSE 32 END AS ny
	FROM world_maps
	WHERE grid_type = 'square'
	  AND width IS NOT NULL AND height IS NOT NULL AND width > 0 AND height > 0
),
painted AS (
	SELECT wm.id, MAX((c->>'x')::int) AS mx, MAX((c->>'y')::int) AS my
	FROM world_maps wm
	JOIN LATERAL (
		SELECT c FROM map_events me, jsonb_array_elements(me.payload_jsonb->'cells') AS c
			WHERE me.world_map_id = wm.id AND me.kind = 'paint_cells'
			  AND me.undone_at IS NULL AND c->>'biome' <> 'unset'
		UNION ALL
		SELECT c FROM map_anchors ma, jsonb_array_elements(ma.state_jsonb->'cells') AS c
			WHERE ma.world_map_id = wm.id AND c->>'biome' <> 'unset'
	) cells ON true
	GROUP BY wm.id
)
UPDATE world_maps wm
SET grid_cells_x = d.nx, grid_cells_y = d.ny
FROM dims d
WHERE wm.id = d.id
  AND (wm.grid_cells_x <> d.nx OR wm.grid_cells_y <> d.ny)
  AND NOT EXISTS (
	SELECT 1 FROM painted p WHERE p.id = wm.id AND (p.mx >= d.nx OR p.my >= d.ny)
  );
