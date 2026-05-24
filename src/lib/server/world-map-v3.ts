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

import { and, asc, eq, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { entities, factions, mapAnchors, mapEvents, worldMaps } from './db/schema.js';
import { assertSourceEventIdIsEvent } from './intervals/polymorphic-fk.js';
import { computeIntervalPositions } from './intervals/recompute.js';
import type { Db } from './intervals.js';
import type { AnchorState } from '$lib/features/map/projection.js';

export const EVENT_KINDS = ['transfer_region'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type TransferRegionPayload = {
	region_id: string;
	new_faction_id: string;
};

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
	if (typeof input.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(input.color)) {
		error(400, 'Faction color must be a hex string like #aabbcc');
	}
}

export async function createFaction(
	db: Db,
	userId: string,
	input: FactionInput
): Promise<typeof factions.$inferSelect> {
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
	const updates: Record<string, unknown> = {};
	if ('name' in patch) {
		if (typeof patch.name !== 'string' || patch.name.trim() === '') {
			error(400, 'Faction name must be a non-empty string');
		}
		updates.name = patch.name.trim();
	}
	if ('color' in patch) {
		if (typeof patch.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(patch.color)) {
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
 * "ownership unknown". This function returns the count of dependent events
 * so the UI can warn before commit.
 */
export async function deleteFaction(
	db: Db,
	userId: string,
	factionId: string
): Promise<{ dependentEventCount: number }> {
	const [existing] = await db
		.select({ id: factions.id })
		.from(factions)
		.where(and(eq(factions.id, factionId), eq(factions.userId, userId)));
	if (!existing) error(404, 'Faction not found');

	// Count dependent transfer_region events where payload_jsonb.new_faction_id
	// matches. JOIN through world_maps.user_id is defense in depth — factions
	// are user-owned so cross-user payloads can't exist, but the JOIN
	// guarantees that even if they did, the count stays scoped.
	const dependentEvents = await db
		.select({ id: mapEvents.id })
		.from(mapEvents)
		.innerJoin(worldMaps, eq(mapEvents.worldMapId, worldMaps.id))
		.where(
			and(
				eq(worldMaps.userId, userId),
				eq(mapEvents.kind, 'transfer_region'),
				sql`${mapEvents.payloadJsonb} ->> 'new_faction_id' = ${factionId}`
			)
		);
	const dependentEventCount = dependentEvents.length;

	await db.delete(factions).where(and(eq(factions.id, factionId), eq(factions.userId, userId)));

	return { dependentEventCount };
}

// ── Map ownership gate ──────────────────────────────────────────────────────

async function assertMapOwnership(db: Db, userId: string, worldMapId: string): Promise<void> {
	const [row] = await db
		.select({ id: worldMaps.id })
		.from(worldMaps)
		.where(and(eq(worldMaps.id, worldMapId), eq(worldMaps.userId, userId)));
	if (!row) error(404, 'Map not found');
}

// ── State_jsonb validator ──────────────────────────────────────────────────
// Anchor state_jsonb is user-supplied via the right-click "Snapshot world
// state here" UX. Lock the shape at the chokepoint so projectState (which
// trusts the structure) doesn't have to defensively `Array.isArray` every
// frame. The check is shallow — values inside regions/artifacts/chains are
// trust-but-verify; lazy GC in projection drops anything that doesn't
// resolve.

function validateAnchorState(state: unknown): asserts state is AnchorState {
	if (!state || typeof state !== 'object') {
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

// ── Anchor CRUD ─────────────────────────────────────────────────────────────

export type AnchorInput = {
	tPosition: number;
	stateJsonb: AnchorState;
};

/**
 * Resolve a fractional t_position from an Act/Scene tuple. The right-click
 * "Snapshot world state here" UX captures the playhead as a position
 * directly, but anchor authoring driven by scene-boundary selection can
 * pass FKs instead. Centralized here so both paths produce identical
 * positions and Slice 2's auto-anchor (if it ships per CMT-2 retro) can
 * reuse the same math.
 */
export async function resolveAnchorPosition(
	db: Db,
	userId: string,
	opts: {
		tPosition?: number;
		actId?: string;
		sceneId?: string | null;
	}
): Promise<number> {
	if (typeof opts.tPosition === 'number' && isFinite(opts.tPosition)) {
		return opts.tPosition;
	}
	if (!opts.actId) {
		error(400, 'Anchor position requires either tPosition or actId');
	}
	const derived = await computeIntervalPositions(
		db,
		{
			startActId: opts.actId,
			startSceneId: opts.sceneId ?? null,
			endActId: opts.actId,
			endSceneId: opts.sceneId ?? null
		},
		userId
	);
	return derived.startPosition;
}

export async function createMapAnchor(
	db: Db,
	userId: string,
	worldMapId: string,
	input: AnchorInput
): Promise<typeof mapAnchors.$inferSelect> {
	await assertMapOwnership(db, userId, worldMapId);
	if (typeof input.tPosition !== 'number' || !isFinite(input.tPosition)) {
		// Note: '-Infinity' sentinel is created by the 0012 backfill, not by
		// authored writes. App code must never write Infinity/-Infinity here.
		error(400, 'tPosition must be a finite number');
	}
	validateAnchorState(input.stateJsonb);

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
		// "edit existing anchor" instead of silently failing.
		const code = (err as { code?: string }).code;
		if (code === '23505') {
			error(409, 'An anchor already exists at this t_position');
		}
		throw err;
	}
}

export async function updateMapAnchor(
	db: Db,
	userId: string,
	worldMapId: string,
	anchorId: string,
	patch: Partial<AnchorInput>
): Promise<typeof mapAnchors.$inferSelect> {
	await assertMapOwnership(db, userId, worldMapId);

	const updates: Record<string, unknown> = {};
	if ('tPosition' in patch) {
		if (typeof patch.tPosition !== 'number' || !isFinite(patch.tPosition)) {
			error(400, 'tPosition must be a finite number');
		}
		updates.tPosition = patch.tPosition;
	}
	if ('stateJsonb' in patch) {
		validateAnchorState(patch.stateJsonb);
		updates.stateJsonb = patch.stateJsonb;
	}

	if (Object.keys(updates).length === 0) {
		error(400, 'No updatable fields supplied');
	}

	const [row] = await db
		.update(mapAnchors)
		.set(updates)
		.where(and(eq(mapAnchors.id, anchorId), eq(mapAnchors.worldMapId, worldMapId)))
		.returning();
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
	kind: EventKind,
	payload: unknown
): Promise<void> {
	if (!payload || typeof payload !== 'object') {
		error(400, 'payload_jsonb must be an object');
	}
	if (kind === 'transfer_region') {
		const p = payload as Partial<TransferRegionPayload>;
		if (typeof p.region_id !== 'string') {
			error(400, 'transfer_region payload requires region_id (uuid string)');
		}
		if (typeof p.new_faction_id !== 'string') {
			error(400, 'transfer_region payload requires new_faction_id (uuid string)');
		}
		// Verify the faction is owned by this user. The renderer's lazy GC
		// would catch a foreign faction at render time, but rejecting it at
		// write time is the better invariant: cross-user references should
		// never reach the DB.
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
	if (typeof input.tPosition !== 'number' || !isFinite(input.tPosition)) {
		error(400, 'tPosition must be a finite number');
	}
	if (!EVENT_KINDS.includes(input.kind)) {
		error(400, `Unknown event kind: ${input.kind}`);
	}
	await validateEventPayload(db, userId, input.kind, input.payloadJsonb);

	if (input.sourceEventId) {
		// Polymorphic FK invariant (CLAUDE.md). source_event_id must point at
		// an entity of type='Event' owned by the caller. This is the second
		// of the two required write-time enforcement points (the first lives
		// in the migration test, the second is here at every writer site).
		await assertSourceEventIdIsEvent(db, input.sourceEventId, userId);
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
	const deleted = await db
		.delete(mapEvents)
		.where(and(eq(mapEvents.id, eventId), eq(mapEvents.worldMapId, worldMapId)))
		.returning();
	if (deleted.length === 0) error(404, 'Event not found');
}

// ── Read paths ──────────────────────────────────────────────────────────────

export async function listFactions(
	db: Db,
	userId: string
): Promise<Array<typeof factions.$inferSelect>> {
	return db
		.select()
		.from(factions)
		.where(eq(factions.userId, userId))
		.orderBy(asc(factions.createdAt));
}

export async function listMapAnchors(
	db: Db,
	userId: string,
	worldMapId: string
): Promise<Array<typeof mapAnchors.$inferSelect>> {
	await assertMapOwnership(db, userId, worldMapId);
	return db
		.select()
		.from(mapAnchors)
		.where(eq(mapAnchors.worldMapId, worldMapId))
		.orderBy(asc(mapAnchors.tPosition), asc(mapAnchors.createdAt), asc(mapAnchors.id));
}

export async function listMapEvents(
	db: Db,
	userId: string,
	worldMapId: string
): Promise<Array<typeof mapEvents.$inferSelect>> {
	await assertMapOwnership(db, userId, worldMapId);
	return db
		.select()
		.from(mapEvents)
		.where(eq(mapEvents.worldMapId, worldMapId))
		.orderBy(asc(mapEvents.tPosition), asc(mapEvents.createdAt), asc(mapEvents.id));
}
