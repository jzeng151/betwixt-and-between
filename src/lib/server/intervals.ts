/**
 * intervals — Phase 1A PR 1 chokepoint
 *
 * Single source of truth for ALL writes to the `intervals` table. Raw INSERT or
 * UPDATE outside this file is forbidden — see CONSIDERATIONS.md → "Dual-write
 * invariant strategy."
 *
 * **Multi-tenant scoping (T8b S5', 2026-05-08):** every public function takes
 * a `userId` and scopes every SELECT/UPDATE/DELETE/INSERT by it. Cross-user
 * reads return empty; cross-user updates affect zero rows. Callers must pass
 * `getUserId(event)` from the route handler.
 *
 * Three primary surfaces:
 *
 *   1. computeIntervalPositions(db, input, userId, cache?)
 *      Pure math wrapper that resolves FK positions. Reads scoped by userId.
 *
 *   2. writeInterval(db, input, userId)
 *      Chokepoint for INSERT. Validates polymorphic FK types, validates
 *      positions match FK derivation, stamps userId on the new row.
 *
 *   3. recomputeIntervalsForAct(db, actId, userId)
 *      Scene-mutation handler. Walks affected intervals (scoped to user),
 *      recomputes positions for scene-anchored rows.
 *
 *      recomputeAllIntervals(db, userId)
 *      Act-mutation handler. Walks every interval owned by user.
 *
 * Math (CONSIDERATIONS.md → "The math, with variable definitions"):
 *
 *   Acts at root (parent_id IS NULL, type='Act') are ordered by
 *   `entities.position`. The act's index in that ordering is its position on
 *   the global story-time axis: Act i occupies [i, i+1).
 *
 *   Scenes within an Act are ordered by `entities.position` among siblings
 *   (parent_id = act.id, type='Scene'). Scene k of m within Act i occupies
 *   [i + k/m, i + (k+1)/m).
 *
 *   Half-open convention: end is exclusive. CHECK (start_position < end_position).
 */

import { sql, eq, and, isNull } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type { NeonQueryResultHKT } from 'drizzle-orm/neon-serverless';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from './db/schema.js';
import { entities, intervals, relationships } from './db/schema.js';
// Pure math (actRange, sceneRange, smartSnap) lives in
// $lib/timeline-v2-helpers so non-server code (drag-preview snap) can import it
// without violating SvelteKit's $lib/server/* boundary.
import { actRange, sceneRange } from '$lib/timeline-v2-helpers.js';

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
type DB = Db;

// =============================================================================
// Types
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

/** Float epsilon for position equality checks (IEEE 754 double; 1e-9 is safe). */
export const POSITION_EPSILON = 1e-9;

// =============================================================================
// FK-derivation: looks up Act/Scene entities and computes positions.
// =============================================================================

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

async function buildRecomputeCache(db: DB, userId: string): Promise<RecomputeCache> {
	const acts = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.userId, userId), eq(entities.type, 'Act'), isNull(entities.parentId)))
		.orderBy(entities.position, entities.createdAt);
	const actIndex = new Map<string, number>();
	acts.forEach((a, i) => actIndex.set(a.id, i));

	const allScenes = await db
		.select({ id: entities.id, parentId: entities.parentId })
		.from(entities)
		.where(and(eq(entities.userId, userId), eq(entities.type, 'Scene')))
		.orderBy(entities.position, entities.createdAt);
	const byAct = new Map<string, string[]>();
	for (const s of allScenes) {
		if (!s.parentId) continue;
		const list = byAct.get(s.parentId) ?? [];
		list.push(s.id);
		byAct.set(s.parentId, list);
	}
	const sceneInfo = new Map<
		string,
		{ sceneIndex: number; sceneCount: number; parentActId: string }
	>();
	for (const [parentActId, ids] of byAct.entries()) {
		ids.forEach((id, i) => {
			sceneInfo.set(id, { sceneIndex: i, sceneCount: ids.length, parentActId });
		});
	}
	return { actIndex, sceneInfo };
}

function actIndexFromCache(cache: RecomputeCache, actId: string): number {
	const i = cache.actIndex.get(actId);
	if (i === undefined) throw new Error(`Act not found in cache: ${actId}`);
	return i;
}

function sceneInfoFromCache(
	cache: RecomputeCache,
	sceneId: string
): { sceneIndex: number; sceneCount: number; parentActId: string } {
	const info = cache.sceneInfo.get(sceneId);
	if (!info) throw new Error(`Scene not found in cache: ${sceneId}`);
	return info;
}

