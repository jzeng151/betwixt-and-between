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
-- commit. The DB columns are plain text — the enum lives as TS const +
-- write-time validation in the API layer — so no DDL change is required
-- here. Vitest invariants in the same commit assert post-migration counts.

DELETE FROM relationships WHERE type = 'pov_of';
--> statement-breakpoint
UPDATE relationships
SET type = 'other', label = COALESCE(label, 'mentor of')
WHERE type = 'mentor_of';
--> statement-breakpoint
DELETE FROM relationships WHERE type = 'appears_in';
--> statement-breakpoint
UPDATE entities
SET type = 'Artifact',
    data = jsonb_set(coalesce(data, '{}'::jsonb), '{legacySubtype}', '"door"'::jsonb)
WHERE type = 'Door';
