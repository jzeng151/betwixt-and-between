/**
 * timeline-compat — V1-bridge layer (Phase 1A PR 1)
 *
 * Throwaway code. Deleted in PR 2 when V2 timeline ships its own affordance
 * and StoryGraph reads from a unified source.
 *
 * Lets the existing V1 Timeline.svelte keep rendering AND the existing
 * StoryGraph.svelte keep drawing `appears_in` edges after the migration runs
 * and the original `appears_in` rows are removed from `relationships`.
 *
 * Two functions, both synthesizing `appears_in`-shaped rows from `intervals`:
 *
 *   getCharacterAppearancesForActs() — what the V1 Timeline data loader needs.
 *     Per-act tuples for multi-act intervals (V1 doesn't model gaps; PR 1
 *     migration only creates full-act intervals so multi-act expansion only
 *     fires for hand-authored or PR 2 data — fine for the bridge).
 *
 *   getAppearsInRelationships() — what the StoryGraph data loader needs.
 *     One synthetic relationship per interval. Same fields as a real
 *     relationships row (`id`, `fromId`, `toId`, `type`, `label`).
 *
 * Both are READ-only views of intervals data. Writes during the transition go
 * through the appears_in hijack in src/routes/api/relationships/+server.ts,
 * which routes to writeInterval().
 */

import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema.js';
import { entities, intervals } from './db/schema.js';
import { actIndexOf } from './intervals.js';

type DB = BetterSQLite3Database<typeof schema>;

export interface CharacterAppearance {
	entityId: string;
	actId: string;
}

/**
 * Synthesize `(characterId, actId)` tuples from intervals. For multi-act
 * intervals, emit one tuple per act covered.
 *
 * Optional filter: limit to a specific entity (e.g., for CharacterEditor's
 * "Story Arcs" panel).
 */
export async function getCharacterAppearancesForActs(
	db: DB,
	opts: { entityId?: string } = {}
): Promise<CharacterAppearance[]> {
	const rows = opts.entityId
		? await db.select().from(intervals).where(eq(intervals.entityId, opts.entityId))
		: await db.select().from(intervals);

	if (rows.length === 0) return [];

	// Build the act-id-by-index map ONCE (per call) so multi-act expansion
	// doesn't issue N queries.
	const acts = await db
		.select({ id: entities.id, position: entities.position, createdAt: entities.createdAt })
		.from(entities)
		.where(and(eq(entities.type, 'Act')));
	// Match the ordering used in actIndexOf: position, then createdAt as tiebreaker.
	acts.sort((a, b) => {
		const ap = a.position ?? Number.MAX_SAFE_INTEGER;
		const bp = b.position ?? Number.MAX_SAFE_INTEGER;
		if (ap !== bp) return ap - bp;
		const at =
			a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt);
		const bt =
			b.createdAt instanceof Date ? b.createdAt.getTime() : Number(b.createdAt);
		return at - bt;
	});
	const idByIndex = new Map<number, string>();
	acts.forEach((a, i) => idByIndex.set(i, a.id));

	const result: CharacterAppearance[] = [];
	for (const interval of rows) {
		const startIdx = Math.floor(interval.startPosition);
		// end is exclusive: an interval ending at exactly an act boundary
		// (e.g., end=2.0) does NOT extend into the next act. So endIdx is the
		// floor of (end - epsilon).
		const endIdx = Math.floor(interval.endPosition - 1e-12);
		for (let i = startIdx; i <= endIdx; i++) {
			const actId = idByIndex.get(i);
			if (!actId) continue;
			result.push({ entityId: interval.entityId, actId });
		}
	}
	return result;
}

/**
 * Synthesize `appears_in`-shaped relationship rows from intervals. Each row
 * has a stable synthetic id derived from the interval id so callers that
 * deduplicate by id behave correctly across reloads.
 *
 * Optional filter: from-entity-id, to-entity-id, both, or neither.
 */
export async function getAppearsInRelationships(
	db: DB,
	opts: { fromId?: string; toId?: string } = {}
): Promise<Array<typeof schema.relationships.$inferSelect>> {
	const tuples = await getCharacterAppearancesForActs(
		db,
		opts.fromId ? { entityId: opts.fromId } : {}
	);
	const filtered = opts.toId ? tuples.filter((t) => t.actId === opts.toId) : tuples;

	// Synthetic rows. Real `relationships.id` is a UUID; we prefix synthetic
	// ones with `compat:` so any caller that tries to write back gets a clear
	// rejection (no `appears_in` writes to relationships during PR 1 — they go
	// through the hijack to writeInterval).
	return filtered.map((t) => ({
		id: `compat:${t.entityId}:${t.actId}`,
		fromId: t.entityId,
		toId: t.actId,
		label: null,
		type: 'appears_in' as const
	}));
}

/**
 * Returns true if a relationship row id was synthesized by the compat layer
 * (and therefore is not a real `relationships` row that can be UPDATEd or
 * DELETEd directly). Use in the relationships [id] handlers if needed.
 */
export function isSyntheticAppearsInId(id: string): boolean {
	return id.startsWith('compat:');
}
