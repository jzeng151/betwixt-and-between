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
// Slice 2 D1: fanOutRegionAdd now writes faction_id (defaulting to the
// user's Neutral faction) instead of color. fanOutRegionColorUpdate was
// deleted — the color column on map_regions is gone, so no color-update
// write-through is needed.

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
 * on later anchors.
 *
 * Single atomic UPDATE per anchor — PG handles concurrent updates via
 * MVCC. Cross-user scoped via the worldMaps.userId predicate so a stray
 * call from an unscoped handler can't touch another user's anchors.
 */
export async function fanOutRegionAdd(
	tx: Tx,
	mapId: string,
	userId: string,
	region: { id: string; factionId: string }
): Promise<void> {
	const entry = JSON.stringify({
		region_id: region.id,
		faction_id: region.factionId
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
