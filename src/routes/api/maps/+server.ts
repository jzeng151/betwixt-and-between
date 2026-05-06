import { json, error } from '@sveltejs/kit';
import { withDb } from '$lib/server/db/index.js';
import { worldMaps } from '$lib/server/db/schema.js';
import { desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) =>
	withDb(platform?.env, async (db) => {
	const rows = await db.select().from(worldMaps).orderBy(desc(worldMaps.createdAt));
	return json(rows);

	});

export const POST: RequestHandler = async ({ platform, request }) =>
	withDb(platform?.env, async (db) => {
	const body = await request.json();
	const { name } = body;

	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}

	const [created] = await db
		.insert(worldMaps)
		.values({ name: name.trim() })
		.returning();

	return json(created, { status: 201 });

	});
