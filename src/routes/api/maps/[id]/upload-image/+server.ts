import { json, error } from '@sveltejs/kit';
import { worldMaps } from '$lib/server/db/schema.js';
import { squareGridCounts } from '$lib/features/map/grid-dims.js';
import { and, eq, sql } from 'drizzle-orm';
import { getStoryId } from '$lib/server/auth-gate.js';
import { uploadImage } from '$lib/server/image-upload.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);

	// Verify map exists AND belongs to user.
	const [map] = await db
		.select()
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.storyId, storyId)));
	if (!map) error(404, 'Map not found');

	const image = await uploadImage(event.request, event.platform, event.params.id);
	const baseImageUrl = image.url;
	const dimensions = image;
	const mapId = event.params.id;

	// Fit the grid to the image aspect so cells are square — but only when it's
	// safe. The brush requires a base image, yet the API can author paint_cells
	// on an image-less map, so "no image ⇒ no terrain" is not guaranteed: scan.
	// We also take the same FOR UPDATE lock the PATCH grid path uses so a
	// concurrent paint can't slip terrain in between the scan and the re-fit.
	// Conditions to re-fit: square grid, first image (no prior baseImageUrl),
	// and no painted (non-'unset') terrain. Otherwise leave the grid alone —
	// re-fitting could orphan cells projection doesn't bounds-clip.
	const updated = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ baseImageUrl: worldMaps.baseImageUrl, gridType: worldMaps.gridType })
			.from(worldMaps)
			.where(and(eq(worldMaps.id, mapId), eq(worldMaps.storyId, storyId)))
			.for('update');
		if (!locked) error(404, 'Map not found');

		let squared: { gridCellsX: number; gridCellsY: number } | Record<string, never> = {};
		if (!locked.baseImageUrl && locked.gridType === 'square') {
			const terrain = await tx.execute(sql`
				SELECT 1 FROM (
					SELECT 1 FROM map_events me, jsonb_array_elements(me.payload_jsonb->'cells') AS c
						WHERE me.world_map_id = ${mapId} AND me.kind = 'paint_cells'
						  AND me.undone_at IS NULL AND c->>'biome' <> 'unset'
					UNION ALL
					SELECT 1 FROM map_anchors ma, jsonb_array_elements(ma.state_jsonb->'cells') AS c
						WHERE ma.world_map_id = ${mapId} AND c->>'biome' <> 'unset'
				) t LIMIT 1
			`);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const rows = ((terrain as any).rows ?? terrain) as unknown[];
			if (rows.length === 0) {
				squared = squareGridCounts(dimensions.width, dimensions.height);
			}
		}

		const [u] = await tx
			.update(worldMaps)
			.set({ baseImageUrl, width: dimensions.width, height: dimensions.height, ...squared })
			.where(and(eq(worldMaps.id, mapId), eq(worldMaps.storyId, storyId)))
			.returning();
		return u;
	});

	return json(updated);
};
