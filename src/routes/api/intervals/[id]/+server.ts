import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { intervals } from '$lib/server/db/schema.js';
import { getUserId } from '$lib/server/auth-gate.js';
import { updateInterval } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [row] = await db
		.select()
		.from(intervals)
		.where(and(eq(intervals.id, event.params.id), eq(intervals.userId, userId)));
	if (!row) error(404, 'Interval not found');
	return json(row);
};

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [existing] = await db
		.select()
		.from(intervals)
		.where(and(eq(intervals.id, event.params.id), eq(intervals.userId, userId)));
	if (!existing) error(404, 'Interval not found');

	const body = await event.request.json();
	const {
		entity_id,
		entityId,
		start_act_id,
		startActId,
		start_scene_id,
		startSceneId,
		end_act_id,
		endActId,
		end_scene_id,
		endSceneId,
		start_position,
		startPosition,
		end_position,
		endPosition
	} = body;

	try {
		const { updated, absorbed } = await updateInterval(
			db,
			event.params.id,
			{
				entityId: entityId ?? entity_id,
				startActId: startActId ?? start_act_id,
				startSceneId: startSceneId !== undefined ? startSceneId : start_scene_id,
				endActId: endActId ?? end_act_id,
				endSceneId: endSceneId !== undefined ? endSceneId : end_scene_id,
				startPosition: startPosition ?? start_position,
				endPosition: endPosition ?? end_position
			},
			userId
		);
		// Embed absorbed IDs in the response so the client can prune any
		// merged-away rows from its store. `absorbed` is empty in the
		// non-merge happy path.
		return json({ ...updated, absorbed });
	} catch (err) {
		error(400, (err as Error).message);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [deleted] = await db
		.delete(intervals)
		.where(and(eq(intervals.id, event.params.id), eq(intervals.userId, userId)))
		.returning();
	if (!deleted) error(404, 'Interval not found');
	return new Response(null, { status: 204 });
};
