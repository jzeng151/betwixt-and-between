-- WorldMap v2 Step 2 + Step 3 — map variants + Location hierarchy primitives
-- (2026-05-14)
--
-- Adds variant temporal bounds to world_maps so a single Location can be
-- depicted by multiple maps each scoped to a story-time range (e.g. pre-war
-- Gondor vs post-war Gondor). Variant resolution picks the row whose
-- [start_position, end_position) covers the current playhead; the all-NULL
-- "default variant" wins when no scoped variant matches.
--
-- The integrity guarantees (M9 design lock) are enforced at the DB level:
--   1. btree_gist EXTENSION enables mixing equality (uuid) with range overlap
--      operators inside a single EXCLUDE constraint.
--   2. EXCLUDE constraint world_maps_variant_no_overlap prevents two scoped
--      variants for the same Location from covering any shared range.
--   3. CHECK world_maps_variant_position_order enforces start < end whenever
--      both are present (strict half-open).
--   4. Partial-unique world_maps_one_default_per_location: at most one row
--      per Location may have start_position IS NULL (the default variant).
--
-- The `part_of` relationship kind itself does not require a migration —
-- `relationships.type` is a text column whose allowed values are TS-only
-- enum guards (consistent with how earlier types were added). Polymorphic
-- type checks (both endpoints must be Location, no cycles, single-parent)
-- live in src/lib/server/location-hierarchy.ts.
--
-- No data backfill — existing world_maps rows leave the new columns NULL,
-- which makes every existing map a default variant for its Location (the
-- expected v2 starting state).

CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

ALTER TABLE "world_maps" ADD COLUMN "start_act_id" uuid;--> statement-breakpoint
ALTER TABLE "world_maps" ADD COLUMN "start_scene_id" uuid;--> statement-breakpoint
ALTER TABLE "world_maps" ADD COLUMN "end_act_id" uuid;--> statement-breakpoint
ALTER TABLE "world_maps" ADD COLUMN "end_scene_id" uuid;--> statement-breakpoint
ALTER TABLE "world_maps" ADD COLUMN "start_position" double precision;--> statement-breakpoint
ALTER TABLE "world_maps" ADD COLUMN "end_position" double precision;--> statement-breakpoint

ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_start_act_id_entities_id_fk" FOREIGN KEY ("start_act_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_start_scene_id_entities_id_fk" FOREIGN KEY ("start_scene_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_end_act_id_entities_id_fk" FOREIGN KEY ("end_act_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_end_scene_id_entities_id_fk" FOREIGN KEY ("end_scene_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_variant_position_order" CHECK (
  start_position IS NULL OR end_position IS NULL OR start_position < end_position
);--> statement-breakpoint

-- DEFERRABLE INITIALLY DEFERRED so that recomputeWorldMapVariantsAll can
-- rewrite multiple variants in a single transaction without tripping
-- transient overlap between row-N's old position and row-(N+1)'s new position
-- during reorder cascades (M11). On standalone INSERT/UPDATE outside a
-- transaction, the constraint still fires immediately at statement end.
ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_variant_no_overlap" EXCLUDE USING gist (
  location_id WITH =,
  numrange(start_position::numeric, end_position::numeric, '[)') WITH &&
) WHERE (
  location_id IS NOT NULL
  AND start_position IS NOT NULL
  AND end_position IS NOT NULL
) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

CREATE UNIQUE INDEX "world_maps_one_default_per_location" ON "world_maps" ("location_id")
  WHERE location_id IS NOT NULL AND start_position IS NULL;
