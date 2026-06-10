import { json, error } from '@sveltejs/kit';
import { worldMaps, mapAnchors } from '$lib/server/db/schema.js';
import { desc, eq, sql } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import {
	assertLocationIdIsLocation,
	assertWorldMapVariantBounds,
	resolveWorldMapVariantBounds
} from '$lib/server/world-maps.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const rows = await db
		.select()
		.from(worldMaps)
		.where(eq(worldMaps.userId, userId))
		.orderBy(desc(worldMaps.createdAt));
	return json(rows);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const {
		name,
		locationId,
		startActId,
		startSceneId,
		endActId,
		endSceneId
	} = body;

	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}
	await assertLocationIdIsLocation(db, userId, locationId);

	// Scene FKs without their parent Act FK are auto-cleared, mirroring PATCH's
	// "clearing an act FK must also clear its scene FK" rule. Without this, a
	// payload like {startSceneId, no startActId} would persist scene anchors on
	// a default variant (start_position IS NULL) and could trip the
	// world_maps_one_default_per_location unique index unexpectedly.
	const normalizedStartActId = startActId ?? null;
	const normalizedEndActId = endActId ?? null;
	const normalizedStartSceneId = normalizedStartActId === null ? null : (startSceneId ?? null);
	const normalizedEndSceneId = normalizedEndActId === null ? null : (endSceneId ?? null);

	await assertWorldMapVariantBounds(db, userId, {
		startActId: normalizedStartActId,
		startSceneId: normalizedStartSceneId,
		endActId: normalizedEndActId,
		endSceneId: normalizedEndSceneId
	});

	let startPosition: number | null = null;
	let endPosition: number | null = null;
	try {
		const bounds = await resolveWorldMapVariantBounds(
			db,
			{
				startActId: normalizedStartActId,
				startSceneId: normalizedStartSceneId,
				endActId: normalizedEndActId,
				endSceneId: normalizedEndSceneId
			},
			userId
		);
		startPosition = bounds.startPosition;
		endPosition = bounds.endPosition;
	} catch (err) {
		error(400, (err as Error).message);
	}

	// Slice 1b A1 invariant: every world_maps row has at least one baseline
	// anchor at t_position = -Infinity so the Pixi renderer (which reads
	// state via projectState) doesn't show an empty map under ?renderer=pixi
	// even though Leaflet (which reads map_regions directly) renders fine.
	// The 0012 migration backfilled this for existing maps; new maps create
	// it in the same transaction as the worldMaps insert so partial-failure
	// can't leave an anchor-less map.
	let created;
	try {
		created = await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(worldMaps)
				.values({
					userId,
					name: name.trim(),
					locationId: locationId ?? null,
					startActId: normalizedStartActId,
					startSceneId: normalizedStartSceneId,
					endActId: normalizedEndActId,
					endSceneId: normalizedEndSceneId,
					startPosition,
					endPosition
				})
				.returning();
			await tx.insert(mapAnchors).values({
				worldMapId: row.id,
				// `-Infinity`::float8 SQL literal — postgres-js (Neon driver)
				// doesn't serialize JS Number.NEGATIVE_INFINITY to Postgres's
				// '-Infinity' float8 special value reliably (silent 500 in dev),
				// even though PGlite in tests does. Match what migration 0012
				// did. Cast through `unknown` because Drizzle's typed-column
				// .values() expects `number` here, not `SQL`.
				tPosition: sql`'-Infinity'::float8` as unknown as number,
				// Slice 3 invariant (PR A test world-map-v3-slice-3-schema.test.ts):
				// every map_anchors.state_jsonb must include the cells key. Pre-
				// Slice-3 anchors were backfilled by drizzle/0022; new writers
				// must keep the contract green or the invariant scan fails.
				// WM3 Slice A (F22): include strokes:[] too for shape consistency —
				// the read path defaults a missing strokes key to [] anyway, but a
				// fresh map has no strokes and the baseline should say so explicitly.
				stateJsonb: { regions: [], artifacts: [], chains: [], cells: [], strokes: [] }
			});
			return row;
		});
	} catch (err) {
		// Drizzle wraps PG errors; unwrap to get the constraint code + message.
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

	return json(created, { status: 201 });
};
