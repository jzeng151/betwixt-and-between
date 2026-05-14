import { json, error } from '@sveltejs/kit';
import { worldMaps, mapRegions } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

/**
 * Duplicate a world_map row + all its regions.
 *
 * Returns the new map (with its new id). The clone keeps locationId, name,
 * baseImageUrl, width, height. Variant bounds (start/end act+scene+position)
 * are NOT copied — duplicating a temporally-scoped variant with its bounds
 * intact would guarantee an EXCLUDE-constraint conflict against its source.
 * The clone is created as a default variant; the caller (UI) prompts the
 * user to pick a new scene range immediately after.
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

	const [clone] = await db
		.insert(worldMaps)
		.values({
			userId,
			name: `${source.name} (copy)`,
			baseImageUrl: source.baseImageUrl,
			width: source.width,
			height: source.height,
			locationId: source.locationId
			// variant bounds intentionally omitted — see comment above
		})
		.returning();

	const sourceRegions = await db
		.select()
		.from(mapRegions)
		.where(eq(mapRegions.mapId, source.id));

	if (sourceRegions.length > 0) {
		await db.insert(mapRegions).values(
			sourceRegions.map((r) => ({
				mapId: clone.id,
				locationId: r.locationId,
				polygon: JSON.parse(JSON.stringify(r.polygon)),
				color: r.color
			}))
		);
	}

	const cloneRegions = await db
		.select()
		.from(mapRegions)
		.where(eq(mapRegions.mapId, clone.id));

	return json({ ...clone, regions: cloneRegions }, { status: 201 });
};
