-- World Map v3 Slice 3 T1' — grid columns on world_maps.
--
-- Adds the deferred grid columns the design doc § Slice 1a A3 punted to
-- Slice 3. Six columns total:
--   grid_type        — 'square' | 'hex'. Default 'square' per design doc
--                      Open Question #1 resolution.
--   grid_cells_x/y   — integer cell counts. CHECK bound 4-128 (codex
--                      outside-voice #12: 200×200 = 40k cells/anchor is
--                      too generous; 128×128 = 16k is a sensible upper).
--   grid_scale_unit  — display unit string ('m', 'ft', etc).
--                      Authoring metadata only; not used in projection.
--   grid_scale_value — meters (or chosen unit) per cell.
--   grid_visible     — render the grid overlay? Two-pass default per
--                      outside-voice B9a: pre-existing rows get FALSE
--                      (no surprise grid on next load); new rows get
--                      TRUE (brush UX wants a visible grid by default).
--
-- Two-pass `grid_visible` mechanic: ADD COLUMN with DEFAULT false fills
-- every existing row with false; then ALTER COLUMN ... SET DEFAULT true
-- so future INSERTs without an explicit value pick up true. Existing
-- rows stay false. Closes outside-voice B9a (subagent #15).
--
-- CHECK constraints are inline ADD CONSTRAINT statements rather than
-- table-level guards so we can name them explicitly and so Drizzle's
-- schema.ts can declare them with the same names via the check() DSL.

ALTER TABLE world_maps
	ADD COLUMN grid_type text NOT NULL DEFAULT 'square';--> statement-breakpoint

ALTER TABLE world_maps
	ADD CONSTRAINT world_maps_grid_type_check
	CHECK (grid_type IN ('square', 'hex'));--> statement-breakpoint

ALTER TABLE world_maps
	ADD COLUMN grid_cells_x integer NOT NULL DEFAULT 32;--> statement-breakpoint

ALTER TABLE world_maps
	ADD COLUMN grid_cells_y integer NOT NULL DEFAULT 24;--> statement-breakpoint

ALTER TABLE world_maps
	ADD CONSTRAINT world_maps_grid_cells_bounds_check
	CHECK (
		grid_cells_x BETWEEN 4 AND 128
		AND grid_cells_y BETWEEN 4 AND 128
	);--> statement-breakpoint

ALTER TABLE world_maps
	ADD COLUMN grid_scale_unit text NOT NULL DEFAULT 'm';--> statement-breakpoint

ALTER TABLE world_maps
	ADD COLUMN grid_scale_value double precision NOT NULL DEFAULT 5.0;--> statement-breakpoint

-- Two-pass grid_visible default (outside-voice B9a):
-- Pass 1: ADD COLUMN with DEFAULT false → backfills all existing rows.
ALTER TABLE world_maps
	ADD COLUMN grid_visible boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- Pass 2: switch the default for future INSERTs.
ALTER TABLE world_maps
	ALTER COLUMN grid_visible SET DEFAULT true;