export async function actIndexOf(db: DB, actId: string, userId: string): Promise<number> {
	const ordered = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.userId, userId), eq(entities.type, 'Act'), isNull(entities.parentId)))
		.orderBy(entities.position, entities.createdAt);

	const idx = ordered.findIndex((row) => row.id === actId);
	if (idx === -1) {
		// Differentiate "not an Act" from "Act with parent_id set" for better errors.
		const [maybe] = await db.select().from(entities).where(and(eq(entities.id, actId), eq(entities.userId, userId)));
		if (!maybe) throw new Error(`Act not found: ${actId}`);
		if (maybe.type !== 'Act')
			throw new Error(
				`Entity ${actId} has type='${maybe.type}', expected 'Act' for actIndexOf`
			);
		throw new Error(`Act ${actId} has parent_id set; only root-level Acts are indexed`);
	}
	return idx;
}

/**
 * Look up a Scene entity's index k and its parent act's scene count m.
 * Returns { sceneIndex: k, sceneCount: m, parentActId }.
 *
 * Throws if the entity is not type='Scene' or has no Act parent.
 */
export async function sceneIndexOf(
	db: DB,
	sceneId: string,
	userId: string
): Promise<{ sceneIndex: number; sceneCount: number; parentActId: string }> {
	const [scene] = await db.select().from(entities).where(and(eq(entities.id, sceneId), eq(entities.userId, userId)));
	if (!scene) throw new Error(`Scene not found: ${sceneId}`);
	if (scene.type !== 'Scene')
		throw new Error(`Entity ${sceneId} has type='${scene.type}', expected 'Scene'`);
	if (!scene.parentId) throw new Error(`Scene ${sceneId} has no parent_id`);

	const [parent] = await db.select().from(entities).where(and(eq(entities.id, scene.parentId), eq(entities.userId, userId)));
	if (!parent) throw new Error(`Scene ${sceneId} parent ${scene.parentId} not found`);
	if (parent.type !== 'Act')
		throw new Error(
			`Scene ${sceneId} parent ${scene.parentId} has type='${parent.type}', expected 'Act'`
		);

	const siblings = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.userId, userId), eq(entities.type, 'Scene'), eq(entities.parentId, scene.parentId)))
		.orderBy(entities.position, entities.createdAt);

	const k = siblings.findIndex((row) => row.id === sceneId);
	if (k === -1) throw new Error(`Scene ${sceneId} not found in siblings of Act ${scene.parentId}`);
	return { sceneIndex: k, sceneCount: siblings.length, parentActId: scene.parentId };
}

/**
 * Derive (start_position, end_position) from FK references.
 *
 * Branches:
 *   start_scene_id NOT NULL → use sceneRange(k, m, actIndex_of_parent_act)
 *   start_scene_id IS NULL  → use input.startPosition if provided AND in
 *                              [actIdx, actIdx + 1]; otherwise actRange(i).start
 *   same logic for end side: explicit position honored when scene FK is null,
 *                              else end-of-act. Must lie in [actIdx, actIdx + 1].
 *
 * Free-fraction support: when the caller wants a sub-act position without a
 * scene anchor (e.g., dragged the resize handle to 1.37 in an act with no
 * scenes), they pass startSceneId=null AND startPosition=1.37. The FK acts
 * as a coarse "this boundary lives in act N" hint; the REAL column carries
 * the exact value.
 */
