-- World Map v3 Slice 2 D1 — faction-only color model + Neutral backfill.
--
-- Three things, in this order so each step's invariant is satisfied before
-- the next runs:
--
--   1. Create a per-user "Neutral" faction (is_system = true) for every
--      existing user that doesn't already have one. Color #9ca3af matches
--      NEUTRAL_REGION_COLOR in src/lib/features/map/projection.ts. The
--      partial unique index from migration 0013 enforces uniqueness; the
--      `NOT EXISTS` guard makes this migration idempotent if re-run.
--
--   2. Backfill anchor `state_jsonb.regions[N].faction_id` to the user's
--      Neutral faction id for every region entry where faction_id is null
--      or absent. This is the acknowledged visual migration cost (codex
--      finding #6 against the original Slice 2 plan): distinct historical
--      region.color values all collapse to a single Neutral grey at render.
--      The legacy `color` field stays in the jsonb (round-trip preserved)
--      but the post-D1 projection ignores it. Anchors whose regions[] is
--      already null or empty are untouched.
--
--   3. Drop map_regions.color. The column is no longer the source of truth
--      for visual rendering — faction_id resolves through factions.color.
--      Region writes after this migration no longer accept a color field;
--      the POST /regions handler in src/routes/api/maps/[id]/regions/ has
--      already been updated to stop reading color from the body.
--
-- Anchors created AFTER this migration but BEFORE the application code
-- writing fanOutRegionAdd with faction_id lands will write null faction_id.
-- The projection treats null faction_id as "fall back to Neutral" — same
-- visual result. Code + data converge on Neutral lookup as the canonical
-- path.

-- Step 1: Per-user Neutral faction.
INSERT INTO factions (user_id, name, color, is_system)
SELECT u.id, 'Neutral', '#9ca3af', true
FROM "user" u
WHERE NOT EXISTS (
	SELECT 1 FROM factions f
	WHERE f.user_id = u.id AND f.is_system = true
);

-- Step 2: Backfill faction_id in anchor jsonb.
-- For each anchor, walk regions[] and set faction_id to Neutral on entries
-- that don't have a non-null faction_id. Uses jsonb_array_elements +
-- jsonb_agg in a correlated subquery; matches the write-through pattern in
-- src/lib/server/anchor-region-write-through.ts.
UPDATE map_anchors ma
SET state_jsonb = jsonb_set(
	ma.state_jsonb,
	'{regions}',
	(
		SELECT jsonb_agg(
			CASE
				WHEN (r ? 'faction_id') AND (r->>'faction_id') IS NOT NULL
					THEN r
				ELSE r || jsonb_build_object('faction_id', neutral.id::text)
			END
		)
		FROM jsonb_array_elements(ma.state_jsonb->'regions') AS r
	)
)
FROM world_maps wm, factions neutral
WHERE ma.world_map_id = wm.id
	AND neutral.user_id = wm.user_id
	AND neutral.is_system = true
	AND ma.state_jsonb ? 'regions'
	AND jsonb_typeof(ma.state_jsonb->'regions') = 'array'
	AND jsonb_array_length(ma.state_jsonb->'regions') > 0;

-- Step 3: Drop the legacy color column.
-- Slice 1b's write-through still writes color into anchor jsonb today; the
-- column drop is paired with the app code change that stops referencing
-- mapRegions.color (POST /regions body + Drizzle schema). After this
-- migration:
--   - anchor.state_jsonb.regions[N].color is preserved on historical rows
--     (round-trip JSON), but the post-D1 projection ignores it.
--   - new region writes do not produce a color field in anchor jsonb;
--     faction.color resolves the rendered color via faction_id (Neutral if
--     unset).
ALTER TABLE map_regions DROP COLUMN color;
