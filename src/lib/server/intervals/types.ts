/**
 * Shared types + constants for the intervals subsystem.
 *
 * Sub-modules (crud / recompute / invariants / polymorphic-fk) all import
 * the polymorphic `Db` union and the public input/output shapes from this
 * file. Keeps the dependency arrows pointing one way: each sub-module
 * depends on `types.ts`, and the shim at `../intervals.ts` re-exports
 * everything declared here for the public API surface.
 */

import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type { NeonQueryResultHKT } from 'drizzle-orm/neon-serverless';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type * as schema from '../db/schema.js';
import type { intervals } from '../db/schema.js';

/**
 * Polymorphic DB handle: accepts the top-level db or a transaction context.
 * Locked 2026-04-29 in /plan-eng-review (Issue 11A/17A). Union covers
 * Neon serverless (Cloudflare runtime), postgres-js (local TCP fallback), and
 * pglite (tests) — all expose compatible Drizzle query APIs.
 */
export type Db =
	| NeonDatabase<typeof schema>
	| PgTransaction<NeonQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>
	| PostgresJsDatabase<typeof schema>
	| PgTransaction<
			PostgresJsQueryResultHKT,
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
	  >
	| PgliteDatabase<typeof schema>
	| PgTransaction<
			PgliteQueryResultHKT,
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
	  >;

/** Float epsilon for position equality checks (IEEE 754 double; 1e-9 is safe). */
export const POSITION_EPSILON = 1e-9;

// =============================================================================
// writeInterval input / row shape
// =============================================================================

export interface WriteIntervalInput {
	entityId: string;
	startActId: string;
	startSceneId?: string | null;
	endActId: string;
	endSceneId?: string | null;
	// Positions are optional. If supplied, MUST match the derivation from FKs
	// (within float epsilon). If absent, derived from FKs.
	startPosition?: number;
	endPosition?: number;
}

export interface UpdateIntervalResult {
	updated: typeof intervals.$inferSelect;
	/** IDs of sibling rows of the same entity whose ranges overlapped the
	 *  patched range and were merged into the result. The caller's client
	 *  store needs to remove these from its copy. */
	absorbed: string[];
}

// =============================================================================
// computeIntervalPositions — FK → position derivation
// =============================================================================

export interface ComputeIntervalPositionsInput {
	startActId: string;
	startSceneId?: string | null;
	endActId: string;
	endSceneId?: string | null;
	/**
	 * Optional explicit position overrides. Honored only when the matching
	 * scene FK is null (free-fraction case). Must fall within the act's
	 * range [actIdx, actIdx + 1] — out-of-range overrides throw.
	 */
	startPosition?: number;
	endPosition?: number;
}

export interface ComputeIntervalPositionsResult {
	startPosition: number;
	endPosition: number;
}

/**
 * One-shot cache for recompute helpers (D20/16A). Reading O(intervals × acts)
 * via repeated actIndexOf/sceneIndexOf on every row turns Act/Scene mutations
 * O(N²) on bigger stories. Build the maps once per recompute call and pass
 * them down so every interval row resolves its FKs in O(1).
 */
export interface RecomputeCache {
	/** actId → 0-based index in the ordered Act list. */
	actIndex: Map<string, number>;
	/** sceneId → { sceneIndex, sceneCount, parentActId } resolved once. */
	sceneInfo: Map<
		string,
		{ sceneIndex: number; sceneCount: number; parentActId: string }
	>;
}

// =============================================================================
// Relationship temporal bounds — Phase 1B Lane A (2026-05-02)
// =============================================================================

export interface RelationshipBoundsInput {
	startActId?: string | null;
	startSceneId?: string | null;
	endActId?: string | null;
	endSceneId?: string | null;
}

export interface RelationshipBoundsResult {
	startPosition: number | null;
	endPosition: number | null;
}