export async function computeIntervalPositions(
	db: DB,
	input: ComputeIntervalPositionsInput,
	userId: string,
	cache?: RecomputeCache
): Promise<ComputeIntervalPositionsResult> {
	let startPosition: number;
	let endPosition: number;

	const lookupAct = async (actId: string): Promise<number> =>
		cache ? actIndexFromCache(cache, actId) : actIndexOf(db, actId, userId);
	const lookupScene = async (
		sceneId: string
	): Promise<{ sceneIndex: number; sceneCount: number; parentActId: string }> =>
		cache ? sceneInfoFromCache(cache, sceneId) : sceneIndexOf(db, sceneId, userId);

	if (input.startSceneId) {
		const { sceneIndex, sceneCount, parentActId } = await lookupScene(input.startSceneId);
		if (parentActId !== input.startActId) {
			throw new Error(
				`start_scene_id ${input.startSceneId} parent ${parentActId} does not match start_act_id ${input.startActId}`
			);
		}
		const i = await lookupAct(parentActId);
		startPosition = sceneRange(sceneIndex, sceneCount, i).start;
	} else {
		const i = await lookupAct(input.startActId);
		const range = actRange(i);
		if (input.startPosition !== undefined) {
			if (input.startPosition < range.start - POSITION_EPSILON || input.startPosition > range.end + POSITION_EPSILON) {
				throw new Error(
					`start_position ${input.startPosition} outside act range [${range.start}, ${range.end}] for start_act_id ${input.startActId}`
				);
			}
			startPosition = input.startPosition;
		} else {
			startPosition = range.start;
		}
	}

	if (input.endSceneId) {
		const { sceneIndex, sceneCount, parentActId } = await lookupScene(input.endSceneId);
		if (parentActId !== input.endActId) {
			throw new Error(
				`end_scene_id ${input.endSceneId} parent ${parentActId} does not match end_act_id ${input.endActId}`
			);
		}
		const i = await lookupAct(parentActId);
		endPosition = sceneRange(sceneIndex, sceneCount, i).end;
	} else {
		const i = await lookupAct(input.endActId);
		const range = actRange(i);
		if (input.endPosition !== undefined) {
			if (input.endPosition < range.start - POSITION_EPSILON || input.endPosition > range.end + POSITION_EPSILON) {
				throw new Error(
					`end_position ${input.endPosition} outside act range [${range.start}, ${range.end}] for end_act_id ${input.endActId}`
				);
			}
			endPosition = input.endPosition;
		} else {
			endPosition = range.end;
		}
	}

	if (startPosition >= endPosition) {
		throw new Error(
			`Derived start_position ${startPosition} >= end_position ${endPosition}; interval would have zero or negative extent`
		);
	}
	return { startPosition, endPosition };
}

// =============================================================================
// Type-safety validation (polymorphic FK guard)
// =============================================================================

async function assertEntityType(db: DB, id: string, expected: schema.EntityType, userId: string): Promise<void> {
	const [row] = await db
		.select({ id: entities.id, type: entities.type })
		.from(entities)
		.where(and(eq(entities.id, id), eq(entities.userId, userId)));
	if (!row) throw new Error(`Entity not found: ${id}`);
	if (row.type !== expected) {
		throw new Error(
			`Polymorphic FK violation: entity ${id} has type='${row.type}', expected '${expected}'`
		);
	}
}

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
 * **Read-modify-write window:** like `validateFKTypes` and
 * `computeIntervalPositions`, this read+check happens outside a DB
 * transaction. Safe under better-sqlite3's connection-level write
 * serialization. Under future Turso replica lag, wrap the whole
 * write/update body in `db.transaction()` — see `writeInterval` docstring.
 */
async function assertNoOverlap(
	db: DB,
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

async function validateFKTypes(db: DB, input: WriteIntervalInput, userId: string): Promise<void> {
	// entity_id must exist AND belong to user (any type — Character, Event, etc.)
	const [entity] = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.id, input.entityId), eq(entities.userId, userId)));
	if (!entity) throw new Error(`entity_id not found: ${input.entityId}`);

	// Acts and Scenes must have correct types AND belong to user.
	await assertEntityType(db, input.startActId, 'Act', userId);
	await assertEntityType(db, input.endActId, 'Act', userId);
	if (input.startSceneId) await assertEntityType(db, input.startSceneId, 'Scene', userId);
	if (input.endSceneId) await assertEntityType(db, input.endSceneId, 'Scene', userId);
}

// =============================================================================
// writeInterval — THE chokepoint
// =============================================================================

/**
 * Insert a new interval. Single point of entry for all interval creation.
 *
 *   - Validates FK types (start_act_id → Act, scene_id → Scene, etc.)
 *   - Derives positions from FKs unless caller supplied them
 *   - If caller supplied positions AND FKs, validates they match (within epsilon)
 *   - Performs the INSERT
 *
 * **Atomicity:** the validate / compute / insert sequence runs inside
 * `db.transaction(async (tx) => {...})`. The polymorphic Db type accepts
 * both top-level db and a transaction context — if the caller is already
 * inside a tx (e.g., from a /api/entities handler), the existing tx is
 * reused without nesting; if not, a fresh one is opened. Locked 2026-04-29
 * in /plan-eng-review (Issue 11A/17A).
 *
 * Throws on any validation failure (rolls back the surrounding transaction).
 */
