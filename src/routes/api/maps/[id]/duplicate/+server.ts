import { json, error } from '@sveltejs/kit';
import { worldMaps, mapRegions } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

/**
 * Duplicate a world_map row + all its regions.
 *
 * Returns the new map (with its new id). The clone keeps name, baseImageUrl,
 * width, height, and copies the source's regions. Two fields are intentionally
 * dropped:
 *
 *   - Variant bounds (start/end act+scene+position) — copying them as-is would
 *     guarantee an EXCLUDE-constraint conflict against the source variant.
 *   - locationId — copying it would either trip
 *     `world_maps_one_default_per_location` (if source is already that
 *     Location's default, which is the common case) or leave the clone as an
 *     ambiguous second default. Instead the clone is left unlinked; the UI
 *     prompts the user to attach it and pick a new scene range.
 *
 * The name is suffixed with " (copy)" so the clone is visually distinct in
 * the map switcher. Regions are deep-copied (polygon arrays cloned via
 * JSON.parse/stringify; locationId/color preserved).
 */
export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);

	const [source] = await db
		.select()
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)));
	if (!source) error(404, 'Map not found');

	// Clone + region copy run in a single transaction so a mid-request failure
	// (FK violation on the region insert, transient DB error) rolls back the
	// clone row instead of leaving an orphan map with no regions.
	const result = await db.transaction(async (tx) => {
		const [clone] = await tx
			.insert(worldMaps)
			.values({
				userId,
				name: `${source.name} (copy)`,
				baseImageUrl: source.baseImageUrl,
				width: source.width,
				height: source.height,
				locationId: null
				// variant bounds + locationId intentionally omitted — see comment above
			})
			.returning();

		const sourceRegions = await tx
			.select()
			.from(mapRegions)
			.where(eq(mapRegions.mapId, source.id));

		let cloneRegions: typeof sourceRegions = [];
		if (sourceRegions.length > 0) {
			cloneRegions = await tx
				.insert(mapRegions)
				.values(
					sourceRegions.map((r) => ({
						mapId: clone.id,
						locationId: r.locationId,
						polygon: JSON.parse(JSON.stringify(r.polygon)),
						color: r.color
					}))
				)
				.returning();
		}

		return { clone, cloneRegions };
	});

	return json({ ...result.clone, regions: result.cloneRegions }, { status: 201 });
};
