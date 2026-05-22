-- Data model cleanup — pre-Slice 1 burst Step 5.5 (2026-05-21)
--
-- Executes the four hard cuts from the 2026-05-20 whole-app /office-hours
-- audit (see ~/.gstack/projects/jzeng151-betwixt-and-between/
-- steve-restructure-pre-slice-1-burst-design-20260520-234854.md):
--
--   1. pov_of   — DELETE. Confirmed no read-side consumer. The original
--                 intent (per-POV world simulation) is a v4-scale slice
--                 (knowledge events + projection filter + propagation
--                 rules + POV-switcher UI). Carrying the row as a
--                 breadcrumb does no work today. See TODOS § "Footnotes
--                 from 2026-05-20 audit" → per-POV simulation.
--
--   2. mentor_of — UPDATE → 'other' with label='mentor of'. Novelist's
--                 character-arc shorthand; no read-side consumer; typed
--                 name carrying zero semantics. The 'other'-with-label
--                 escape hatch covers any authoring need.
--
--                 Two intentional semantic shifts ship with this rewrite:
--                 (a) Directionality: mentor_of was directed (mentor →
--                     mentee) in edge-policy.ts; 'other' is symmetric.
--                     Surviving rows now traverse bidirectionally in
--                     FocusedGraph and render without an arrowhead.
--                     Accepted — the mentor/mentee distinction was a
--                     novelist's-shorthand concept and the audit's call
--                     was that the typed edge carried zero semantics.
--                 (b) Collision handling: if a pair (from, to) already
--                     has an 'other' row with the same temporal key
--                     (NULL start_position OR equal start_position),
--                     the rewrite would violate the partial-unique
--                     indexes relationships_timeless_dedup +
--                     relationships_temporal_dedup (see migration
--                     0002_spotlight_temporal.sql). The pre-UPDATE
--                     DELETE below drops the colliding mentor_of row.
--                     The pre-existing 'other' row wins; any mentor-
--                     specific label on the mentor_of row is lost.
--                     Same reasoning as (a) — typed mentor semantics
--                     are not load-bearing.
--
--                 (The audit deliverable referenced `data.label`; that
--                 was a slip — `relationships` has a `label` text column,
--                 not a `data` jsonb. The escape hatch was always the
--                 dedicated `label` column.)
--
--   3. appears_in — DELETE. Writes were blocked 2026-04-28 (ADR 0002;
--                 src/routes/api/relationships/+server.ts:52-55). ADR 0002
--                 left the "Drop plan unclear" — the never-written
--                 scripts/backfill-appears-in.ts is the placeholder for
--                 the conversion that never shipped. User decision
--                 2026-05-21: accept that any surviving legacy rows are
--                 casualties of the cutover. Single-user dev with writes
--                 blocked weeks ago — likely zero rows in prod.
--
--   4. Door     — UPDATE → 'Artifact' with data.legacySubtype='door'. No
--                 special validators, no special data fields, no special
--                 rendering — carrying it as a distinct EntityType without
--                 mechanics is the same anti-pattern as pov_of. Mechanics
--                 (data.locked, data.key_artifact_id, data.connects_to,
--                 projection-engine portal behavior) revisit if/when
--                 hex-grid + fog-of-war work moves from deferred to active.
--                 See TODOS § "Footnotes from 2026-05-20 audit" → Door
--                 mechanics.
--
-- The TS enum trim (RelationshipType, EntityType, PlaceableEntityType in
-- src/lib/server/db/schema.ts) ships alongside this migration in the same
-- commit. To defend against rolling-deploy drift (an old Worker instance
-- still carrying the dead types in its TS enum, racing this migration on
-- the way out), the migration also installs CHECK constraints at the end
-- that fence the trimmed enum values at the DB level. A stale-Worker
-- write attempting to re-introduce a cut type now fails with 23514
-- instead of silently re-corrupting the data this migration just cleaned.
-- Trade-off: every future enum addition needs a paired DROP CONSTRAINT
-- + ADD CONSTRAINT block in its migration to stay in sync.
--
-- Each destructive statement is wrapped in a DO block with RAISE NOTICE
-- so the operator running `npm run db:migrate` sees pre-counts ahead of
-- the COMMIT — visible audit trail of what's about to be lost.

DO $$ DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM relationships WHERE type = 'pov_of';
  RAISE NOTICE '0011: deleting % pov_of rows', n;
  DELETE FROM relationships WHERE type = 'pov_of';
END $$;
--> statement-breakpoint
-- Pre-collision DELETE — see comment 2(b) above. Drops mentor_of rows
-- that would violate the partial-unique dedup indexes once rewritten
-- to type='other'. Must run BEFORE the UPDATE; otherwise the UPDATE
-- aborts the whole migration on any colliding pair.
DO $$ DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM relationships m
    WHERE m.type = 'mentor_of'
      AND EXISTS (
        SELECT 1 FROM relationships o
        WHERE o.type = 'other'
          AND o.from_id = m.from_id
          AND o.to_id = m.to_id
          AND (
            (o.start_position IS NULL AND m.start_position IS NULL)
            OR o.start_position = m.start_position
          )
      );
  RAISE NOTICE '0011: deleting % mentor_of rows that would collide with existing other rows', n;
  DELETE FROM relationships m
  WHERE m.type = 'mentor_of'
    AND EXISTS (
      SELECT 1 FROM relationships o
      WHERE o.type = 'other'
        AND o.from_id = m.from_id
        AND o.to_id = m.to_id
        AND (
          (o.start_position IS NULL AND m.start_position IS NULL)
          OR o.start_position = m.start_position
        )
    );
END $$;
--> statement-breakpoint
DO $$ DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM relationships WHERE type = 'mentor_of';
  RAISE NOTICE '0011: rewriting % mentor_of rows to other + label', n;
  UPDATE relationships
    SET type = 'other', label = COALESCE(label, 'mentor of')
    WHERE type = 'mentor_of';
END $$;
--> statement-breakpoint
DO $$ DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM relationships WHERE type = 'appears_in';
  RAISE NOTICE '0011: deleting % appears_in rows', n;
  DELETE FROM relationships WHERE type = 'appears_in';
END $$;
--> statement-breakpoint
DO $$ DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM entities WHERE type = 'Door';
  RAISE NOTICE '0011: rewriting % Door entities to Artifact + data.legacySubtype', n;
  UPDATE entities
    SET type = 'Artifact',
        data = jsonb_set(coalesce(data, '{}'::jsonb), '{legacySubtype}', '"door"'::jsonb)
    WHERE type = 'Door';
END $$;
--> statement-breakpoint
-- DB-level fence on the trimmed enum values. DROP IF EXISTS + ADD makes
-- this migration idempotent — re-runs are safe (the constraint gets
-- dropped and re-added with the same body). Future enum additions need
-- their own migration with the paired DROP + ADD shape to stay in sync.
ALTER TABLE relationships DROP CONSTRAINT IF EXISTS relationships_type_valid;
--> statement-breakpoint
ALTER TABLE relationships ADD CONSTRAINT relationships_type_valid CHECK (
  type IN (
    'takes_place_at','caused_by','allied_with','rivals',
    'located_at','note_of','part_of','other'
  )
);
--> statement-breakpoint
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_type_valid;
--> statement-breakpoint
ALTER TABLE entities ADD CONSTRAINT entities_type_valid CHECK (
  type IN ('Character','Location','Event','Act','Scene','Note','Artifact','Item')
);
