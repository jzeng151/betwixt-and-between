// Slice 1b — projection context endpoint.
//
// Returns the cross-user-scoped sets the client needs to call
// projectState(t, anchors, events, ctx). The client already holds raw
// anchors + events via PR 1's map-anchors-store / map-events-store; this
// endpoint adds the {allowedFactions, allowedRegions} pair that lets the
// pure projectState resolve faction colors and lazy-GC orphan regions
// without ever importing server-only code.
//
// Cross-user invariant (CLAUDE.md): mapRegions has no user_id column;
// scope must JOIN through worldMaps.user_id. fetchProjectionContext does
// the join. The map-existence pre-check below is defense-in-depth — a
// non-owning user hits 404 instead of an empty-payload 200 that would
// leak the bare fact "this map id exists for someone."

import { json, error } from '@sveltejs/kit';
import { worldMaps } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { fetchProjectionContext } from '$lib/server/projection-context.js';
import { isUuid } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);

	// Codex P2 on PR #55: feeding a malformed param into a UUID-typed
	// predicate raises a Postgres `invalid input syntax for type uuid`
	// error (500), masking what's really a client-side bug. Surface it
	// as 404 — same response shape as "map exists but belongs to another
	// user," matching the existence-leak defense-in-depth pattern used
	// elsewhere in this codebase.
	if (!event.params.id || !isUuid(event.params.id)) error(404, 'Map not found');

	const [map] = await db
		.select({ id: worldMaps.id })
		.from(worldMaps)
		.where(and(eq(worldMaps.id, event.params.id), eq(worldMaps.userId, userId)));
	if (!map) error(404, 'Map not found');

	const ctx = await fetchProjectionContext(db, event.params.id!, userId);

	// Serialize Map / Set to plain JSON shapes. Client reconstructs into
	// Map / Set on receive (use-projection.ts in commit 3c). The shape is
	// stable across the strangler-fig flag's lifetime — Slice 2 deletion
	// doesn't change this endpoint.
	return json({
		allowedFactions: Array.from(ctx.allowedFactions.values()),
		allowedRegions: Array.from(ctx.allowedRegions)
	});
};
