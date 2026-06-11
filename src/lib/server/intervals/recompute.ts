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

import { error } from '@sveltejs/kit';
import { sql, eq, and, isNull, inArray } from 'drizzle-orm';
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
			// Half-open (2026-06 audit fix): a start exactly AT range.end belongs
			// to the NEXT act's FK — accepting it here stored a row violating
			// floor(start) == idx(startAct), which the next act-level recompute
			// reinterpreted (fraction 0 → start-of-THIS-act, silently growing the
			// interval by a full act).
			if (
				input.startPosition < range.start - POSITION_EPSILON ||
				input.startPosition > range.end - POSITION_EPSILON
			) {
				throw new Error(
					`start_position ${input.startPosition} outside act range [${range.start}, ${range.end}) for start_act_id ${input.startActId}`
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
			// Mirror of the start side: an end exactly AT range.start belongs to
			// the PREVIOUS act's FK (exclusive end). Accepting it stored a row
			// the next recompute mapped to end-of-THIS-act (fraction 0 → idx+1),
			// shifting the boundary forward a full act.
			if (
				input.endPosition < range.start + POSITION_EPSILON ||
				input.endPosition > range.end + POSITION_EPSILON
			) {
				throw new Error(
					`end_position ${input.endPosition} outside act range (${range.start}, ${range.end}] for end_act_id ${input.endActId}`
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
 * Derive one side's recomputed position from the cache (2026-06 audit fix).
 *
 *   scene-anchored side    → sceneRange boundary (start → .start, end → .end)
 *   fraction-positioned    → act index from cache + the stored fractional
 *                            offset (frozen-fraction semantics). For an end
 *                            side, fraction 0 means "exclusive end of act"
 *                            and maps to actIndex + 1.
 *
 * When act indices are unchanged (scene reorders) the fraction branch is the
 * identity, so the same helpers serve both cascade loops.
 */
function deriveStartSide(
	cache: RecomputeCache,
	actId: string,
	sceneId: string | null,
	storedPosition: number
): number {
	if (sceneId) {
		const { sceneIndex, sceneCount, parentActId } = sceneInfoFromCache(cache, sceneId);
		if (parentActId !== actId) {
			throw new Error(`start_scene_id ${sceneId} parent ${parentActId} does not match start_act_id ${actId}`);
		}
		return sceneRange(sceneIndex, sceneCount, actIndexFromCache(cache, parentActId)).start;
	}
	const fraction = storedPosition - Math.floor(storedPosition);
	return actIndexFromCache(cache, actId) + fraction;
}

function deriveEndSide(
	cache: RecomputeCache,
	actId: string,
	sceneId: string | null,
	storedPosition: number
): number {
	if (sceneId) {
		const { sceneIndex, sceneCount, parentActId } = sceneInfoFromCache(cache, sceneId);
		if (parentActId !== actId) {
			throw new Error(`end_scene_id ${sceneId} parent ${parentActId} does not match end_act_id ${actId}`);
		}
		return sceneRange(sceneIndex, sceneCount, actIndexFromCache(cache, parentActId)).end;
	}
	const fraction = storedPosition - Math.floor(storedPosition);
	const i = actIndexFromCache(cache, actId);
	// end at a whole-number boundary is the act's exclusive end (start-of-next).
	return fraction === 0 ? i + 1 : i + fraction;
}

export type SwappedFks = {
	startActId: string;
	startSceneId: string | null;
	endActId: string;
	endSceneId: string | null;
};

/**
 * Recompute one interval row's positions, normalizing inversions.
 *
 * An Act reorder can move the end-anchor act at-or-before the start-anchor
 * act, and a Scene reorder can move a start-anchor scene past the end side;
 * pre-audit both cases aborted the whole cascade transaction (a thrown
 * derive error or the intervals_position_order CHECK) and surfaced as a 500
 * blocking the reorder/delete. Normalization: swap the side anchors so the
 * interval covers [earlier side, later side] in the new ordering — both
 * anchors survive, no data is lost. If even the swapped orientation is
 * degenerate (zero extent), the row is left untouched (`null` return): its
 * stored values are still DB-valid and the next mutation re-normalizes.
 */
function computeRowRecompute(
	cache: RecomputeCache,
	row: {
		startActId: string;
		startSceneId: string | null;
		endActId: string;
		endSceneId: string | null;
		startPosition: number;
		endPosition: number;
	}
): { newStart: number; newEnd: number; swapped: SwappedFks | null } | null {
	const newStart = deriveStartSide(cache, row.startActId, row.startSceneId, row.startPosition);
	const newEnd = deriveEndSide(cache, row.endActId, row.endSceneId, row.endPosition);
	if (newStart < newEnd) return { newStart, newEnd, swapped: null };

	const swappedStart = deriveStartSide(cache, row.endActId, row.endSceneId, row.endPosition);
	const swappedEnd = deriveEndSide(cache, row.startActId, row.startSceneId, row.startPosition);
	if (swappedStart < swappedEnd) {
		return {
			newStart: swappedStart,
			newEnd: swappedEnd,
			swapped: {
				startActId: row.endActId,
				startSceneId: row.endSceneId,
				endActId: row.startActId,
				endSceneId: row.startSceneId
			}
		};
	}
	return null;
}

type SwapCheck = { id: string; entityId: string; start: number; end: number };

// Trim float noise (e.g. 1.9999999998) for the user-facing span numbers.
const fmtPos = (n: number): string => String(Number(n.toFixed(3)));

/**
 * Re-assert the same-entity no-overlap invariant for rows whose anchors were
 * SWAPPED by computeRowRecompute (2026-06 audit follow-up, codex). The swap
 * keeps both anchors when a reorder inverts an interval, but it can widen the
 * row across acts so it now intersects a sibling interval of the same entity —
 * a state the per-row recompute would otherwise write silently (there is no DB
 * overlap constraint backing the invariant). Run AFTER all rows are written so
 * each check sees final positions; a real overlap throws (rolling back the whole
 * cascade transaction) instead of persisting an overlap.
 *
 * SCOPE (2026-06 review follow-up — narrowed from an earlier over-broad claim):
 * this checks ONLY swap-normalized rows, i.e. the new overlap class that swap
 * normalization itself can introduce. It does NOT catch a *pure reprojection*
 * that widens a multi-act interval across a same-entity sibling without inverting
 * it (e.g. reorder [act0,act1,act2] → [act0,act2,act1] turns an act0→act1 span
 * [0,2) into [0,3) over a sibling now at [1,2); neither row is swapped). That
 * overlap class is PRE-EXISTING and is the "accepted exposure" documented in
 * invariants.ts → assertNoOverlap; the durable fix is the EXCLUDE USING gist
 * constraint named there, not a wider post-write scan here (which would also
 * 409 on historical overlaps and block otherwise-legitimate reorders).
 *
 * On a clash we throw a 409 with an ACTIONABLE message (entity name, the two
 * overlapping spans, and how to resolve it by hand) rather than a bare 500: the
 * route catch's `if (status) throw err` re-throws it verbatim to the client, so
 * the author sees what collided and what to do (move/shorten one span, or place
 * the Act elsewhere) instead of an opaque failure. 409 matches the 23505 → 409
 * conflict translation the routes already use for the duplicate-bounds case.
 */
async function assertSwapsNoOverlap(db: Db, userId: string, swaps: SwapCheck[]): Promise<void> {
	for (const s of swaps) {
		// Half-open overlap: [a1, a2) ∩ [b1, b2) ≠ ∅ iff a1 < b2 AND b1 < a2.
		const siblings = await db
			.select({
				id: intervals.id,
				startPosition: intervals.startPosition,
				endPosition: intervals.endPosition
			})
			.from(intervals)
			.where(and(eq(intervals.entityId, s.entityId), eq(intervals.userId, userId)));
		const clash = siblings.find(
			(row) => row.id !== s.id && s.start < row.endPosition && row.startPosition < s.end
		);
		if (!clash) continue;

		const [ent] = await db
			.select({ name: entities.name })
			.from(entities)
			.where(and(eq(entities.id, s.entityId), eq(entities.userId, userId)));
		const who = ent?.name ? `"${ent.name}"` : 'this entity';
		error(
			409,
			`This change would place ${who} in two overlapping time spans ` +
				`(${fmtPos(s.start)}–${fmtPos(s.end)} and ${fmtPos(clash.startPosition)}–${fmtPos(clash.endPosition)} ` +
				`on the story-time axis) — an entity can't occupy two intervals at once, so nothing was saved. ` +
				`To resolve: open ${who} and move or shorten one of those two spans so they no longer overlap, ` +
				`then retry — or place the Act at a different position.`
		);
	}
}

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
	const swaps: SwapCheck[] = [];
	for (const row of affected) {
		// Scene-anchored sides re-derive from the scene's new index; fraction-
		// positioned sides are the identity here (act indices unchanged by a
		// scene mutation). Inverted rows (a start scene reordered past the end
		// side) are swap-normalized instead of tripping the DB CHECK (2026-06
		// audit fix — see computeRowRecompute).
		const result = computeRowRecompute(cache, row);
		if (!result) continue;
		const { newStart, newEnd, swapped } = result;

		const startDrift = Math.abs(newStart - row.startPosition) > POSITION_EPSILON;
		const endDrift = Math.abs(newEnd - row.endPosition) > POSITION_EPSILON;
		if (!startDrift && !endDrift && !swapped) continue;

		await db
			.update(intervals)
			.set({
				startPosition: newStart,
				endPosition: newEnd,
				...(swapped ?? {})
			})
			.where(and(eq(intervals.id, row.id), eq(intervals.userId, userId)));
		if (swapped) swaps.push({ id: row.id, entityId: row.entityId, start: newStart, end: newEnd });
		updated++;
	}
	await assertSwapsNoOverlap(db, userId, swaps);

	// Scene-anchored map_placements also need their derived positions refreshed
	// after a scene-within-act mutation (Step 4, Codex #2). Coarse: walk the
	// user's placement rows. Placements are expected to be few per user; the
	// per-row recompute short-circuits when nothing drifts. The cache built
	// above is threaded through so each row resolves FKs in O(1) instead of
	// re-querying acts/scenes per row (2026-06 perf audit).
	const { recomputePlacementBoundsAll } = await import('../map-placements.js');
	await recomputePlacementBoundsAll(db, userId, cache);

	// Scene-anchored relationships (caused_by scope) carry the same derived
	// start/end positions and must refresh on a scene-within-act mutation too.
	// WM3 Slice 5 PR-D wires relationship.start_position to a user-facing
	// jump-to-cause click, so a stale value now scrubs the playhead to the
	// wrong story-time. Coarse walk, same short-circuit-on-no-drift contract
	// as the placement recompute above.
	await recomputeRelationshipBoundsAll(db, userId, cache);

	// Scene-anchored world_map variants depend on the scene's index/count within
	// its act, so they drift on a scene-within-act mutation exactly like the
	// placements/relationships above — yet this cascade historically skipped them
	// (only the Act-reorder path recomputed variants). A scene move would then
	// leave a scene-anchored variant's derived position stale until the next Act
	// reorder (2026-06 review). Same coarse walk; runs in the caller's tx so the
	// world_maps DEFERRABLE EXCLUDE tolerates transient overlaps until commit.
	const { recomputeWorldMapVariantsAll } = await import('../world-maps.js');
	await recomputeWorldMapVariantsAll(db, userId, cache);

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
	const swaps: SwapCheck[] = [];

	for (const row of all) {
		try {
			/* Per the locked semantic, fraction-positioned rows (no scene FK on a side)
			   keep their position frozen across Scene reorders. For ACT reorders, every
			   row's act_index can shift, so even fraction-positioned rows need their
			   integer part updated — deriveStartSide / deriveEndSide preserve the
			   fractional offset within the act while updating the integer part.
			   A reorder that inverts an interval's anchor order is swap-normalized
			   instead of aborting the whole cascade (2026-06 audit fix — see
			   computeRowRecompute). */
			const result = computeRowRecompute(cache, row);
			if (!result) continue;
			const { newStart, newEnd, swapped } = result;

			const startDrift = Math.abs(newStart - row.startPosition) > POSITION_EPSILON;
			const endDrift = Math.abs(newEnd - row.endPosition) > POSITION_EPSILON;
			if (!startDrift && !endDrift && !swapped) continue;

			await db
				.update(intervals)
				.set({
					startPosition: newStart,
					endPosition: newEnd,
					...(swapped ?? {})
				})
				.where(and(eq(intervals.id, row.id), eq(intervals.userId, userId)));
			if (swapped)
				swaps.push({ id: row.id, entityId: row.entityId, start: newStart, end: newEnd });
			updated++;
		} catch (err) {
			throw new Error(
				`recomputeAllIntervals failed on interval ${row.id}: ${(err as Error).message}`
			);
		}
	}
	// Roll back the whole cascade if any swap-normalized row now overlaps a
	// sibling of the same entity (2026-06 audit follow-up — see assertSwapsNoOverlap).
	await assertSwapsNoOverlap(db, userId, swaps);

	// Also recompute temporal relationship bounds in the same transaction so
	// act-reorder cascades are atomic (Phase 1B Lane A, 2026-05-02). The cache
	// built above is threaded through every walk below (2026-06 perf audit) so
	// no walk re-queries acts/scenes per row or rebuilds the cache.
	await recomputeRelationshipBoundsAll(db, userId, cache);

	// World-map variant bounds piggyback on the same cascade (M11 design lock).
	// Imported lazily to break the world-maps.ts → intervals.ts dependency cycle.
	const { recomputeWorldMapVariantsAll } = await import('../world-maps.js');
	await recomputeWorldMapVariantsAll(db, userId, cache);

	// Map-placement bounds piggyback on the same cascade (M11 — Step 4).
	// Same lazy-import dance to break the map-placements.ts → intervals.ts cycle.
	const { recomputePlacementBoundsAll } = await import('../map-placements.js');
	await recomputePlacementBoundsAll(db, userId, cache);

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
 * Resolve derived bounds, swap-normalizing an inversion the way the interval
 * recompute (computeRowRecompute) does — for the three sibling derived-position
 * tables that resolve through `resolveRelationshipBounds` (relationships,
 * world_maps variants, map_placements). Each carries a `start_position <
 * end_position` CHECK, so a scene reorder that moves a start-anchor scene past
 * its end-anchor scene in the same act would otherwise derive an inverted range,
 * trip the CHECK (23514), and roll back the whole reorder as an opaque 500.
 *
 * `resolveRelationshipBounds` → `computeIntervalPositions` *throws* on an
 * inverted/zero-extent derived range (it can't return the inverted numbers), so
 * the normalization is structured as: try the direct anchors; on throw, retry
 * with the side anchors swapped. The swap only "wins" when it yields a valid
 * `start < end`; if it doesn't, the original throw was something else (a corrupt
 * FK, a scene that left its act) and is re-thrown unchanged so real errors still
 * surface as before.
 *
 * Returns `{ ..bounds, swappedFks: null }` for the normal path (including the
 * both-null "timeless" bounds each caller clears on its own), or `{ ..swapped,
 * swappedFks }` when an inversion was normalized — in which case the caller MUST
 * also persist `swappedFks` (start/end act+scene FK columns) so the row stays
 * self-consistent (start anchor ↔ start_position).
 */
export async function resolveRelationshipBoundsSwapNormalized(
	db: Db,
	input: RelationshipBoundsInput,
	userId: string,
	cache?: RecomputeCache
): Promise<RelationshipBoundsResult & { swappedFks: SwappedFks | null }> {
	try {
		const direct = await resolveRelationshipBounds(db, input, userId, cache);
		return { startPosition: direct.startPosition, endPosition: direct.endPosition, swappedFks: null };
	} catch (directErr) {
		let swapped: RelationshipBoundsResult;
		try {
			swapped = await resolveRelationshipBounds(
				db,
				{
					startActId: input.endActId ?? null,
					startSceneId: input.endSceneId ?? null,
					endActId: input.startActId ?? null,
					endSceneId: input.startSceneId ?? null
				},
				userId,
				cache
			);
		} catch {
			// Swapping didn't fix it → the original error wasn't an inversion. Surface it.
			throw directErr;
		}
		return {
			startPosition: swapped.startPosition,
			endPosition: swapped.endPosition,
			swappedFks: {
				startActId: input.endActId as string,
				startSceneId: input.endSceneId ?? null,
				endActId: input.startActId as string,
				endSceneId: input.startSceneId ?? null
			}
		};
	}
}

/**
 * Walk all temporal relationships and recompute their start_position /
 * end_position from FK anchors. Returns the count of rows updated.
 *
 * Runs inside the caller's transaction context (pass db or tx). Module-
 * internal — only `recomputeAllIntervals` above triggers it today.
 */
async function recomputeRelationshipBoundsAll(
	db: Db,
	userId: string,
	providedCache?: RecomputeCache
): Promise<number> {
	// Two row classes need a visit:
	//   (a) act-anchored rows — re-derive their position from the live anchor.
	//   (b) orphaned rows — act FKs both null (the anchoring Act was deleted, so
	//       ON DELETE SET NULL fired) but start/end_position still hold the
	//       deleted Act's stale story-time. resolveRelationshipBounds returns
	//       null/null for these, and the change-detection below clears them.
	//       Without this, the edge stays "clickable" (isCausalEdgeClickable only
	//       checks startPosition != null) and jump-to-cause leaks a deleted Act's
	//       timing for an otherwise now-timeless link (Codex P2, Slice 5 PR-D).
	const rows = await db
		.select()
		.from(relationships)
		.where(
			and(
				eq(relationships.userId, userId),
				sql`(${relationships.startActId} IS NOT NULL OR ${relationships.endActId} IS NOT NULL OR ${relationships.startPosition} IS NOT NULL OR ${relationships.endPosition} IS NOT NULL)`
			)
		);

	if (rows.length === 0) return 0;

	const cache = providedCache ?? (await buildRecomputeCache(db, userId));

	// Compute first, write after, so the position writes can be staged
	// swap-safely (see below). Two outcome buckets:
	//   clears — partial-anchor rows reverted to timeless (FKs + positions null).
	//   sets   — rows whose derived start/end positions changed.
	const clears: string[] = [];
	const sets: Array<{
		id: string;
		startPosition: number | null;
		endPosition: number | null;
		swappedFks: SwappedFks | null;
	}> = [];

	for (const row of rows) {
		try {
			// Partial anchor: an Act delete (ON DELETE SET NULL) nulled exactly one
			// side of a scoped edge whose start and end acts differ (the modal lets
			// start/end acts be chosen independently). The surviving half can no
			// longer form a valid [start, end) scope — resolveRelationshipBounds
			// requires both act FKs or neither — so revert the row to timeless: null
			// the dangling anchor and clear both positions. Without this the orphaned
			// half keeps the row in this query and resolveRelationshipBounds throws,
			// aborting the whole Act-delete transaction (Codex P1, Slice 5 PR-D).
			if ((row.startActId == null) !== (row.endActId == null)) {
				clears.push(row.id);
				continue;
			}

			// Swap-normalize an inversion (a scene reorder that moves a start-anchor
			// scene past the end-anchor scene in the same act) instead of writing an
			// inverted range that trips relationships_position_order → opaque 500
			// (2026-06 review; the same fix the intervals path got).
			const resolved = await resolveRelationshipBoundsSwapNormalized(
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
			const { startPosition, endPosition, swappedFks } = resolved;

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

			// A swap can leave both positions numerically unchanged (the two scenes'
			// derived spans are symmetric) while still needing the FK columns swapped,
			// so don't short-circuit when swappedFks is set.
			if (!startChanged && !endChanged && !swappedFks) continue;

			sets.push({ id: row.id, startPosition, endPosition, swappedFks });
		} catch (err) {
			throw new Error(
				`recomputeRelationshipBoundsAll failed on relationship ${row.id}: ${(err as Error).message}`
			);
		}
	}

	// Partial-anchor clears go to null start_position → they leave the temporal
	// dedup index, so no row-ordering hazard.
	for (const id of clears) {
		await db
			.update(relationships)
			.set({
				startActId: null,
				startSceneId: null,
				endActId: null,
				endSceneId: null,
				startPosition: null,
				endPosition: null
			})
			.where(and(eq(relationships.id, id), eq(relationships.userId, userId)));
	}

	// Position writes are swap-safe. A scene reorder can map two same-endpoint,
	// same-type edges (which `relationships_temporal_dedup` — UNIQUE (from, to,
	// type, start_position) WHERE start_position IS NOT NULL — permits to coexist
	// only because their start_positions differ) onto each other's positions. A
	// naive row-by-row write would momentarily hold two equal start_positions and
	// trip that index, aborting the reorder. So stage every changed start_position
	// to a unique sentinel outside the real range (negatives — real positions are
	// >= 0) first, then write the finals: neither phase ever holds a duplicate
	// start_position (Codex P2, Slice 5 PR-D). Only start_position is staged;
	// end_position is in no unique index.
	if (sets.length > 0) {
		for (let i = 0; i < sets.length; i++) {
			await db
				.update(relationships)
				.set({ startPosition: -(i + 1) })
				.where(and(eq(relationships.id, sets[i].id), eq(relationships.userId, userId)));
		}
		for (const s of sets) {
			await db
				.update(relationships)
				.set({
					startPosition: s.startPosition,
					endPosition: s.endPosition,
					// Persist the swapped side anchors so the row stays self-consistent
					// (start FK ↔ start_position) after an inversion was normalized.
					...(s.swappedFks ?? {})
				})
				.where(and(eq(relationships.id, s.id), eq(relationships.userId, userId)));
		}
	}

	return clears.length + sets.length;
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
// Three classifications per row in classifyTPosition:
//   - REPROJECT — finite t inside the snapshot, Act still exists in cache.
//                 New t computed.
//   - DELETE    — finite t in a now-deleted Act (snapshot has actId, cache
//                 doesn't). Per Codex P1 on PR #52 commit a9c550f: leaving
//                 the row at its old t_position causes UNIQUE-index
//                 collisions with shifted-up anchors from later Acts (e.g.,
//                 anchor at t=1.5 in deleted Act 1 collides with anchor at
//                 old-t=2.5 from Act 2 whose new-t=1.5). The Act delete
//                 transaction would abort. Resolution: drop the row. Slice 2
//                 may layer a snap-to-neighbor or warn-before-delete policy.
//   - SKIP      — `-Infinity` / `+Infinity` (initial-anchor sentinel), or
//                 `floor(t)` outside the snapshot entirely (no oldIdx
//                 mapping). Leave unchanged.
//
// Cross-user scoping: queries scope through worldMaps.userId via JOIN +
// inArray defense-in-depth per CLAUDE.md. `map_anchors` and `map_events`
// carry no user_id.
// =============================================================================

type TPositionAction =
	| { kind: 'reproject'; newT: number }
	| { kind: 'delete' }
	| { kind: 'skip' };

function classifyTPosition(
	t: number,
	preSnapshot: ActOrderingSnapshot,
	cache: RecomputeCache
): TPositionAction {
	if (!Number.isFinite(t)) return { kind: 'skip' };
	const oldIdx = Math.floor(t);
	const actId = preSnapshot.get(oldIdx);
	if (!actId) return { kind: 'skip' };
	const newIdx = cache.actIndex.get(actId);
	if (newIdx === undefined) return { kind: 'delete' };
	const frac = t - oldIdx;
	return { kind: 'reproject', newT: newIdx + frac };
}

// Defense-in-depth helper. The SELECT JOIN through worldMaps.userId scopes
// reads correctly, but the per-row UPDATE targets only by id — relying on the
// caller to keep both inside the same transaction. If a future caller invokes
// recomputeAllIntervals on `db` outside a tx (or someone refactors the SELECT
// JOIN away), the UPDATE alone would not block a cross-user write. Pre-
// collecting userMapIds and gating the UPDATE with inArray(...) makes the
// scoping self-enforcing — the UPDATE physically cannot touch another user's
// rows even if the SELECT becomes stale or unscoped.
async function loadUserMapIds(db: Db, userId: string): Promise<string[]> {
	const maps = await db
		.select({ id: worldMaps.id })
		.from(worldMaps)
		.where(eq(worldMaps.userId, userId));
	return maps.map((m) => m.id);
}

// Phase-1 parking base for the two-phase anchor write below. Each parked
// row gets a UNIQUE value of (ANCHOR_PARK_BASE - i) where i is its index in
// the updates[] list. Distinctness is guaranteed by construction — no
// IEEE-754 collapse possible because these are small-magnitude integers
// that are exactly representable in float8.
//
// History: the original fix shipped in commit a9c550f added a constant
// offset (`t_position + 1e15`). Codex (chatgpt-codex-connector) correctly
// flagged that as a P1 on commit adb43e0: float64 ULP at magnitude 1e15 is
// ≈0.125, so two anchors at e.g. t=1.10 and t=1.11 both round to the same
// parked value after `+ 1e15` (verified — `1e15 + 1.10 === 1e15 + 1.11`
// in JS / float8). Phase 1 then tripped the same UNIQUE index it was meant
// to dodge. Setting absolute per-row unique values sidesteps the entire
// IEEE-754 spacing question — small-magnitude integer t_positions are
// exactly representable regardless of how dense the original fractions
// were.
//
// -1_000_000 is chosen to be (a) well outside any user-authored t_position
// (those are non-negative — Acts are at integer index ≥ 0), (b) clearly
// recognizable as "parked" if it ever shows up in DB inspection during a
// crash, (c) small enough in magnitude that ANCHOR_PARK_BASE - i remains
// exact for i well into the trillions.
const ANCHOR_PARK_BASE = -1_000_000;

// Postgres caps a statement at 65535 bind parameters; each VALUES row in the
// bulk recompute UPDATEs below uses 2 (id, t_position). A heavily-painted map
// (every paint stroke is a map_events row) can accumulate enough changed rows
// that one VALUES clause exceeds that limit and fails the entire Act reorder/
// delete cascade. Chunk the bulk writes so the statement stays bounded
// (1000 rows ≈ 2001 params). (2026-06 audit follow-up — the single-VALUES
// rewrite replaced per-row loops that never hit the param ceiling.)
export const BULK_UPDATE_CHUNK = 1000;
export function chunked<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

async function recomputeMapAnchors(
	db: Db,
	userId: string,
	preSnapshot: ActOrderingSnapshot,
	cache: RecomputeCache
): Promise<number> {
	const userMapIds = await loadUserMapIds(db, userId);
	if (userMapIds.length === 0) return 0;
	const rows = await db
		.select({ id: mapAnchors.id, tPosition: mapAnchors.tPosition })
		.from(mapAnchors)
		.where(inArray(mapAnchors.worldMapId, userMapIds));

	const updates: { id: string; newT: number }[] = [];
	const deletes: string[] = [];
	for (const row of rows) {
		const action = classifyTPosition(row.tPosition, preSnapshot, cache);
		if (action.kind === 'delete') {
			deletes.push(row.id);
			continue;
		}
		if (action.kind === 'skip') continue;
		if (Math.abs(action.newT - row.tPosition) <= POSITION_EPSILON) continue;
		updates.push({ id: row.id, newT: action.newT });
	}

	// Pre-pass: drop anchors whose Act was deleted. Must run BEFORE the
	// two-phase write so the deleted-Act t_positions vacate UNIQUE index
	// slots that shifted-up anchors are about to move into. Without this,
	// an Act delete with same-fraction anchors across acts aborts the
	// cascade transaction (Codex P1 on PR #52 commit a9c550f, line 637).
	if (deletes.length > 0) {
		// Chunked (2026-06 follow-up): a heavily-painted map being collapsed by an
		// Act delete can have more rows to drop than the 65535 bind-param ceiling
		// allows in one inArray — same reason the bulk UPDATEs below are chunked.
		for (const slice of chunked(deletes, BULK_UPDATE_CHUNK)) {
			await db
				.delete(mapAnchors)
				.where(and(inArray(mapAnchors.id, slice), inArray(mapAnchors.worldMapId, userMapIds)));
		}
	}

	if (updates.length === 0) return 0;

	// Two-phase write to avoid violating the (world_map_id, t_position) UNIQUE
	// index on intermediate row states. Per-row UPDATE to final values fails
	// when two anchors swap slots (e.g., anchor at t=1.5 in Act 1 and anchor
	// at t=2.5 in Act 2 after a 1↔2 reorder — each is destined for the
	// other's current value, and the first UPDATE collides on the unique
	// index).
	//
	// Phase 1: park each to-be-updated row to its OWN unique parked value
	// (ANCHOR_PARK_BASE - i, see the constant docstring). Distinctness is by
	// construction so no two parked rows collide; the negative magnitude is
	// outside any user-authored t_position so no parked row collides with a
	// non-updated existing row either. Per-row write is safe.
	//
	// Phase 2: write each row's final value. The positive t_position range
	// is now empty of to-be-updated rows (they're all parked at negatives)
	// AND of deleted-Act rows (the pre-pass above removed them), so no two
	// final values collide. Per-row write is safe.
	//
	// Codex (chatgpt-codex-connector) flagged the underlying swap collision
	// as a P1 on PR #52 commit 23077b60; the deleted-Act collision as a
	// follow-on P1 on commit a9c550f; the IEEE-754 collapse of the original
	// constant-offset parking (1e15) as a third P1 on commit adb43e0.
	//
	// 2026-06 perf audit: each phase is ONE VALUES-join UPDATE instead of one
	// statement per row — an Act reorder over a map with N anchors previously
	// issued 2N sequential round trips inside the cascade transaction. The
	// user scope joins world_maps.user_id directly (same self-enforcing
	// posture as loadUserMapIds, without an array parameter).
	// Phase 1: park (chunked). The park magnitude uses the GLOBAL index
	// (start + local) so parked values stay unique across chunk boundaries.
	for (let start = 0; start < updates.length; start += BULK_UPDATE_CHUNK) {
		const slice = updates.slice(start, start + BULK_UPDATE_CHUNK);
		const parkValues = sql.join(
			slice.map(
				(u, j) => sql`(${u.id}::uuid, ${ANCHOR_PARK_BASE - (start + j)}::double precision)`
			),
			sql`, `
		);
		await db.execute(sql`
			UPDATE ${mapAnchors}
			SET t_position = v.t_position
			FROM (VALUES ${parkValues}) AS v(id, t_position), ${worldMaps}
			WHERE ${mapAnchors.id} = v.id
				AND ${mapAnchors.worldMapId} = ${worldMaps.id}
				AND ${worldMaps.userId} = ${userId}
		`);
	}
	// Phase 2: write final values (chunked). All to-be-updated rows are parked at
	// negatives, so the positive range is empty and no chunk boundary creates an
	// intermediate UNIQUE-index collision.
	for (const slice of chunked(updates, BULK_UPDATE_CHUNK)) {
		const finalValues = sql.join(
			slice.map((u) => sql`(${u.id}::uuid, ${u.newT}::double precision)`),
			sql`, `
		);
		await db.execute(sql`
			UPDATE ${mapAnchors}
			SET t_position = v.t_position
			FROM (VALUES ${finalValues}) AS v(id, t_position), ${worldMaps}
			WHERE ${mapAnchors.id} = v.id
				AND ${mapAnchors.worldMapId} = ${worldMaps.id}
				AND ${worldMaps.userId} = ${userId}
		`);
	}
	return updates.length;
}

async function recomputeMapEvents(
	db: Db,
	userId: string,
	preSnapshot: ActOrderingSnapshot,
	cache: RecomputeCache
): Promise<number> {
	const userMapIds = await loadUserMapIds(db, userId);
	if (userMapIds.length === 0) return 0;
	const rows = await db
		.select({ id: mapEvents.id, tPosition: mapEvents.tPosition })
		.from(mapEvents)
		.where(inArray(mapEvents.worldMapId, userMapIds));

	const updates: { id: string; newT: number }[] = [];
	const deletes: string[] = [];
	for (const row of rows) {
		const action = classifyTPosition(row.tPosition, preSnapshot, cache);
		if (action.kind === 'delete') {
			deletes.push(row.id);
			continue;
		}
		if (action.kind === 'skip') continue;
		if (Math.abs(action.newT - row.tPosition) <= POSITION_EPSILON) continue;
		updates.push({ id: row.id, newT: action.newT });
	}

	// Drop events whose Act was deleted. map_events has no UNIQUE index on
	// (world_map_id, t_position) so this isn't a correctness fix — it's a
	// semantic fix: an event referencing a no-longer-existing Act slot is
	// orphaned history. Matches the policy applied to anchors above.
	if (deletes.length > 0) {
		// Chunked (2026-06 follow-up): every paint stroke is a map_events row, so a
		// painted map can exceed the 65535 bind-param ceiling on a single inArray —
		// same reason the bulk UPDATE below is chunked.
		for (const slice of chunked(deletes, BULK_UPDATE_CHUNK)) {
			await db
				.delete(mapEvents)
				.where(and(inArray(mapEvents.id, slice), inArray(mapEvents.worldMapId, userMapIds)));
		}
	}

	// map_events has no unique index; a single VALUES-join UPDATE is safe and
	// avoids one round trip per row (2026-06 perf audit — every paint stroke
	// is a map_events row, so this loop dominated Act-reorder latency on
	// painted maps).
	// Chunked single-phase UPDATE (map_events has no unique index, so no parking
	// is needed; chunking only bounds the bind-parameter count per statement).
	for (const slice of chunked(updates, BULK_UPDATE_CHUNK)) {
		const eventValues = sql.join(
			slice.map((u) => sql`(${u.id}::uuid, ${u.newT}::double precision)`),
			sql`, `
		);
		await db.execute(sql`
			UPDATE ${mapEvents}
			SET t_position = v.t_position
			FROM (VALUES ${eventValues}) AS v(id, t_position), ${worldMaps}
			WHERE ${mapEvents.id} = v.id
				AND ${mapEvents.worldMapId} = ${worldMaps.id}
				AND ${worldMaps.userId} = ${userId}
		`);
	}
	return updates.length;
}
