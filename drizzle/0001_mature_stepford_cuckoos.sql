-- Dedup any existing duplicate relationship edges (keep oldest by id ordering).
-- Required before the unique index can be created. Locked 2026-04-29 in
-- /plan-eng-review (Issue 18-revised B). For a single-user app at this scale,
-- this typically removes 0 rows; the step is defensive against any rows
-- created by manual edits or test fixtures pre-constraint.
DELETE FROM relationships
WHERE id NOT IN (
  SELECT MIN(id) FROM relationships
  GROUP BY from_id, to_id, type
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationships_dedup` ON `relationships` (`from_id`,`to_id`,`type`);
