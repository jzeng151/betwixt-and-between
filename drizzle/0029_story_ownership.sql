CREATE TABLE stories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stories_user_id_idx ON stories (user_id);
--> statement-breakpoint
CREATE FUNCTION create_default_story() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO stories (id, user_id, name) VALUES (NEW.id, NEW.id, 'My story');
 RETURN NEW;
END;
$$;
CREATE TRIGGER user_default_story AFTER INSERT ON "user"
 FOR EACH ROW EXECUTE FUNCTION create_default_story();
-- Install the signup trigger before backfilling, so concurrent signups cannot
-- land between the backfill and trigger creation without a default story.
INSERT INTO stories (id, user_id, name) SELECT id, id, 'My story' FROM "user"
 ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Keep the physical user_id columns so the previous Worker remains compatible
-- while this migration runs. The application now exposes them as storyId.
DO $$
DECLARE
 relation_name text;
 fk record;
BEGIN
 FOREACH relation_name IN ARRAY ARRAY[
  'entities', 'relationships', 'canvas_positions', 'window_canvas_state',
  'intervals', 'world_maps', 'map_placements', 'factions', 'world_map_layer_prefs'
 ] LOOP
  FOR fk IN SELECT c.conname FROM pg_constraint c
   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
   WHERE c.conrelid = relation_name::regclass AND c.contype = 'f' AND a.attname = 'user_id'
  LOOP
   EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', relation_name, fk.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES stories(id) ON DELETE CASCADE',
   relation_name, relation_name || '_story_id_fkey');
 END LOOP;
END $$;
