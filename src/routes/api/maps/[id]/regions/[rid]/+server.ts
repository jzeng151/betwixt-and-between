import { json, error } from '@sveltejs/kit';
import { worldMaps, entities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { isSelfIntersecting } from '$lib/server/validation.js';
import { ensurePartOf, removeImpliedPartOf } from '$lib/server/location-hierarchy.js';
import {
	fanOutRegionDelete,
	fanOutRegionGeometryUpdate
} from '$lib/server/anchor-region-write-through.js';
import {
	readBaselineRegionsForUser,
	type AnchorRegionRow
} from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

/**
 * Slice 2 D2 PR-B/PR-C: region ownership reads from baseline anchor JSON
 * via readBaselineRegionsForUser (which scopes through world_maps.user_id).
 * Cross-user access returns 404 (no existence leak).
 */
async function assertOwnedRegion(
	db: App.Locals['db'],
	mapId: string,
	regionId: string,
	userId: string
): Promise<AnchorRegionRow | null> {
	const rows = await readBaselineRegionsForUser(db, userId, mapId);
	return rows.find((r) => r.id === regionId) ?? null;
}

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const region = await assertOwnedRegion(db, event.params.id, event.params.rid, userId);
	if (!region) error(404, 'Region not found');

	const body = await event.request.json();
	const patch: { polygon?: number[][]; locationId?: string | null } = {};
	let locationIdInPatch = false;

	if (body.locationId === null) {
		patch.locationId = null;
		locationIdInPatch = true;
	} else if (typeof body.locationId === 'string') {
		// Verify locationId belongs to user AND is type='Location'.
		// codex PR review iter 4: anchor JSON stores locationId verbatim;
		// use `loc.id` (PG-canonical lowercase) so later string-equality
		// scans match. codex PR review iter 7: type guard added — without
		// it, a client could PATCH the region to a Character/Act id and
		// the Location-DELETE scrub would never fire for the stale ref.
		const [loc] = await db
			.select({ id: entities.id })
			.from(entities)
			.where(
				and(
					eq(entities.id, body.locationId),
					eq(entities.userId, userId),
					eq(entities.type, 'Location')
				)
			);
		if (!loc) error(400, 'Location not found');
		patch.locationId = loc.id;
		locationIdInPatch = true;
	}

	// Slice 2 D1: color is no longer a region field — drop silently if
	// included so legacy callers degrade rather than 400.

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
		patch.polygon = body.polygon;
	}

	if (patch.polygon === undefined && !locationIdInPatch) {
		error(400, 'No valid fields to update');
	}

	// Anchor write + part_of remove/upsert are atomic. Otherwise a partial
	// failure (ensurePartOf rejects on cycle/single-parent) leaves the
	// anchor pointing at the new location with the old implied edge gone.
	let updated: AnchorRegionRow;
	try {
		updated = await db.transaction(async (tx) => {
			// Slice 2 D2 PR-C (T6): write to anchor first so removeImpliedPartOf
			// sees the post-update state.
			await fanOutRegionGeometryUpdate(
				tx,
				event.params.id!,
				userId,
				event.params.rid!,
				{
					polygon: patch.polygon,
					...(locationIdInPatch ? { locationId: patch.locationId ?? null } : {})
				}
			);

			const locationChanged =
				locationIdInPatch && (patch.locationId ?? null) !== region.locationId;
			if (locationChanged) {
				const [parentMap] = await tx
					.select({ locationId: worldMaps.locationId })
					.from(worldMaps)
					.where(eq(worldMaps.id, event.params.id));
				if (parentMap?.locationId && region.locationId) {
					await removeImpliedPartOf(tx, userId, region.locationId, parentMap.locationId);
				}
				if (parentMap?.locationId && typeof patch.locationId === 'string') {
					await ensurePartOf(tx, userId, patch.locationId, parentMap.locationId);
				}
			}

			return {
				id: region.id,
				mapId: region.mapId,
				locationId: locationIdInPatch ? patch.locationId ?? null : region.locationId,
				polygon: patch.polygon ?? region.polygon
			};
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

	// Anchor DELETE + implied edge cleanup are atomic. Order: anchor delete
	// must run BEFORE removeImpliedPartOf because the latter reads anchor
	// JSON — if we removed the edge first and the anchor delete failed,
	// we'd have a stranded region whose implied edge was already gone.
	await db.transaction(async (tx) => {
		await fanOutRegionDelete(tx, event.params.id!, userId, event.params.rid!);
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
