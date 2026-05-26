// Server-only helper: fetch the ProjectionContext for a given (worldMapId,
// userId) pair, with the cross-user defenses baked into the SQL.
//
// Why this file exists: src/lib/features/map/projection.ts is a PURE
// function — it must remain client-importable and DB-free. The cross-user
// invariant ("skip faction_id not owned by world_maps.user_id" — see
// docs/plans/world-map-v3-design.md § Slice 1a clarifications, outside-voice
// codex #9) requires a DB query, so it lives here under src/lib/server/.
//
// The regions query JOINs through world_maps.user_id so that a region whose
// map_id points at a different user's world_map cannot appear in the
// allowed-regions set — same defense-in-depth pattern as map_regions and
// entity_aliases (CLAUDE.md trust-boundary rules). Factions carry user_id
// directly, so the scope is a plain equality predicate.

import { eq } from 'drizzle-orm';
import { factions } from './db/schema.js';
import type {
	AllowedFaction,
	ProjectionContext
} from '$lib/features/map/projection.js';
import { readBaselineRegionsForUser } from './world-map-v3.js';

// Loose-typed db param so this works for both the production postgres-js
// driver and PGlite test instances; Drizzle's runtime API is identical
// across drivers and only the connection type differs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export async function fetchProjectionContext(
	db: AnyDb,
	worldMapId: string,
	userId: string
): Promise<ProjectionContext> {
	const factionRows: Array<{ id: string; color: string }> = await db
		.select({ id: factions.id, color: factions.color })
		.from(factions)
		.where(eq(factions.userId, userId));

	// Slice 2 D2 PR-B: allowedRegions now reads from baseline anchor JSON
	// via readBaselineRegionsForUser (cross-user-scoped via JOIN through
	// world_maps.user_id). Same set of region ids as the old map_regions
	// query post-T4 backfill invariant.
	const regionRows = await readBaselineRegionsForUser(db, userId, worldMapId);

	const allowedFactions = new Map<string, AllowedFaction>();
	for (const row of factionRows) {
		allowedFactions.set(row.id, { id: row.id, color: row.color });
	}

	const allowedRegions = new Set<string>();
	for (const row of regionRows) {
		allowedRegions.add(row.id);
	}

	return { allowedFactions, allowedRegions };
}
