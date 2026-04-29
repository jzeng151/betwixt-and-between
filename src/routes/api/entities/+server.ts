import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { entities } from '$lib/server/db/schema.js';
import { EntityType } from '$lib/server/db/schema.js';
import { recomputeIntervalsForAct } from '$lib/server/intervals.js';
import { desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const rows = await db.select().from(entities).orderBy(desc(entities.createdAt));
	return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { type, name, data, parentId, position } = body;

	if (!type || !EntityType.includes(type)) {
		error(400, 'Invalid entity type');
	}
	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}

	const [created] = await db
		.insert(entities)
		.values({
			type,
			name: name.trim(),
			data: data ? JSON.stringify(data) : '{}',
			parentId: typeof parentId === 'string' ? parentId : null,
			position: typeof position === 'number' ? position : null
		})
		.returning();

	// When a Scene is added to an Act, recompute interval positions for that act
	// (m changed → all scene-anchored intervals in the act shift).
	if (type === 'Scene' && created.parentId) {
		await recomputeIntervalsForAct(db, created.parentId);
	}

	return json(created, { status: 201 });
};
