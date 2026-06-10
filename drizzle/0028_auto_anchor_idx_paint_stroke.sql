-- WM3 Slice A /review perf — widen the auto-anchor partial index to paint_stroke.
--
-- 0023 created map_events_auto_anchor_idx with predicate
-- (kind = 'paint_cells' AND undone_at IS NULL) to keep the auto-anchor COUNT(*)
-- off a full-partition scan inside SELECT FOR UPDATE on world_maps.
--
-- Slice A widened that COUNT to `kind IN ('paint_cells','paint_stroke')` so
-- freeform strokes also drive the auto-anchor bake (eng-review §6). Postgres
-- only uses a partial index when the query predicate PROVABLY implies the index
-- predicate, and `kind IN ('paint_cells','paint_stroke')` does NOT imply
-- `kind = 'paint_cells'` — so the planner dropped the index and the COUNT
-- regressed to a scan, on EVERY paint write (grid and freeform), reintroducing
-- the exact lock-contention 0023 was written to prevent.
--
-- Redefine the index predicate to match the widened COUNT. Same DROP/CREATE
-- (not CONCURRENTLY) posture as 0023 — it runs inside Drizzle's migration
-- transaction wrapper; the rebuild is cheap relative to a missing index.
DROP INDEX IF EXISTS "map_events_auto_anchor_idx";
--> statement-breakpoint
CREATE INDEX "map_events_auto_anchor_idx"
	ON "map_events" ("world_map_id", "created_at")
	WHERE kind IN ('paint_cells', 'paint_stroke') AND undone_at IS NULL;
