import { json, error } from '@sveltejs/kit';
import { worldMaps, mapRegions } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { assertLocationIdIsLocation } from '$lib/server/world-maps.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [map] = await db
		.select()
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)));
	if (!map) error(404, 'Map not found');

	// mapRegions has no direct userId — scoped via worldMaps.userId already verified above.
	const regions = await db
		.select()
		.from(mapRegions)
		.where(eq(mapRegions.mapId, event.params.id));

	return json({ ...map, regions });
};

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();

	const updates: Record<string, unknown> = {};
	if (typeof body.name === 'string') updates.name = body.name.trim();
	if (typeof body.baseImageUrl === 'string') updates.baseImageUrl = body.baseImageUrl;
	if (typeof body.width === 'number') updates.width = body.width;
	if (typeof body.height === 'number') updates.height = body.height;
	// locationId: explicit presence (including null) is meaningful — null means unlink.
	// location_inactive_at is managed by the world_maps_stamp_location_inactive_at
	// trigger (migration 0008) so every unlink path — user PATCH, ON DELETE SET NULL
	// cascade — stamps uniformly.
	if ('locationId' in body) {
		await assertLocationIdIsLocation(db, userId, body.locationId);
		updates.locationId = body.locationId ?? null;
	}

	if (Object.keys(updates).length === 0) {
		error(400, 'No valid fields to update');
	}

	const [updated] = await db
		.update(worldMaps)
		.set(updates)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)))
		.returning();

	if (!updated) error(404, 'Map not found');
	return json(updated);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [deleted] = await db
		.delete(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)))
		.returning();

	if (!deleted) error(404, 'Map not found');
	return new Response(null, { status: 204 });
};
