import { json, error } from '@sveltejs/kit';
import { worldMaps } from '$lib/server/db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const rows = await db
		.select()
		.from(worldMaps)
		.where(eq(worldMaps.userId, userId))
		.orderBy(desc(worldMaps.createdAt));
	return json(rows);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { name } = body;

	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}

	const [created] = await db
		.insert(worldMaps)
		.values({ userId, name: name.trim() })
		.returning();

	return json(created, { status: 201 });
};
