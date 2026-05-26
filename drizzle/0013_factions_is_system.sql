-- World Map v3 Slice 2 D1 — system "Neutral" faction marker.
--
-- Adds factions.is_system so the per-user Neutral faction (Slice 2 D1) can
-- be schema-level-protected against deletion. The actual Neutral faction
-- rows + faction_id backfill on map_regions land in a later migration
-- (T3) once the projection-side faction-only resolution is in place.
-- This PR is additive only: column + partial unique index. No data is
-- mutated; existing factions all carry is_system=false.
--
-- Partial unique index enforces "exactly one is_system=true row per
-- user_id." Without this, an attacker (or a buggy server-side helper)
-- could mark a second faction as is_system and shadow Neutral. With the
-- index, Postgres rejects the insert at the storage layer.
--
-- Server-side PATCH/DELETE guards in world-map-v3.ts reject mutations
-- on is_system=true rows with 422. UI hides the Delete button. The
-- index is the lowest-layer guarantee; the guard is convenience.

ALTER TABLE factions
	ADD COLUMN is_system boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX factions_user_one_system
	ON factions (user_id)
	WHERE is_system = true;
