import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { entities } from '$lib/server/db/schema.js';
import { recomputeAllIntervals, recomputeIntervalsForAct } from '$lib/server/intervals.js';
import { intervals as intervalsTable } from '$lib/server/db/schema.js';
import { and, eq, gt, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const [entity] = await db.select().from(entities).where(eq(entities.id, params.id));
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
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const { name, data, parentId, position } = body as {
		name?: string;
		data?: unknown;
		parentId?: string | null;
		position?: number;
	};

	const [entity] = await db.select().from(entities).where(eq(entities.id, params.id));
	if (!entity) error(404, 'Entity not found');

	const updates: Record<string, unknown> = {
		updatedAt: sql`(unixepoch())`
	};
	if (name !== undefined) updates.name = name.trim();
	if (data !== undefined) updates.data = JSON.stringify(data);

	// parentId change (Scene cross-act move). Defer to moveSceneToAct primitive
	// for the full cascade (interval FK fix-up + recompute both parents).
	if (parentId !== undefined && parentId !== entity.parentId) {
		if (entity.type !== 'Scene') {
			error(400, 'parentId can only be changed for Scene entities');
		}
		const { moveSceneToAct } = await import('$lib/server/intervals.js');
		const newPos = typeof position === 'number' ? position : 0;
		try {
			await moveSceneToAct(db, params.id, parentId as string, newPos);
		} catch (err) {
			error(400, (err as Error).message);
		}
		// moveSceneToAct already updated parent_id + position; apply remaining
		// non-position updates (name, data) if any.
		if (name !== undefined || data !== undefined) {
			await db.update(entities).set(updates).where(eq(entities.id, params.id));
		}
		const [refreshed] = await db.select().from(entities).where(eq(entities.id, params.id));
		return json(refreshed);
	}

	// Position change — cascade siblings if same parent context (D18/12A).
	let didPositionCascade = false;
	if (
		position !== undefined &&
		position !== entity.position &&
		(entity.type === 'Act' || entity.type === 'Scene')
	) {
		const oldPos = entity.position;
		didPositionCascade = true;

		// Build the sibling-set predicate per the generalized cascade primitive
		// (CONSIDERATIONS D18). For Acts: parent_id IS NULL AND type='Act'.
		// For Scenes: parent_id = entity.parentId AND type='Scene'.
		const siblingFilter =
			entity.type === 'Act'
				? and(eq(entities.type, 'Act'), isNull(entities.parentId))
				: and(eq(entities.type, 'Scene'), eq(entities.parentId, entity.parentId!));

		if (oldPos === null) {
			// Position was null — treat as appending at the end. Just set it.
		} else if (position < oldPos) {
			// Bump siblings in [position, oldPos) by +1.
			await db
				.update(entities)
				.set({
					position: sql`${entities.position} + 1` as unknown as number,
					updatedAt: sql`(unixepoch())` as unknown as Date
				})
				.where(
					and(
						siblingFilter,
						ne(entities.id, params.id),
						gte(entities.position, position),
						lt(entities.position, oldPos)
					)
				);
		} else {
			// position > oldPos — bump siblings in (oldPos, position] by -1.
			await db
				.update(entities)
				.set({
					position: sql`${entities.position} - 1` as unknown as number,
					updatedAt: sql`(unixepoch())` as unknown as Date
				})
				.where(
					and(
						siblingFilter,
						ne(entities.id, params.id),
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
		.where(eq(entities.id, params.id))
		.returning();

	// Recompute after position cascade. Acts → all intervals; Scenes → just
	// the parent act's intervals.
	if (didPositionCascade) {
		if (entity.type === 'Act') {
			await recomputeAllIntervals(db);
		} else if (entity.type === 'Scene' && entity.parentId) {
			await recomputeIntervalsForAct(db, entity.parentId);
		}
	}

	return json(updated);
};

// drizzle-orm exposes lte under a different export — alias here.
function lte(col: typeof entities.position, val: number) {
	return sql`${col} <= ${val}`;
}

/**
 * Delete an entity. For Acts, optionally accepts ?moveScenesTo=<actId>
 * to reparent the act's scenes to another act before cascade-deleting
 * (D9/7B). Without the param, scenes cascade-delete via FK. Either way,
 * surviving intervals are recomputed.
 *
 * P2-3 fix: when reparenting, intervals' start_act_id / end_act_id are
 * updated for any interval anchored to a reparented scene.
 */
export const DELETE: RequestHandler = async ({ params, url }) => {
	const [entity] = await db.select().from(entities).where(eq(entities.id, params.id));
	if (!entity) error(404, 'Entity not found');

	const moveScenesTo = url.searchParams.get('moveScenesTo');

	if (moveScenesTo && entity.type === 'Act') {
		// Validate target act.
		if (moveScenesTo === params.id) {
			error(400, 'moveScenesTo target must differ from the act being deleted');
		}
		const [target] = await db.select().from(entities).where(eq(entities.id, moveScenesTo));
		if (!target) {
			error(400, `moveScenesTo target not found: ${moveScenesTo}`);
		}
		if (target.type !== 'Act') {
			error(400, `moveScenesTo target must be an Act (got type='${target.type}')`);
		}

		// Find scenes to reparent + count target's existing scenes for offset.
		const sourceScenes = await db
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, params.id)))
			.orderBy(entities.position, entities.createdAt);
		const targetScenes = await db
			.select({ id: entities.id })
			.from(entities)
			.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, moveScenesTo)));
		const offset = targetScenes.length;

		// Reparent each scene + update interval FKs (P2-3).
		for (let i = 0; i < sourceScenes.length; i++) {
			const scene = sourceScenes[i];
			await db
				.update(entities)
				.set({
					parentId: moveScenesTo,
					position: offset + i,
					updatedAt: sql`(unixepoch())` as unknown as Date
				})
				.where(eq(entities.id, scene.id));
			// Update intervals anchored to this scene.
			await db
				.update(intervalsTable)
				.set({
					startActId: moveScenesTo,
					updatedAt: sql`(unixepoch())` as unknown as Date
				})
				.where(eq(intervalsTable.startSceneId, scene.id));
			await db
				.update(intervalsTable)
				.set({
					endActId: moveScenesTo,
					updatedAt: sql`(unixepoch())` as unknown as Date
				})
				.where(eq(intervalsTable.endSceneId, scene.id));
		}
	}

	// Now delete the entity. FK CASCADE handles intervals + remaining scenes.
	await db.delete(entities).where(eq(entities.id, params.id));

	// Recompute survivors. Act delete shifts every act's index; recompute all.
	if (entity.type === 'Act') {
		await recomputeAllIntervals(db);
	} else if (entity.type === 'Scene' && entity.parentId) {
		await recomputeIntervalsForAct(db, entity.parentId);
	}

	return new Response(null, { status: 204 });
};
