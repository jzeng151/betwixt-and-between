/**
 * /api/map-placements — list (GET) + create (POST).
 *
 * GET supports optional ?locationId=, ?placeableId=, ?mapId= filters so the
 * scene-change projection (M3) can pull only the active-Location-subtree's
 * placements without dragging the whole table client-side.
 *
 * POST validates polymorphic FKs (placeable / location / map / variant
 * bounds), derives start_position / end_position from act/scene anchors via
 * the same Premise-4 math as relationships and world-map variants, then
 * inserts inside a transaction so the FK validation read + the write are
 * consistent with concurrent entity deletes.
 */
import { json, error } from '@sveltejs/kit';
import { mapPlacements } from '$lib/server/db/schema.js';
import { and, desc, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { isPgError } from '$lib/server/pg-errors.js';
import {
	assertPlaceableId,
	assertPlacementLocationId,
	assertPlacementMapId,
	assertPlacementVariantBounds,
	resolvePlacementBounds
} from '$lib/server/map-placements.js';
import { isUuid } from '$lib/server/validation.js';
import { validateStyleInData, validatePlacementDataSize } from '$lib/server/style-validation.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const url = event.url;
	const filters = [eq(mapPlacements.userId, userId)];

	// Validate UUID filters before pushing into the query — Postgres raises an
	// invalid-cast error on malformed uuid text and we'd surface it as a 500.
	const locationId = url.searchParams.get('locationId');
	if (locationId !== null) {
		if (!isUuid(locationId)) error(400, 'locationId must be a UUID');
		filters.push(eq(mapPlacements.locationId, locationId));
	}

	const placeableId = url.searchParams.get('placeableId');
	if (placeableId !== null) {
		if (!isUuid(placeableId)) error(400, 'placeableId must be a UUID');
		filters.push(eq(mapPlacements.placeableId, placeableId));
	}

	const mapId = url.searchParams.get('mapId');
	if (mapId !== null) {
		if (!isUuid(mapId)) error(400, 'mapId must be a UUID');
		filters.push(eq(mapPlacements.mapId, mapId));
	}

	const rows = await db
		.select()
		.from(mapPlacements)
		.where(and(...filters))
		.orderBy(desc(mapPlacements.createdAt));
	return json(rows);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;

	const {
		placeableId,
		locationId,
		mapId,
		x,
		y,
		startActId,
		startSceneId,
		endActId,
		endSceneId,
		data
	} = body;

	if (typeof x !== 'number' || typeof y !== 'number') {
		error(400, 'x and y are required numbers');
	}
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		error(400, 'x and y must be finite numbers');
	}
	if (x < 0 || x > 1 || y < 0 || y > 1) {
		error(400, 'x and y must be fractions in [0, 1] of the source-image dimensions');
	}

	// Slice 3 T24 — style whitelist. If the client sends data.style, every
	// key + value must conform to ResolvedStyle's contract.
	validateStyleInData(data, 'placement.data');
	validatePlacementDataSize(data, 'placement.data');

	const normalizedStartActId = startActId ?? null;
	const normalizedEndActId = endActId ?? null;
	// Open-ended placements aren't supported in v2 — both anchors required or
	// both null (default placement). Mirrors resolveRelationshipBounds' contract.
	if ((normalizedStartActId === null) !== (normalizedEndActId === null)) {
		error(400, 'startActId and endActId must both be set or both be null');
	}
	const normalizedStartSceneId = normalizedStartActId === null ? null : (startSceneId ?? null);
	const normalizedEndSceneId = normalizedEndActId === null ? null : (endSceneId ?? null);

	try {
		return await db.transaction(async (tx) => {
			await assertPlaceableId(tx, userId, placeableId);
			await assertPlacementLocationId(tx, userId, locationId);
			await assertPlacementMapId(tx, userId, mapId);
			await assertPlacementVariantBounds(tx, userId, {
				startActId: normalizedStartActId,
				startSceneId: normalizedStartSceneId,
				endActId: normalizedEndActId,
				endSceneId: normalizedEndSceneId
			});

			let startPosition: number | null = null;
			let endPosition: number | null = null;
			if (normalizedStartActId !== null || normalizedEndActId !== null) {
				let bounds: { startPosition: number | null; endPosition: number | null };
				try {
					bounds = await resolvePlacementBounds(
						tx,
						{
							startActId: normalizedStartActId,
							startSceneId: normalizedStartSceneId,
							endActId: normalizedEndActId,
							endSceneId: normalizedEndSceneId
						},
						userId
					);
				} catch (e) {
					// resolvePlacementBounds / computeIntervalPositions throw plain
					// Errors on invalid temporal input (start > end, scene parented
					// to a different act, etc.). Surface as 400 client error. A driver
					// error (malformed-UUID cast etc.) is opaqued as a 500 instead of
					// echoing its raw message (2026-06 review).
					if ((e as { status?: number }).status) throw e;
					if (isPgError(e)) throw e;
					error(400, `Invalid placement bounds: ${(e as Error).message}`);
				}
				startPosition = bounds.startPosition;
				endPosition = bounds.endPosition;
			}

			const [created] = await tx
				.insert(mapPlacements)
				.values({
					userId,
					placeableId,
					locationId: locationId ?? null,
					mapId: mapId ?? null,
					x,
					y,
					startActId: normalizedStartActId,
					startSceneId: normalizedStartSceneId,
					endActId: normalizedEndActId,
					endSceneId: normalizedEndSceneId,
					startPosition,
					endPosition,
					data: data && typeof data === 'object' ? data : {}
				})
				.returning();

			return json(created, { status: 201 });
		});
	} catch (err) {
		// SvelteKit error() throws an HttpError; rethrow as-is to preserve status.
		if ((err as { status?: number; body?: unknown }).status) throw err;
		const wrapped = err as { code?: string; cause?: { code?: string }; message?: string };
		const code = wrapped.code ?? wrapped.cause?.code ?? '';
		const msg = `${wrapped.message ?? ''} ${(wrapped.cause as { message?: string } | undefined)?.message ?? ''}`;
		if (code === '23514' || msg.includes('map_placements_xy_unit_range')) {
			error(400, 'x and y must be fractions in [0, 1].');
		}
		if (code === '23514' || msg.includes('map_placements_position_order')) {
			error(400, 'Placement end must come after the start.');
		}
		throw err;
	}
};
