/**
 * Server-side helpers for the `world_maps` table.
 *
 * Currently houses:
 *   - assertLocationIdIsLocation: polymorphic-FK guard for `location_id`.
 *   - assertWorldMapVariantBounds: polymorphic-FK guard for the four variant
 *     temporal-bound FKs (start/end act, start/end scene). Same pattern as
 *     intervals.ts FK validation: Postgres can't CHECK a column's referent type
 *     cleanly, so the invariant is upheld at the write layer + Vitest invariant
 *     tests.
 *   - resolveWorldMapVariantBounds: thin wrapper over resolveRelationshipBounds.
 *     Variants share the same 4-FK + 2-position shape as relationships.
 *   - recomputeWorldMapVariantsAll: M11 cascade — recomputes start_position /
 *     end_position on every variant after an Act reorder.
 */
import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { entities, worldMaps } from './db/schema.js';
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

export async function assertLocationIdIsLocation(
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

export interface WorldMapVariantBoundsInput {
	startActId?: string | null;
	startSceneId?: string | null;
	endActId?: string | null;
	endSceneId?: string | null;
}

/**
 * Validate the four variant temporal-bound FKs. Each FK must reference a
 * user-owned entity of the appropriate type:
 *   start_act_id   / end_act_id   → type='Act'
 *   start_scene_id / end_scene_id → type='Scene'
 *
 * Null/undefined FKs are accepted (default-variant case + open-ended caller
 * intent — caller decides whether the resulting bounds shape is valid; that
 * is enforced by resolveWorldMapVariantBounds + the DB CHECK/EXCLUDE).
 */
export async function assertWorldMapVariantBounds(
	db: unknown,
	userId: string,
	input: WorldMapVariantBoundsInput
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

/**
 * Derive (startPosition, endPosition) for a world_map variant from its act/scene
 * FK anchors. Variants share the same 4-FK shape as temporal relationships, so
 * this delegates to resolveRelationshipBounds (Premise-4 math in one place).
 */
export async function resolveWorldMapVariantBounds(
	db: Parameters<typeof resolveRelationshipBounds>[0],
	input: WorldMapVariantBoundsInput,
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
 * Walk all world_maps variants owned by user and recompute their derived
 * start_position / end_position from FK anchors. Returns the count updated.
 *
 * Called inside recomputeAllIntervals' transaction so an Act reorder cascades
 * atomically across intervals → relationships → world_map variants (M11).
 *
 * The EXCLUDE constraint is declared DEFERRABLE INITIALLY DEFERRED so the
 * per-row updates inside this loop can transiently overlap between row-N's
 * old position and row-(N+1)'s new position during a swap-style reorder.
 * Final check happens at transaction commit; if the final state still
 * overlaps anywhere, the whole reorder rolls back.
 */
export async function recomputeWorldMapVariantsAll(
	db: Parameters<typeof resolveRelationshipBounds>[0],
	userId: string
): Promise<number> {
	// Include rows whose act FKs are fully null but still carry stale positions
	// (e.g. ON DELETE SET NULL nulled both act FKs but start_position/end_position
	// remain) so we can clear them. Without this filter such rows would never be
	// revisited and would keep stale ranges visible to resolveActiveVariant.
	const rows = (await (db as unknown as SelectableDB)
		.select()
		.from(worldMaps)
		.where(
			and(
				eq(worldMaps.userId, userId),
				sql`(${worldMaps.startActId} IS NOT NULL OR ${worldMaps.endActId} IS NOT NULL OR ${worldMaps.startPosition} IS NOT NULL OR ${worldMaps.endPosition} IS NOT NULL)`
			)
		)) as Array<{
		id: string;
		locationId: string | null;
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
			// Degenerate after ON DELETE SET NULL: exactly one act FK survived, or
			// both nulled while positions stayed. Treat as default variant and clear
			// derived positions + scene FKs rather than throwing from
			// resolveRelationshipBounds.
			const oneActOnly =
				(row.startActId === null) !== (row.endActId === null);
			const bothActsNull = row.startActId === null && row.endActId === null;
			const degenerate = oneActOnly || bothActsNull;
			let startPosition: number | null;
			let endPosition: number | null;
			if (degenerate) {
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
					userId
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
			const startChanged = (startPosition === null) !== (row.startPosition === null) || startDrift;
			const endChanged = (endPosition === null) !== (row.endPosition === null) || endDrift;

			const updates: Record<string, unknown> = {};
			if (startChanged) updates.startPosition = startPosition;
			if (endChanged) updates.endPosition = endPosition;

			// Degenerate rows: clear any surviving act/scene FK so the row is fully
			// a default variant (consistent state) rather than carrying a half-anchor.
			if (degenerate) {
				if (row.startActId !== null) updates.startActId = null;
				if (row.startSceneId !== null) updates.startSceneId = null;
				if (row.endActId !== null) updates.endActId = null;
				if (row.endSceneId !== null) updates.endSceneId = null;

				// If this row would now collide with an existing default for the same
				// location (world_maps_one_default_per_location), unlink it instead
				// of letting the unique-index abort the surrounding cascade. The
				// world_maps_stamp_location_inactive_at trigger stamps the audit ts.
				if (row.locationId !== null) {
					const conflicts = (await (db as unknown as SelectableDB)
						.select({ id: worldMaps.id })
						.from(worldMaps)
						.where(
							and(
								eq(worldMaps.userId, userId),
								eq(worldMaps.locationId, row.locationId),
								sql`${worldMaps.startPosition} IS NULL`,
								sql`${worldMaps.id} <> ${row.id}`
							)
						)) as Array<{ id: string }>;
					if (conflicts.length > 0) {
						updates.locationId = null;
					}
				}
			}

			if (Object.keys(updates).length === 0) continue;

			await (db as unknown as {
				update: (table: typeof worldMaps) => {
					set: (vals: Record<string, unknown>) => {
						where: (clause: unknown) => Promise<unknown>;
					};
				};
			})
				.update(worldMaps)
				.set(updates)
				.where(and(eq(worldMaps.id, row.id), eq(worldMaps.userId, userId)));
			updated++;
		} catch (err) {
			throw new Error(
				`recomputeWorldMapVariantsAll failed on world_map ${row.id}: ${(err as Error).message}`
			);
		}
	}
	return updated;
}