export async function writeInterval(
	db: DB,
	input: WriteIntervalInput,
	userId: string
): Promise<typeof intervals.$inferSelect> {
	await validateFKTypes(db, input, userId);

	// Normalize: ensure startSceneId points to the lower-index scene.
	// Client may send scenes in visual order rather than story-time (createdAt) order.
	const normalized = { ...input };
	if (
		normalized.startActId === normalized.endActId &&
		normalized.startSceneId &&
		normalized.endSceneId &&
		normalized.startSceneId !== normalized.endSceneId
	) {
		const startInfo = await sceneIndexOf(db, normalized.startSceneId, userId);
		const endInfo = await sceneIndexOf(db, normalized.endSceneId, userId);
		if (startInfo.sceneIndex > endInfo.sceneIndex) {
			normalized.startSceneId = input.endSceneId;
			normalized.endSceneId = input.startSceneId;
		}
	}

	const derived = await computeIntervalPositions(db, normalized, userId);

	if (input.startPosition !== undefined) {
		if (Math.abs(input.startPosition - derived.startPosition) > POSITION_EPSILON) {
			throw new Error(
				`Provided start_position ${input.startPosition} does not match derived ${derived.startPosition} for FKs`
			);
		}
	}
	if (input.endPosition !== undefined) {
		if (Math.abs(input.endPosition - derived.endPosition) > POSITION_EPSILON) {
			throw new Error(
				`Provided end_position ${input.endPosition} does not match derived ${derived.endPosition} for FKs`
			);
		}
	}

	/* Same-entity overlap rejection (CONSIDERATIONS.md → /plan-eng-review item 1.2,
	   locked 2026-04-28). Must run after position derivation, before the insert. */
	await assertNoOverlap(db, normalized.entityId, derived.startPosition, derived.endPosition, undefined, userId);

	const [created] = await db
		.insert(intervals)
		.values({
			userId,
			entityId: normalized.entityId,
			startActId: normalized.startActId,
			startSceneId: normalized.startSceneId ?? null,
			endActId: normalized.endActId,
			endSceneId: normalized.endSceneId ?? null,
			startPosition: derived.startPosition,
			endPosition: derived.endPosition
		})
		.returning();
	return created;
}

/**
 * Patch an existing interval. Caller can change any combination of FKs;
 * positions always recompute from the resulting FK state.
 */
export interface UpdateIntervalResult {
	updated: typeof intervals.$inferSelect;
	/** IDs of sibling rows of the same entity whose ranges overlapped the
	 *  patched range and were merged into the result. The caller's client
	 *  store needs to remove these from its copy. */
	absorbed: string[];
}

