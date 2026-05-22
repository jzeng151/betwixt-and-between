/**
 * Position math + recompute cascades for the intervals subsystem.
 *
 * Three layers, ordered narrow → wide:
 *  1. FK lookup helpers (actIndexOf / sceneIndexOf) and a one-shot
 *     `RecomputeCache` so callers walking many rows resolve each FK in O(1).
 *  2. `computeIntervalPositions` — pure derivation from FKs (single row).
 *  3. `recomputeIntervalsForAct` / `recomputeAllIntervals` — cascade after
 *     Scene-level or Act-level mutations. Also drives temporal-relationship
 *     and world-map / map-placement recomputes via lazy imports (to break
 *     module-graph cycles).
 *
 * Math (docs/adr/0003-premise-4-position-math.md → "The math"):
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
import { entities, intervals, relationships, mapAnchors, mapEvents, worldMaps } from '../db/schema.js';
// Pure math (actRange, sceneRange, smartSnap) lives in
// $lib/features/timeline/timeline-helpers so non-server code (drag-preview snap) can import it
// without violating SvelteKit's $lib/server/* boundary.
import { actRange, sceneRange } from '$lib/features/timeline/timeline-helpers.js';
import {
	POSITION_EPSILON,
	type Db,
	type ComputeIntervalPositionsInput,
	type ComputeIntervalPositionsResult,
	type RecomputeCache,
	type RelationshipBoundsInput,
	type RelationshipBoundsResult
} from './types.js';

// =============================================================================
// FK-derivation cache + lookups
// =============================================================================

async function buildRecomputeCache(db: Db, userId: string): Promise<RecomputeCache> {
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

export async function actIndexOf(db: Db, actId: string, userId: string): Promise<number> {
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
	db: Db,
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
	db: Db,
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
// Recompute cascades — run after Scene/Act mutations
// =============================================================================

/**
 * Recompute positions for every interval anchored to a Scene within `actId`.
 *
 * Branch on scene FK presence (docs/adr/0003-premise-4-position-math.md → "Position recomputation"):
 *   - start_scene_id NOT NULL → re-derive start_position
 *   - start_scene_id IS NULL  → leave start_position UNCHANGED (fraction-positioned, frozen)
 *   - same for end side, independently
 *
 * Only writes rows whose positions actually changed.
 */
export async function recomputeIntervalsForAct(db: Db, actId: string, userId: string): Promise<number> {
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

	// Scene-anchored map_placements also need their derived positions refreshed
	// after a scene-within-act mutation (Step 4, Codex #2). Coarse: walk the
	// user's placement rows. Placements are expected to be few per user; the
	// per-row recompute short-circuits when nothing drifts.
	// Note: relationships' scene-anchored rows have the same pre-existing gap
	// — they only refresh inside recomputeAllIntervals. Out of scope here.
	const { recomputePlacementBoundsAll } = await import('../map-placements.js');
	await recomputePlacementBoundsAll(db, userId);

	return updated;
}

/**
 * Recompute positions for EVERY interval row owned by user.
 *
 * Runs after any Act-level mutation (insert, reorder, delete) where the
 * act_index of one or more Acts changes. Acts are typically <= ~30 in any
 * story; touching every interval is fine at that scale.
 */
/**
 * Snapshot of the Act ordering BEFORE a reorder cascade fires. Maps the old
 * act-index (the integer part of a stored t_position) back to its actId.
 *
 * Captured at the API-handler boundary BEFORE the entities.position UPDATE
 * runs, then passed through `recomputeAllIntervals` into the map-anchor /
 * map-event recompute. Required because `map_anchors` and `map_events` have
 * no `start_act_id` FK column — `Math.floor(t_position)` is the only handle
 * we have on "which Act was this anchored to," and that handle goes stale
 * the moment entities.position changes. See CMT-7 in the WM3 design doc;
 * U12 in TODOS revisits whether to add an FK column at Slice 2.
 */
export type ActOrderingSnapshot = Map<number, string>;

export async function snapshotActOrdering(db: Db, userId: string): Promise<ActOrderingSnapshot> {
	const acts = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.userId, userId), eq(entities.type, 'Act'), isNull(entities.parentId)))
		.orderBy(entities.position, entities.createdAt);
	const snap: ActOrderingSnapshot = new Map();
	acts.forEach((a, i) => snap.set(i, a.id));
	return snap;
}

export async function recomputeAllIntervals(
	db: Db,
	userId: string,
	preSnapshot?: ActOrderingSnapshot
): Promise<number> {
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
	const { recomputeWorldMapVariantsAll } = await import('../world-maps.js');
	await recomputeWorldMapVariantsAll(db, userId);

	// Map-placement bounds piggyback on the same cascade (M11 — Step 4).
	// Same lazy-import dance to break the map-placements.ts → intervals.ts cycle.
	const { recomputePlacementBoundsAll } = await import('../map-placements.js');
	await recomputePlacementBoundsAll(db, userId);

	// World Map v3 — anchor + event t_position recompute. Only fires when the
	// caller supplied a pre-cascade Act-ordering snapshot (i.e., Act reorders
	// and Act deletes). Scene reorders within an Act don't shift any Act
	// index, so they never need this. See snapshotActOrdering docstring.
	if (preSnapshot) {
		await recomputeMapAnchors(db, userId, preSnapshot, cache);
		await recomputeMapEvents(db, userId, preSnapshot, cache);
	}

	return updated;
}

