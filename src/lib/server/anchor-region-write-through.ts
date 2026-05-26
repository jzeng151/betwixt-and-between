// Slice 1b A3 — region write-through to map_anchors.state_jsonb.regions[].
//
// Iron-rule parity: under ?renderer=leaflet, regions are read directly from
// the map_regions table. Under ?renderer=pixi, they come from projectState
// which reads the active anchor's state_jsonb.regions[]. For the two
// renderers to show the same geometry baseline, every map_regions write
// (INSERT/UPDATE/DELETE) must also fan out to every anchor on the map.
//
// Eng-review A3 decision: write to ALL anchors on the map (not just "latest"
// per the original test-plan wording). Geometry is atemporal — a region
// either exists or it doesn't, regardless of which T's snapshot you load.
//
// Concurrency model (Codex P1 on PR #55):
//
// The first cut used JS-side read-modify-write — SELECT all anchors, mutate
// state_jsonb in Node, write each row back. Two concurrent fan-outs could
// both read the same baseline anchor snapshot and clobber each other on
// write. Demo scale made this rare but the structural fix is to keep the
// mutation server-side as a single atomic UPDATE per row, which PG handles
// correctly via MVCC without explicit row locks.
//
// Each helper now issues ONE UPDATE per map that mutates every anchor on
// the map in a single statement, using jsonb_set / jsonb path expressions
// to splice in/remove entries. Per-row atomicity holds; concurrent fan-outs
// on different regions serialize at the row level via MVCC; concurrent
// fan-outs on the SAME region produce a deterministic last-writer-wins.
//
// Slice 2 D1: fanOutRegionAdd writes faction_id (defaulting to the user's
// Neutral faction) instead of color. fanOutRegionColorUpdate was deleted.
//
// Slice 2 D2 PR-A: fanOutRegionAdd now also writes polygon + locationId.
// Anchor jsonb is canonical for geometry; the legacy reads from
// map_regions stay during D2 but anchor JSON is the leading source.
// fanOutRegionPolygonUpdate keeps the two in sync on PATCH.

import { and, eq, sql } from 'drizzle-orm';
import { mapAnchors, worldMaps } from './db/schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/**
 * Append a new region entry to every anchor's `state_jsonb.regions[]` for
 * the given map. If a region with the same `region_id` already exists in
 * an anchor's array (idempotency / retry safety), it's replaced rather
 * than duplicated.
 *
 * factionId is the user's Neutral faction id by default (set in the POST
 * handler via ensureNeutralFaction). transfer_region events override this
 * on later anchors. polygon + locationId mirror the canonical map_regions
 * row during D2; future T5/T6 work moves the canonical source into anchor
 * jsonb and drops map_regions.
 *
 * Single atomic UPDATE per anchor — PG handles concurrent updates via
 * MVCC. Cross-user scoped via the worldMaps.userId predicate so a stray
 * call from an unscoped handler can't touch another user's anchors.
 */
export async function fanOutRegionAdd(
	tx: Tx,
	mapId: string,
	userId: string,
	region: { id: string; factionId: string; polygon: number[][]; locationId: string | null }
): Promise<void> {
	const entry = JSON.stringify({
		region_id: region.id,
		faction_id: region.factionId,
		polygon: region.polygon,
		locationId: region.locationId
	});
	// Build the new regions array in SQL: filter out any existing entry
	// with this region_id (idempotency), then append the new entry. The
	// filter uses jsonb_array_elements + jsonb_agg in a subquery, with
	// COALESCE for the empty-after-filter case.
	await tx.execute(sql`
		UPDATE ${mapAnchors}
		SET state_jsonb = jsonb_set(
			state_jsonb,
			'{regions}',
			COALESCE(
				(
					SELECT jsonb_agg(r)
					FROM jsonb_array_elements(COALESCE(state_jsonb->'regions', '[]'::jsonb)) AS r
					WHERE r->>'region_id' != ${region.id}
				),
				'[]'::jsonb
			) || ${entry}::jsonb,
			true
		)
		FROM ${worldMaps}
		WHERE ${mapAnchors.worldMapId} = ${worldMaps.id}
			AND ${mapAnchors.worldMapId} = ${mapId}
			AND ${worldMaps.userId} = ${userId}
	`);
}

/**
 * Slice 2 D2 PR-A: rewrite polygon and/or locationId for the matching
 * region entry across every anchor's state_jsonb.regions[]. Preserves
 * faction_id (overlay layer) and the legacy `color` field (round-trip).
 * Anchors without a matching region_id no-op via the jsonb_agg + CASE
 * pattern.
 *
 * Pass null for a field to skip its update; pass a value to overwrite.
 * At least one of polygon / locationId must be supplied (callers should
 * not invoke with both null).
 */
export async function fanOutRegionGeometryUpdate(
	tx: Tx,
	mapId: string,
	userId: string,
	regionId: string,
	patch: { polygon?: number[][]; locationId?: string | null }
): Promise<void> {
	const polygonJson =
		patch.polygon !== undefined ? JSON.stringify(patch.polygon) : null;
	const locationIdJson =
		'locationId' in patch
			? patch.locationId === null
				? 'null'
				: JSON.stringify(patch.locationId)
			: null;
	await tx.execute(sql`
		UPDATE ${mapAnchors}
		SET state_jsonb = jsonb_set(
			state_jsonb,
			'{regions}',
			COALESCE(
				(
					SELECT jsonb_agg(
						CASE
							WHEN r->>'region_id' = ${regionId}
								THEN
									CASE
										WHEN ${polygonJson}::text IS NOT NULL
											THEN jsonb_set(r, '{polygon}', ${polygonJson}::jsonb, true)
										ELSE r
									END
									||
									CASE
										WHEN ${locationIdJson}::text IS NOT NULL
											THEN jsonb_build_object('locationId', ${locationIdJson}::jsonb)
										ELSE '{}'::jsonb
									END
							ELSE r
						END
					)
					FROM jsonb_array_elements(COALESCE(state_jsonb->'regions', '[]'::jsonb)) AS r
				),
				'[]'::jsonb
			),
			true
		)
		FROM ${worldMaps}
		WHERE ${mapAnchors.worldMapId} = ${worldMaps.id}
			AND ${mapAnchors.worldMapId} = ${mapId}
			AND ${worldMaps.userId} = ${userId}
	`);
}

/**
 * Remove the entry matching `regionId` from every anchor's
 * `state_jsonb.regions[]`. Region's faction ownership (if any) is dropped
 * with it — the region no longer exists.
 */
export async function fanOutRegionDelete(
	tx: Tx,
	mapId: string,
	userId: string,
	regionId: string
): Promise<void> {
	await tx.execute(sql`
		UPDATE ${mapAnchors}
		SET state_jsonb = jsonb_set(
			state_jsonb,
			'{regions}',
			COALESCE(
				(
					SELECT jsonb_agg(r)
					FROM jsonb_array_elements(COALESCE(state_jsonb->'regions', '[]'::jsonb)) AS r
					WHERE r->>'region_id' != ${regionId}
				),
				'[]'::jsonb
			),
			true
		)
		FROM ${worldMaps}
		WHERE ${mapAnchors.worldMapId} = ${worldMaps.id}
			AND ${mapAnchors.worldMapId} = ${mapId}
			AND ${worldMaps.userId} = ${userId}
	`);
}

// Re-exports keep tests happy without re-importing.
export { and, eq };