export async function updateInterval(
	db: DB,
	id: string,
	patch: Partial<WriteIntervalInput>,
	userId: string
): Promise<UpdateIntervalResult> {
	const [existing] = await db.select().from(intervals).where(and(eq(intervals.id, id), eq(intervals.userId, userId)));
	if (!existing) throw new Error(`Interval not found: ${id}`);

	const mergedStartActId = patch.startActId ?? existing.startActId;
	const mergedStartSceneId =
		patch.startSceneId !== undefined ? patch.startSceneId : existing.startSceneId;
	const mergedEndActId = patch.endActId ?? existing.endActId;
	const mergedEndSceneId =
		patch.endSceneId !== undefined ? patch.endSceneId : existing.endSceneId;

	// Position overrides: explicit patch wins. If scene FK stays null and the
	// start act didn't change, preserve the existing frozen fraction. Otherwise
	// let computeIntervalPositions fall back to act-range defaults.
	const startPosOverride =
		patch.startPosition !== undefined
			? patch.startPosition
			: mergedStartSceneId === null && mergedStartActId === existing.startActId
				? existing.startPosition
				: undefined;
	const endPosOverride =
		patch.endPosition !== undefined
			? patch.endPosition
			: mergedEndSceneId === null && mergedEndActId === existing.endActId
				? existing.endPosition
				: undefined;

	const merged: WriteIntervalInput = {
		entityId: patch.entityId ?? existing.entityId,
		startActId: mergedStartActId,
		startSceneId: mergedStartSceneId,
		endActId: mergedEndActId,
		endSceneId: mergedEndSceneId,
		startPosition: startPosOverride,
		endPosition: endPosOverride
	};

	await validateFKTypes(db, merged, userId);
	const derived = await computeIntervalPositions(db, merged, userId);

	if (patch.startPosition !== undefined) {
		if (Math.abs(patch.startPosition - derived.startPosition) > POSITION_EPSILON) {
			throw new Error(
				`Provided start_position ${patch.startPosition} does not match derived ${derived.startPosition}`
			);
		}
	}
	if (patch.endPosition !== undefined) {
		if (Math.abs(patch.endPosition - derived.endPosition) > POSITION_EPSILON) {
			throw new Error(
				`Provided end_position ${patch.endPosition} does not match derived ${derived.endPosition}`
			);
		}
	}

	// Same-entity overlap → merge into the union range (UX request: dragging
	// the right edge of one bar past the left edge of another for the same
	// character/event should join them rather than throwing). Adjacent
	// intervals (touching at a boundary) do NOT trigger merge; the half-open
	// `[a1, a2) ∩ [b1, b2) ≠ ∅` rule keeps boundary touch as no-overlap.
	const sameEntity = await db
		.select()
		.from(intervals)
		.where(and(eq(intervals.entityId, merged.entityId), eq(intervals.userId, userId)));
	const overlappers = sameEntity.filter(
		(row) =>
			row.id !== id &&
			derived.startPosition < row.endPosition &&
			row.startPosition < derived.endPosition
	);

	let unionStart = derived.startPosition;
	let unionEnd = derived.endPosition;
	let unionStartActId = merged.startActId;
	let unionStartSceneId = merged.startSceneId ?? null;
	let unionEndActId = merged.endActId;
	let unionEndSceneId = merged.endSceneId ?? null;
	const absorbed: string[] = [];

	if (overlappers.length > 0) {
		// Compute the union range and pick FKs from whichever interval owns
		// each end (the leftmost start, the rightmost end). This preserves
		// scene anchoring on whichever side wasn't moved.
		let leftmost = {
			pos: derived.startPosition,
			actId: merged.startActId,
			sceneId: merged.startSceneId ?? null
		};
		let rightmost = {
			pos: derived.endPosition,
			actId: merged.endActId,
			sceneId: merged.endSceneId ?? null
		};
		for (const row of overlappers) {
			if (row.startPosition < leftmost.pos) {
				leftmost = {
					pos: row.startPosition,
					actId: row.startActId,
					sceneId: row.startSceneId ?? null
				};
			}
			if (row.endPosition > rightmost.pos) {
				rightmost = {
					pos: row.endPosition,
					actId: row.endActId,
					sceneId: row.endSceneId ?? null
				};
			}
		}
		unionStart = leftmost.pos;
		unionStartActId = leftmost.actId;
		unionStartSceneId = leftmost.sceneId;
		unionEnd = rightmost.pos;
		unionEndActId = rightmost.actId;
		unionEndSceneId = rightmost.sceneId;

		// Delete the absorbed siblings before the update so the unique-
		// row-per-entity-position invariant holds. userId in WHERE is defense-
		// in-depth — overlappers were already filtered by userId above.
		for (const row of overlappers) {
			await db.delete(intervals).where(and(eq(intervals.id, row.id), eq(intervals.userId, userId)));
			absorbed.push(row.id);
		}
	}

	const [updated] = await db
		.update(intervals)
		.set({
			entityId: merged.entityId,
			startActId: unionStartActId,
			startSceneId: unionStartSceneId,
			endActId: unionEndActId,
			endSceneId: unionEndSceneId,
			startPosition: unionStart,
			endPosition: unionEnd,
		})
		.where(and(eq(intervals.id, id), eq(intervals.userId, userId)))
		.returning();
	return { updated, absorbed };
}

// =============================================================================
// Recompute helpers (run inside transactions on Scene/Act mutations)
// =============================================================================

/**
 * Recompute positions for every interval anchored to a Scene within `actId`.
 *
 * Branch on scene FK presence (CONSIDERATIONS.md → "Position recomputation rules"):
 *   - start_scene_id NOT NULL → re-derive start_position
 *   - start_scene_id IS NULL  → leave start_position UNCHANGED (fraction-positioned, frozen)
 *   - same for end side, independently
 *
 * Only writes rows whose positions actually changed.
 */
export async function recomputeIntervalsForAct(db: DB, actId: string, userId: string): Promise<number> {
	const affected = await db
		.select()
		.from(intervals)
		.where(
			and(
				eq(intervals.userId, userId),
				sql`(${intervals.startActId} = ${actId} OR ${intervals.endActId} = ${actId})`
			)
		);

	// One-shot act + scene index maps so each row resolves FKs in O(1)
	// instead of issuing 2-4 DB queries (D20/16A).
	const cache = await buildRecomputeCache(db, userId);

	let updated = 0;
	for (const row of affected) {
		let newStart = row.startPosition;
		let newEnd = row.endPosition;

		if (row.startSceneId) {
			const { sceneIndex, sceneCount, parentActId } = sceneInfoFromCache(cache, row.startSceneId);
			const i = actIndexFromCache(cache, parentActId);
			newStart = sceneRange(sceneIndex, sceneCount, i).start;
		}
		if (row.endSceneId) {
			const { sceneIndex, sceneCount, parentActId } = sceneInfoFromCache(cache, row.endSceneId);
			const i = actIndexFromCache(cache, parentActId);
			newEnd = sceneRange(sceneIndex, sceneCount, i).end;
		}

		const startDrift = Math.abs(newStart - row.startPosition) > POSITION_EPSILON;
		const endDrift = Math.abs(newEnd - row.endPosition) > POSITION_EPSILON;
		if (!startDrift && !endDrift) continue;

		await db
			.update(intervals)
			.set({
				startPosition: newStart,
				endPosition: newEnd,
			})
			.where(and(eq(intervals.id, row.id), eq(intervals.userId, userId)));
		updated++;
	}
	return updated;
}

