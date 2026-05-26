-- World Map v3 Slice 2 D3 (T7) — soft-delete column for undo.
--
-- One map_events row = one undoable command. Undo pops the latest event
-- in commit order ((created_at DESC, id DESC)), sets undone_at = now(),
-- and the projection + list paths filter out undone rows. Redo is a
-- client-side concern: the popped event is held in memory and replayed
-- via a fresh POST to /api/maps/[id]/events, which creates a NEW row
-- (new id, new created_at, same t_position + payload_jsonb). The
-- undone row stays in place as audit trail.
--
-- The "append-only history" posture is preserved: undo soft-deletes
-- (not hard-deletes), and redo never resurrects — it appends a new
-- row. Restoring an undone row from undone_at -> NULL would defeat
-- the audit invariant.

ALTER TABLE map_events
    ADD COLUMN IF NOT EXISTS undone_at timestamptz;
