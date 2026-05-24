// World Map v3 server chokepoints — anchors, events, factions.
//
// Every write that touches map_anchors / map_events / factions MUST go
// through these functions so the cross-user invariant (CLAUDE.md: "a
// missing JOIN is a cross-user data leak") and the polymorphic FK
// invariant on map_events.source_event_id (CLAUDE.md → "Polymorphic FK
// invariants") are enforced at exactly one place. API handlers call into
// here; tests pin the regression class via tests/integration/auth-isolation-*
// and tests/integration/polymorphic-fk-source-event.
//
// Event kinds are the Slice 1b discriminated union. Slice 1 ships only
// `transfer_region`; later slices add `move_entity`, `link_chain`,
// `spawn_artifact`, `despawn_artifact`. Adding a kind requires extending
// EVENT_KINDS + validateEventPayload + projection.ts's fold.

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { factions, mapAnchors, mapEvents, mapRegions, worldMaps } from './db/schema.js';
import { assertSourceEventIdIsEvent } from './intervals/polymorphic-fk.js';
import type { Db } from './intervals.js';
import {
	EVENT_KINDS,
	type AnchorState,
	type EventKind,
	type TransferRegionPayload
} from '$lib/features/map/projection.js';

// Re-export the shared event-payload type so callers that only depend on the
// server module don't have to reach across into projection.ts.
export { EVENT_KINDS };
export type { EventKind, TransferRegionPayload };

// CSS hex color: 3-digit (#abc), 4-digit (#abcd / rgba shorthand), 6-digit
// (#aabbcc), or 8-digit (#aabbccdd / rgba). 5- and 7-digit hex are not
// valid CSS colors; reject them.
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// RFC 4122 UUID format. Postgres's `uuid` column type rejects malformed
// strings with a 22P02 syntax error; without a write-time format check
// these surface as 500s for any request that supplies a non-UUID route
// param (e.g. /api/maps/not-a-uuid/anchors) or payload id. Validate at
// the boundary so it's always a clean 400.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function assertUuid(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !UUID_RE.test(value)) {
		error(400, `${label} must be a uuid`);
	}
}

// Guard that a JSON body is a plain object before using `in`/key-access.
// readJson() rejects malformed JSON but accepts valid JSON scalars/arrays —
// `null in null` and `'x' in 42` throw TypeError, which would surface as a
// 500 instead of a clean 400. Every PATCH entry routes through here.
function assertObjectBody(body: unknown): asserts body is Record<string, unknown> {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'Request body must be a JSON object');
	}
}

// ── Faction CRUD ────────────────────────────────────────────────────────────

export type FactionInput = {
	name: string;
	color: string;
	styleJsonb?: Record<string, unknown> | null;
};

function validateFactionInput(input: Partial<FactionInput>): void {
	if (typeof input.name !== 'string' || input.name.trim() === '') {
		error(400, 'Faction name is required');
	}
	if (typeof input.color !== 'string' || !HEX_COLOR_RE.test(input.color)) {
		error(400, 'Faction color must be a hex string like #aabbcc');
	}
}

export async function createFaction(
	db: Db,
	userId: string,
	input: FactionInput
): Promise<typeof factions.$inferSelect> {
	assertObjectBody(input);
	validateFactionInput(input);
	const [row] = await db
		.insert(factions)
		.values({
			userId,
			name: input.name.trim(),
			color: input.color,
			styleJsonb: input.styleJsonb ?? null
		})
		.returning();
	return row;
}

export async function updateFaction(
	db: Db,
	userId: string,
	factionId: string,
	patch: Partial<FactionInput>
): Promise<typeof factions.$inferSelect> {
	assertUuid(factionId, 'faction id');
	assertObjectBody(patch);
	const updates: Record<string, unknown> = {};
	if ('name' in patch) {
		if (typeof patch.name !== 'string' || patch.name.trim() === '') {
			error(400, 'Faction name must be a non-empty string');
		}
		updates.name = patch.name.trim();
	}
	if ('color' in patch) {
		if (typeof patch.color !== 'string' || !HEX_COLOR_RE.test(patch.color)) {
			error(400, 'Faction color must be a hex string');
		}
		updates.color = patch.color;
	}
	if ('styleJsonb' in patch) updates.styleJsonb = patch.styleJsonb ?? null;

	if (Object.keys(updates).length === 0) {
		error(400, 'No updatable fields supplied');
	}

	const [row] = await db
		.update(factions)
		.set(updates)
		.where(and(eq(factions.id, factionId), eq(factions.userId, userId)))
		.returning();
	if (!row) error(404, 'Faction not found');
	return row;
}

