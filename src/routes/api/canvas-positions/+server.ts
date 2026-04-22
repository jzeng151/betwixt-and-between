import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { canvasPositions, entities } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const rows = await db.select().from(canvasPositions);
	return json(rows);
};

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { entityId, x, y, width, height } = body;

	if (!entityId) error(400, 'entityId is required');

	const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
	if (!entity) error(400, 'Entity not found');

	const [upserted] = await db
		.insert(canvasPositions)
		.values({
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
