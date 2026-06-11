/**
 * /api/map-placements/[id] — read (GET) + update (PATCH) + delete (DELETE).
 *
 * PATCH supports partial updates: only fields present on the body are touched.
 * Variant-bound FKs follow the same "clearing an act FK auto-clears its
 * scene FK" rule as the world_maps PATCH handler. Position re-derivation runs
 * inside the transaction so a concurrent Act delete cannot leave a stale
 * derived position.
 */
import { json, error } from '@sveltejs/kit';
import { mapPlacements } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
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
import { validateStyleInData, validatePlacementDataSize } from '$lib/server/style-validation.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [row] = await db
		.select()
		.from(mapPlacements)
		.where(and(eq(mapPlacements.id, event.params.id), eq(mapPlacements.userId, userId)));
	if (!row) error(404, 'Placement not found');
	return json(row);
};

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;

	try {
		return await db.transaction(async (tx) => {
			const [existing] = await tx
				.select()
				.from(mapPlacements)
				.where(and(eq(mapPlacements.id, event.params.id), eq(mapPlacements.userId, userId)));
			if (!existing) error(404, 'Placement not found');

			const updates: Record<string, unknown> = {};

			if ('placeableId' in body) {
				await assertPlaceableId(tx, userId, body.placeableId);
				updates.placeableId = body.placeableId;
			}
			if ('locationId' in body) {
				await assertPlacementLocationId(tx, userId, body.locationId);
				updates.locationId = body.locationId ?? null;
			}
			if ('mapId' in body) {
				await assertPlacementMapId(tx, userId, body.mapId);
				updates.mapId = body.mapId ?? null;
			}
			if ('x' in body) {
				if (typeof body.x !== 'number' || !Number.isFinite(body.x) || body.x < 0 || body.x > 1) {
					error(400, 'x must be a finite number in [0, 1]');
				}
				updates.x = body.x;
			}
			if ('y' in body) {
				if (typeof body.y !== 'number' || !Number.isFinite(body.y) || body.y < 0 || body.y > 1) {
					error(400, 'y must be a finite number in [0, 1]');
				}
				updates.y = body.y;
			}
			if ('data' in body) {
				// Slice 3 T24 — style whitelist applies on PATCH too.
				validateStyleInData(body.data, 'placement.data');
				validatePlacementDataSize(body.data, 'placement.data');
				updates.data = body.data && typeof body.data === 'object' ? body.data : {};
			}

			const variantTouched =
				'startActId' in body ||
				'startSceneId' in body ||
				'endActId' in body ||
				'endSceneId' in body;

			if (variantTouched) {
				const mergedStartActId =
					'startActId' in body ? (body.startActId ?? null) : existing.startActId;
				const mergedEndActId =
					'endActId' in body ? (body.endActId ?? null) : existing.endActId;
				// Strict v2 contract (matches POST + DB CHECK): both act FKs set
				// or both null. PATCHing only one side is a caller bug — surface
				// it as 400 rather than silently nullifying the other side.
				if ((mergedStartActId === null) !== (mergedEndActId === null)) {
					error(400, 'startActId and endActId must both be set or both be null');
				}
				const mergedStartSceneId =
					mergedStartActId === null
						? null
						: 'startSceneId' in body
							? (body.startSceneId ?? null)
							: existing.startSceneId;
				const mergedEndSceneId =
					mergedEndActId === null
						? null
						: 'endSceneId' in body
							? (body.endSceneId ?? null)
							: existing.endSceneId;

				await assertPlacementVariantBounds(tx, userId, {
					startActId: mergedStartActId,
					startSceneId: mergedStartSceneId,
					endActId: mergedEndActId,
					endSceneId: mergedEndSceneId
				});

				let startPosition: number | null = null;
				let endPosition: number | null = null;
				if (mergedStartActId !== null || mergedEndActId !== null) {
					let bounds: { startPosition: number | null; endPosition: number | null };
					try {
						bounds = await resolvePlacementBounds(
							tx,
							{
								startActId: mergedStartActId,
								startSceneId: mergedStartSceneId,
								endActId: mergedEndActId,
								endSceneId: mergedEndSceneId
							},
							userId
						);
					} catch (e) {
						// Plain validation Errors → 400; a driver error (malformed-UUID
						// cast etc.) is opaqued as a 500 so its raw message can't leak
						// (2026-06 review — parity with the POST route).
						if ((e as { status?: number }).status) throw e;
						if (isPgError(e)) throw e;
						error(400, `Invalid placement bounds: ${(e as Error).message}`);
					}
					startPosition = bounds.startPosition;
					endPosition = bounds.endPosition;
				}

				updates.startActId = mergedStartActId;
				updates.startSceneId = mergedStartSceneId;
				updates.endActId = mergedEndActId;
				updates.endSceneId = mergedEndSceneId;
				updates.startPosition = startPosition;
				updates.endPosition = endPosition;
			}

			if (Object.keys(updates).length === 0) {
				return json(existing);
			}

			const [updated] = await tx
				.update(mapPlacements)
				.set(updates)
				.where(and(eq(mapPlacements.id, event.params.id), eq(mapPlacements.userId, userId)))
				.returning();

			return json(updated);
		});
	} catch (err) {
		if ((err as { status?: number }).status) throw err;
		const wrapped = err as { code?: string; cause?: { code?: string }; message?: string };
		const msg = `${wrapped.message ?? ''} ${(wrapped.cause as { message?: string } | undefined)?.message ?? ''}`;
		if (msg.includes('map_placements_xy_unit_range')) {
			error(400, 'x and y must be fractions in [0, 1].');
		}
		if (msg.includes('map_placements_position_order')) {
			error(400, 'Placement end must come after the start.');
		}
		throw err;
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const deleted = await db
		.delete(mapPlacements)
		.where(and(eq(mapPlacements.id, event.params.id), eq(mapPlacements.userId, userId)))
		.returning();
	if (deleted.length === 0) error(404, 'Placement not found');
	return new Response(null, { status: 204 });
};
