-- World Map v3 Slice 3 T15 — synthetic-anchor marker on map_anchors.
--
-- Adds `is_synthetic` boolean to mark anchors written by the server-side
-- auto-anchor logic (outside-voice B7: tight rules at K=20 paint_cells
-- events between user-authored anchors). Synthetic anchors are a
-- projection-cost optimization — they snapshot rolling brush state so
-- projection at the current playhead doesn't have to walk every event
-- back to the last user-authored anchor.
--
-- Semantics (outside-voice B7 + B8):
--   • is_synthetic=false (default) — user-authored anchor.
--     Right-click "snapshot world state here" sets this; existing
--     anchors from 0012's backfill remain user-authored.
--   • is_synthetic=true — auto-written by paint_cells POST handler when
--     the non-undone paint_cells count since last anchor reaches K=20
--     AND the current event has command_complete=true (or null
--     command_id). Stroke-boundary aware: never split mid-stroke.
--
-- Undo policy (outside-voice B9 + A9): synthetic anchors are NOT
-- treated as dependents in the Slice 2 D3 cascade-undo prompt. When an
-- undo would invalidate a synthetic anchor's snapshot, projection
-- bypasses the synthetic anchor and rebuilds from the prior
-- user-authored anchor + remaining live events. No cascade-undo prompt
-- for synthetic anchors (the user didn't author them).

ALTER TABLE map_anchors
	ADD COLUMN is_synthetic boolean NOT NULL DEFAULT false;
