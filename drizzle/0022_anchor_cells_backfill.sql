-- World Map v3 Slice 3 T2 — anchor state_jsonb.cells[] backfill.
--
-- Brush authoring (Slice 3 D2) stores per-cell biome in
-- anchor.state_jsonb.cells[]. Every existing anchor (including the
-- '-Infinity'::float8 baseline anchors seeded by 0012) needs a cells
-- field so projection.ts can read it unconditionally without a
-- "missing key" branch.
--
-- Idempotent: jsonb_set with create_missing=true is a no-op when the
-- key already exists. Pre-Slice-3 anchors have no cells key, so this
-- migration writes [] into them. Post-Slice-3 anchors are written by
-- the new code paths with cells already populated.
--
-- bump_updated_at consequence: this UPDATE will fire the
-- map_anchors_bump_updated_at trigger from 0012 on every row,
-- rewriting updated_at to migration-run time. Acceptable data noise
-- per CLAUDE.md (trigger is the trigger, not "app code setting
-- updated_at"). The plan acknowledges this in outside-voice
-- amendments § T2.
--
-- Sparse representation invariant: empty cells means "no terrain
-- painted yet, render as transparent." Stored 'unset' biome (Slice 3
-- A6) is also rendered transparent; they're equivalent at render
-- time. This migration writes [] not [{biome:'unset'}…] — the user
-- never painted, so there's nothing to store.

UPDATE map_anchors
SET state_jsonb = jsonb_set(
	state_jsonb,
	'{cells}',
	'[]'::jsonb,
	true
)
WHERE NOT (state_jsonb ? 'cells');
