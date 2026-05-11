-- Add nullable userId columns for multi-user support
ALTER TABLE "entities" ADD COLUMN "user_id" uuid REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "user_id" uuid REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "canvas_positions" ADD COLUMN "user_id" uuid REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "window_canvas_state" ADD COLUMN "user_id" uuid REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intervals" ADD COLUMN "user_id" uuid REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "world_maps" ADD COLUMN "user_id" uuid REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "entities_user_id_idx" ON "entities" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "relationships_user_id_idx" ON "relationships" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "canvas_positions_user_id_idx" ON "canvas_positions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "window_canvas_state_user_id_idx" ON "window_canvas_state" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "intervals_user_id_idx" ON "intervals" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "world_maps_user_id_idx" ON "world_maps" USING btree ("user_id");
