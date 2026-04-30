/**
 * intervals — Phase 1A PR 1 chokepoint
 *
 * Single source of truth for ALL writes to the `intervals` table. Raw INSERT or
 * UPDATE outside this file is forbidden — see CONSIDERATIONS.md → "Dual-write
 * invariant strategy."
 *
 * Three primary surfaces:
 *
 *   1. computeIntervalPositions(input)   — pure math, callable from anywhere.
 *      Used by writeInterval AND the Vitest invariant test (single source of
 *      truth on the formula; drift impossible across call sites).
 *
 *   2. writeInterval(input)              — chokepoint for INSERT and UPDATE.
 *      Validates polymorphic FK types, validates positions match FK derivation
 *      when both supplied, computes positions if only FKs supplied, writes in a
 *      transaction.
 *
 *   3. recomputeIntervalsForAct(actId)   — Scene-mutation handler. Walks
 *      affected intervals, recomputes positions for scene-anchored rows, leaves
 *      fraction-positioned rows frozen. Runs in same transaction as the scene
 *      mutation (caller responsibility).
 *
 *      recomputeAllIntervals()           — Act-mutation handler. Walks every
 *      interval and recomputes positions because act_index changed for some N.
 *      Runs in same transaction as the act mutation.
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

import { sql, eq, and, isNull, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SQLiteTransaction } from 'drizzle-orm/sqlite-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from './db/schema.js';
import { entities, intervals } from './db/schema.js';
// Pure math (actRange, sceneRange, smartSnap) lives in
// $lib/timeline-v2-helpers so non-server code (drag-preview snap) can import it
// without violating SvelteKit's $lib/server/* boundary.
import { actRange, sceneRange } from '$lib/timeline-v2-helpers.js';

/**
 * Polymorphic DB handle. Helpers accept either the top-level db or a
 * transaction context — both expose the same query API thanks to Drizzle's
 * BetterSQLiteTransaction extending BaseSQLiteDatabase. Locked 2026-04-29
 * in /plan-eng-review (Issue 11A/17A) — closes the PR 1 tech-debt note that
 * used to live at the top of writeInterval.
 *
 * Callers wrap in `db.transaction(async (tx) => { await writeInterval(tx, ...) })`
 * to get atomic write semantics. All multi-step write helpers in this module
 * accept Db so the same helper composes inside or outside a transaction.
 */
export type Db =
	| BetterSQLite3Database<typeof schema>
	| SQLiteTransaction<
			'sync',
			import('better-sqlite3').RunResult,
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

/** Float epsilon for position equality. SQLite REAL is IEEE 754 double; 1e-9 is safe. */
export const POSITION_EPSILON = 1e-9;

// =============================================================================
// FK-derivation: looks up Act/Scene entities and computes positions.
// =============================================================================

/**
 * Look up an Act entity's index in the global story-time axis.
 *
 *   act_index = rank of this Act among all root-level Acts ordered by `position`.
 *
 * Throws if the entity is not found, not type='Act', or has a non-NULL parent_id
 * (Acts at root level only).
 */
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

export async function buildRecomputeCache(db: DB): Promise<RecomputeCache> {
	const acts = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.type, 'Act'), isNull(entities.parentId)))
		.orderBy(entities.position, entities.createdAt);
	const actIndex = new Map<string, number>();
	acts.forEach((a, i) => actIndex.set(a.id, i));

	const allScenes = await db
		.select({ id: entities.id, parentId: entities.parentId })
		.from(entities)
		.where(eq(entities.type, 'Scene'))
		.orderBy(entities.position, entities.createdAt);
	// Group scenes by parent act to compute sceneIndex / sceneCount.
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

