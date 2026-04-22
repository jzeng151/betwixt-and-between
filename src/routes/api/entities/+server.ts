import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { entities } from '$lib/server/db/schema.js';
import { EntityType } from '$lib/server/db/schema.js';
import { desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const rows = await db.select().from(entities).orderBy(desc(entities.createdAt));
	return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { type, name, data } = body;

	if (!type || !EntityType.includes(type)) {
		error(400, 'Invalid entity type');
	}
	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}

	const [created] = await db
		.insert(entities)
		.values({ type, name: name.trim(), data: data ? JSON.stringify(data) : '{}' })
		.returning();

	return json(created, { status: 201 });
};
