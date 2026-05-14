-- WorldMap v2 groundwork follow-up (2026-05-14)
--
-- Closes a P2 gap surfaced by Codex review on PR #42: the PATCH /api/maps/[id]
-- handler stamps location_inactive_at when the user unlinks, but the FK's
-- ON DELETE SET NULL clause bypasses the handler entirely. A deletion-driven
-- unlink left the timestamp NULL, making post-delete orphan maps indistinguishable
-- from never-linked maps — defeating the column's whole purpose.
--
-- This trigger moves the stamping into the DB so every location_id → NULL
-- transition gets recorded uniformly: user PATCH, FK cascade, future direct
-- SQL writes. Clearing on re-link (NULL → non-NULL) is included so the marker
-- is single-source-of-truth.

CREATE OR REPLACE FUNCTION world_maps_stamp_location_inactive_at() RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.location_id IS NOT NULL AND NEW.location_id IS NULL) THEN
    NEW.location_inactive_at = now();
  ELSIF (OLD.location_id IS NULL AND NEW.location_id IS NOT NULL) THEN
    NEW.location_inactive_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER world_maps_stamp_location_inactive_at_trigger
  BEFORE UPDATE ON "world_maps"
  FOR EACH ROW EXECUTE FUNCTION world_maps_stamp_location_inactive_at();
