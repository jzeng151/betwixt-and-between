/**
 * Server-side helpers for the `map_placements` table (WorldMap v2 Step 4).
 *
 * Mirrors the world-maps.ts pattern: polymorphic-FK guards + variant-bounds
 * resolution + an M11 recompute cascade hooked into recomputeAllIntervals.
 *
 *   - assertPlaceableId: placeable_id must reference a Character / Artifact /
 *     Item entity owned by user.
 *   - assertPlacementLocationId: location_id (when set) must reference a
 *     Location owned by user.
 *   - assertPlacementMapId: map_id (when set) must reference a world_maps
 *     row owned by user.
 *   - assertPlacementVariantBounds: same shape as world_maps variant bounds.
 *   - resolvePlacementBounds: thin wrapper over resolveRelationshipBounds.
 *   - recomputePlacementBoundsAll: M11 cascade — recomputes start/end_position
 *     on every placement after an Act reorder.
 */
import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { entities, mapPlacements, worldMaps, PlaceableEntityType } from './db/schema.js';
import { isUuid } from './validation.js';
import { resolveRelationshipBounds } from './intervals.js';

type SelectableDB = {
	select: (...args: unknown[]) => {
		from: (...args: unknown[]) => {
			where: (...args: unknown[]) => Promise<Array<Record<string, unknown>>>;
		};
	};
};

const POSITION_EPSILON = 1e-9;
const PLACEABLE_TYPE_SET = new Set<string>(PlaceableEntityType);

export async function assertPlaceableId(
	db: unknown,
	userId: string,
	placeableId: string | null | undefined
): Promise<void> {
	if (placeableId === null || placeableId === undefined) {
		error(400, 'placeable_id is required');
	}
	if (!isUuid(placeableId)) error(400, 'placeable_id must be a UUID');

	const rows = (await (db as SelectableDB)
		.select({ type: entities.type })
		.from(entities)
		.where(and(eq(entities.id, placeableId), eq(entities.userId, userId)))) as Array<{
		type: string;
	}>;

	if (rows.length === 0) error(400, 'placeable_id does not reference an existing entity');
	if (!PLACEABLE_TYPE_SET.has(rows[0].type)) {
		error(
			400,
			`placeable_id must reference a Character/Artifact/Item entity (got type='${rows[0].type}')`
		);
	}
}

export async function assertPlacementLocationId(
	db: unknown,
	userId: string,
	locationId: string | null | undefined
): Promise<void> {
	if (locationId === null || locationId === undefined) return;
	if (!isUuid(locationId)) error(400, 'location_id must be a UUID');

	const rows = (await (db as SelectableDB)
		.select({ type: entities.type })
		.from(entities)
		.where(and(eq(entities.id, locationId), eq(entities.userId, userId)))) as Array<{
		type: string;
	}>;

	if (rows.length === 0) error(400, 'location_id does not reference an existing entity');
	if (rows[0].type !== 'Location') {
		error(400, `location_id must reference a Location entity (got type='${rows[0].type}')`);
	}
}

export async function assertPlacementMapId(
	db: unknown,
	userId: string,
	mapId: string | null | undefined
): Promise<void> {
	if (mapId === null || mapId === undefined) return;
	if (!isUuid(mapId)) error(400, 'map_id must be a UUID');

	const rows = (await (db as SelectableDB)
		.select({ id: worldMaps.id })
		.from(worldMaps)
		.where(and(eq(worldMaps.id, mapId), eq(worldMaps.userId, userId)))) as Array<{ id: string }>;

	if (rows.length === 0) error(400, 'map_id does not reference an existing world_map');
}

export interface PlacementVariantBoundsInput {
	startActId?: string | null;
	startSceneId?: string | null;
	endActId?: string | null;
	endSceneId?: string | null;
}

/**
 * Validate the four placement temporal-bound FKs, mirroring
 * assertWorldMapVariantBounds. Each FK (when set) must reference an
 * entity of the appropriate type, owned by the user.
 */
export async function assertPlacementVariantBounds(
	db: unknown,
	userId: string,
	input: PlacementVariantBoundsInput
): Promise<void> {
	const checks: Array<{ id: string | null | undefined; expected: 'Act' | 'Scene'; column: string }> = [
		{ id: input.startActId, expected: 'Act', column: 'start_act_id' },
		{ id: input.endActId, expected: 'Act', column: 'end_act_id' },
		{ id: input.startSceneId, expected: 'Scene', column: 'start_scene_id' },
		{ id: input.endSceneId, expected: 'Scene', column: 'end_scene_id' }
	];

	for (const check of checks) {
		if (check.id === null || check.id === undefined) continue;
		if (!isUuid(check.id)) error(400, `${check.column} must be a UUID`);

		const rows = (await (db as SelectableDB)
			.select({ type: entities.type })
			.from(entities)
			.where(and(eq(entities.id, check.id), eq(entities.userId, userId)))) as Array<{
			type: string;
		}>;

		if (rows.length === 0) {
			error(400, `${check.column} does not reference an existing entity`);
		}
		if (rows[0].type !== check.expected) {
			error(
				400,
				`${check.column} must reference a ${check.expected} entity (got type='${rows[0].type}')`
			);
		}
	}
}

