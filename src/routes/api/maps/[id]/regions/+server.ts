import { json, error } from '@sveltejs/kit';
import { worldMaps, entities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { isSelfIntersecting } from '$lib/server/validation.js';
import { ensurePartOf } from '$lib/server/location-hierarchy.js';
import { fanOutRegionAdd } from '$lib/server/anchor-region-write-through.js';
import { ensureNeutralFaction } from '$lib/server/world-map-v3.js';
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
	// Slice 2 D1: color is no longer accepted — visual color resolves
	// through faction_id (defaults to Neutral). The body shape narrows
	// to { locationId?, polygon }.
	const { locationId, polygon } = body;

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

	let resolvedLocationId: string | null = null;

	// Verify locationId belongs to user when supplied.
	// codex PR review iter 4: anchor JSON stores locationId as a plain
	// string (no PG uuid normalization). If the client posts an uppercase
	// UUID, PG accepts it on the entity validation query but the JSON
	// value retains the casing. Later string-equality scans — entity
	// lookups via Map(id→entity), the Location-DELETE jsonb scrub, etc —
	// compare against the DB-canonical lowercase form and miss the
	// uppercase JSON value. Use the validated `loc.id` (PG-canonicalized)
	// for all anchor JSON writes.
	if (typeof locationId === 'string') {
		// codex PR review iter 7: the prior validation accepted any user-
		// owned entity. Post-T6 the anchor JSON locationId is a free-form
		// string with no FK and no type discriminator; without an explicit
		// type check, a client could persist a Character or Act id here,
		// then delete that entity, leaving the canonical baseline with a
		// stale UUID the Location-DELETE scrub (which only fires for
		// type='Location') will never clear.
		const [loc] = await db
			.select({ id: entities.id })
			.from(entities)
			.where(
				and(
					eq(entities.id, locationId),
					eq(entities.userId, userId),
					eq(entities.type, 'Location')
				)
			);
		if (!loc) error(400, 'Location not found');
		resolvedLocationId = loc.id;
	}

	// Slice 2 D2 PR-C (T6): map_regions is dropped. Region identity is
	// minted client-side as a UUID and lives only in anchor JSON. The
	// transaction protects the part_of edge from a region "creation"
	// that fails after the anchor write — if ensurePartOf rejects on
	// cycle/single-parent, the anchor mutation rolls back.
	const newRegionId = crypto.randomUUID();

	let created: { id: string; mapId: string; locationId: string | null; polygon: number[][] };
	try {
		created = await db.transaction(async (tx) => {
			// Slice 2 D1: ensure the user has a Neutral faction before the
			// region's anchor entry needs to reference one. Idempotent.
			const neutralFactionId = await ensureNeutralFaction(tx, userId);
			if (resolvedLocationId && map.locationId) {
				await ensurePartOf(tx, userId, resolvedLocationId, map.locationId);
			}
			await fanOutRegionAdd(tx, event.params.id!, userId, {
				id: newRegionId,
				factionId: neutralFactionId,
				polygon,
				locationId: resolvedLocationId
			});
			return {
				id: newRegionId,
				mapId: event.params.id!,
				locationId: resolvedLocationId,
				polygon
			};
		});
	} catch (err) {
		// SvelteKit HttpError thrown from ensurePartOf surfaces .status; preserve it.
		const status = (err as { status?: number }).status;
		if (typeof status === 'number') throw err;
		error(400, (err as Error).message);
	}

	return json(created, { status: 201 });
};