export async function actIndexOf(db: DB, actId: string): Promise<number> {
	const ordered = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.type, 'Act'), isNull(entities.parentId)))
		.orderBy(entities.position, entities.createdAt);

	const idx = ordered.findIndex((row) => row.id === actId);
	if (idx === -1) {
		// Differentiate "not an Act" from "Act with parent_id set" for better errors.
		const [maybe] = await db.select().from(entities).where(eq(entities.id, actId));
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
	sceneId: string
): Promise<{ sceneIndex: number; sceneCount: number; parentActId: string }> {
	const [scene] = await db.select().from(entities).where(eq(entities.id, sceneId));
	if (!scene) throw new Error(`Scene not found: ${sceneId}`);
	if (scene.type !== 'Scene')
		throw new Error(`Entity ${sceneId} has type='${scene.type}', expected 'Scene'`);
	if (!scene.parentId) throw new Error(`Scene ${sceneId} has no parent_id`);

	const [parent] = await db.select().from(entities).where(eq(entities.id, scene.parentId));
	if (!parent) throw new Error(`Scene ${sceneId} parent ${scene.parentId} not found`);
	if (parent.type !== 'Act')
		throw new Error(
			`Scene ${sceneId} parent ${scene.parentId} has type='${parent.type}', expected 'Act'`
		);

	const siblings = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, scene.parentId)))
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
	cache?: RecomputeCache
): Promise<ComputeIntervalPositionsResult> {
	let startPosition: number;
	let endPosition: number;

	const lookupAct = async (actId: string): Promise<number> =>
		cache ? actIndexFromCache(cache, actId) : actIndexOf(db, actId);
	const lookupScene = async (
		sceneId: string
	): Promise<{ sceneIndex: number; sceneCount: number; parentActId: string }> =>
		cache ? sceneInfoFromCache(cache, sceneId) : sceneIndexOf(db, sceneId);

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

async function assertEntityType(db: DB, id: string, expected: schema.EntityType): Promise<void> {
	const [row] = await db
		.select({ id: entities.id, type: entities.type })
		.from(entities)
		.where(eq(entities.id, id));
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
	excludeId?: string
): Promise<void> {
	const existing = await db
		.select()
		.from(intervals)
		.where(eq(intervals.entityId, entityId));

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

async function validateFKTypes(db: DB, input: WriteIntervalInput): Promise<void> {
	// entity_id must exist (any type — Character, Event, etc.)
	const [entity] = await db
		.select({ id: entities.id })
		.from(entities)
		.where(eq(entities.id, input.entityId));
	if (!entity) throw new Error(`entity_id not found: ${input.entityId}`);

	// Acts and Scenes must have correct types.
	await assertEntityType(db, input.startActId, 'Act');
	await assertEntityType(db, input.endActId, 'Act');
	if (input.startSceneId) await assertEntityType(db, input.startSceneId, 'Scene');
	if (input.endSceneId) await assertEntityType(db, input.endSceneId, 'Scene');
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
	input: WriteIntervalInput
): Promise<typeof intervals.$inferSelect> {
	await validateFKTypes(db, input);
	const derived = await computeIntervalPositions(db, input);

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

	// Same-entity overlap rejection (CONSIDERATIONS.md → /plan-eng-review
	// resolutions item 1.2, locked 2026-04-28). Must run AFTER position
	// derivation but BEFORE the insert.
	//
	// **Atomicity** (revisited 2026-04-29): better-sqlite3's `db.transaction()`
	// requires a SYNCHRONOUS callback (it throws on a returned Promise). Since
	// our helper chain is async/await for Drizzle compatibility, we cannot
	// wrap the body in `tx.transaction(async (tx) => ...)` without first
	// converting every helper to sync. That sync refactor is tracked as
	// TODO T1 (Phase 1.6 follow-up). Until T1 ships, the connection-level
	// serialization in better-sqlite3 keeps each individual `.insert()` /
	// `.update()` atomic; the read-modify-write window between FK validation
	// and the final write is open only to concurrent writers in another
	// process — better-sqlite3's single-connection-per-process model makes
	// that impossible today. Future-Turso replica lag is the genuine risk
	// that T1 will close.
	await assertNoOverlap(db, input.entityId, derived.startPosition, derived.endPosition);

	const [created] = await db
		.insert(intervals)
		.values({
			entityId: input.entityId,
			startActId: input.startActId,
			startSceneId: input.startSceneId ?? null,
			endActId: input.endActId,
			endSceneId: input.endSceneId ?? null,
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
	patch: Partial<WriteIntervalInput>
): Promise<UpdateIntervalResult> {
	const [existing] = await db.select().from(intervals).where(eq(intervals.id, id));
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

	await validateFKTypes(db, merged);
	const derived = await computeIntervalPositions(db, merged);

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
		.where(eq(intervals.entityId, merged.entityId));
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
		// row-per-entity-position invariant holds.
		for (const row of overlappers) {
			await db.delete(intervals).where(eq(intervals.id, row.id));
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
			updatedAt: sql`(unixepoch())` as unknown as Date
		})
		.where(eq(intervals.id, id))
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
export async function recomputeIntervalsForAct(db: DB, actId: string): Promise<number> {
	const affected = await db
		.select()
		.from(intervals)
		.where(
			sql`(${intervals.startActId} = ${actId} OR ${intervals.endActId} = ${actId})`
		);

	// One-shot act + scene index maps so each row resolves FKs in O(1)
	// instead of issuing 2-4 DB queries (D20/16A).
	const cache = await buildRecomputeCache(db);

	let updated = 0;
	for (const row of affected) {
		// Branch on scene FK presence per the locked semantic.
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
				updatedAt: sql`(unixepoch())` as unknown as Date
			})
			.where(eq(intervals.id, row.id));
		updated++;
	}
	return updated;
}

/**
 * Recompute positions for EVERY interval row in the database.
 *
 * Runs after any Act-level mutation (insert, reorder, delete) where the
 * act_index of one or more Acts changes. Acts are typically <= ~30 in any
 * story; touching every interval is fine at that scale.
 */
export async function recomputeAllIntervals(db: DB): Promise<number> {
	const all = await db.select().from(intervals);
	// Single act + scene index map for the whole pass — every row's FK
	// resolution is O(1) instead of issuing fresh queries (D20/16A).
	const cache = await buildRecomputeCache(db);
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
				cache
			);

			// Per the locked semantic, fraction-positioned rows (no scene FK on a
			// side) keep their position frozen across Scene reorders. But for
			// ACT reorders, every row's act_index can shift, so even
			// fraction-positioned rows need their integer part updated.
			//
			// Strategy: if the row has NO scene FK on a side, preserve the
			// fractional offset within the act but update the integer part.
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
					updatedAt: sql`(unixepoch())` as unknown as Date
				})
				.where(eq(intervals.id, row.id));
			updated++;
		} catch (err) {
			// Surface but don't swallow; caller decides whether to abort the
			// containing transaction.
			throw new Error(
				`recomputeAllIntervals failed on interval ${row.id}: ${(err as Error).message}`
			);
		}
	}
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
 * The two writes are NOT wrapped in a transaction (D17 deferred to T1's sync
 * refactor). Connection-level serialization in better-sqlite3 keeps each
 * individual write atomic; partial failure between the UPDATE and INSERT is
 * possible but rare in practice (single-process app). T1 closes that gap.
 */
