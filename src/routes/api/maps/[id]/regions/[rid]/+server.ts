import { json, error } from '@sveltejs/kit';
import { mapRegions, worldMaps, entities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { isSelfIntersecting } from '$lib/server/validation.js';
import { ensurePartOf, removeImpliedPartOf } from '$lib/server/location-hierarchy.js';
import type { RequestHandler } from './$types';

/**
 * mapRegions has no direct userId column — scoped via JOIN on
 * worldMaps.userId. Verify the parent map belongs to the user before any
 * operation. Cross-user access returns 404 (no existence leak).
 */
async function assertOwnedRegion(
	db: App.Locals['db'],
	mapId: string,
	regionId: string,
	userId: string
) {
	const [row] = await db
		.select({ region: mapRegions })
		.from(mapRegions)
		.innerJoin(worldMaps, eq(worldMaps.id, mapRegions.mapId))
		.where(
			and(
				eq(mapRegions.id, regionId),
				eq(mapRegions.mapId, mapId),
				eq(worldMaps.userId, userId)
			)
		);
	return row?.region ?? null;
}

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const region = await assertOwnedRegion(db, event.params.id, event.params.rid, userId);
	if (!region) error(404, 'Region not found');

	const body = await event.request.json();
	const updates: Record<string, unknown> = {};

	if (body.locationId === null) updates.locationId = null;
	else if (typeof body.locationId === 'string') {
		// Verify locationId belongs to user.
		const [loc] = await db
			.select({ id: entities.id })
			.from(entities)
			.where(and(eq(entities.id, body.locationId), eq(entities.userId, userId)));
		if (!loc) error(400, 'Location not found');
		updates.locationId = body.locationId;
	}

	if (typeof body.color === 'string') updates.color = body.color;
	if (body.color === null) updates.color = null;

	if (Array.isArray(body.polygon)) {
		if (body.polygon.length < 3) error(400, 'Polygon must have at least 3 vertices');
		if (body.polygon.length > 500) error(400, 'Polygon must have at most 500 vertices');
		if (
			!body.polygon.every(
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
		if (isSelfIntersecting(body.polygon)) error(400, 'Polygon must not be self-intersecting');
		updates.polygon = body.polygon;
	}

	if (Object.keys(updates).length === 0) error(400, 'No valid fields to update');

	// Region UPDATE + part_of remove/upsert are atomic. Otherwise a partial
	// failure (ensurePartOf rejects on cycle/single-parent) leaves the region
	// pointing at the new location with the old implied edge gone and no new
	// one in place.
	let updated;
	try {
		updated = await db.transaction(async (tx) => {
			const [row] = await tx
				.update(mapRegions)
				.set(updates)
				.where(eq(mapRegions.id, event.params.rid))
				.returning();

			const locationChanged =
				'locationId' in updates && updates.locationId !== region.locationId;
			if (locationChanged) {
				const [parentMap] = await tx
					.select({ locationId: worldMaps.locationId })
					.from(worldMaps)
					.where(eq(worldMaps.id, event.params.id));
				if (parentMap?.locationId && region.locationId) {
					await removeImpliedPartOf(tx, userId, region.locationId, parentMap.locationId);
				}
				if (parentMap?.locationId && typeof updates.locationId === 'string') {
					await ensurePartOf(tx, userId, updates.locationId, parentMap.locationId);
				}
			}
			return row;
		});
	} catch (err) {
		const status = (err as { status?: number }).status;
		if (typeof status === 'number') throw err;
		error(400, (err as Error).message);
	}

	return json(updated);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const region = await assertOwnedRegion(db, event.params.id, event.params.rid, userId);
	if (!region) error(404, 'Region not found');

	// Region DELETE + implied edge cleanup are atomic. The orphan check
	// (cross-map sibling lookup) and the edge delete must see a consistent
	// view: if a concurrent region INSERT lands between them outside a tx,
	// we could wrongly drop an edge that should still hold.
	await db.transaction(async (tx) => {
		await tx.delete(mapRegions).where(eq(mapRegions.id, event.params.rid));
		if (region.locationId) {
			const [parentMap] = await tx
				.select({ locationId: worldMaps.locationId })
				.from(worldMaps)
				.where(eq(worldMaps.id, event.params.id));
			if (parentMap?.locationId) {
				await removeImpliedPartOf(tx, userId, region.locationId, parentMap.locationId);
			}
		}
	});

	return new Response(null, { status: 204 });
};
