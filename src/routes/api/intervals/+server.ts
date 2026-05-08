import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { intervals } from '$lib/server/db/schema.js';
import { getUserId } from '$lib/server/auth-gate.js';
import { writeInterval } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const entityId = event.url.searchParams.get('entity_id');
	if (entityId) {
		const rows = await db
			.select()
			.from(intervals)
			.where(and(eq(intervals.entityId, entityId), eq(intervals.userId, userId)))
			.orderBy(intervals.startPosition);
		return json(rows);
	}
	const rows = await db
		.select()
		.from(intervals)
		.where(eq(intervals.userId, userId))
		.orderBy(intervals.startPosition);
	return json(rows);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
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
		const created = await writeInterval(
			db,
			{
				entityId: eId,
				startActId: sActId,
				startSceneId: sSceneId ?? null,
				endActId: eActId,
				endSceneId: eSceneId ?? null,
				startPosition: sPos,
				endPosition: ePos
			},
			userId
		);
		return json(created, { status: 201 });
	} catch (err) {
		// writeInterval validates FKs against entities scoped by userId — cross-
		// user FKs surface as "entity_id not found" (400). Position drift,
		// scene-parent mismatch, polymorphic FK violations also raise here.
		error(400, (err as Error).message);
	}
};
