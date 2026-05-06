import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { worldMaps, mapRegions } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { isSelfIntersecting } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	// Verify map exists
	const [map] = await db.select().from(worldMaps).where(eq(worldMaps.id, params.id));
	if (!map) error(404, 'Map not found');

	const body = await request.json();
	const { locationId, polygon, color } = body;

	// Validate polygon
	if (!Array.isArray(polygon) || polygon.length < 3) {
		error(400, 'Polygon must have at least 3 vertices');
	}
	if (polygon.length > 500) {
		error(400, 'Polygon must have at most 500 vertices');
	}
	if (!polygon.every((v: any) => Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && isFinite(v[0]) && isFinite(v[1]))) {
		error(400, 'Each polygon vertex must be [number, number]');
	}
	if (isSelfIntersecting(polygon)) {
		error(400, 'Polygon must not be self-intersecting');
	}

	const values: typeof mapRegions.$inferInsert = {
		mapId: params.id,
		polygon,
	};
	if (typeof locationId === 'string') values.locationId = locationId;
	if (typeof color === 'string') values.color = color;

	try {
		const [created] = await db.insert(mapRegions).values(values).returning();
		return json(created, { status: 201 });
	} catch (err) {
		error(400, (err as Error).message);
	}
};
