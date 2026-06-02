-- Settings customization Phase 1 — server-backed user preferences.
--
-- Replaces the localStorage-only `preferences` store as the source of truth:
-- the client store becomes a cache that hydrates from here on login and writes
-- through via PATCH /api/preferences (T3/T4). This PR is additive only — the
-- table + its constraints + the bump trigger. No data is migrated.
--
-- Profile-shaped from day one (eng-review P4): the (user_id, profile_id) PK +
-- is_active flag mean Phase 3 "workspace profiles" / "theme presets" become
-- "allow N rows + a switcher" with NO further schema migration. Phase 1 writes
-- exactly one row per user (name='Default', is_active=1).
--
-- is_active is integer 0/1 (NOT boolean) per CLAUDE.md convention (matches
-- window_canvas_state.pinned, world_map_layer_prefs.visible). The partial
-- unique index user_preferences_one_active enforces "at most one active row
-- per user" at the storage layer. This is BOTH the integrity guarantee behind
-- the future profile switcher AND the conflict target the lazy first-login
-- upsert (ON CONFLICT DO NOTHING) needs to be race-safe under concurrent
-- first-GETs (codex outside-voice). cf. factions_user_one_system (0013), which
-- does the same for a boolean column; here the predicate is `= 1`.
--
-- version is the OPTIMISTIC-CONCURRENCY revision counter (Approach B). It is
-- DISTINCT from data->>'schemaVersion' (the blob SHAPE / migration version) —
-- the two must never be conflated. The server PATCH bumps it with an atomic
-- conditional UPDATE (codex — fixes a TOCTOU race that load-check-write would
-- have):
--     UPDATE user_preferences SET data = $merged, version = version + 1
--      WHERE user_id = $u AND profile_id = $p AND version = $clientVersion
--      RETURNING version;
-- Zero rows affected → 409 stale; the client reconciles. (Lands in T2/T4.)
--
-- initialized_from_client_at is the durable first-login-reconcile marker
-- (codex): set once when a user's pre-existing localStorage prefs are pushed
-- into a freshly-created Default row, so we never re-clobber by comparing the
-- server blob against code defaults (which drift between releases).
--
-- bump_updated_at trigger (CLAUDE.md mutable-table convention): the row IS
-- mutated by user actions, so updated_at must bump on UPDATE and app code must
-- NOT set it. The trigger function bump_updated_at() is defined in 0000.

CREATE TABLE user_preferences (
	user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	profile_id uuid NOT NULL DEFAULT gen_random_uuid(),
	name text NOT NULL,
	is_active integer NOT NULL DEFAULT 1,
	version integer NOT NULL DEFAULT 1,
	data jsonb NOT NULL DEFAULT '{}'::jsonb,
	initialized_from_client_at timestamp with time zone,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	updated_at timestamp with time zone NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, profile_id)
);--> statement-breakpoint

CREATE UNIQUE INDEX user_preferences_one_active
	ON user_preferences (user_id)
	WHERE is_active = 1;--> statement-breakpoint

CREATE TRIGGER user_preferences_bump_updated_at
	BEFORE UPDATE ON user_preferences
	FOR EACH ROW EXECUTE FUNCTION bump_updated_at();
