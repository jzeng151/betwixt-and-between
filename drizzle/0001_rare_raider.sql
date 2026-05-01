CREATE TABLE IF NOT EXISTS "window_canvas_state" (
	"window_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer DEFAULT 160 NOT NULL,
	"height" integer DEFAULT 80 NOT NULL,
	"pinned" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "window_canvas_state_window_id_entity_id_pk" PRIMARY KEY("window_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "window_canvas_state" ADD CONSTRAINT "window_canvas_state_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "window_canvas_state_window_idx" ON "window_canvas_state" USING btree ("window_id");