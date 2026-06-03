-- Settings customization Phase 3 — appearance presets (T10).
--
-- A named, reusable APPEARANCE blob (theme / accent / the three color maps),
-- stored SEPARATELY from user_preferences (design Approach C). Profiles carry
-- the full prefs blob and switch via is_active; a preset is appearance-only and
-- is *applied* (patched into the active profile's appearance.*), never
-- activated. The separate table makes it structurally impossible for a preset
-- to leak into a profile-list query (the `kind`-discriminator risk Approach B
-- carried). Additive only — one table, no data migrated.
--
-- Built-in presets (High Contrast, Sepia, …) ship as a constant, NOT rows; only
-- user-saved presets land here.
--
-- IMMUTABLE except delete: NO updated_at column and NO bump_updated_at trigger.
-- A preset is created once and deleted; there is no edit path, so the
-- mutable-table trigger convention does not apply. created_at is for ordering.

CREATE TABLE appearance_presets (
	user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	preset_id uuid NOT NULL DEFAULT gen_random_uuid(),
	name text NOT NULL,
	appearance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, preset_id)
);
