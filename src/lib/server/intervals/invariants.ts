/**
 * Runtime invariants enforced on the `intervals` table before write.
 *
 * Today this is the same-entity overlap rule; future scene-within-act
 * invariants and any other cross-row checks land here so they share
 * one read/scope surface and one place to audit when the trust
 * boundary moves.
 */

import { eq, and } from 'drizzle-orm';
import { intervals } from '../db/schema.js';
import type { Db } from './types.js';

/**
 * Reject an insert/update whose [start, end) intersects any existing interval
 * for the SAME entity. Per /plan-eng-review resolutions item 1.2 (locked
 * 2026-04-28): one entity cannot be in two places at once on the story-time
 * axis. Adjacent intervals (touching at the boundary) are fine — the half-open
 * convention `[a1, a2)` and `[b1, b2)` overlaps iff `a1 < b2 AND b1 < a2`,
 * so e.g. [1, 2) and [2, 3) do NOT overlap.
 *
 * `excludeId` lets `updateInterval` skip the row being patched (otherwise it
 * would always overlap with itself).
 *
 * **Read-modify-write window (2026-06 audit):** like `validateFKTypes` and
 * `computeIntervalPositions`, this read+check is not atomic with the
 * subsequent write unless the caller wraps both in `db.transaction()`. On
 * the current runtime (Neon Postgres, one pool per request, default READ
 * COMMITTED) two concurrent writes for the same entity can BOTH pass this
 * check and insert overlapping intervals — there is no DB constraint
 * backing the invariant (unlike world_maps' EXCLUDE or relationships'
 * partial uniques). Accepted exposure for a single-user-per-session app;
 * the durable fix is an EXCLUDE USING gist constraint on
 * (entity_id, numrange(start_position, end_position)) — see the 2026-06
 * audit report before adding it (existing rows may already overlap via
 * historical recompute paths and would fail the migration).
 */
export async function assertNoOverlap(
	db: Db,
	entityId: string,
	startPosition: number,
	endPosition: number,
	excludeId: string | undefined,
	userId: string
): Promise<void> {
	const existing = await db
		.select()
		.from(intervals)
		.where(and(eq(intervals.entityId, entityId), eq(intervals.userId, userId)));

	for (const row of existing) {
		if (excludeId && row.id === excludeId) continue;
		// Half-open overlap: [a1, a2) ∩ [b1, b2) ≠ ∅  iff  a1 < b2 AND b1 < a2.
		if (startPosition < row.endPosition && row.startPosition < endPosition) {
			throw new Error(
				`Overlap with existing interval ${row.id} [${row.startPosition}, ${row.endPosition}) for this entity. Existing interval covers ${row.startPosition}–${row.endPosition} on the story-time axis.`
			);
		}
	}
}
