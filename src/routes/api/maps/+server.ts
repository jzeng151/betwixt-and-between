import { json, error } from '@sveltejs/kit';
import { worldMaps } from '$lib/server/db/schema.js';
import { desc, eq } from 'drizzle-orm';
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
	const {
		name,
		locationId,
		startActId,
		startSceneId,
		endActId,
		endSceneId
	} = body;

	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}
	await assertLocationIdIsLocation(db, userId, locationId);
	await assertWorldMapVariantBounds(db, userId, {
		startActId,
		startSceneId,
		endActId,
		endSceneId
	});

	let startPosition: number | null = null;
	let endPosition: number | null = null;
	try {
		const bounds = await resolveWorldMapVariantBounds(
			db,
			{ startActId, startSceneId, endActId, endSceneId },
			userId
		);
		startPosition = bounds.startPosition;
		endPosition = bounds.endPosition;
	} catch (err) {
		error(400, (err as Error).message);
	}

	let created;
	try {
		[created] = await db
			.insert(worldMaps)
			.values({
				userId,
				name: name.trim(),
				locationId: locationId ?? null,
				startActId: startActId ?? null,
				startSceneId: startSceneId ?? null,
				endActId: endActId ?? null,
				endSceneId: endSceneId ?? null,
				startPosition,
				endPosition
			})
			.returning();
	} catch (err) {
		// Drizzle wraps PG errors; unwrap to get the constraint code + message.
		const wrapped = err as { code?: string; cause?: { code?: string }; message?: string };
		const code = wrapped.code ?? wrapped.cause?.code ?? '';
		const msg = `${wrapped.message ?? ''} ${(wrapped.cause as { message?: string } | undefined)?.message ?? ''}`;
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

	return json(created, { status: 201 });
};
