import { json, error } from '@sveltejs/kit';
import { worldMaps, mapRegions, entities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { isSelfIntersecting } from '$lib/server/validation.js';
import { ensurePartOf } from '$lib/server/location-hierarchy.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);

	// Verify map exists AND belongs to user.
	const [map] = await db
		.select()
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)));
	if (!map) error(404, 'Map not found');

	const body = await event.request.json();
	const { locationId, polygon, color } = body;

	if (!Array.isArray(polygon) || polygon.length < 3) {
		error(400, 'Polygon must have at least 3 vertices');
	}
	if (polygon.length > 500) {
		error(400, 'Polygon must have at most 500 vertices');
	}
	if (
		!polygon.every(
			(v: unknown) =>
				Array.isArray(v) &&
				v.length >= 2 &&
				typeof v[0] === 'number' &&
				typeof v[1] === 'number' &&
				isFinite(v[0]) &&
				isFinite(v[1])
		)
	) {
		error(400, 'Each polygon vertex must be [number, number]');
	}
	if (isSelfIntersecting(polygon)) {
		error(400, 'Polygon must not be self-intersecting');
	}

	// Verify locationId belongs to user when supplied.
	if (typeof locationId === 'string') {
		const [loc] = await db
			.select({ id: entities.id })
			.from(entities)
			.where(and(eq(entities.id, locationId), eq(entities.userId, userId)));
		if (!loc) error(400, 'Location not found');
	}

	const values: typeof mapRegions.$inferInsert = {
		mapId: event.params.id,
		polygon
	};
	if (typeof locationId === 'string') values.locationId = locationId;
	if (typeof color === 'string') values.color = color;

	let created;
	try {
		[created] = await db.insert(mapRegions).values(values).returning();
	} catch (err) {
		error(400, (err as Error).message);
	}

	// Linking a region to a Location implies that Location is part_of the
	// map's anchor Location. Upsert the part_of edge so breadcrumbs and
	// drill-down reflect the hierarchy the user just authored.
	if (typeof locationId === 'string' && map.locationId) {
		await ensurePartOf(db, userId, locationId, map.locationId);
	}

	return json(created, { status: 201 });
};
