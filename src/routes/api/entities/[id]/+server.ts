import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { getUserId } from '$lib/server/auth-gate.js';
import { recomputeAllIntervals, recomputeIntervalsForAct } from '$lib/server/intervals.js';
import { intervals as intervalsTable } from '$lib/server/db/schema.js';
import { and, eq, gt, gte, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [entity] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
	if (!entity) error(404, 'Entity not found');
	return json(entity);
};

/**
 * Patch an entity. Accepts `name`, `data`, `parentId`, `position`.
 * For Acts/Scenes, position changes cascade siblings server-side
 * (locked D18/Issue 12A) and recompute intervals. parentId changes for
 * Scenes trigger a cross-act move via the moveSceneToAct primitive
 * (recompute both old and new parent acts).
 */
export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { name, data, parentId, position } = body as {
		name?: string;
		data?: unknown;
		parentId?: string | null;
		position?: number;
	};

	const [entity] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
	if (!entity) error(404, 'Entity not found');

	// updated_at is maintained by the bump_updated_at BEFORE UPDATE trigger
	// — do not set it here. data is jsonb on pg; pass the object directly.
	const updates: Record<string, unknown> = {};
	if (name !== undefined) updates.name = name.trim();
	if (data !== undefined) updates.data = data;

	// parentId change for Scenes: delegate to moveSceneToAct.
	if (parentId !== undefined && parentId !== entity.parentId) {
		if (entity.type !== 'Scene') {
			error(400, 'parentId can only be changed for Scene entities');
		}
		const { moveSceneToAct } = await import('$lib/server/intervals.js');
		const newPos = typeof position === 'number' ? position : 0;
		try {
			await moveSceneToAct(db, event.params.id, parentId as string, newPos, userId);
		} catch (err) {
			error(400, (err as Error).message);
		}
		// moveSceneToAct already updated parent_id + position; apply remaining
		// non-position updates (name, data) if any.
		if (name !== undefined || data !== undefined) {
			await db
				.update(entities)
				.set(updates)
				.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
		}
		const [refreshed] = await db
			.select()
			.from(entities)
			.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
		return json(refreshed);
	}

	// Position change — cascade siblings if same parent context (D18/12A).
	// userId in WHERE: critical — User A's reorder must not bump User B's
	// siblings (especially for Acts where parentId is null).
	let didPositionCascade = false;
	if (
		position !== undefined &&
		position !== entity.position &&
		(entity.type === 'Act' || entity.type === 'Scene')
	) {
		const oldPos = entity.position;
		didPositionCascade = true;

		// Sibling-set predicate for the generalized cascade primitive (D18).
		const siblingFilter =
			entity.type === 'Act'
				? and(eq(entities.userId, userId), eq(entities.type, 'Act'), isNull(entities.parentId))
				: and(eq(entities.userId, userId), eq(entities.type, 'Scene'), eq(entities.parentId, entity.parentId!));

		if (oldPos === null) {
			// Position was null — treat as appending at the end. Just set it.
		} else if (position < oldPos) {
			await db
				.update(entities)
				.set({
					position: sql`${entities.position} + 1` as unknown as number,
				})
				.where(
					and(
						siblingFilter,
						ne(entities.id, event.params.id),
						gte(entities.position, position),
						lt(entities.position, oldPos)
					)
				);
		} else {
			await db
				.update(entities)
				.set({
					position: sql`${entities.position} - 1` as unknown as number,
				})
				.where(
					and(
						siblingFilter,
						ne(entities.id, event.params.id),
						gt(entities.position, oldPos),
						lte(entities.position, position)
					)
				);
		}
		updates.position = position;
	} else if (position !== undefined) {
		updates.position = position;
	}

	const [updated] = await db
		.update(entities)
		.set(updates)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)))
		.returning();

	// Recompute after position cascade. Acts → all intervals; Scenes → just
	// the parent act's intervals.
	if (didPositionCascade) {
		if (entity.type === 'Act') {
			await recomputeAllIntervals(db, userId);
		} else if (entity.type === 'Scene' && entity.parentId) {
			await recomputeIntervalsForAct(db, entity.parentId, userId);
		}
	}

	return json(updated);
};

/**
 * Delete an entity. For Acts, optionally accepts ?moveScenesTo=<actId>
 * to reparent the act's scenes to another act before cascade-deleting
 * (D9/7B). Without the param, scenes cascade-delete via FK. Either way,
 * surviving intervals are recomputed.
 *
 * P2-3 fix: when reparenting, intervals' start_act_id / end_act_id are
 * updated for any interval anchored to a reparented scene.
 */
