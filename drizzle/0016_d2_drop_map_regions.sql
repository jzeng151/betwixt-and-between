-- World Map v3 Slice 2 D2 PR-C (T6) — drop map_regions table.
--
-- Anchor state_jsonb.regions[] is now canonical for region identity,
-- geometry (polygon), faction overlay, and location-link. Migration
-- 0015 backfilled polygon + locationId from map_regions into the
-- baseline anchor for every map; the integration invariant test (T4)
-- proved equivalence. T5a rewrote every read site to consume anchor
-- JSON. T6 (this migration + accompanying app changes) drops the last
-- writers — region POST/PATCH/DELETE and duplicate-map no longer
-- touch map_regions — making the table unreferenced.
--
-- Rollback procedure: revert the T6 PR. The table cannot be
-- reconstructed from anchor JSON alone if any historical anchors
-- carry stale region_ids (lazy GC by design) — but since the baseline
-- anchor remains in sync with reality, a manual restore can rebuild
-- map_regions by selecting (region_id, polygon, locationId) from the
-- earliest anchor per map. Document this in the rollback runbook if
-- ever invoked.

DROP TABLE IF EXISTS map_regions;
