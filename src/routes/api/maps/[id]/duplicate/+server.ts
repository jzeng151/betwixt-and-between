import { json, error } from '@sveltejs/kit';
import { worldMaps, mapAnchors } from '$lib/server/db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { ensureNeutralFaction, readBaselineRegions } from '$lib/server/world-map-v3.js';
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
 * JSON.parse/stringify; locationId preserved). Slice 2 D2 PR-C (T6):
 * regions live only in anchor JSON now; cloned regions get fresh UUIDs
 * minted in JS and are written directly into the new map's baseline
 * anchor.
 *
 * Slice 1b A1: the clone gets one baseline anchor at t_position=-Infinity
 * built from the CLONED region ids. Source's non-baseline anchors
 * (user-authored snapshots tied to source.region.id values) are NOT cloned —
 * their region_id refs would be stale post-clone.
 */
export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);

	const [source] = await db
		.select()
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)));
	if (!source) error(404, 'Map not found');

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

		// Slice 2 D2 PR-B/PR-C: source regions read from baseline anchor JSON.
		const sourceRegions = await readBaselineRegions(tx, source.id);

		const cloneRegions: Array<{
			id: string;
			mapId: string;
			locationId: string | null;
			polygon: number[][];
		}> = sourceRegions.map((r) => ({
			id: crypto.randomUUID(),
			mapId: clone.id,
			locationId: r.locationId,
			polygon: JSON.parse(JSON.stringify(r.polygon))
		}));

		// Slice 2 D1: anchor regions[] carry faction_id (defaulting to the
		// user's Neutral faction) instead of color. ensureNeutralFaction is
		// idempotent.
		const neutralFactionId = await ensureNeutralFaction(tx, userId);

		await tx.insert(mapAnchors).values({
			worldMapId: clone.id,
			// SQL literal for -Infinity — see comment in /api/maps/+server.ts
			// POST handler; postgres-js doesn't serialize JS Infinity reliably.
			tPosition: sql`'-Infinity'::float8` as unknown as number,
			stateJsonb: {
				regions: cloneRegions.map((r) => ({
					region_id: r.id,
					faction_id: neutralFactionId,
					polygon: r.polygon,
					locationId: r.locationId
				})),
				artifacts: [],
				chains: []
			}
		});

		return { clone, cloneRegions };
	});

	return json({ ...result.clone, regions: result.cloneRegions }, { status: 201 });
};
