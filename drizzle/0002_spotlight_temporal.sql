-- Spotlight integration: temporal relationship bounds + entity_aliases table
-- Phase 1B Lane A, 2026-05-02

ALTER TABLE "relationships" ADD COLUMN "start_act_id" uuid;
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "start_scene_id" uuid;
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "end_act_id" uuid;
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "end_scene_id" uuid;
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "start_position" double precision;
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "end_position" double precision;
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "revealed_at_position" double precision;
--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_start_act_id_entities_id_fk" FOREIGN KEY ("start_act_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_start_scene_id_entities_id_fk" FOREIGN KEY ("start_scene_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_end_act_id_entities_id_fk" FOREIGN KEY ("end_act_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_end_scene_id_entities_id_fk" FOREIGN KEY ("end_scene_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_position_order" CHECK (
  ("start_position" IS NULL AND "end_position" IS NULL)
  OR ("start_position" IS NOT NULL AND "end_position" IS NOT NULL AND "start_position" < "end_position")
);
--> statement-breakpoint
DROP INDEX IF EXISTS "relationships_dedup";
--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_timeless_dedup"
  ON "relationships"("from_id", "to_id", "type")
  WHERE "start_position" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_temporal_dedup"
  ON "relationships"("from_id", "to_id", "type", "start_position")
  WHERE "start_position" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "relationships_position_idx" ON "relationships"("start_position", "end_position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "primary_entity_id" uuid NOT NULL,
  "alias_entity_id" uuid NOT NULL,
  "revealed_at_position" double precision,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "entity_aliases_unique" UNIQUE("primary_entity_id", "alias_entity_id"),
  CONSTRAINT "entity_aliases_no_self" CHECK ("primary_entity_id" <> "alias_entity_id")
);
--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_primary_entity_id_entities_id_fk" FOREIGN KEY ("primary_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_alias_entity_id_entities_id_fk" FOREIGN KEY ("alias_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "entity_aliases_primary_idx" ON "entity_aliases"("primary_entity_id");
--> statement-breakpoint
CREATE INDEX "entity_aliases_alias_idx" ON "entity_aliases"("alias_entity_id");
