import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { mapRegions } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { isSelfIntersecting } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	// Fetch region and verify it belongs to this map
	const [region] = await db
		.select()
		.from(mapRegions)
		.where(eq(mapRegions.id, params.rid));

	if (!region || region.mapId !== params.id) error(404, 'Region not found');

	const body = await request.json();
	const updates: Record<string, unknown> = {};

	if (body.locationId === null) updates.locationId = null;
	else if (typeof body.locationId === 'string') updates.locationId = body.locationId;

	if (typeof body.color === 'string') updates.color = body.color;
	if (body.color === null) updates.color = null;

	if (Array.isArray(body.polygon)) {
		if (body.polygon.length < 3) error(400, 'Polygon must have at least 3 vertices');
		if (body.polygon.length > 500) error(400, 'Polygon must have at most 500 vertices');
		if (!body.polygon.every((v: any) => Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && isFinite(v[0]) && isFinite(v[1]))) {
			error(400, 'Each polygon vertex must be [number, number]');
		}
		if (isSelfIntersecting(body.polygon)) error(400, 'Polygon must not be self-intersecting');
		updates.polygon = body.polygon;
	}

	if (Object.keys(updates).length === 0) error(400, 'No valid fields to update');

	const [updated] = await db
		.update(mapRegions)
		.set(updates)
		.where(eq(mapRegions.id, params.rid))
		.returning();

	return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const [deleted] = await db
		.delete(mapRegions)
		.where(and(eq(mapRegions.id, params.rid), eq(mapRegions.mapId, params.id)))
		.returning({ id: mapRegions.id });

	if (!deleted) error(404, 'Region not found');
	return new Response(null, { status: 204 });
};