/**
 * Recompute positions for EVERY interval row owned by user.
 *
 * Runs after any Act-level mutation (insert, reorder, delete) where the
 * act_index of one or more Acts changes. Acts are typically <= ~30 in any
 * story; touching every interval is fine at that scale.
 */
export async function recomputeAllIntervals(db: DB, userId: string): Promise<number> {
	const all = await db.select().from(intervals).where(eq(intervals.userId, userId));
	// Build one-shot FK cache (D20/16A).
	const cache = await buildRecomputeCache(db, userId);
	let updated = 0;

	for (const row of all) {
		try {
			const derived = await computeIntervalPositions(
				db,
				{
					startActId: row.startActId,
					startSceneId: row.startSceneId,
					endActId: row.endActId,
					endSceneId: row.endSceneId
				},
				userId,
				cache
			);

			/* Per the locked semantic, fraction-positioned rows (no scene FK on a side)
			   keep their position frozen across Scene reorders. For ACT reorders, every
			   row's act_index can shift, so even fraction-positioned rows need their
			   integer part updated.
			   Strategy: if a side has no scene FK, preserve the fractional offset within
			   the act but update the integer part. */
			let newStart = derived.startPosition;
			let newEnd = derived.endPosition;

			if (!row.startSceneId) {
				const oldFraction = row.startPosition - Math.floor(row.startPosition);
				const newActIndex = actIndexFromCache(cache, row.startActId);
				newStart = newActIndex + oldFraction;
			}
			if (!row.endSceneId) {
				const oldFraction = row.endPosition - Math.floor(row.endPosition);
				const newActIndex = actIndexFromCache(cache, row.endActId);
				// end can be exactly at a whole-number act boundary (exclusive end);
				// detect that and place it as start-of-next-act.
				newEnd = oldFraction === 0 ? newActIndex + 1 : newActIndex + oldFraction;
			}

			const startDrift = Math.abs(newStart - row.startPosition) > POSITION_EPSILON;
			const endDrift = Math.abs(newEnd - row.endPosition) > POSITION_EPSILON;
			if (!startDrift && !endDrift) continue;

			if (newStart >= newEnd) {
				throw new Error(
					`Recompute would produce start_position ${newStart} >= end_position ${newEnd} on interval ${row.id}`
				);
			}

			await db
				.update(intervals)
				.set({
					startPosition: newStart,
					endPosition: newEnd,
				})
				.where(and(eq(intervals.id, row.id), eq(intervals.userId, userId)));
			updated++;
		} catch (err) {
			throw new Error(
				`recomputeAllIntervals failed on interval ${row.id}: ${(err as Error).message}`
			);
		}
	}

	// Also recompute temporal relationship bounds in the same transaction so
	// act-reorder cascades are atomic (Phase 1B Lane A, 2026-05-02).
	await recomputeRelationshipBoundsAll(db, userId);

	// World-map variant bounds piggyback on the same cascade (M11 design lock).
	// Imported lazily to break the world-maps.ts → intervals.ts dependency cycle.
	const { recomputeWorldMapVariantsAll } = await import('./world-maps.js');
	await recomputeWorldMapVariantsAll(db, userId);

	return updated;
}

// =============================================================================
// splitInterval — D7 / Issue 5b A
// =============================================================================

/**
 * Split a multi-act interval at an internal position.
 *
 * Behavior (locked 2026-04-29 in /plan-eng-review):
 *   - Reads existing interval; rejects if `atPosition` is outside its range
 *     (or exactly at start/end — would produce a zero-extent half).
 *   - Resolves FKs at `atPosition` via positionToEndFKs (for the left half's
 *     new end) and positionToStartFKs (for the right half's new start).
 *   - Updates original to [start, atPosition); inserts new row [atPosition, end)
 *     with the same entityId.
 *
 * Atomicity: callers should wrap in `db.transaction(async (tx) => { await
 * splitInterval(tx, ...) })` so a crash between the UPDATE (left half) and
 * INSERT (right half) rolls back both. Drizzle's Postgres drivers support
 * async tx callbacks natively (the previous sqlite-era raw BEGIN/COMMIT
 * workaround is gone). When called outside a tx the two writes are not
 * atomic — by design only the split endpoint and tests-that-want-rollback
 * compose this inside a tx.
 */
