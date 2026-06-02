/**
 * intervals — write chokepoint (Phase 1A PR 1)
 *
 * Single source of truth for ALL writes to the `intervals` table. Raw INSERT
 * or UPDATE outside this file is forbidden — see
 * docs/adr/0003-premise-4-position-math.md → "Dual-write invariant strategy".
 *
 * **Multi-tenant scoping (T8b S5', 2026-05-08):** every public function takes
 * a `userId` and scopes every SELECT/UPDATE/DELETE/INSERT by it. Cross-user
 * reads return empty; cross-user updates affect zero rows. Callers must pass
 * `getUserId(event)` from the route handler.
 *
 * Four primary surfaces:
 *
 *   1. writeInterval(db, input, userId)
 *      Chokepoint for INSERT. Validates polymorphic FK types, validates
 *      positions match FK derivation, stamps userId on the new row.
 *
 *   2. updateInterval(db, id, patch, userId)
 *      Chokepoint for UPDATE. Same validation surface as writeInterval plus
 *      same-entity overlap → union merge with absorbed-row reporting.
 *
 *   3. splitInterval(db, id, atPosition, userId)
 *      Split a multi-act interval at an internal position. Resolves FKs from
 *      the split position via the timeline-helpers pure math.
 *
 *   4. moveSceneToAct(db, sceneId, newActId, newPosition, userId)
 *      Reparent a Scene and rewrite the act FKs on every interval anchored
 *      to it; cascade the position bump on target-act siblings; recompute
 *      both the old and new parent acts.
 */

import { sql, eq, and, isNull } from 'drizzle-orm';
import { entities, intervals } from '../db/schema.js';
import {
	POSITION_EPSILON,
	type Db,
	type WriteIntervalInput,
	type UpdateIntervalResult
} from './types.js';
import { validateFKTypes } from './polymorphic-fk.js';
import { assertNoOverlap } from './invariants.js';
import {
	computeIntervalPositions,
	recomputeIntervalsForAct,
	sceneIndexOf
} from './recompute.js';

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
 * **Atomicity:** callers should wrap in `db.transaction(async (tx) => { await
 * writeInterval(tx, ...) })` when they need the validate / compute / insert
 * sequence to be atomic. The polymorphic Db type accepts both top-level db
 * and a tx context, so passing `tx` is enough — this function does NOT open
 * its own transaction. When called outside a tx the validation reads and
 * the insert are not atomic; a concurrent write between assertNoOverlap and
 * the insert could slip an overlap through. By design only the route
 * handlers that already open a tx (or tests that want explicit rollback)
 * compose this inside one. Locked 2026-04-29 in /plan-eng-review
 * (Issue 11A/17A).
 *
 * Throws on any validation failure (rolls back the surrounding tx if one).
 */
export async function writeInterval(
	db: Db,
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

	/* Same-entity overlap rejection (docs/adr/0003-premise-4-position-math.md →
	   "Half-open convention" — adjacent intervals must be non-overlapping by
	   construction). Must run after position derivation, before the insert. */
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
export async function updateInterval(
	db: Db,
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
	db: Db,
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
		'$lib/features/timeline/timeline-helpers.js'
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
	db: Db,
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

	// Mirror the act-FK rewrite onto map_placements anchored to this scene
	// (Step 4, Codex #2). A placement whose start/end_scene_id is this scene
	// would otherwise keep pointing at the old parent Act, and playhead
	// filtering would be wrong until the next full Act-level recompute.
	const { mapPlacements: mapPlacementsTbl } = await import('../db/schema.js');
	await db
		.update(mapPlacementsTbl)
		.set({ startActId: newActId })
		.where(and(eq(mapPlacementsTbl.startSceneId, sceneId), eq(mapPlacementsTbl.userId, userId)));
	await db
		.update(mapPlacementsTbl)
		.set({ endActId: newActId })
		.where(and(eq(mapPlacementsTbl.endSceneId, sceneId), eq(mapPlacementsTbl.userId, userId)));

	// Mirror the act-FK rewrite onto relationships scoped to this scene (Codex
	// P1, Slice 5 PR-D). A caused_by edge anchored to this scene keeps its old
	// parent Act otherwise; recomputeRelationshipBoundsAll (run via
	// recomputeIntervalsForAct below) would then hit the scene-parent/act
	// mismatch guard in computeIntervalPositions and abort the whole scene move.
	const { relationships: relationshipsTbl } = await import('../db/schema.js');
	await db
		.update(relationshipsTbl)
		.set({ startActId: newActId })
		.where(and(eq(relationshipsTbl.startSceneId, sceneId), eq(relationshipsTbl.userId, userId)));
	await db
		.update(relationshipsTbl)
		.set({ endActId: newActId })
		.where(and(eq(relationshipsTbl.endSceneId, sceneId), eq(relationshipsTbl.userId, userId)));

	if (oldActId !== newActId) {
		await recomputeIntervalsForAct(db, oldActId, userId);
	}
	await recomputeIntervalsForAct(db, newActId, userId);
}
