import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { withDb } from '$lib/server/db/index.js';
import { intervals } from '$lib/server/db/schema.js';
import { writeInterval } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url }) =>
	withDb(platform?.env, async (db) => {
	const entityId = url.searchParams.get('entity_id');
	if (entityId) {
		const rows = await db
			.select()
			.from(intervals)
			.where(eq(intervals.entityId, entityId))
			.orderBy(intervals.startPosition);
		return json(rows);
	}
	const rows = await db.select().from(intervals).orderBy(intervals.startPosition);
	return json(rows);

	});

export const POST: RequestHandler = async ({ platform, request }) =>
	withDb(platform?.env, async (db) => {
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

	const eId = entityId ?? entity_id;
	const sActId = startActId ?? start_act_id;
	const sSceneId = startSceneId ?? start_scene_id;
	const eActId = endActId ?? end_act_id;
	const eSceneId = endSceneId ?? end_scene_id;
	const sPos = startPosition ?? start_position;
	const ePos = endPosition ?? end_position;

	if (!eId) error(400, 'entity_id is required');
	if (!sActId) error(400, 'start_act_id is required');
	if (!eActId) error(400, 'end_act_id is required');

	try {
		const created = await writeInterval(db, {
			entityId: eId,
			startActId: sActId,
			startSceneId: sSceneId ?? null,
			endActId: eActId,
			endSceneId: eSceneId ?? null,
			startPosition: sPos,
			endPosition: ePos
		});
		return json(created, { status: 201 });
	} catch (err) {
		const message = (err as Error).message;
		// Polymorphic FK violations, position drift, scene-parent mismatch all
		// raise from writeInterval. Surface as 400 with the message.
		error(400, message);
	}

	});