export async function splitInterval(
	db: DB,
	intervalId: string,
	atPosition: number,
	userId: string
): Promise<{ left: typeof intervals.$inferSelect; right: typeof intervals.$inferSelect }> {
	const [existing] = await db.select().from(intervals).where(and(eq(intervals.id, intervalId), eq(intervals.userId, userId)));
	if (!existing) throw new Error(`Interval not found: ${intervalId}`);

	if (atPosition <= existing.startPosition + POSITION_EPSILON) {
		throw new Error(
			`splitInterval: atPosition ${atPosition} <= startPosition ${existing.startPosition}; would produce zero-extent left half`
		);
	}
	if (atPosition >= existing.endPosition - POSITION_EPSILON) {
		throw new Error(
			`splitInterval: atPosition ${atPosition} >= endPosition ${existing.endPosition}; would produce zero-extent right half`
		);
	}

	const actRows = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.userId, userId), eq(entities.type, 'Act'), isNull(entities.parentId)))
		.orderBy(entities.position, entities.createdAt);
	const sceneRows = await db
		.select({ id: entities.id, parentId: entities.parentId })
		.from(entities)
		.where(and(eq(entities.userId, userId), eq(entities.type, 'Scene')))
		.orderBy(entities.position, entities.createdAt);
	const scenesByActId = new Map<string, { id: string }[]>();
	for (const s of sceneRows) {
		if (!s.parentId) continue;
		const list = scenesByActId.get(s.parentId) ?? [];
		list.push({ id: s.id });
		scenesByActId.set(s.parentId, list);
	}

	// Lazy-imported pure helpers — no $lib/server boundary issue since these
	// are pure math.
	const { positionToStartFKs, positionToEndFKs } = await import(
		'$lib/timeline-v2-helpers.js'
	);
	const leftEndFKs = positionToEndFKs(atPosition, actRows, scenesByActId);
	const rightStartFKs = positionToStartFKs(atPosition, actRows, scenesByActId);
	if (!leftEndFKs || !rightStartFKs) {
		throw new Error(`splitInterval: could not resolve FKs for position ${atPosition}`);
	}

	// Update original (left half). updated_at is maintained by the
	// bump_updated_at BEFORE UPDATE trigger; do not set explicitly.
	const [left] = await db
		.update(intervals)
		.set({
			endActId: leftEndFKs.endActId,
			endSceneId: leftEndFKs.endSceneId,
			endPosition: leftEndFKs.endPosition
		})
		.where(and(eq(intervals.id, intervalId), eq(intervals.userId, userId)))
		.returning();

	const [right] = await db
		.insert(intervals)
		.values({
			userId,
			entityId: existing.entityId,
			startActId: rightStartFKs.startActId,
			startSceneId: rightStartFKs.startSceneId,
			endActId: existing.endActId,
			endSceneId: existing.endSceneId,
			startPosition: rightStartFKs.startPosition,
			endPosition: existing.endPosition
		})
		.returning();

	return { left, right };
}

// =============================================================================
// moveSceneToAct — T3 (full SceneEditor) cross-act move
// =============================================================================

/**
 * Reparent a Scene to a different Act, optionally specifying its new sibling
 * position. Updates intervals anchored to that scene to point at the new
 * parent act (P2-3 from the eng review's outside voice — without this fix,
 * scene-anchored intervals carry stale start_act_id / end_act_id after the
 * scene's parent_id changes).
 *
 * Behavior:
 *   1. Validate target is an Act (and not the source scene's current parent
 *      with the same position — no-op).
 *   2. Bump siblings in the target act at position >= newPosition by +1
 *      (cascade — see CONSIDERATIONS D18 generalized cascade primitive).
 *   3. Update scene's parent_id and position.
 *   4. Update intervals.start_act_id / end_act_id for any interval anchored
 *      to this scene (start_scene_id = sceneId or end_scene_id = sceneId).
 *   5. Recompute intervals for BOTH the old and new parent acts (composition
 *      changed in both — m may differ, scene boundaries shift).
 *
 * Atomicity caveat: see writeInterval's note. T1's sync refactor will wrap
 * this in db.transaction(...).
 */
