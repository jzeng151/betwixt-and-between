import { json, error } from '@sveltejs/kit';
import { withDb } from '$lib/server/db/index.js';
import { worldMaps, mapRegions } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, params }) =>
	withDb(platform?.env, async (db) => {
	const [map] = await db.select().from(worldMaps).where(eq(worldMaps.id, params.id));
	if (!map) error(404, 'Map not found');

	const regions = await db
		.select()
		.from(mapRegions)
		.where(eq(mapRegions.mapId, params.id));

	return json({ ...map, regions });

	});

export const PATCH: RequestHandler = async ({ platform, params, request }) =>
	withDb(platform?.env, async (db) => {
	const body = await request.json();

	const updates: Record<string, unknown> = {};
	if (typeof body.name === 'string') updates.name = body.name.trim();
	if (typeof body.baseImageUrl === 'string') updates.baseImageUrl = body.baseImageUrl;
	if (typeof body.width === 'number') updates.width = body.width;
	if (typeof body.height === 'number') updates.height = body.height;

	if (Object.keys(updates).length === 0) {
		error(400, 'No valid fields to update');
	}

	const [updated] = await db
		.update(worldMaps)
		.set(updates)
		.where(eq(worldMaps.id, params.id))
		.returning();

	if (!updated) error(404, 'Map not found');
	return json(updated);

	});

export const DELETE: RequestHandler = async ({ platform, params }) =>
	withDb(platform?.env, async (db) => {
	const [deleted] = await db
		.delete(worldMaps)
		.where(eq(worldMaps.id, params.id))
		.returning();

	if (!deleted) error(404, 'Map not found');
	return new Response(null, { status: 204 });

	});