/**
 * Delete a faction. `map_events.payload_jsonb.new_faction_id` references are
 * NOT cascade-deleted (event log is truth of history per design § "Faction
 * integrity policy"). The renderer lazy-GCs the broken reference and shows
 * "ownership unknown". The UI is expected to call countFactionDependents
 * first, show the warn-before-commit dialog, then call deleteFaction.
 */
export async function deleteFaction(
	db: Db,
	userId: string,
	factionId: string
): Promise<void> {
	assertUuid(factionId, 'faction id');
	const [existing] = await db
		.select({ id: factions.id })
		.from(factions)
		.where(and(eq(factions.id, factionId), eq(factions.userId, userId)));
	if (!existing) error(404, 'Faction not found');

	await db.delete(factions).where(and(eq(factions.id, factionId), eq(factions.userId, userId)));
}

/**
 * Count dependent transfer_region events that reference this faction's id
 * via payload_jsonb.new_faction_id. Surfaced by GET /api/factions/[id]/dependents
 * so the UI can show "deleting will leave N events with ownership-unknown"
 * before calling DELETE. JOIN through world_maps.user_id is defense in depth
 * — validateEventPayload rejects cross-user faction refs at write time, so
 * payloads referencing this faction on another user's map shouldn't exist;
 * the JOIN ensures the count stays scoped if that invariant ever breaks.
 */
export async function countFactionDependents(
	db: Db,
	userId: string,
	factionId: string
): Promise<number> {
	assertUuid(factionId, 'faction id');
	const [existing] = await db
		.select({ id: factions.id })
		.from(factions)
		.where(and(eq(factions.id, factionId), eq(factions.userId, userId)));
	if (!existing) error(404, 'Faction not found');

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(mapEvents)
		.innerJoin(worldMaps, eq(mapEvents.worldMapId, worldMaps.id))
		.where(
			and(
				eq(worldMaps.userId, userId),
				eq(mapEvents.kind, 'transfer_region'),
				sql`${mapEvents.payloadJsonb} ->> 'new_faction_id' = ${factionId}`
			)
		);
	return count;
}

// ── Map ownership gate ──────────────────────────────────────────────────────

async function assertMapOwnership(db: Db, userId: string, worldMapId: string): Promise<void> {
	assertUuid(worldMapId, 'map id');
	const [row] = await db
		.select({ id: worldMaps.id })
		.from(worldMaps)
		.where(and(eq(worldMaps.id, worldMapId), eq(worldMaps.userId, userId)));
	if (!row) error(404, 'Map not found');
}

// ── State_jsonb validator ──────────────────────────────────────────────────
// Anchor state_jsonb is user-supplied via the right-click "Snapshot world
// state here" UX. Validation has two layers:
//
//   1. Shape: regions/artifacts/chains must be arrays if present, so
//      projectState (which trusts the structure) doesn't need to
//      defensively `Array.isArray` every frame.
//
//   2. Ownership: every regions[].region_id must reference a row on THIS
//      world map, and every regions[].faction_id must reference a faction
//      owned by this user. Closes the same cross-user gap the event
//      validator closes: an attacker authenticated as user A POSTing an
//      anchor whose regions[].region_id is user B's region uuid would
//      otherwise persist a cross-user identifier into A's map_anchors row.
//      Lazy GC at render is a second line of defense; rejecting at write
//      is the better invariant.
//
// artifacts[] and chains[] are NOT authored in Slice 1b (Slice 4 / Slice 5
// respectively); their nested ids skip ownership validation until those
// slices wire the write paths.

function validateAnchorStateShape(state: unknown): asserts state is AnchorState {
	// `typeof [] === 'object'` is true — arrays must be rejected explicitly
	// or `state_jsonb: []` would pass and persist (Codex PR54#2). Same
	// pattern as assertObjectBody but kept inline so the call sites read
	// cleanly.
	if (state === null || typeof state !== 'object' || Array.isArray(state)) {
		error(400, 'state_jsonb must be an object');
	}
	const s = state as Record<string, unknown>;
	if ('regions' in s && s.regions !== undefined && !Array.isArray(s.regions)) {
		error(400, 'state_jsonb.regions must be an array if present');
	}
	if ('artifacts' in s && s.artifacts !== undefined && !Array.isArray(s.artifacts)) {
		error(400, 'state_jsonb.artifacts must be an array if present');
	}
	if ('chains' in s && s.chains !== undefined && !Array.isArray(s.chains)) {
		error(400, 'state_jsonb.chains must be an array if present');
	}
}

