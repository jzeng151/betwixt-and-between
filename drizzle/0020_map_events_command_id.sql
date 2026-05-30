-- World Map v3 Slice 3 T21 — chunked-stroke grouping on map_events.
--
-- Adds `command_id uuid NULL` so multi-event brush strokes can be
-- undone as one logical command. Resolution to outside-voice B5
-- (codex + subagent convergent finding): the 256-cell payload cap
-- (outside-voice A3) splits big strokes across multiple paint_cells
-- events, but Slice 2 D3's undo handler pops one latest event — which
-- would silently split a user gesture into multiple undo steps.
--
-- Semantics:
--   • Client generates one UUIDv4 per brush stroke (mouse-down to
--     mouse-up). Every chunked event in that stroke carries the same
--     command_id. The last chunk additionally sets command_complete
--     in the payload so the server-side auto-anchor (T22) knows the
--     stroke is fully posted.
--   • NULL command_id = standalone event. Legacy behavior — applies to
--     manual right-click anchors, transfer_region events, any non-
--     brush write paths. The undo handler treats NULL command_id rows
--     as singletons (pop the latest, soft-delete that one row).
--   • Non-NULL command_id = grouped event. Undo soft-deletes ALL rows
--     sharing that command_id in one transaction, atomically. Redo
--     POSTs the chunks as fresh rows with new command_id (Slice 2 D3
--     append-only history posture preserved).
--
-- Partial index over (world_map_id, command_id) WHERE command_id IS
-- NOT NULL accelerates the "soft-delete all rows with this command_id
-- on this map" undo path without paying the index cost on the much-
-- more-common NULL-command_id rows.

ALTER TABLE map_events
	ADD COLUMN command_id uuid;--> statement-breakpoint

CREATE INDEX map_events_command_id_idx
	ON map_events (world_map_id, command_id)
	WHERE command_id IS NOT NULL;
