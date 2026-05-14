-- WorldMap v2 groundwork (2026-05-13)
--
-- Adds the durable Location anchor to world_maps so v2 features (variants,
-- placements, drill-down, spotlight cycling) can resolve "which Location does
-- this map depict" without a parallel hierarchy.
--
-- world_maps.location_id is added NULL for all existing rows. No backfill —
-- linking is explicit via the v2 picker UI (Step 1). Polymorphic FK contract:
-- target entity must have type='Location'; enforced at the write layer + by
-- a Vitest invariant test (Postgres cannot CHECK this cleanly, same precedent
-- as intervals.start_act_id).
--
-- location_inactive_at records when the FK was nulled (either by ON DELETE
-- SET NULL or by user unlink), so the v2 UI can surface orphan maps for
-- re-linking. NULL on healthy rows.

ALTER TABLE "world_maps" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "world_maps" ADD COLUMN "location_inactive_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_location_id_entities_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_maps_location_id_idx" ON "world_maps" USING btree ("location_id");