async function validateAnchorStateOwnership(
	db: Db,
	userId: string,
	worldMapId: string,
	state: AnchorState
): Promise<void> {
	const regions = state.regions ?? [];
	if (regions.length === 0) return;

	// Collect distinct ids first to batch the IN queries.
	const regionIds = new Set<string>();
	const factionIds = new Set<string>();
	for (const r of regions) {
		if (r === null || typeof r !== 'object' || Array.isArray(r)) {
			error(400, 'state_jsonb.regions[] must contain objects');
		}
		assertUuid(r.region_id, 'state_jsonb.regions[].region_id');
		regionIds.add(r.region_id);
		// faction_id is optional and may be explicitly null (= unowned). Any
		// OTHER non-string value (number, object, array, undefined-via-typo)
		// is a malformed write — reject rather than silently dropping the
		// scope check. null is the only non-string we tolerate.
		if (r.faction_id === null || r.faction_id === undefined) {
			continue;
		}
		assertUuid(r.faction_id, 'state_jsonb.regions[].faction_id');
		factionIds.add(r.faction_id);
	}

	// Region ownership: must belong to THIS map.
	if (regionIds.size > 0) {
		const rows = await db
			.select({ id: mapRegions.id })
			.from(mapRegions)
			.where(and(inArray(mapRegions.id, [...regionIds]), eq(mapRegions.mapId, worldMapId)));
		const found = new Set(rows.map((r) => r.id));
		for (const id of regionIds) {
			if (!found.has(id)) error(400, `region_id ${id} not found on this map`);
		}
	}

	// Faction ownership: must belong to this user.
	if (factionIds.size > 0) {
		const rows = await db
			.select({ id: factions.id })
			.from(factions)
			.where(and(inArray(factions.id, [...factionIds]), eq(factions.userId, userId)));
		const found = new Set(rows.map((r) => r.id));
		for (const id of factionIds) {
			if (!found.has(id)) error(400, `faction_id ${id} not owned by caller`);
		}
	}
}

// ── Anchor CRUD ─────────────────────────────────────────────────────────────

export type AnchorInput = {
	tPosition: number;
	stateJsonb: AnchorState;
};

// (resolveAnchorPosition removed — PR 2 ships the right-click authoring UX
// that captures the playhead's tPosition directly; Slice 2's auto-anchor
// will re-introduce an FK-based helper when it actually has a caller.)

export async function createMapAnchor(
	db: Db,
	userId: string,
	worldMapId: string,
	input: AnchorInput
): Promise<typeof mapAnchors.$inferSelect> {
	await assertMapOwnership(db, userId, worldMapId);
	assertObjectBody(input);
	if (typeof input.tPosition !== 'number' || !isFinite(input.tPosition)) {
		// Note: '-Infinity' sentinel is created by the 0012 backfill, not by
		// authored writes. App code must never write Infinity/-Infinity here.
		error(400, 'tPosition must be a finite number');
	}
	validateAnchorStateShape(input.stateJsonb);
	await validateAnchorStateOwnership(db, userId, worldMapId, input.stateJsonb);

	try {
		const [row] = await db
			.insert(mapAnchors)
			.values({
				worldMapId,
				tPosition: input.tPosition,
				stateJsonb: input.stateJsonb
			})
			.returning();
		return row;
	} catch (err) {
		// Unique violation on (world_map_id, t_position) when an anchor
		// already exists at this T — surface as 409 so the UI can offer
		// "edit existing anchor" instead of silently failing. Drizzle +
		// PGlite both wrap the original Postgres error in `.cause`, so we
		// check both levels.
		if (isUniqueViolation(err)) {
			error(409, 'An anchor already exists at this t_position');
		}
		throw err;
	}
}

function isUniqueViolation(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const top = (err as { code?: string }).code;
	if (top === '23505') return true;
	const cause = (err as { cause?: unknown }).cause;
	if (cause && typeof cause === 'object' && (cause as { code?: string }).code === '23505') {
		return true;
	}
	return false;
}

