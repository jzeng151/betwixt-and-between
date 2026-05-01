CREATE TABLE "canvas_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"x" integer DEFAULT 0 NOT NULL,
	"y" integer DEFAULT 0 NOT NULL,
	"width" integer DEFAULT 160 NOT NULL,
	"height" integer DEFAULT 80 NOT NULL,
	CONSTRAINT "canvas_positions_entity_id_unique" UNIQUE("entity_id")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_id" uuid,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"start_act_id" uuid NOT NULL,
	"start_scene_id" uuid,
	"end_act_id" uuid NOT NULL,
	"end_scene_id" uuid,
	"start_position" real NOT NULL,
	"end_position" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intervals_position_order" CHECK ("intervals"."start_position" < "intervals"."end_position")
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"label" text,
	"type" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_positions" ADD CONSTRAINT "canvas_positions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_parent_id_entities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervals" ADD CONSTRAINT "intervals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervals" ADD CONSTRAINT "intervals_start_act_id_entities_id_fk" FOREIGN KEY ("start_act_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervals" ADD CONSTRAINT "intervals_start_scene_id_entities_id_fk" FOREIGN KEY ("start_scene_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervals" ADD CONSTRAINT "intervals_end_act_id_entities_id_fk" FOREIGN KEY ("end_act_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervals" ADD CONSTRAINT "intervals_end_scene_id_entities_id_fk" FOREIGN KEY ("end_scene_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_id_entities_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_id_entities_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_created_at_idx" ON "entities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "entities_parent_idx" ON "entities" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "entities_type_position_idx" ON "entities" USING btree ("type","position");--> statement-breakpoint
CREATE INDEX "intervals_entity_idx" ON "intervals" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "intervals_position_idx" ON "intervals" USING btree ("start_position","end_position");--> statement-breakpoint
CREATE INDEX "intervals_start_scene_idx" ON "intervals" USING btree ("start_scene_id");--> statement-breakpoint
CREATE INDEX "intervals_end_scene_idx" ON "intervals" USING btree ("end_scene_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_dedup" ON "relationships" USING btree ("from_id","to_id","type");--> statement-breakpoint
-- BEFORE UPDATE trigger: keeps `updated_at` fresh on every UPDATE without
-- requiring application code to set it. Replaces the 17 manual
-- `updatedAt: sql\`(unixepoch())\`` lines from the sqlite era. Applies to
-- every table with an `updated_at` column.
CREATE OR REPLACE FUNCTION bump_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER entities_bump_updated_at
  BEFORE UPDATE ON "entities"
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();--> statement-breakpoint
CREATE TRIGGER intervals_bump_updated_at
  BEFORE UPDATE ON "intervals"
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();