export async function resolvePlacementBounds(
	db: Parameters<typeof resolveRelationshipBounds>[0],
	input: PlacementVariantBoundsInput,
	userId: string
): Promise<{ startPosition: number | null; endPosition: number | null }> {
	return resolveRelationshipBounds(
		db,
		{
			startActId: input.startActId ?? null,
			startSceneId: input.startSceneId ?? null,
			endActId: input.endActId ?? null,
			endSceneId: input.endSceneId ?? null
		},
		userId
	);
}

/**
 * Walk all map_placements owned by user and recompute their derived
 * start_position / end_position from FK anchors. Returns the count updated.
 *
 * Called inside recomputeAllIntervals' transaction so an Act reorder cascades
 * atomically across intervals → relationships → world_map variants → placements.
 *
 * Open-ended placements are NOT supported in v2 — bounds are strictly
 * both-null or both-set (matches the DB CHECK and POST/PATCH validation).
 * Any "degenerate" row that lost only one of its act FKs to ON DELETE SET NULL
 * is normalized to "default placement" (all bounds cleared), mirroring
 * recomputeWorldMapVariantsAll exactly.
 */
export async function recomputePlacementBoundsAll(
	db: Parameters<typeof resolveRelationshipBounds>[0],
	userId: string,
	// Optional act/scene index cache from the calling cascade (2026-06 perf
	// audit) — without it every scene-anchored row costs several extra queries.
	cache?: Parameters<typeof resolveRelationshipBounds>[3]
): Promise<number> {
	const rows = (await (db as unknown as SelectableDB)
		.select()
		.from(mapPlacements)
		.where(
			and(
				eq(mapPlacements.userId, userId),
				sql`(${mapPlacements.startActId} IS NOT NULL OR ${mapPlacements.endActId} IS NOT NULL OR ${mapPlacements.startPosition} IS NOT NULL OR ${mapPlacements.endPosition} IS NOT NULL)`
			)
		)) as Array<{
		id: string;
		startActId: string | null;
		startSceneId: string | null;
		endActId: string | null;
		endSceneId: string | null;
		startPosition: number | null;
		endPosition: number | null;
	}>;

	if (rows.length === 0) return 0;

	let updated = 0;
	for (const row of rows) {
		try {
			// Strict v2 contract: both act FKs set or both null. If ON DELETE
			// SET NULL killed only one side, the row is degenerate — clear
			// everything back to default placement (mirrors world_maps).
			const degenerate =
				(row.startActId === null) !== (row.endActId === null);
			const bothActsNull = row.startActId === null && row.endActId === null;
			const normalizeToDefault = degenerate || bothActsNull;

			let startPosition: number | null;
			let endPosition: number | null;
			if (normalizeToDefault) {
				startPosition = null;
				endPosition = null;
			} else {
				const resolved = await resolveRelationshipBounds(
					db,
					{
						startActId: row.startActId,
						startSceneId: row.startSceneId,
						endActId: row.endActId,
						endSceneId: row.endSceneId
					},
					userId,
					cache
				);
				startPosition = resolved.startPosition;
				endPosition = resolved.endPosition;
			}

			const startDrift =
				startPosition !== null &&
				row.startPosition !== null &&
				Math.abs(startPosition - row.startPosition) > POSITION_EPSILON;
			const endDrift =
				endPosition !== null &&
				row.endPosition !== null &&
				Math.abs(endPosition - row.endPosition) > POSITION_EPSILON;
			const startChanged =
				(startPosition === null) !== (row.startPosition === null) || startDrift;
			const endChanged = (endPosition === null) !== (row.endPosition === null) || endDrift;

			// Invariant: start/end positions always move together — either both
			// are nulled (normalizeToDefault), or both come from resolveRelationshipBounds
			// in the same call. Updating only one side could violate the strict
			// `map_placements_position_order` CHECK; do not split this branch.
			const updates: Record<string, unknown> = {};
			if (startChanged) updates.startPosition = startPosition;
			if (endChanged) updates.endPosition = endPosition;

			if (normalizeToDefault) {
				if (row.startActId !== null) updates.startActId = null;
				if (row.endActId !== null) updates.endActId = null;
				if (row.startSceneId !== null) updates.startSceneId = null;
				if (row.endSceneId !== null) updates.endSceneId = null;
			}

			if (Object.keys(updates).length === 0) continue;

			await (db as unknown as {
				update: (table: typeof mapPlacements) => {
					set: (vals: Record<string, unknown>) => {
						where: (clause: unknown) => Promise<unknown>;
					};
				};
			})
				.update(mapPlacements)
				.set(updates)
				.where(and(eq(mapPlacements.id, row.id), eq(mapPlacements.userId, userId)));
			updated++;
		} catch (err) {
			throw new Error(
				`recomputePlacementBoundsAll failed on placement ${row.id}: ${(err as Error).message}`
			);
		}
	}
	return updated;
}
