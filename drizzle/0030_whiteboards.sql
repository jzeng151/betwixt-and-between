CREATE TABLE whiteboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  document jsonb NOT NULL DEFAULT '{"version":1,"elements":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX whiteboards_story_id_idx ON whiteboards(story_id);
--> statement-breakpoint
CREATE TRIGGER whiteboards_bump_updated_at BEFORE UPDATE ON whiteboards
FOR EACH ROW EXECUTE FUNCTION bump_updated_at();
