-- World Map v3 Slice 3 T14' — per-user-per-map layer visibility prefs.
--
-- Created per outside-voice A1 + B3: the in-session review tried to
-- host this in window_canvas_state, but that table is keyed on
-- (window_id, entity_id) for per-entity node placement in a graph
-- window — it has no row shape for "layer X visibility on world_map Y
-- for user Z." Different data lifecycle, different shape.
--
-- Cross-user invariant (CLAUDE.md): every write MUST be scoped through
-- world_maps.user_id via JOIN (the user_id column on this table is
-- "the user authoring the pref," not "the user owning the map" — those
-- must match). The server-side write helper validates the JOIN before
-- INSERT/UPDATE/DELETE; cross-user attempts return 404. Outside-voice
-- codex #15 flagged this explicitly. The integration tests at
-- tests/integration/auth-isolation-world-map-v3.test.ts cover it.
--
-- Composite PK on (user_id, world_map_id, layer_key) means each user
-- has at most one row per (map, layer) pair. Inserting a duplicate is
-- a constraint violation; the upsert helper does ON CONFLICT DO UPDATE.
--
-- `visible` is integer 0/1 (NOT boolean) per CLAUDE.md convention
-- (matches window_canvas_state.pinned). Keeps SQL portable and avoids
-- casting in client code.
--
-- bump_updated_at trigger (CLAUDE.md mutable-table convention +
-- outside-voice B9d): the table IS mutated by user actions (toggle
-- layer on/off), so updated_at must bump on UPDATE. Without the
-- trigger, the cursor-pagination order-by-updated_at story from
-- Slice 2 D5 would fight CLAUDE.md "never set updated_at in app
-- code." The trigger function bump_updated_at() is defined in 0000.
--
-- Layer keys (declaration in code, not DB): the design doc § Slice 3
-- D6 enumerates the layer stack (background, grid, terrain, regions,
-- placements, chrome). The DB does not constrain layer_key to those
-- values — adding/removing layers is a code change, not a migration.
-- Stale layer_key rows (e.g. a layer renamed in code) become orphans
-- and are silently ignored by the reader. Lazy GC matches the
-- anchor-jsonb policy.

CREATE TABLE world_map_layer_prefs (
	user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	world_map_id uuid NOT NULL REFERENCES world_maps(id) ON DELETE CASCADE,
	layer_key text NOT NULL,
	visible integer NOT NULL DEFAULT 1,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	updated_at timestamp with time zone NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, world_map_id, layer_key)
);--> statement-breakpoint

CREATE INDEX world_map_layer_prefs_map_idx
	ON world_map_layer_prefs (world_map_id);--> statement-breakpoint

CREATE TRIGGER world_map_layer_prefs_bump_updated_at
	BEFORE UPDATE ON world_map_layer_prefs
	FOR EACH ROW EXECUTE FUNCTION bump_updated_at();