// =============================================================================
// Relationship temporal bounds — Phase 1B Lane A (2026-05-02)
// =============================================================================

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
	db: Db,
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
 * Runs inside the caller's transaction context (pass db or tx). Module-
 * internal — only `recomputeAllIntervals` above triggers it today.
 */
async function recomputeRelationshipBoundsAll(db: Db, userId: string): Promise<number> {
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

// =============================================================================
// World Map v3 — anchor + event t_position recompute (Slice 1a, 2026-05-22)
// =============================================================================
//
// `map_anchors` and `map_events` carry a raw `t_position` (doublePrecision) with
// no FK to start_act_id / start_scene_id. When Acts are reordered or deleted,
// `floor(t_position)` is the only handle on "which Act was this anchored to,"
// and it goes stale the moment entities.position changes. The pre-cascade
// `ActOrderingSnapshot` is the bridge.
//
// Slice 1a semantic (CMT-7 option A — "t_position-only recompute"):
//   oldIdx = floor(t_position) → snapshot[oldIdx] → actId
//   newIdx = cache.actIndex.get(actId)
//   new t_position = newIdx + (t_position - oldIdx)
//
// This preserves the fractional offset within the Act — mirroring how the
// intervals recompute treats fraction-positioned rows (lines 345-356 above).
// Sub-act position drifts within the Act when scene composition changes;
// that drift is the "semantic drift" CMT-7 explicitly defers to Slice 2.
// U12 in TODOS captures the revisit (option B: add a scene_id FK).
//
// Edge cases:
//   - `-Infinity` (initial-anchor sentinel): left unchanged. Always sorts
//     before any user-authored t_position regardless of Act ordering.
//   - `+Infinity`: shouldn't occur in writes, but if present is left unchanged
//     for the same reason.
//   - Deleted Act (oldIdx not in preSnapshot, OR snapshot's actId no longer
//     in cache): leave t_position unchanged. The row points at a no-longer-
//     existing Act slot; semantic drift accepted. Slice 2 may layer cascade-
//     delete or snap-to-neighbor policy on top.
//   - Cross-user scoping: queries JOIN through world_maps.user_id per the
//     CLAUDE.md invariant. `map_anchors` and `map_events` carry no user_id.
// =============================================================================

async function reprojectTPosition(
	t: number,
	preSnapshot: ActOrderingSnapshot,
	cache: RecomputeCache
): Promise<number | null> {
	if (!Number.isFinite(t)) return null;
	const oldIdx = Math.floor(t);
	const actId = preSnapshot.get(oldIdx);
	if (!actId) return null;
	const newIdx = cache.actIndex.get(actId);
	if (newIdx === undefined) return null;
	const frac = t - oldIdx;
	return newIdx + frac;
}

async function recomputeMapAnchors(
	db: Db,
	userId: string,
	preSnapshot: ActOrderingSnapshot,
	cache: RecomputeCache
): Promise<number> {
	const rows = await db
		.select({ id: mapAnchors.id, tPosition: mapAnchors.tPosition })
		.from(mapAnchors)
		.innerJoin(worldMaps, eq(mapAnchors.worldMapId, worldMaps.id))
		.where(eq(worldMaps.userId, userId));
	let updated = 0;
	for (const row of rows) {
		const next = await reprojectTPosition(row.tPosition, preSnapshot, cache);
		if (next === null) continue;
		if (Math.abs(next - row.tPosition) <= POSITION_EPSILON) continue;
		await db
			.update(mapAnchors)
			.set({ tPosition: next })
			.where(eq(mapAnchors.id, row.id));
		updated++;
	}
	return updated;
}

async function recomputeMapEvents(
	db: Db,
	userId: string,
	preSnapshot: ActOrderingSnapshot,
	cache: RecomputeCache
): Promise<number> {
	const rows = await db
		.select({ id: mapEvents.id, tPosition: mapEvents.tPosition })
		.from(mapEvents)
		.innerJoin(worldMaps, eq(mapEvents.worldMapId, worldMaps.id))
		.where(eq(worldMaps.userId, userId));
	let updated = 0;
	for (const row of rows) {
		const next = await reprojectTPosition(row.tPosition, preSnapshot, cache);
		if (next === null) continue;
		if (Math.abs(next - row.tPosition) <= POSITION_EPSILON) continue;
		await db
			.update(mapEvents)
			.set({ tPosition: next })
			.where(eq(mapEvents.id, row.id));
		updated++;
	}
	return updated;
}