export async function updateMapAnchor(
	db: Db,
	userId: string,
	worldMapId: string,
	anchorId: string,
	patch: Partial<AnchorInput>
): Promise<typeof mapAnchors.$inferSelect> {
	await assertMapOwnership(db, userId, worldMapId);
	assertUuid(anchorId, 'anchor id');
	assertObjectBody(patch);

	const updates: Record<string, unknown> = {};
	if ('tPosition' in patch) {
		if (typeof patch.tPosition !== 'number' || !isFinite(patch.tPosition)) {
			error(400, 'tPosition must be a finite number');
		}
		updates.tPosition = patch.tPosition;
	}
	if ('stateJsonb' in patch) {
		validateAnchorStateShape(patch.stateJsonb);
		await validateAnchorStateOwnership(db, userId, worldMapId, patch.stateJsonb as AnchorState);
		updates.stateJsonb = patch.stateJsonb;
	}

	if (Object.keys(updates).length === 0) {
		error(400, 'No updatable fields supplied');
	}

	let row: typeof mapAnchors.$inferSelect | undefined;
	try {
		[row] = await db
			.update(mapAnchors)
			.set(updates)
			.where(and(eq(mapAnchors.id, anchorId), eq(mapAnchors.worldMapId, worldMapId)))
			.returning();
	} catch (err) {
		// Same UNIQUE (world_map_id, t_position) collision shape as
		// createMapAnchor — PATCHing tPosition onto an occupied slot lands
		// here. Surface 409 so the UI can offer "edit the existing anchor"
		// instead of seeing an opaque 500.
		if (isUniqueViolation(err)) {
			error(409, 'An anchor already exists at this t_position');
		}
		throw err;
	}
	if (!row) error(404, 'Anchor not found');
	return row;
}

export async function deleteMapAnchor(
	db: Db,
	userId: string,
	worldMapId: string,
	anchorId: string
): Promise<void> {
	await assertMapOwnership(db, userId, worldMapId);
	assertUuid(anchorId, 'anchor id');
	const deleted = await db
		.delete(mapAnchors)
		.where(and(eq(mapAnchors.id, anchorId), eq(mapAnchors.worldMapId, worldMapId)))
		.returning();
	if (deleted.length === 0) error(404, 'Anchor not found');
}

// ── Event CRUD ──────────────────────────────────────────────────────────────

export type EventInput = {
	tPosition: number;
	kind: EventKind;
	payloadJsonb: unknown;
	sourceEventId?: string | null;
};

async function validateEventPayload(
	db: Db,
	userId: string,
	worldMapId: string,
	kind: EventKind,
	payload: unknown
): Promise<void> {
	if (!payload || typeof payload !== 'object') {
		error(400, 'payload_jsonb must be an object');
	}
	if (kind === 'transfer_region') {
		const p = payload as Partial<TransferRegionPayload>;
		assertUuid(p.region_id, 'transfer_region payload.region_id');
		assertUuid(p.new_faction_id, 'transfer_region payload.new_faction_id');
		// Verify the region belongs to THIS world map (which is already
		// scoped to userId via assertMapOwnership upstream). Without this
		// check, an attacker authenticated as user A could POST a
		// transfer_region whose region_id is user B's region uuid, leaking
		// a cross-user identifier into A's map_events rows. The renderer's
		// lazy GC would drop it at render time, but the row would persist
		// as a probing oracle. Reject at write — cross-user references
		// must never reach the DB.
		const [region] = await db
			.select({ id: mapRegions.id })
			.from(mapRegions)
			.where(and(eq(mapRegions.id, p.region_id), eq(mapRegions.mapId, worldMapId)));
		if (!region) error(400, 'region_id not found on this map');
		// Verify the faction is owned by this user. Same defense — faction
		// ownership is by user_id, not map, so we scope through factions.user_id.
		const [faction] = await db
			.select({ id: factions.id })
			.from(factions)
			.where(and(eq(factions.id, p.new_faction_id), eq(factions.userId, userId)));
		if (!faction) error(400, 'new_faction_id not found');
	}
}

