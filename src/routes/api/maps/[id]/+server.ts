import { json, error } from '@sveltejs/kit';
import { worldMaps } from '$lib/server/db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import {
	assertLocationIdIsLocation,
	assertWorldMapVariantBounds,
	resolveWorldMapVariantBounds
} from '$lib/server/world-maps.js';
import { readBaselineRegions } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [map] = await db
		.select()
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)));
	if (!map) error(404, 'Map not found');

	// Slice 2 D2 PR-B: regions sourced from the baseline anchor's
	// state_jsonb.regions[] instead of map_regions. Same shape (id, mapId,
	// locationId, polygon) since T4's invariant keeps anchor JSON in sync.
	// Cross-user defense already enforced by the worldMaps ownership check
	// above.
	const regions = await readBaselineRegions(db, event.params.id);

	return json({ ...map, regions });
};

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();

	const [existing] = await db
		.select()
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)));
	if (!existing) error(404, 'Map not found');

	const updates: Record<string, unknown> = {};
	if (typeof body.name === 'string') updates.name = body.name.trim();
	if (typeof body.baseImageUrl === 'string') updates.baseImageUrl = body.baseImageUrl;
	if (typeof body.width === 'number') updates.width = body.width;
	if (typeof body.height === 'number') updates.height = body.height;

	// Slice 3 (QA gap fix) — grid settings write path. The grid_* columns
	// landed in 0018 with defaults and are read by the Pixi renderer, but
	// the PATCH handler never accepted them, so "hex available per-map"
	// (design doc D1) had no way to take effect. Validate app-side; the
	// DB CHECK constraints (world_maps_grid_type_check / _cells_bounds)
	// back-stop direct writes.
	if ('gridType' in body) {
		if (body.gridType !== 'square' && body.gridType !== 'hex') {
			error(400, "gridType must be 'square' or 'hex'");
		}
		updates.gridType = body.gridType;
	}
	if ('gridCellsX' in body) {
		if (!Number.isInteger(body.gridCellsX) || body.gridCellsX < 4 || body.gridCellsX > 128) {
			error(400, 'gridCellsX must be an integer in [4, 128]');
		}
		updates.gridCellsX = body.gridCellsX;
	}
	if ('gridCellsY' in body) {
		if (!Number.isInteger(body.gridCellsY) || body.gridCellsY < 4 || body.gridCellsY > 128) {
			error(400, 'gridCellsY must be an integer in [4, 128]');
		}
		updates.gridCellsY = body.gridCellsY;
	}
	if ('gridScaleUnit' in body) {
		if (typeof body.gridScaleUnit !== 'string' || body.gridScaleUnit.length === 0 || body.gridScaleUnit.length > 16) {
			error(400, 'gridScaleUnit must be a non-empty string ≤ 16 chars');
		}
		updates.gridScaleUnit = body.gridScaleUnit;
	}
	if ('gridScaleValue' in body) {
		if (typeof body.gridScaleValue !== 'number' || !Number.isFinite(body.gridScaleValue) || body.gridScaleValue <= 0) {
			error(400, 'gridScaleValue must be a positive number');
		}
		updates.gridScaleValue = body.gridScaleValue;
	}
	if ('gridVisible' in body) {
		if (typeof body.gridVisible !== 'boolean') {
			error(400, 'gridVisible must be a boolean');
		}
		updates.gridVisible = body.gridVisible;
	}

	// locationId: explicit presence (including null) is meaningful — null means unlink.
	// location_inactive_at is managed by the world_maps_stamp_location_inactive_at
	// trigger (migration 0008) so every unlink path — user PATCH, ON DELETE SET NULL
	// cascade — stamps uniformly.
	if ('locationId' in body) {
		await assertLocationIdIsLocation(db, userId, body.locationId);
		updates.locationId = body.locationId ?? null;
	}

	// Variant bounds: explicit presence of any of the four FKs triggers re-derivation.
	// Scene FKs without their parent Act FK are auto-cleared, mirroring the
	// relationship PATCH's "clearing an act FK must also clear its scene FK" rule.
	const variantTouched =
		'startActId' in body ||
		'startSceneId' in body ||
		'endActId' in body ||
		'endSceneId' in body;

	if (variantTouched) {
		const mergedStartActId =
			'startActId' in body ? (body.startActId ?? null) : existing.startActId;
		const mergedStartSceneId =
			mergedStartActId === null
				? null
				: 'startSceneId' in body
					? (body.startSceneId ?? null)
					: existing.startSceneId;
		const mergedEndActId =
			'endActId' in body ? (body.endActId ?? null) : existing.endActId;
		const mergedEndSceneId =
			mergedEndActId === null
				? null
				: 'endSceneId' in body
					? (body.endSceneId ?? null)
					: existing.endSceneId;

		await assertWorldMapVariantBounds(db, userId, {
			startActId: mergedStartActId,
			startSceneId: mergedStartSceneId,
			endActId: mergedEndActId,
			endSceneId: mergedEndSceneId
		});

		let startPosition: number | null = null;
		let endPosition: number | null = null;
		try {
			const bounds = await resolveWorldMapVariantBounds(
				db,
				{
					startActId: mergedStartActId,
					startSceneId: mergedStartSceneId,
					endActId: mergedEndActId,
					endSceneId: mergedEndSceneId
				},
				userId
			);
			startPosition = bounds.startPosition;
			endPosition = bounds.endPosition;
		} catch (err) {
			error(400, (err as Error).message);
		}

		updates.startActId = mergedStartActId;
		updates.startSceneId = mergedStartSceneId;
		updates.endActId = mergedEndActId;
		updates.endSceneId = mergedEndSceneId;
		updates.startPosition = startPosition;
		updates.endPosition = endPosition;
	}

	if (Object.keys(updates).length === 0) {
		error(400, 'No valid fields to update');
	}

	let updated;
	try {
		updated = await db.transaction(async (tx) => {
			// codex P2 (PR #58): grid edits READ terrain (the guards below) then
			// WRITE the grid columns. Without a lock, a concurrent paint_cells
			// POST — which takes SELECT ... FOR UPDATE on this world_maps row in
			// createMapEvent — can validate + insert a far/old-geometry cell
			// between our guard read and our write, leaving live terrain outside
			// the new bounds or painted under the old grid type. Take the same
			// row lock so grid edits serialize with terrain writes. Only when a
			// grid field changes — other PATCH fields don't race terrain.
			const gridTouched =
				'gridType' in body || 'gridCellsX' in body || 'gridCellsY' in body;
			if (gridTouched) {
				await tx.execute(
					sql`SELECT id FROM world_maps WHERE id = ${event.params.id} FOR UPDATE`
				);

				// codex P2: re-read the grid UNDER the lock. `existing` came from a
				// pre-transaction read, so a concurrent grid change (e.g. another
				// form switching square→hex with a paint under the new grid) could
				// commit before this PATCH gets the lock — a stale gridType would
				// make the change-detection below false and skip the terrain guard.
				// Decide off the locked current values.
				const lockedRes = await tx.execute(
					sql`SELECT grid_type AS "gridType", grid_cells_x AS "gridCellsX", grid_cells_y AS "gridCellsY" FROM world_maps WHERE id = ${event.params.id}`
				);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const locked = (((lockedRes as any).rows ?? lockedRes) as Array<{
					gridType: string;
					gridCellsX: number;
					gridCellsY: number;
				}>)[0];
				if (!locked) error(404, 'world_map not found');

				// gridType change reinterprets the same stored (x,y) cell keys
				// under a different geometry (square cells vs hex axial), so
				// existing terrain would move/distort. Reject once any non-erased
				// terrain exists. Events are temporal — a painted-then-erased cell
				// still renders at an intermediate playhead — so scan all live
				// paint_cells events + anchor snapshots, treating 'unset' as absent.
				if ('gridType' in body && body.gridType !== locked.gridType) {
					const terrain = await tx.execute(sql`
						SELECT 1 AS hit FROM (
							SELECT c->>'biome' AS biome
							FROM map_events me, jsonb_array_elements(me.payload_jsonb->'cells') AS c
							WHERE me.world_map_id = ${event.params.id}
							  AND me.kind = 'paint_cells' AND me.undone_at IS NULL
							UNION ALL
							SELECT c->>'biome' AS biome
							FROM map_anchors ma, jsonb_array_elements(ma.state_jsonb->'cells') AS c
							WHERE ma.world_map_id = ${event.params.id}
						) cells
						WHERE cells.biome <> 'unset'
						LIMIT 1
					`);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const rows = ((terrain as any).rows ?? terrain) as unknown[];
					if (rows.length > 0) {
						error(
							409,
							'Cannot change the grid type after terrain has been painted — erase all terrain first.'
						);
					}
				}

				// Shrinking grid_cells_x/y below terrain visible at ANY playhead
				// orphans it (cells fall outside the new bounds yet still project
				// off the usable grid). Same temporal reasoning: reject when ANY
				// non-'unset' paint_cells interval (or anchor cell) is out of
				// bounds, regardless of a later erase. Growth is always safe.
				if ('gridCellsX' in body || 'gridCellsY' in body) {
					const newCellsX = (updates.gridCellsX as number | undefined) ?? locked.gridCellsX;
					const newCellsY = (updates.gridCellsY as number | undefined) ?? locked.gridCellsY;
					if (newCellsX < locked.gridCellsX || newCellsY < locked.gridCellsY) {
						const oob = await tx.execute(sql`
							SELECT 1 AS hit FROM (
								SELECT (c->>'x')::int AS x, (c->>'y')::int AS y, c->>'biome' AS biome
								FROM map_events me, jsonb_array_elements(me.payload_jsonb->'cells') AS c
								WHERE me.world_map_id = ${event.params.id}
								  AND me.kind = 'paint_cells' AND me.undone_at IS NULL
								UNION ALL
								SELECT (c->>'x')::int AS x, (c->>'y')::int AS y, c->>'biome' AS biome
								FROM map_anchors ma, jsonb_array_elements(ma.state_jsonb->'cells') AS c
								WHERE ma.world_map_id = ${event.params.id}
							) cells
							WHERE cells.biome <> 'unset' AND (cells.x >= ${newCellsX} OR cells.y >= ${newCellsY})
							LIMIT 1
						`);
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const rows = ((oob as any).rows ?? oob) as unknown[];
						if (rows.length > 0) {
							error(
								409,
								'Cannot shrink the grid below painted cells — erase the out-of-bounds terrain first.'
							);
						}
					}
				}
			}

			const [row] = await tx
				.update(worldMaps)
				.set(updates)
				.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)))
				.returning();
			return row;
		});
	} catch (err) {
		const wrapped = err as { code?: string; cause?: { code?: string }; message?: string };
		const code = wrapped.code ?? wrapped.cause?.code ?? '';
		const msg = `${wrapped.message ?? ''} ${(wrapped.cause as { message?: string } | undefined)?.message ?? ''}`;
		if (code === '23P01' || msg.includes('world_maps_variant_no_overlap')) {
			error(
				409,
				"Couldn't save the variant. Another variant for this Location already covers part of that range."
			);
		}
		if (code === '23505' || msg.includes('world_maps_one_default_per_location')) {
			error(
				409,
				"Couldn't save the variant. A default variant for this Location already exists."
			);
		}
		if (code === '23514' || msg.includes('world_maps_variant_position_order')) {
			error(
				400,
				"Couldn't save the variant. The end must come after the start."
			);
		}
		throw err;
	}

	if (!updated) error(404, 'Map not found');
	return json(updated);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [deleted] = await db
		.delete(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)))
		.returning();

	if (!deleted) error(404, 'Map not found');
	return new Response(null, { status: 204 });
};
