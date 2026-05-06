import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db/index.js';
import { intervals } from '$lib/server/db/schema.js';
import { updateInterval } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, params }) => {
	const db = await getDb(platform?.env);
	const [row] = await db.select().from(intervals).where(eq(intervals.id, params.id));
	if (!row) error(404, 'Interval not found');
	return json(row);
};

export const PATCH: RequestHandler = async ({ platform, params, request }) => {
	const db = await getDb(platform?.env);
	const [existing] = await db.select().from(intervals).where(eq(intervals.id, params.id));
	if (!existing) error(404, 'Interval not found');

	const body = await request.json();
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
		const { updated, absorbed } = await updateInterval(db, params.id, {
			entityId: entityId ?? entity_id,
			startActId: startActId ?? start_act_id,
			startSceneId: startSceneId !== undefined ? startSceneId : start_scene_id,
			endActId: endActId ?? end_act_id,
			endSceneId: endSceneId !== undefined ? endSceneId : end_scene_id,
			startPosition: startPosition ?? start_position,
			endPosition: endPosition ?? end_position
		});
		// Embed absorbed IDs in the response so the client can prune any
		// merged-away rows from its store. `absorbed` is empty in the
		// non-merge happy path.
		return json({ ...updated, absorbed });
	} catch (err) {
		error(400, (err as Error).message);
	}
};

export const DELETE: RequestHandler = async ({ platform, params }) => {
	const db = await getDb(platform?.env);
	const [row] = await db.select().from(intervals).where(eq(intervals.id, params.id));
	if (!row) error(404, 'Interval not found');

	await db.delete(intervals).where(eq(intervals.id, params.id));
	return new Response(null, { status: 204 });
};