export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [entity] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
	if (!entity) error(404, 'Entity not found');

	const moveScenesTo = event.url.searchParams.get('moveScenesTo');

	if (moveScenesTo && entity.type === 'Act') {
		if (moveScenesTo === event.params.id) {
			error(400, 'moveScenesTo target must differ from the act being deleted');
		}
		const [target] = await db
			.select()
			.from(entities)
			.where(and(eq(entities.id, moveScenesTo), eq(entities.userId, userId)));
		if (!target) {
			error(400, `moveScenesTo target not found: ${moveScenesTo}`);
		}
		if (target.type !== 'Act') {
			error(400, `moveScenesTo target must be an Act (got type='${target.type}')`);
		}

		// Count target's existing scenes to compute append offset.
		const sourceScenes = await db
			.select()
			.from(entities)
			.where(and(eq(entities.userId, userId), eq(entities.type, 'Scene'), eq(entities.parentId, event.params.id)))
			.orderBy(entities.position, entities.createdAt);
		const targetScenes = await db
			.select({ id: entities.id })
			.from(entities)
			.where(and(eq(entities.userId, userId), eq(entities.type, 'Scene'), eq(entities.parentId, moveScenesTo)));
		const offset = targetScenes.length;

		// Reparent each scene + update interval FKs (P2-3).
		for (let i = 0; i < sourceScenes.length; i++) {
			const scene = sourceScenes[i];
			await db
				.update(entities)
				.set({
					parentId: moveScenesTo,
					position: offset + i,
				})
				.where(and(eq(entities.id, scene.id), eq(entities.userId, userId)));
			await db
				.update(intervalsTable)
				.set({
					startActId: moveScenesTo,
				})
				.where(and(eq(intervalsTable.startSceneId, scene.id), eq(intervalsTable.userId, userId)));
			await db
				.update(intervalsTable)
				.set({
					endActId: moveScenesTo,
				})
				.where(and(eq(intervalsTable.endSceneId, scene.id), eq(intervalsTable.userId, userId)));
		}
	}

	// Pre-rescope intervals touching this act before the cascade deletes them.
	// FK is onDelete: 'cascade', so any interval with startActId or endActId
	// pointing here would otherwise be removed entirely. Instead, reassign
	// the boundary to the adjacent surviving act so the character/event
	// scope shrinks rather than disappearing. Intervals fully contained in
	// this act (both ends here) cannot be salvaged and still get deleted.
	if (entity.type === 'Act') {
		const allActs = await db
			.select({ id: entities.id, position: entities.position, createdAt: entities.createdAt })
			.from(entities)
			.where(and(eq(entities.userId, userId), eq(entities.type, 'Act'), isNull(entities.parentId)))
			.orderBy(entities.position, entities.createdAt);
		const deletedIdx = allActs.findIndex((a) => a.id === event.params.id);
		if (deletedIdx >= 0 && allActs.length > 1) {
			const prevAct = deletedIdx > 0 ? allActs[deletedIdx - 1] : null;
			const nextAct = deletedIdx < allActs.length - 1 ? allActs[deletedIdx + 1] : null;

			const touched = await db
				.select()
				.from(intervalsTable)
				.where(
					and(
						eq(intervalsTable.userId, userId),
						or(
							eq(intervalsTable.startActId, event.params.id),
							eq(intervalsTable.endActId, event.params.id)
						)
					)
				);

			for (const iv of touched) {
				const startInDeleted = iv.startActId === event.params.id;
				const endInDeleted = iv.endActId === event.params.id;

				// Both endpoints in the deleted act → no salvageable scope.
				if (startInDeleted && endInDeleted) {
					await db
						.delete(intervalsTable)
						.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
					continue;
				}

				if (endInDeleted) {
					// Clamp end to end-of-prev-act. If no prev, no salvage.
					if (!prevAct) {
						await db
							.delete(intervalsTable)
							.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
						continue;
					}
					/* Use the ordered-list index, not the stored `position` column — the
					   interval-position system is built on actIndexOf's rank-in-query-order.
					   If `entities.position` drifts (null row, manual DB edit, cascade bug),
					   column-based math would silently rescope to the wrong story-time slot.
					   prevAct's index in the pre-delete ordering = deletedIdx-1, which equals
					   its post-delete index too (deleting a later row doesn't shift earlier
					   rows). end-of-prevAct = idx + 1. */
					const newEndPos = deletedIdx;
					await db
						.update(intervalsTable)
						.set({
							endActId: prevAct.id,
							endSceneId: null,
							endPosition: newEndPos,
						})
						.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
				}

				if (startInDeleted) {
					// Clamp start to start-of-next-act. If no next, no salvage.
					if (!nextAct) {
						await db
							.delete(intervalsTable)
							.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
						continue;
					}
					/* nextAct's pre-delete index = deletedIdx+1; post-delete it shifts down
					   to deletedIdx because the deleted act is removed. Using the post-delete
					   index means recomputeAllIntervals finds no drift to correct. */
					const newStartPos = deletedIdx;
					await db
						.update(intervalsTable)
						.set({
							startActId: nextAct.id,
							startSceneId: null,
							startPosition: newStartPos,
						})
						.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
				}
			}
		}
	}

	// FK CASCADE removes remaining scenes and any fully-contained intervals already deleted above.
	await db
		.delete(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));

	// Recompute survivors. Act delete shifts every act's index; recompute all.
	if (entity.type === 'Act') {
		await recomputeAllIntervals(db, userId);
	} else if (entity.type === 'Scene' && entity.parentId) {
		await recomputeIntervalsForAct(db, entity.parentId, userId);
	}

	return new Response(null, { status: 204 });
};
