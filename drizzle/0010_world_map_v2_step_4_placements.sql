-- WorldMap v2 Step 4 — map_placements + Artifact/Item/Door entity types
-- (2026-05-16)
--
-- Adds the first-class `map_placements` table per the v2.1 design addendum
-- (M1). A placement binds a placeable entity (Character / Artifact / Item /
-- Door — see PlaceableEntityType in schema.ts) to a Location and a fractional
-- (x, y) point on the source-image, with its own active window in story-time
-- (4 FK + 2 derived position columns, mirroring world_maps variants).
--
-- 'Artifact', 'Item', 'Door' are added as values of the existing entity-type
-- enum. The enum lives as a TS const + write-time validation (entities.type
-- is a free-form text column with the enum surfaced via Drizzle's `enum:`
-- option) — no DB-level enum type to ALTER.
--
-- ON DELETE behavior locked in M8:
--   placeable_id → CASCADE  (delete the placeable → delete its placements)
--   location_id  → SET NULL (orphan placement; UI surfaces for re-anchor)
--   map_id       → SET NULL (variant hint is disposable — placement still
--                            resolves at fraction-of-image on whichever
--                            variant covers the playhead)
--   start/end act/scene FKs → SET NULL + recomputePlacementBoundsAll
--                             (M11 cascade, runs inside recomputeAllIntervals)
--
-- The xy CHECK keeps coordinates in the unit square (B11). The position-order
-- CHECK enforces "both null OR both set with start < end" — open-ended
-- placements are NOT supported in v2. The TS API layer enforces the same
-- "both act FKs set or both null" rule on POST/PATCH; this DB CHECK is the
-- backstop against any direct INSERT/UPDATE that bypasses the chokepoint.

CREATE TABLE "map_placements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "user"("id") ON DELETE CASCADE,
  "placeable_id" uuid NOT NULL REFERENCES "entities"("id") ON DELETE CASCADE,
  "location_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL,
  "map_id" uuid REFERENCES "world_maps"("id") ON DELETE SET NULL,
  "x" double precision NOT NULL,
  "y" double precision NOT NULL,
  "start_act_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL,
  "start_scene_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL,
  "end_act_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL,
  "end_scene_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL,
  "start_position" double precision,
  "end_position" double precision,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "map_placements_xy_unit_range" CHECK (x >= 0 AND x <= 1 AND y >= 0 AND y <= 1),
  CONSTRAINT "map_placements_position_order" CHECK (
    (start_position IS NULL AND end_position IS NULL)
    OR (start_position IS NOT NULL AND end_position IS NOT NULL AND start_position < end_position)
  )
);--> statement-breakpoint

CREATE INDEX "map_placements_location_position_idx" ON "map_placements"
  ("location_id", "start_position", "end_position");--> statement-breakpoint
CREATE INDEX "map_placements_placeable_idx" ON "map_placements" ("placeable_id");--> statement-breakpoint
CREATE INDEX "map_placements_map_idx" ON "map_placements" ("map_id");--> statement-breakpoint

-- bump_updated_at trigger so application code never sets updated_at on
-- placement updates (matches the entities/world_maps pattern).
CREATE TRIGGER "map_placements_bump_updated_at"
  BEFORE UPDATE ON "map_placements"
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();
