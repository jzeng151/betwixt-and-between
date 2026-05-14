import { json, error } from '@sveltejs/kit';
import { worldMaps, mapRegions } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import {
	assertLocationIdIsLocation,
	assertWorldMapVariantBounds,
	resolveWorldMapVariantBounds
} from '$lib/server/world-maps.js';
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

	const [existing] = await db
		.select()
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)));
	if (!existing) error(404, 'Map not found');

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

	// Variant bounds: explicit presence of any of the four FKs triggers re-derivation.
	// Scene FKs without their parent Act FK are auto-cleared, mirroring the
	// relationship PATCH's "clearing an act FK must also clear its scene FK" rule.
	const variantTouched =
		'startActId' in body ||
		'startSceneId' in body ||
		'endActId' in body ||
		'endSceneId' in body;

	if (variantTouched) {
		const mergedStartActId =
			'startActId' in body ? (body.startActId ?? null) : existing.startActId;
		const mergedStartSceneId =
			mergedStartActId === null
				? null
				: 'startSceneId' in body
					? (body.startSceneId ?? null)
					: existing.startSceneId;
		const mergedEndActId =
			'endActId' in body ? (body.endActId ?? null) : existing.endActId;
		const mergedEndSceneId =
			mergedEndActId === null
				? null
				: 'endSceneId' in body
					? (body.endSceneId ?? null)
					: existing.endSceneId;

		await assertWorldMapVariantBounds(db, userId, {
			startActId: mergedStartActId,
			startSceneId: mergedStartSceneId,
			endActId: mergedEndActId,
			endSceneId: mergedEndSceneId
		});

		let startPosition: number | null = null;
		let endPosition: number | null = null;
		try {
			const bounds = await resolveWorldMapVariantBounds(
				db,
				{
					startActId: mergedStartActId,
					startSceneId: mergedStartSceneId,
					endActId: mergedEndActId,
					endSceneId: mergedEndSceneId
				},
				userId
			);
			startPosition = bounds.startPosition;
			endPosition = bounds.endPosition;
		} catch (err) {
			error(400, (err as Error).message);
		}

		updates.startActId = mergedStartActId;
		updates.startSceneId = mergedStartSceneId;
		updates.endActId = mergedEndActId;
		updates.endSceneId = mergedEndSceneId;
		updates.startPosition = startPosition;
		updates.endPosition = endPosition;
	}

	if (Object.keys(updates).length === 0) {
		error(400, 'No valid fields to update');
	}

	let updated;
	try {
		[updated] = await db
			.update(worldMaps)
			.set(updates)
			.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)))
			.returning();
	} catch (err) {
		const code = (err as { code?: string }).code ?? '';
		const msg = (err as Error).message ?? '';
		if (code === '23P01' || msg.includes('world_maps_variant_no_overlap')) {
			error(409, 'A variant for this Location already covers part of that range');
		}
		if (code === '23505' || msg.includes('world_maps_one_default_per_location')) {
			error(409, 'A default variant for this Location already exists');
		}
		if (code === '23514' || msg.includes('world_maps_variant_position_order')) {
			error(400, 'Variant start_position must be strictly less than end_position');
		}
		throw err;
	}

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
