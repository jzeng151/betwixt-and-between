import { json, error } from '@sveltejs/kit';
import { canvasPositions, entities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const rows = await db
		.select()
		.from(canvasPositions)
		.where(eq(canvasPositions.userId, userId));
	return json(rows);
};

export const PUT: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { entityId, x, y, width, height } = body;

	if (!entityId) error(400, 'entityId is required');

	// Verify entity belongs to user (cross-user FK = leak).
	const [entity] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, entityId), eq(entities.userId, userId)));
	if (!entity) error(400, 'Entity not found');

	const [upserted] = await db
		.insert(canvasPositions)
		.values({
			userId,
			entityId,
			x: x ?? 0,
			y: y ?? 0,
			width: width ?? 160,
			height: height ?? 80
		})
		.onConflictDoUpdate({
			target: canvasPositions.entityId,
			set: {
				x: x ?? 0,
				y: y ?? 0,
				width: width ?? 160,
				height: height ?? 80
			}
		})
		.returning();

	return json(upserted);
};