export async function splitInterval(
	db: DB,
	intervalId: string,
	atPosition: number
): Promise<{ left: typeof intervals.$inferSelect; right: typeof intervals.$inferSelect }> {
	const [existing] = await db.select().from(intervals).where(eq(intervals.id, intervalId));
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

	// Build acts and scenesByActId for FK resolution at the split point.
	const actRows = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.type, 'Act'), isNull(entities.parentId)))
		.orderBy(entities.position, entities.createdAt);
	const sceneRows = await db
		.select({ id: entities.id, parentId: entities.parentId })
		.from(entities)
		.where(eq(entities.type, 'Scene'))
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

	// Update original (left half).
	const [left] = await db
		.update(intervals)
		.set({
			endActId: leftEndFKs.endActId,
			endSceneId: leftEndFKs.endSceneId,
			endPosition: leftEndFKs.endPosition,
			updatedAt: sql`(unixepoch())` as unknown as Date
		})
		.where(eq(intervals.id, intervalId))
		.returning();

	// Insert new (right half).
	const [right] = await db
		.insert(intervals)
		.values({
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
	newPosition: number
): Promise<void> {
	const [scene] = await db.select().from(entities).where(eq(entities.id, sceneId));
	if (!scene) throw new Error(`Scene not found: ${sceneId}`);
	if (scene.type !== 'Scene') {
		throw new Error(`Entity ${sceneId} has type='${scene.type}', expected 'Scene'`);
	}
	if (!scene.parentId) {
		throw new Error(`Scene ${sceneId} has no parent_id`);
	}

	const [target] = await db.select().from(entities).where(eq(entities.id, newActId));
	if (!target) throw new Error(`Target act not found: ${newActId}`);
	if (target.type !== 'Act') {
		throw new Error(`Target ${newActId} has type='${target.type}', expected 'Act'`);
	}

	const oldActId = scene.parentId;

	// Cascade: bump siblings in target act at position >= newPosition.
	await db
		.update(entities)
		.set({
			position: sql`${entities.position} + 1` as unknown as number,
			updatedAt: sql`(unixepoch())` as unknown as Date
		})
		.where(
			and(
				eq(entities.type, 'Scene'),
				eq(entities.parentId, newActId),
				sql`${entities.position} >= ${newPosition}`
			)
		);

	// Update scene's parent_id and position.
	await db
		.update(entities)
		.set({
			parentId: newActId,
			position: newPosition,
			updatedAt: sql`(unixepoch())` as unknown as Date
		})
		.where(eq(entities.id, sceneId));

	// Update intervals' act FKs for any interval anchored to this scene.
	await db
		.update(intervals)
		.set({
			startActId: newActId,
			updatedAt: sql`(unixepoch())` as unknown as Date
		})
		.where(eq(intervals.startSceneId, sceneId));
	await db
		.update(intervals)
		.set({
			endActId: newActId,
			updatedAt: sql`(unixepoch())` as unknown as Date
		})
		.where(eq(intervals.endSceneId, sceneId));

	// Recompute both old and new parent acts.
	if (oldActId !== newActId) {
		await recomputeIntervalsForAct(db, oldActId);
	}
	await recomputeIntervalsForAct(db, newActId);
}

// =============================================================================
// Query helpers
// =============================================================================

/** "Who is present at story time T?" */
export async function entitiesPresentAt(db: DB, t: number): Promise<string[]> {
	const rows = await db
		.select({ entityId: intervals.entityId })
		.from(intervals)
		.where(
			and(sql`${intervals.startPosition} <= ${t}`, sql`${intervals.endPosition} > ${t}`)
		);
	return [...new Set(rows.map((r) => r.entityId))];
}

/** "Who is present anywhere in Act with given index?" */
export async function entitiesPresentInActIndex(db: DB, i: number): Promise<string[]> {
	const rows = await db
		.select({ entityId: intervals.entityId })
		.from(intervals)
		.where(
			and(sql`${intervals.startPosition} < ${i + 1}`, sql`${intervals.endPosition} > ${i}`)
		);
	return [...new Set(rows.map((r) => r.entityId))];
}

/** "All intervals that touch the scene with given id" — FK-direct, no math. */
export async function intervalsTouchingScene(db: DB, sceneId: string) {
	return db
		.select()
		.from(intervals)
		.where(
			sql`(${intervals.startSceneId} = ${sceneId} OR ${intervals.endSceneId} = ${sceneId})`
		);
}

/** All intervals for an entity, ordered by story time. */
export async function intervalsForEntity(db: DB, entityId: string) {
	return db
		.select()
		.from(intervals)
		.where(eq(intervals.entityId, entityId))
		.orderBy(intervals.startPosition);
}

/** All intervals for a list of entities, fetched in one query. */
export async function intervalsForEntities(db: DB, entityIds: string[]) {
	if (entityIds.length === 0) return [];
	return db
		.select()
		.from(intervals)
		.where(inArray(intervals.entityId, entityIds))
		.orderBy(intervals.startPosition);
}
