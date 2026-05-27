-- World Map v3 Slice 2 D2 PR-A — anchor schema gains polygon + locationId.
--
-- Codex finding #1 against the original Slice 2 plan: anchor
-- state_jsonb.regions[] was being asserted as "canonical for geometry"
-- but the runtime type only carried { region_id, faction_id, color }.
-- Polygon geometry lived in map_regions; under D2 the plan migrates
-- map_regions out of the picture and anchor JSON becomes canonical.
-- This migration is the data-side backfill: for every anchor row, walk
-- its regions[] array and splice the corresponding map_regions row's
-- polygon + locationId into each entry. Application writes are updated
-- in the same PR so new regions land with these fields populated.
--
-- The legacy `color` field is left untouched (it stays in the jsonb for
-- round-trip of historical data; post-D1 projection ignores it — see
-- migration 0014).

UPDATE map_anchors ma
SET state_jsonb = jsonb_set(
	ma.state_jsonb,
	'{regions}',
	(
		SELECT jsonb_agg(
			-- For each region entry, look up the matching map_regions row
			-- and splice in polygon + locationId. If no match (the entry
			-- references a deleted region), preserve the entry as-is so
			-- the lazy-GC at render still skips it cleanly.
			CASE
				WHEN mr.id IS NULL THEN r
				ELSE r
					|| jsonb_build_object('polygon', mr.polygon)
					|| (
						CASE
							WHEN mr.location_id IS NULL THEN jsonb_build_object('locationId', NULL)
							ELSE jsonb_build_object('locationId', mr.location_id::text)
						END
					)
			END
		)
		FROM jsonb_array_elements(ma.state_jsonb->'regions') AS r
		LEFT JOIN map_regions mr
			ON mr.id::text = r->>'region_id'
			AND mr.map_id = ma.world_map_id
	)
)
WHERE ma.state_jsonb ? 'regions'
	AND jsonb_typeof(ma.state_jsonb->'regions') = 'array'
	AND jsonb_array_length(ma.state_jsonb->'regions') > 0;
