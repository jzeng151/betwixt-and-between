-- World Map: bitmap-based geographic map with polygon regions
-- Phase 1 World Map feature, 2026-05-05

CREATE TABLE IF NOT EXISTS "world_maps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "base_image_url" text,
  "width" integer,
  "height" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "map_regions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "map_id" uuid NOT NULL,
  "location_id" uuid,
  "polygon" jsonb NOT NULL,
  "color" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "map_regions_map_id_world_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."world_maps"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "map_regions_location_id_entities_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "map_regions_map_id_idx" ON "map_regions"("map_id");
--> statement-breakpoint
CREATE INDEX "map_regions_location_id_idx" ON "map_regions"("location_id");
--> statement-breakpoint
CREATE TRIGGER world_maps_bump_updated_at
  BEFORE UPDATE ON "world_maps"
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();
--> statement-breakpoint
CREATE TRIGGER map_regions_bump_updated_at
  BEFORE UPDATE ON "map_regions"
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();