export async function moveSceneToAct(
	db: DB,
	sceneId: string,
	newActId: string,
	newPosition: number,
	userId: string
): Promise<void> {
	const [scene] = await db.select().from(entities).where(and(eq(entities.id, sceneId), eq(entities.userId, userId)));
	if (!scene) throw new Error(`Scene not found: ${sceneId}`);
	if (scene.type !== 'Scene') {
		throw new Error(`Entity ${sceneId} has type='${scene.type}', expected 'Scene'`);
	}
	if (!scene.parentId) {
		throw new Error(`Scene ${sceneId} has no parent_id`);
	}

	const [target] = await db.select().from(entities).where(and(eq(entities.id, newActId), eq(entities.userId, userId)));
	if (!target) throw new Error(`Target act not found: ${newActId}`);
	if (target.type !== 'Act') {
		throw new Error(`Target ${newActId} has type='${target.type}', expected 'Act'`);
	}

	const oldActId = scene.parentId;

	await db
		.update(entities)
		.set({
			position: sql`${entities.position} + 1` as unknown as number,
		})
		.where(
			and(
				eq(entities.userId, userId),
				eq(entities.type, 'Scene'),
				eq(entities.parentId, newActId),
				sql`${entities.position} >= ${newPosition}`
			)
		);

	await db
		.update(entities)
		.set({
			parentId: newActId,
			position: newPosition,
		})
		.where(and(eq(entities.id, sceneId), eq(entities.userId, userId)));

	await db
		.update(intervals)
		.set({
			startActId: newActId,
		})
		.where(and(eq(intervals.startSceneId, sceneId), eq(intervals.userId, userId)));
	await db
		.update(intervals)
		.set({
			endActId: newActId,
		})
		.where(and(eq(intervals.endSceneId, sceneId), eq(intervals.userId, userId)));

	if (oldActId !== newActId) {
		await recomputeIntervalsForAct(db, oldActId, userId);
	}
	await recomputeIntervalsForAct(db, newActId, userId);
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

/**
 * Resolve (start_position, end_position) for a relationship from its FK anchors.
 *
 * Returns { startPosition: null, endPosition: null } when both act FKs are
 * absent — the relationship is timeless.
 *
 * Otherwise delegates to computeIntervalPositions using the same math as
 * intervals: start_act_id drives the integer part; scene FK (when present)
 * drives the fractional part.
 */
export async function resolveRelationshipBounds(
	db: DB,
	input: RelationshipBoundsInput,
	userId: string,
	cache?: RecomputeCache
): Promise<RelationshipBoundsResult> {
	if (!input.startActId && !input.endActId) {
		return { startPosition: null, endPosition: null };
	}

	// Both act anchors required when either is set — caller must provide both.
	if (!input.startActId || !input.endActId) {
		throw new Error(
			'resolveRelationshipBounds: startActId and endActId must both be set or both be null'
		);
	}

	const derived = await computeIntervalPositions(
		db,
		{
			startActId: input.startActId,
			startSceneId: input.startSceneId ?? null,
			endActId: input.endActId,
			endSceneId: input.endSceneId ?? null
		},
		userId,
		cache
	);
	return { startPosition: derived.startPosition, endPosition: derived.endPosition };
}

/**
 * Walk all temporal relationships and recompute their start_position /
 * end_position from FK anchors. Returns the count of rows updated.
 *
 * Runs inside the caller's transaction context (pass db or tx).
 */
async function recomputeRelationshipBoundsAll(db: DB, userId: string): Promise<number> {
	const rows = await db
		.select()
		.from(relationships)
		.where(
			and(
				eq(relationships.userId, userId),
				sql`(${relationships.startActId} IS NOT NULL OR ${relationships.endActId} IS NOT NULL)`
			)
		);

	if (rows.length === 0) return 0;

	const cache = await buildRecomputeCache(db, userId);
	let updated = 0;

	for (const row of rows) {
		try {
			const { startPosition, endPosition } = await resolveRelationshipBounds(
				db,
				{
					startActId: row.startActId,
					startSceneId: row.startSceneId,
					endActId: row.endActId,
					endSceneId: row.endSceneId
				},
				userId,
				cache
			);

			const startDrift =
				startPosition !== null &&
				row.startPosition !== null &&
				Math.abs(startPosition - row.startPosition) > POSITION_EPSILON;
			const endDrift =
				endPosition !== null &&
				row.endPosition !== null &&
				Math.abs(endPosition - row.endPosition) > POSITION_EPSILON;
			// Also handle case where position was null and now needs a value
			const startChanged = (startPosition === null) !== (row.startPosition === null) || startDrift;
			const endChanged = (endPosition === null) !== (row.endPosition === null) || endDrift;

			if (!startChanged && !endChanged) continue;

			await db
				.update(relationships)
				.set({ startPosition, endPosition })
				.where(and(eq(relationships.id, row.id), eq(relationships.userId, userId)));
			updated++;
		} catch (err) {
			throw new Error(
				`recomputeRelationshipBoundsAll failed on relationship ${row.id}: ${(err as Error).message}`
			);
		}
	}
	return updated;
}
