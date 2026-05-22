-- World Map v3 foundation — Slice 1a (2026-05-22)
--
-- Adds the three tables the projection engine needs:
--   map_anchors  — author-placed keyframes. (world_map_id, t_position) is
--                  unique; state_jsonb is the canonical snapshot of the
--                  world at that T. Mutable; bump_updated_at trigger.
--   map_events   — typed delta operations between anchors. Discriminated
--                  by `kind`, payload shape is per-kind (see design doc).
--                  Append-only (no updated_at, no trigger). source_event_id
--                  is a polymorphic FK to entities(id) of type='Event',
--                  enforced at the app layer (assertSourceEventIdIsEvent).
--   factions     — region-ownership grouping. Direct user_id (no natural
--                  parent). Mutable; bump_updated_at trigger.
--
-- Cross-user scoping invariant (CLAUDE.md): map_anchors and map_events
-- have NO user_id column. Every query must scope through world_maps.user_id
-- via JOIN. A missing JOIN is a cross-user data leak.
--
-- t_position uses double precision (float8) per plan-eng-review D3, matching
-- intervals.start_position. '-Infinity'::float8 is the unambiguous lower
-- bound used by the initial-anchor backfill below — user-authored events
-- cannot beat it.
--
-- Lazy GC (plan-eng-review D5): jsonb references (region_id, faction_id,
-- entity_id) are NOT enforced as FKs (Postgres can't). The renderer skips
-- unresolvable references; no cascade rewrites of historical anchors.
--
-- Initial anchor backfill: one anchor per existing world_maps row at
-- t_position = '-Infinity'::float8. state_jsonb.regions[] snapshots the
-- current map_regions rows for that world_map (region_id, color from
-- map_regions.color, faction_id=null since factions don't exist yet).
-- artifacts[] and chains[] start empty. World maps with no regions still
-- get an initial anchor (empty regions[]) so projection.ts always has a
-- starting state. Variants are world_maps rows in Slice 1, so each
-- variant gets its own initial anchor.

CREATE TABLE "map_anchors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "world_map_id" uuid NOT NULL REFERENCES "world_maps"("id") ON DELETE CASCADE,
  "t_position" double precision NOT NULL,
  "state_jsonb" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "map_anchors_world_map_id_t_position_uniq"
  ON "map_anchors" ("world_map_id", "t_position");--> statement-breakpoint

CREATE TRIGGER "map_anchors_bump_updated_at"
  BEFORE UPDATE ON "map_anchors"
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();--> statement-breakpoint

CREATE TABLE "map_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "world_map_id" uuid NOT NULL REFERENCES "world_maps"("id") ON DELETE CASCADE,
  "t_position" double precision NOT NULL,
  "kind" text NOT NULL,
  "payload_jsonb" jsonb NOT NULL,
  "source_event_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "map_events_world_map_id_t_position_idx"
  ON "map_events" ("world_map_id", "t_position");--> statement-breakpoint

CREATE TABLE "factions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text NOT NULL,
  "style_jsonb" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "factions_user_id_idx" ON "factions" ("user_id");--> statement-breakpoint

CREATE TRIGGER "factions_bump_updated_at"
  BEFORE UPDATE ON "factions"
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();--> statement-breakpoint

-- Initial-anchor backfill. One row per existing world_maps row at
-- '-Infinity'::float8 with regions[] snapshotted from current map_regions.
-- jsonb_agg returns NULL when no rows match, so coalesce to '[]'::jsonb to
-- guarantee a well-shaped state_jsonb for maps with zero regions.
DO $$ DECLARE n bigint;
BEGIN
  INSERT INTO "map_anchors" ("world_map_id", "t_position", "state_jsonb")
  SELECT
    wm.id,
    '-Infinity'::float8,
    jsonb_build_object(
      'regions', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'region_id', mr.id,
              'faction_id', NULL,
              'color', mr.color
            )
          )
          FROM "map_regions" mr
          WHERE mr.map_id = wm.id
        ),
        '[]'::jsonb
      ),
      'artifacts', '[]'::jsonb,
      'chains', '[]'::jsonb
    )
  FROM "world_maps" wm;

  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0012: seeded % initial map_anchors (one per world_maps row)', n;
END $$;
