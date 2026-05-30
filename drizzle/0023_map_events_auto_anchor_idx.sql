-- Slice 3 /review perf — partial index for the auto-anchor count query.
--
-- maybeWriteAutoAnchor (world-map-v3.ts) runs a COUNT(*) on every paint_cells
-- POST inside SELECT FOR UPDATE on world_maps. Without an index covering
-- (world_map_id, kind='paint_cells', undone_at IS NULL, created_at >
-- cutoff), Postgres scans the whole map's map_events partition for each
-- count. Each scan blocks behind the FOR UPDATE so concurrent paint POSTs
-- queue on each other paying that cost.
--
-- Partial index narrows to the actual hot predicate (kind='paint_cells'
-- AND undone_at IS NULL) and keys on (world_map_id, created_at) so the
-- cutoff comparison uses index-only scan.
--
-- Trade-off vs CONCURRENTLY: CREATE INDEX (not CONCURRENTLY) takes a
-- SHARE lock that blocks writes on map_events for the build duration.
-- On a fresh column / empty paint_cells partition this is instantaneous;
-- in production with brush history accumulated, the build is still cheap
-- relative to a missing index. Slice 4+ may revisit if production scale
-- demands CONCURRENTLY (which can't run inside Drizzle's migration
-- transaction wrapper).

CREATE INDEX map_events_auto_anchor_idx
	ON map_events (world_map_id, created_at)
	WHERE kind = 'paint_cells' AND undone_at IS NULL;