export async function createMapEvent(
	db: Db,
	userId: string,
	worldMapId: string,
	input: EventInput
): Promise<typeof mapEvents.$inferSelect> {
	await assertMapOwnership(db, userId, worldMapId);
	assertObjectBody(input);
	if (typeof input.tPosition !== 'number' || !isFinite(input.tPosition)) {
		error(400, 'tPosition must be a finite number');
	}
	if (!EVENT_KINDS.includes(input.kind)) {
		error(400, `Unknown event kind: ${input.kind}`);
	}
	await validateEventPayload(db, userId, worldMapId, input.kind, input.payloadJsonb);

	// source_event_id: explicit type check, not a truthy check. Codex PR54#2:
	// `if (input.sourceEventId)` would skip validation for the empty string,
	// but `"" ?? null` is `""` (nullish coalescing only triggers on null/
	// undefined), so the INSERT would still write the empty string and hit
	// a DB error. Coerce explicitly.
	if (input.sourceEventId !== null && input.sourceEventId !== undefined) {
		if (typeof input.sourceEventId !== 'string' || input.sourceEventId === '') {
			error(400, 'source_event_id must be a non-empty uuid string or null');
		}
		assertUuid(input.sourceEventId, 'source_event_id');
		// Polymorphic FK invariant (CLAUDE.md). source_event_id must point at
		// an entity of type='Event' owned by the caller. This is the second
		// of the two required write-time enforcement points (the first lives
		// in the migration test, the second is here at every writer site).
		// assertSourceEventIdIsEvent throws plain Errors ("Entity not found",
		// "Polymorphic FK violation") which SvelteKit surfaces as 500. The
		// invariant violation is client input, not internal failure — convert
		// to 400 so the API contract stays clean.
		try {
			await assertSourceEventIdIsEvent(db, input.sourceEventId, userId);
		} catch (err) {
			const msg = (err as Error).message ?? 'source_event_id is invalid';
			if (/Entity not found|Polymorphic FK violation/.test(msg)) {
				error(400, msg);
			}
			throw err;
		}
	}

	const [row] = await db
		.insert(mapEvents)
		.values({
			worldMapId,
			tPosition: input.tPosition,
			kind: input.kind,
			payloadJsonb: input.payloadJsonb,
			sourceEventId: input.sourceEventId ?? null
		})
		.returning();
	return row;
}

export async function deleteMapEvent(
	db: Db,
	userId: string,
	worldMapId: string,
	eventId: string
): Promise<void> {
	await assertMapOwnership(db, userId, worldMapId);
	assertUuid(eventId, 'event id');
	const deleted = await db
		.delete(mapEvents)
		.where(and(eq(mapEvents.id, eventId), eq(mapEvents.worldMapId, worldMapId)))
		.returning();
	if (deleted.length === 0) error(404, 'Event not found');
}

// ── Read paths ──────────────────────────────────────────────────────────────
//
// Hard cap on list responses. Slice 1b's authoring UX doesn't approach this
// volume for a single map; the cap is a safety net for the moment a user
// has authored hundreds of events and one GET would otherwise ship them all.
// Slice 5+ may swap this for cursor pagination ordered by the same
// (t_position, created_at, id) sort the projection layer relies on.
//
// LIST_LIMIT + 1 fetches a sentinel row so the handler can flip `truncated`
// to true without a second count query.

export const LIST_LIMIT = 500;

export type ListResponse<T> = {
	rows: T[];
	truncated: boolean;
};

function makeListResponse<T>(rows: T[]): ListResponse<T> {
	const truncated = rows.length > LIST_LIMIT;
	return {
		rows: truncated ? rows.slice(0, LIST_LIMIT) : rows,
		truncated
	};
}

export async function listFactions(
	db: Db,
	userId: string
): Promise<ListResponse<typeof factions.$inferSelect>> {
	const rows = await db
		.select()
		.from(factions)
		.where(eq(factions.userId, userId))
		.orderBy(asc(factions.createdAt))
		.limit(LIST_LIMIT + 1);
	return makeListResponse(rows);
}

export async function listMapAnchors(
	db: Db,
	userId: string,
	worldMapId: string
): Promise<ListResponse<typeof mapAnchors.$inferSelect>> {
	await assertMapOwnership(db, userId, worldMapId);
	const rows = await db
		.select()
		.from(mapAnchors)
		.where(eq(mapAnchors.worldMapId, worldMapId))
		.orderBy(asc(mapAnchors.tPosition), asc(mapAnchors.createdAt), asc(mapAnchors.id))
		.limit(LIST_LIMIT + 1);
	return makeListResponse(rows);
}

export async function listMapEvents(
	db: Db,
	userId: string,
	worldMapId: string
): Promise<ListResponse<typeof mapEvents.$inferSelect>> {
	await assertMapOwnership(db, userId, worldMapId);
	const rows = await db
		.select()
		.from(mapEvents)
		.where(eq(mapEvents.worldMapId, worldMapId))
		.orderBy(asc(mapEvents.tPosition), asc(mapEvents.createdAt), asc(mapEvents.id))
		.limit(LIST_LIMIT + 1);
	return makeListResponse(rows);
}
