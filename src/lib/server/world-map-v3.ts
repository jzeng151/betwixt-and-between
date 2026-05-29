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

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import {
	factions,
	mapAnchors,
	mapEvents,
	worldMaps,
	worldMapLayerPrefs
} from './db/schema.js';
import { assertSourceEventIdIsEvent } from './intervals/polymorphic-fk.js';
import type { Db } from './intervals.js';
import {
	BIOMES,
	EVENT_KINDS,
	PAINT_CELLS_MAX_PER_EVENT,
	type AnchorState,
	type BiomeKind,
	type EventKind,
	type PaintCellsPayload,
	type TransferRegionPayload
} from '$lib/features/map/projection.js';

// Re-export the shared event-payload type so callers that only depend on the
// server module don't have to reach across into projection.ts.
export { BIOMES, EVENT_KINDS, PAINT_CELLS_MAX_PER_EVENT };
export type { BiomeKind, EventKind, PaintCellsPayload, TransferRegionPayload };

// Slice 3 outside-voice A2 + B7 — auto-anchor fires after K non-undone
// paint_cells events accumulate since the last anchor on a map. Bounds
// projection cost between sparse user-authored anchors. Synthetic anchors
// are marked is_synthetic=true (drizzle/0019) and bypassed by undo's
// dependent-event prompt (A9).
const AUTO_ANCHOR_K = 20;

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

// ── Slice 2 D2 PR-B: region reads through anchor JSON ─────────────────────
//
// Helper for the 7 read sites that previously did
// `db.select().from(mapRegions)`. Returns region shape identical to the old
// map_regions row (id, mapId, locationId, polygon) so callers don't have
// to know they're now reading from anchor JSON. createdAt/updatedAt are
// dropped — clients don't use them and the anchor entries don't carry them.
//
// Source: the baseline anchor (tPosition = -Infinity) for each map. T4's
// backfill + T4's fanOutRegionAdd keep this anchor's regions[] in sync
// with the map_regions table; reads either source give identical
// geometry. T6 drops map_regions; until then both are kept in sync by
// the write paths.

export type AnchorRegionRow = {
	id: string;
	mapId: string;
	locationId: string | null;
	polygon: number[][];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDbOrTx = any;

export async function readBaselineRegions(
	db: AnyDbOrTx,
	worldMapId: string
): Promise<AnchorRegionRow[]> {
	const [anchor] = await db
		.select({ stateJsonb: mapAnchors.stateJsonb })
		.from(mapAnchors)
		.where(eq(mapAnchors.worldMapId, worldMapId))
		.orderBy(asc(mapAnchors.tPosition), asc(mapAnchors.createdAt), asc(mapAnchors.id))
		.limit(1);
	if (!anchor) return [];
	const state = anchor.stateJsonb as AnchorState | null;
	const regions = state?.regions ?? [];
	return regions
		.filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3)
		.map((r) => ({
			id: r.region_id,
			mapId: worldMapId,
			locationId: r.locationId ?? null,
			polygon: r.polygon as number[][]
		}));
}

/**
 * Cross-user-safe variant: scopes through world_maps.user_id so callers
 * that aren't already gated by an ownership assert can use this safely.
 * Returns empty array on cross-user attempt (no existence leak).
 */
export async function readBaselineRegionsForUser(
	db: AnyDbOrTx,
	userId: string,
	worldMapId: string
): Promise<AnchorRegionRow[]> {
	const [anchor] = await db
		.select({ stateJsonb: mapAnchors.stateJsonb })
		.from(mapAnchors)
		.innerJoin(worldMaps, eq(mapAnchors.worldMapId, worldMaps.id))
		.where(and(eq(mapAnchors.worldMapId, worldMapId), eq(worldMaps.userId, userId)))
		.orderBy(asc(mapAnchors.tPosition), asc(mapAnchors.createdAt), asc(mapAnchors.id))
		.limit(1);
	if (!anchor) return [];
	const state = anchor.stateJsonb as AnchorState | null;
	const regions = state?.regions ?? [];
	return regions
		.filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3)
		.map((r) => ({
			id: r.region_id,
			mapId: worldMapId,
			locationId: r.locationId ?? null,
			polygon: r.polygon as number[][]
		}));
}

/**
 * Slice 2 D1: every user has a per-user "Neutral" faction (is_system=true).
 * The migration drizzle/0014_d1_faction_only_color.sql backfills existing
 * users. New users get Neutral lazily on their first faction-or-region
 * write via this helper — the plan's better-auth signup-hook approach
 * works too but threading the request-scoped db through better-auth's
 * hook system is more plumbing than this lazy-create pattern. The result
 * is the same: by the time any region-write needs a Neutral faction_id,
 * one exists.
 *
 * Idempotent. The partial unique index factions_user_one_system enforces
 * "at most one is_system row per user" at the storage layer; this helper
 * checks-then-inserts but a concurrent race that lost the insert would
 * either still see the existing row on retry OR the unique index would
 * have rejected the duplicate. Both outcomes leave us with one row.
 */
export const NEUTRAL_FACTION_COLOR = '#9ca3af';
export const NEUTRAL_FACTION_NAME = 'Neutral';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;
export async function ensureNeutralFaction(tx: AnyTx, userId: string): Promise<string> {
	const [existing] = await tx
		.select({ id: factions.id })
		.from(factions)
		.where(and(eq(factions.userId, userId), eq(factions.isSystem, true)));
	if (existing) return existing.id;
	// codex PR review: try/catch on the INSERT doesn't recover inside a
	// surrounding transaction — PG aborts the entire tx on the unique
	// violation, so the catch-and-reselect still surfaces as 500. Use
	// ON CONFLICT DO NOTHING which keeps the tx alive when the partial
	// unique index factions_user_one_system rejects a concurrent second
	// write. The INSERT returns the new row on the winning path or no
	// rows on the losing path; the post-INSERT SELECT recovers either
	// way without poisoning the transaction.
	await tx
		.insert(factions)
		.values({
			userId,
			name: NEUTRAL_FACTION_NAME,
			color: NEUTRAL_FACTION_COLOR,
			isSystem: true
		})
		.onConflictDoNothing();
	const [row] = await tx
		.select({ id: factions.id })
		.from(factions)
		.where(and(eq(factions.userId, userId), eq(factions.isSystem, true)));
	if (!row) error(500, 'ensureNeutralFaction: row missing after INSERT');
	return row.id;
}

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

	// Slice 2 D1: rename/recolor on Neutral is allowed (user owns it); the
	// guard below only fires for callers that try to set is_system through
	// PATCH (which would shadow the existing Neutral row). is_system is
	// not in FactionInput so the existing TS shape already blocks this at
	// the type level, but the runtime check defends against unchecked
	// `as any` callers. Checked BEFORE the no-updatable-fields gate so a
	// PATCH body of only { isSystem: true } returns 422, not 400.
	if ('isSystem' in (patch as Record<string, unknown>)) {
		error(422, 'is_system cannot be set via PATCH');
	}

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
		.select({ id: factions.id, isSystem: factions.isSystem })
		.from(factions)
		.where(and(eq(factions.id, factionId), eq(factions.userId, userId)));
	if (!existing) error(404, 'Faction not found');
	// Slice 2 D1: the per-user Neutral faction is the fallback ownership
	// target for un-faction-ed regions. Allowing delete would orphan every
	// region that resolves through it. The partial unique index also
	// prevents re-creation of a Neutral after deletion would be allowed
	// here, but rejecting at the helper is the user-facing message.
	if (existing.isSystem) error(422, 'Cannot delete the system Neutral faction');

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
				// Slice 2 D3 (T7): undone events don't count as dependents —
				// they no longer affect projection.
				sql`${mapEvents.undoneAt} IS NULL`,
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
	// Slice 3 T2 — cells must be an array if present. Default of [] is
	// applied by createMapAnchor/updateMapAnchor before INSERT (see below).
	// Per-cell shape/biome/bounds validation runs in those write paths via
	// assertCellsInBounds (codex P2 — anchor POST/PATCH are client-write
	// boundaries, not just internal snapshots of a validated event chain).
	if ('cells' in s && s.cells !== undefined && !Array.isArray(s.cells)) {
		error(400, 'state_jsonb.cells must be an array if present');
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
	// Slice 2 D2 PR-B: existence check reads from baseline anchor JSON.
	// Same answer as map_regions post-T4 invariant.
	if (regionIds.size > 0) {
		const rows = await readBaselineRegions(db, worldMapId);
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

/**
 * Validate a cells array against a map's grid: each entry an object with
 * integer x/y inside [0, gridX) × [0, gridY) and a known biome. Shared by
 * the paint_cells event validator and the authored-anchor write path
 * (codex P2 — anchor POST/PATCH are client-write boundaries too, so a
 * direct snapshot can't be trusted to carry only already-validated cells).
 */
function assertCellsInBounds(cells: unknown, gridX: number, gridY: number, label: string): void {
	if (!Array.isArray(cells)) error(400, `${label} cells must be an array`);
	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i] as { x?: unknown; y?: unknown; biome?: unknown } | null;
		if (!cell || typeof cell !== 'object') error(400, `${label} cells[${i}] must be an object`);
		if (typeof cell.x !== 'number' || !Number.isInteger(cell.x)) {
			error(400, `${label} cells[${i}].x must be an integer`);
		}
		if (typeof cell.y !== 'number' || !Number.isInteger(cell.y)) {
			error(400, `${label} cells[${i}].y must be an integer`);
		}
		if (cell.x < 0 || cell.x >= gridX) {
			error(400, `${label} cells[${i}].x out of bounds [0, ${gridX})`);
		}
		if (cell.y < 0 || cell.y >= gridY) {
			error(400, `${label} cells[${i}].y out of bounds [0, ${gridY})`);
		}
		if (!(BIOMES as readonly string[]).includes(cell.biome as BiomeKind)) {
			error(400, `${label} cells[${i}].biome must be one of ${BIOMES.join('|')}`);
		}
	}
}

/**
 * Load a map's grid dimensions (caller must have asserted ownership).
 */
async function loadGridDims(db: Db, worldMapId: string): Promise<{ x: number; y: number }> {
	const [map] = await db
		.select({ x: worldMaps.gridCellsX, y: worldMaps.gridCellsY })
		.from(worldMaps)
		.where(eq(worldMaps.id, worldMapId));
	if (!map) error(404, 'world_map not found');
	return map;
}

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

	// Slice 3 invariant: every map_anchors.state_jsonb has the cells key.
	// Client-authored anchor snapshots (right-click "snapshot world state
	// here") may omit cells — default to []. Keeps the PR A invariant test
	// green for any authoring path.
	const normalizedState: AnchorState = {
		...input.stateJsonb,
		cells: input.stateJsonb.cells ?? []
	};
	// codex P2: anchor POST is a client-write boundary — validate cell
	// shape/biome/bounds the same way paint_cells does, so a direct snapshot
	// can't persist off-grid terrain that projection would draw and
	// grid-shrink checks would treat as real.
	const grid = await loadGridDims(db, worldMapId);
	assertCellsInBounds(normalizedState.cells, grid.x, grid.y, 'anchor state_jsonb');

	// codex P2: a synthetic anchor (server cache row) may already sit at this
	// T after ~20 paints at the current playhead. It is NOT authored state,
	// so drop synthetic anchors at/after this T BEFORE inserting — otherwise
	// the unique constraint rejects the user's authored snapshot with a 409.
	// This also clears stale downstream synthetic anchors that froze the old
	// base. A real authored anchor at this T survives (synthetic-only delete)
	// and still yields the 409 below.
	//
	// codex P2 (PR #58): the invalidate + insert run under the SAME world_maps
	// row lock createMapEvent holds for paint writes. Without it, a paint can
	// land between the synthetic delete and the authored insert and
	// re-materialize a synthetic anchor from the OLD base — leaving the
	// authored anchor shadowed by a stale snapshot at/after its T. The lock
	// serializes the two; the transaction also rolls the invalidate back if the
	// insert 409s, so a duplicate-T failure doesn't strip synthetic anchors.
	return await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT id FROM world_maps WHERE id = ${worldMapId} FOR UPDATE`);
		await invalidateSyntheticAnchorsAtOrAfter(tx, worldMapId, input.tPosition);
		try {
			const [row] = await tx
				.insert(mapAnchors)
				.values({
					worldMapId,
					tPosition: input.tPosition,
					stateJsonb: normalizedState
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
	});
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

	// Slice 2 D2 PR-C hardening (codex review): the baseline anchor at
	// t_position = -Infinity is canonical for region geometry post-T6.
	// User-facing PATCH/DELETE on the baseline can erase or poison every
	// region on the map. Fan-out helpers (fanOutRegionAdd /
	// fanOutRegionGeometryUpdate / fanOutRegionDelete in
	// anchor-region-write-through.ts) are the only authorized writers to
	// baseline state. Reject any direct edit here.
	const [existing] = await db
		.select({ tPosition: mapAnchors.tPosition })
		.from(mapAnchors)
		.where(and(eq(mapAnchors.id, anchorId), eq(mapAnchors.worldMapId, worldMapId)));
	if (!existing) error(404, 'Anchor not found');
	if (!Number.isFinite(existing.tPosition)) {
		error(422, 'Cannot edit the baseline anchor — it tracks canonical region geometry');
	}

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
		// Slice 3 invariant: cells key must be present. PATCH callers can
		// omit it; default to [] to match createMapAnchor's normalization.
		const incoming = patch.stateJsonb as AnchorState;
		updates.stateJsonb = { ...incoming, cells: incoming.cells ?? [] };
		// codex P2: client-write boundary — validate cell shape/biome/bounds.
		const grid = await loadGridDims(db, worldMapId);
		assertCellsInBounds(
			(updates.stateJsonb as AnchorState).cells,
			grid.x,
			grid.y,
			'anchor state_jsonb'
		);
	}

	if (Object.keys(updates).length === 0) {
		error(400, 'No updatable fields supplied');
	}

	// codex P2: invalidate synthetic anchors at/after the earliest of the
	// old/new t_position BEFORE the update — both to clear stale frozen bases
	// and so PATCHing the t_position onto a synthetic-occupied slot replaces
	// that cache row instead of colliding with it. A real authored anchor at
	// the target T survives (synthetic-only delete) and still 409s below.
	const affectedT = Math.min(
		existing.tPosition,
		(updates.tPosition as number | undefined) ?? existing.tPosition
	);

	// codex P2 (PR #58): invalidate + update under the same world_maps row lock
	// paint writes take, so a concurrent paint can't re-materialize a synthetic
	// anchor from the old base between the delete and the update and shadow the
	// edited anchor.
	let row: typeof mapAnchors.$inferSelect | undefined;
	try {
		row = await db.transaction(async (tx) => {
			await tx.execute(sql`SELECT id FROM world_maps WHERE id = ${worldMapId} FOR UPDATE`);
			await invalidateSyntheticAnchorsAtOrAfter(tx, worldMapId, affectedT);
			const [updatedRow] = await tx
				.update(mapAnchors)
				.set(updates)
				.where(and(eq(mapAnchors.id, anchorId), eq(mapAnchors.worldMapId, worldMapId)))
				.returning();
			return updatedRow;
		});
	} catch (err) {
		// Same UNIQUE (world_map_id, t_position) collision shape as
		// createMapAnchor — PATCHing tPosition onto an anchor-occupied slot
		// lands here. Surface 409 so the UI can offer "edit the existing
		// anchor" instead of seeing an opaque 500.
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
	// Slice 2 D2 PR-C hardening (codex review): see updateMapAnchor's
	// matching guard. Deleting the baseline anchor (t_position = -Infinity)
	// removes the canonical region geometry post-T6; reject explicitly
	// instead of silently dropping every region on the map.
	const [existing] = await db
		.select({ tPosition: mapAnchors.tPosition })
		.from(mapAnchors)
		.where(and(eq(mapAnchors.id, anchorId), eq(mapAnchors.worldMapId, worldMapId)));
	if (!existing) error(404, 'Anchor not found');
	if (!Number.isFinite(existing.tPosition)) {
		error(422, 'Cannot delete the baseline anchor — it tracks canonical region geometry');
	}
	// codex P2 (PR #58): delete + invalidate under the same world_maps row lock
	// paint writes take, so a concurrent paint can't slip a synthetic anchor in
	// between the delete and the invalidation and survive it, shadowing the
	// post-delete base.
	await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT id FROM world_maps WHERE id = ${worldMapId} FOR UPDATE`);
		const deleted = await tx
			.delete(mapAnchors)
			.where(and(eq(mapAnchors.id, anchorId), eq(mapAnchors.worldMapId, worldMapId)))
			.returning();
		if (deleted.length === 0) error(404, 'Anchor not found');
		// Removing an authored anchor changes the base for projections at/after
		// its T — drop synthetic anchors that froze the old base there.
		await invalidateSyntheticAnchorsAtOrAfter(tx, worldMapId, existing.tPosition);
	});
}

// ── Event CRUD ──────────────────────────────────────────────────────────────

export type EventInput = {
	tPosition: number;
	kind: EventKind;
	payloadJsonb: unknown;
	sourceEventId?: string | null;
	// Slice 3 outside-voice B5 — chunked-stroke grouping. Client generates
	// one UUIDv4 per brush stroke; every chunked paint_cells event in that
	// stroke carries the same commandId. Undo treats rows sharing a
	// commandId as one logical command. NULL = standalone event (legacy:
	// transfer_region, manual anchors). Stored in map_events.command_id.
	commandId?: string | null;
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
		// Slice 2 D2 PR-B: existence check reads from baseline anchor JSON.
		const baselineRegions = await readBaselineRegions(db, worldMapId);
		if (!baselineRegions.some((r) => r.id === p.region_id)) {
			error(400, 'region_id not found on this map');
		}
		// Verify the faction is owned by this user. Same defense — faction
		// ownership is by user_id, not map, so we scope through factions.user_id.
		const [faction] = await db
			.select({ id: factions.id })
			.from(factions)
			.where(and(eq(factions.id, p.new_faction_id), eq(factions.userId, userId)));
		if (!faction) error(400, 'new_faction_id not found');
	}
	if (kind === 'paint_cells') {
		const p = payload as Partial<PaintCellsPayload>;
		if (!Array.isArray(p.cells)) {
			error(400, 'paint_cells payload.cells must be an array');
		}
		if (p.cells.length === 0) {
			error(400, 'paint_cells payload.cells must be non-empty');
		}
		// Outside-voice A3: hard reject above the 256-cell cap. Client
		// chunks at this boundary; bigger payloads here mean a non-stock
		// client or a replay attempting to dodge chunking. Either way,
		// reject — auto-anchor sizing assumes the cap holds.
		if (p.cells.length > PAINT_CELLS_MAX_PER_EVENT) {
			error(
				400,
				`paint_cells payload.cells exceeds cap of ${PAINT_CELLS_MAX_PER_EVENT} cells per event`
			);
		}
		// Grid bounds come from world_maps.grid_cells_x/y (Slice 3 T1';
		// drizzle/0018). assertMapOwnership upstream guarantees this map
		// belongs to userId, so the single-row read is safe.
		const [map] = await db
			.select({ x: worldMaps.gridCellsX, y: worldMaps.gridCellsY })
			.from(worldMaps)
			.where(eq(worldMaps.id, worldMapId));
		if (!map) error(404, 'world_map not found');
		assertCellsInBounds(p.cells, map.x, map.y, 'paint_cells');
		// command_complete is optional; when omitted, the auto-anchor
		// path (T22) treats the event as a single-event stroke (eligible
		// to trigger an anchor write). When present, must be a boolean.
		if (p.command_complete !== undefined && typeof p.command_complete !== 'boolean') {
			error(400, 'paint_cells payload.command_complete must be a boolean if provided');
		}
	}
}

export async function createMapEvent(
	db: Db,
	userId: string,
	worldMapId: string,
	input: EventInput
): Promise<typeof mapEvents.$inferSelect & { invalidatedAnchorIds: string[] }> {
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

	// Slice 3 outside-voice B5 — commandId UUID format check + scope guard.
	// Non-NULL commandId values group chunked paint_cells events; undo
	// soft-deletes the whole group. Other kinds (transfer_region, etc.) can
	// pass commandId through too, but in practice only brush authoring uses
	// it. Format must be a valid UUID — assertUuid surfaces 400 on bad input.
	let commandId: string | null = null;
	if (input.commandId !== null && input.commandId !== undefined) {
		if (typeof input.commandId !== 'string' || input.commandId === '') {
			error(400, 'commandId must be a non-empty uuid string or null');
		}
		assertUuid(input.commandId, 'commandId');
		commandId = input.commandId;
	}

	// Slice 3 outside-voice B7 — auto-anchor for paint_cells strokes.
	// Wrap the INSERT + count + synthetic-anchor write in one transaction
	// with SELECT FOR UPDATE on the world_maps row. Two concurrent
	// paint_cells POSTs serialize on the lock; both see consistent counts.
	return await db.transaction(async (tx) => {
		// Lock the parent world_maps row. Cross-user safety: assertMapOwnership
		// upstream already restricts to user-owned maps, so this is only a
		// concurrency control between the same user's own writes.
		await tx.execute(sql`SELECT id FROM world_maps WHERE id = ${worldMapId} FOR UPDATE`);

		// codex P2: re-validate paint_cells bounds UNDER the lock. The
		// validateEventPayload() bounds check above ran before this transaction;
		// a concurrent PATCH /api/maps/:id that shrinks grid_cells_x/y can commit
		// between that read and acquiring this lock, and the PATCH's own shrink
		// guard can't see this not-yet-inserted cell. Grid edits take the SAME
		// world_maps FOR UPDATE lock, so re-reading the grid here sees their
		// committed result — an out-of-bounds paint is rejected instead of
		// slipping terrain outside the new bounds.
		if (input.kind === 'paint_cells') {
			const [lockedGrid] = await tx
				.select({ x: worldMaps.gridCellsX, y: worldMaps.gridCellsY })
				.from(worldMaps)
				.where(eq(worldMaps.id, worldMapId));
			if (!lockedGrid) error(404, 'world_map not found');
			assertCellsInBounds(
				(input.payloadJsonb as Partial<PaintCellsPayload>).cells,
				lockedGrid.x,
				lockedGrid.y,
				'paint_cells'
			);
		}

		const [row] = await tx
			.insert(mapEvents)
			.values({
				worldMapId,
				tPosition: input.tPosition,
				kind: input.kind,
				payloadJsonb: input.payloadJsonb,
				sourceEventId: input.sourceEventId ?? null,
				commandId
			})
			.returning();

		// codex P2: a synthetic anchor at a LATER t_position froze a snapshot
		// that didn't include this event. projectState picks that anchor and
		// excludes events with t_position <= anchorT, so a retroactive or
		// same-T paint, or a transfer_region at T <= the anchor's T, would be
		// silently hidden. Drop synthetic anchors at/after this event's T so a
		// freshly-authored event isn't shadowed by a stale cache row. Runs
		// before the auto-anchor write below, which re-materializes a correct
		// snapshot when the stroke completes. Forward painting (the common
		// case) advances T past every synthetic anchor, so this is a no-op
		// there; only retroactive/same-T edits pay the re-fold cost.
		//
		// codex P2 (PR #58): the deleted synthetic-anchor ids ride back on
		// the response so the client can evict them from mapAnchorsStore.
		// Otherwise the /events response returns only the new event, the
		// client appends it but keeps the now-stale synthetic anchor, and
		// projectState still picks that anchor — hiding the just-authored
		// retroactive/same-T change until a full reload.
		const invalidatedAnchorIds = await invalidateSyntheticAnchorsAtOrAfter(
			tx,
			worldMapId,
			input.tPosition
		);

		if (input.kind === 'paint_cells') {
			await maybeWriteAutoAnchor(tx, worldMapId, input, commandId);
		}

		return { ...row, invalidatedAnchorIds };
	});
}

/**
 * Slice 3 B7 — auto-anchor write logic.
 *
 * Conditions to fire (all must hold):
 *   1. Counter: count(map_events on this map WHERE kind='paint_cells'
 *      AND undone_at IS NULL AND created_at > last anchor's created_at)
 *      >= AUTO_ANCHOR_K.
 *   2. Stroke complete: commandId IS NULL (standalone single-event stroke)
 *      OR payload.command_complete === true (the last chunk of a
 *      multi-event stroke). Never split mid-stroke.
 *
 * Snapshot: t_position = MAX(t_position) over the in-flight paint_cells
 * events (the events that will be summarized). state_jsonb is derived from
 * the latest anchor's state_jsonb with the recent paint_cells events
 * folded into cells[]. Other keys (regions, artifacts, chains) pass through
 * unchanged — paint_cells doesn't touch them.
 *
 * Synchronization: caller already holds FOR UPDATE on the world_maps row,
 * so two concurrent POSTs serialize and only one fires the anchor write.
 * The other observes the new anchor on its own count query (created_at >
 * new anchor's created_at means count restarts at 0).
 */
async function maybeWriteAutoAnchor(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tx: any,
	worldMapId: string,
	input: EventInput,
	commandId: string | null
): Promise<void> {
	const payload = input.payloadJsonb as Partial<PaintCellsPayload> | null;
	const strokeComplete =
		commandId === null || (payload != null && payload.command_complete === true);
	if (!strokeComplete) return;

	// Find the latest existing anchor (user OR synthetic). Created_at is the
	// commit-time discriminator; t_position is the snapshot time which can
	// differ. We want the most recently WRITTEN anchor, not the most
	// time-advanced one.
	const [latestAnchor] = await tx
		.select({ id: mapAnchors.id })
		.from(mapAnchors)
		.where(eq(mapAnchors.worldMapId, worldMapId))
		.orderBy(desc(mapAnchors.createdAt), desc(mapAnchors.id))
		.limit(1);
	// Bind the cutoff via a scalar subquery on the anchor's own row rather
	// than a JS Date param. The neon + postgres-js drivers mis-serialize a
	// JS Date in a raw timestamp comparison (the cursor queries below hit
	// the same hazard and defend with tsLiteral / micro-precise text — see
	// the comment at `tPosLiteral`). Reading created_at back out of the row
	// avoids the JS round-trip entirely and keeps full microsecond
	// precision. No anchor yet → every paint_cells event counts (-infinity).
	const cutoffSql = latestAnchor
		? sql`(SELECT created_at FROM map_anchors WHERE id = ${latestAnchor.id})`
		: sql`'-infinity'::timestamptz`;

	// Count non-undone paint_cells events committed AFTER the cutoff.
	const countResult = await tx.execute(sql`
		SELECT COUNT(*)::bigint AS cnt
		FROM map_events
		WHERE world_map_id = ${worldMapId}
		  AND kind = 'paint_cells'
		  AND undone_at IS NULL
		  AND created_at > ${cutoffSql}
	`);
	const countRows = Array.isArray(countResult.rows)
		? countResult.rows
		: ((countResult as unknown) as { rows: Array<{ cnt: string | number }> }).rows ?? [];
	const count = countRows.length > 0 ? Number(countRows[0].cnt) : 0;
	if (count < AUTO_ANCHOR_K) return;

	// Read the post-cutoff window only to learn the t_position range (maxT)
	// and confirm there's something to snapshot. The actual fold is rebuilt
	// from the full live log below (foldEvents) so it can't miss earlier
	// same-T paints. ALL live event kinds are read (not just paint_cells) so
	// transfer_region / future kinds fold forward too — filtering on kind
	// here would lose an ownership change once this anchor shadows it.
	const recentEvents = await tx
		.select({
			id: mapEvents.id,
			tPosition: mapEvents.tPosition,
			kind: mapEvents.kind,
			createdAt: mapEvents.createdAt,
			payloadJsonb: mapEvents.payloadJsonb
		})
		.from(mapEvents)
		.where(
			and(
				eq(mapEvents.worldMapId, worldMapId),
				sql`${mapEvents.undoneAt} IS NULL`,
				sql`${mapEvents.createdAt} > ${cutoffSql}`
			)
		);
	if (recentEvents.length === 0) return; // belt + suspenders
	const maxT = recentEvents.reduce(
		(acc: number, e: { tPosition: number }) => (e.tPosition > acc ? e.tPosition : acc),
		Number.NEGATIVE_INFINITY
	);

	// Build the snapshot to EQUAL projectState(maxT): start from the anchor
	// strictly BEFORE maxT and fold every live event in (baseT, maxT].
	//
	// Why strictly before (codex P2): if we keyed off the anchor AT maxT we'd
	// pick the very synthetic anchor we're about to replace, and folding only
	// "events after that anchor's T" would drop the same-T repaints we're
	// trying to bake in (the #1 data-loss case). Anchoring on the PRIOR
	// distinct anchor and folding through maxT inclusive bakes in same-T
	// paints, while events at or below the prior anchor's T stay shadowed by
	// baseState — so a retroactive paint committed late at an earlier
	// playhead doesn't leak into the snapshot.
	const anchorsBefore = await tx
		.select()
		.from(mapAnchors)
		.where(
			and(
				eq(mapAnchors.worldMapId, worldMapId),
				sql`${mapAnchors.tPosition} < ${maxT}`
			)
		)
		.orderBy(desc(mapAnchors.tPosition), desc(mapAnchors.createdAt), desc(mapAnchors.id))
		.limit(1);
	const baseAnchor = anchorsBefore[0];
	const baseAnchorT = baseAnchor ? Number(baseAnchor.tPosition) : Number.NEGATIVE_INFINITY;
	const baseState = (baseAnchor?.stateJsonb ?? {
		regions: [],
		artifacts: [],
		chains: [],
		cells: []
	}) as AnchorState;

	// Re-fold from the FULL live log in (baseAnchorT, maxT] rather than the
	// cutoff window — the cutoff window can miss earlier same-T paints (folded
	// into a prior synthetic that is no longer the base) and can include
	// retroactive paints the base already shadows. A finite lower bound is
	// only applied when there's a prior anchor; -Infinity baselines bind no
	// lower bound (binding ±Infinity as a param breaks the driver).
	const foldConds = [
		eq(mapEvents.worldMapId, worldMapId),
		sql`${mapEvents.undoneAt} IS NULL`,
		sql`${mapEvents.tPosition} <= ${maxT}`
	];
	if (Number.isFinite(baseAnchorT)) {
		foldConds.push(sql`${mapEvents.tPosition} > ${baseAnchorT}`);
	}
	const foldEvents = await tx
		.select({
			id: mapEvents.id,
			tPosition: mapEvents.tPosition,
			kind: mapEvents.kind,
			createdAt: mapEvents.createdAt,
			payloadJsonb: mapEvents.payloadJsonb
		})
		.from(mapEvents)
		.where(and(...foldConds));

	// Fold ALL recent events into the snapshot (codex P1). Order by
	// (tPosition, created_at, id) — same rule as projection.ts. Both
	// paint_cells (cells map, last-write-wins) and transfer_region
	// (region faction_id mutation) are applied; unknown future kinds
	// pass through silently. Keeps the snapshot semantically equivalent
	// to "projectState(maxT) with the events folded in" so the post-
	// anchor projection lookups read the correct rolling state.
	const sortedEvents = [...foldEvents].sort(
		(
			a: { tPosition: number; createdAt: Date | string; id: string },
			b: typeof a
		) => {
			if (a.tPosition !== b.tPosition) return a.tPosition - b.tPosition;
			const am = a.createdAt instanceof Date ? a.createdAt.getTime() : Date.parse(String(a.createdAt));
			const bm = b.createdAt instanceof Date ? b.createdAt.getTime() : Date.parse(String(b.createdAt));
			if (am !== bm) return am - bm;
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		}
	);
	const cells = new Map<string, { x: number; y: number; biome: BiomeKind }>();
	for (const cell of baseState.cells ?? []) {
		cells.set(`${cell.x},${cell.y}`, cell);
	}
	// Region snapshot starts from baseAnchor and gets mutated by
	// transfer_region events. Keep object identity per region_id so
	// later folds find existing entries.
	const regionsById = new Map<string, AnchorState['regions'] extends (infer R)[] | undefined ? R : never>();
	for (const r of baseState.regions ?? []) {
		regionsById.set(r.region_id, r);
	}
	for (const e of sortedEvents) {
		const p = e.payloadJsonb as Record<string, unknown> | null;
		if (!p || typeof p !== 'object') continue;
		if (e.kind === 'paint_cells') {
			const cs = (p as Partial<PaintCellsPayload>).cells;
			if (!Array.isArray(cs)) continue;
			for (const c of cs) {
				if (
					c &&
					Number.isInteger(c.x) &&
					Number.isInteger(c.y) &&
					(BIOMES as readonly string[]).includes(c.biome)
				) {
					cells.set(`${c.x},${c.y}`, c);
				}
			}
		} else if (e.kind === 'transfer_region') {
			const regionId = (p as { region_id?: unknown }).region_id;
			const newFactionId = (p as { new_faction_id?: unknown }).new_faction_id;
			if (typeof regionId !== 'string' || typeof newFactionId !== 'string') {
				continue;
			}
			const existing = regionsById.get(regionId);
			if (existing) {
				regionsById.set(regionId, { ...existing, faction_id: newFactionId });
			} else {
				// Region not in baseAnchor (lazy GC at render still drops
				// unresolvable refs, but the event ownership claim is
				// recorded here so post-anchor projection sees it).
				regionsById.set(regionId, {
					region_id: regionId,
					faction_id: newFactionId
				});
			}
		}
		// Unknown kinds (Slice 2+ move_entity, Slice 5 link_chain) pass
		// through unchanged. When added, fold them here too.
	}

	const snapshot: AnchorState = {
		regions: Array.from(regionsById.values()),
		artifacts: baseState.artifacts ?? [],
		chains: baseState.chains ?? [],
		cells: Array.from(cells.values())
	};

	// Write the synthetic anchor. The unique constraint (world_map_id,
	// t_position) fires when an anchor already lives at maxT — common when
	// the user keeps painting at the same playhead T after a synthetic anchor
	// was already written there.
	//
	// codex P1: swallowing the conflict silently loses data — projection
	// treats an anchor at T as the state at T and excludes events with
	// t_position <= T, so the new same-T paint events fold into neither the
	// stale snapshot nor the event stream and the just-painted cells vanish.
	//
	// codex P2 (follow-up): an in-place stateJsonb UPDATE would keep the old
	// created_at, but the re-folded snapshot now contains events committed
	// AFTER that created_at. invalidateSyntheticAnchorsFrom keys off
	// (anchor.created_at >= event.created_at), so on a later undo/delete of
	// one of those events the stale anchor would escape invalidation and keep
	// rendering removed cells. Delete-then-insert instead: the replacement
	// row gets a fresh created_at >= every event it folds (invalidation works)
	// AND advances the count cutoff so we don't re-fold a growing window. The
	// delete is scoped to is_synthetic, so a user-authored anchor at maxT is
	// left intact and the insert below hits the constraint (swallowed) —
	// the authored anchor stays authoritative.
	await tx
		.delete(mapAnchors)
		.where(
			and(
				eq(mapAnchors.worldMapId, worldMapId),
				eq(mapAnchors.tPosition, maxT),
				eq(mapAnchors.isSynthetic, true)
			)
		);
	try {
		await tx.insert(mapAnchors).values({
			worldMapId,
			tPosition: maxT,
			stateJsonb: snapshot,
			isSynthetic: true
		});
	} catch (err) {
		if (!isUniqueViolation(err)) throw err;
		// A user-authored anchor lives at maxT — authoritative, leave it.
	}
}

/**
 * Delete every synthetic anchor whose frozen snapshot may have folded the
 * event identified by `boundaryEventId`. A synthetic anchor folds events
 * committed up to its own created_at, so any synthetic anchor created at
 * or after the (soft-deleted) event's created_at could be holding that
 * event's now-removed cells. Bind the boundary via a scalar subquery on
 * the event's own row — not a JS Date param, which the neon/postgres-js
 * drivers mis-serialize (see the comment at `tPosLiteral`). The event row
 * is still present (soft-delete sets undone_at), so the subquery resolves.
 * Caller must hold the world_maps FOR UPDATE lock so a concurrent paint
 * can't re-insert a synthetic anchor between this delete and its count.
 */
async function invalidateSyntheticAnchorsFrom(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tx: any,
	worldMapId: string,
	boundaryEventId: string
): Promise<void> {
	await tx
		.delete(mapAnchors)
		.where(
			and(
				eq(mapAnchors.worldMapId, worldMapId),
				eq(mapAnchors.isSynthetic, true),
				sql`${mapAnchors.createdAt} >= (SELECT created_at FROM map_events WHERE id = ${boundaryEventId})`
			)
		);
}

/**
 * Drop synthetic anchors at or after `tPosition` (codex P2). Each synthetic
 * anchor freezes a copy of the rolling state inherited from the user anchor
 * active at its t_position. When a user authors, edits, or deletes an
 * anchor at T, every synthetic anchor at t_position >= T may have copied a
 * now-stale base, so projection at/after those points would keep reading
 * the frozen snapshot instead of the user's change. Deleting them forces
 * projection to re-fold from the nearest surviving anchor; the next paint
 * stroke past K regenerates a fresh synthetic anchor. `tPosition` is a
 * finite JS number (validated by callers), so binding it directly is safe.
 */
async function invalidateSyntheticAnchorsAtOrAfter(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	worldMapId: string,
	tPosition: number
): Promise<string[]> {
	const deleted = await db
		.delete(mapAnchors)
		.where(
			and(
				eq(mapAnchors.worldMapId, worldMapId),
				eq(mapAnchors.isSynthetic, true),
				sql`${mapAnchors.tPosition} >= ${tPosition}`
			)
		)
		.returning({ id: mapAnchors.id });
	return (deleted as Array<{ id: string }>).map((r) => r.id);
}

export async function deleteMapEvent(
	db: Db,
	userId: string,
	worldMapId: string,
	eventId: string
): Promise<void> {
	await assertMapOwnership(db, userId, worldMapId);
	assertUuid(eventId, 'event id');
	// codex review P2: D3 (T7) introduced undoneAt for audit-preserving
	// soft-delete. Hard-delete via this endpoint defeats the invariant —
	// callers can erase rows that the undo command stack assumes are
	// still on disk. Convert this route to a soft-delete so the audit
	// trail stays append-only. Already-undone events return 404
	// (idempotent — caller sees the same result as "row missing").
	await db.transaction(async (tx) => {
		// Serialize with concurrent paints/undos on this map (same lock the
		// paint + undo paths take) so the synthetic-anchor invalidation
		// below can't race a paint re-inserting one.
		await tx.execute(sql`SELECT id FROM world_maps WHERE id = ${worldMapId} FOR UPDATE`);
		const [updated] = await tx
			.update(mapEvents)
			.set({ undoneAt: new Date() })
			.where(
				and(
					eq(mapEvents.id, eventId),
					eq(mapEvents.worldMapId, worldMapId),
					sql`${mapEvents.undoneAt} IS NULL`
				)
			)
			.returning();
		if (!updated) error(404, 'Event not found');
		// codex P2: a synthetic anchor may have folded this event's cells.
		// Soft-deleting the event without invalidating those anchors leaves
		// the terrain visible via the stale snapshot — projection can still
		// pick the synthetic anchor. Same invalidation the undo path runs.
		await invalidateSyntheticAnchorsFrom(tx, worldMapId, eventId);
	});
}

/**
 * Slice 2 D3 (T7) — undo the latest live event on a map.
 * Slice 3 B5 — group chunked-stroke events under one undo.
 *
 * Pops by commit order ((created_at DESC, id DESC)), NOT by t_position.
 * Command-stack semantics: "undo my most recent action" means the user's
 * latest edit, even when that edit landed at a t_position earlier than
 * later events.
 *
 * Slice 3 grouping (outside-voice B5): if the popped event has a non-NULL
 * command_id, soft-delete ALL events on this map sharing that command_id
 * atomically in the same transaction. Returns the array of soft-deleted
 * rows ordered (created_at DESC, id DESC) so the client can rebuild its
 * in-memory state in the same order it was originally written. Standalone
 * events (command_id IS NULL) return a length-1 array.
 *
 * Soft-delete: sets undone_at = now(). The rows stay in place as audit
 * trail; projection + list endpoints filter on undone_at IS NULL. Redo
 * is a client-side concern — the popped events are held in the client's
 * in-memory stack and replayed via fresh POST /events. Grouped strokes
 * redo with a FRESH command_id (the original is consumed; new POSTs are
 * a new logical command).
 *
 * Cross-user: ownership of the map is asserted via assertMapOwnership;
 * attempts against another user's map surface as 404.
 *
 * Empty stack: 422 with "No events to undo".
 */
export async function undoLatestMapEvent(
	db: Db,
	userId: string,
	worldMapId: string
): Promise<(typeof mapEvents.$inferSelect)[]> {
	await assertMapOwnership(db, userId, worldMapId);

	// /review adversarial #1 — wrap the 4-statement undo sequence in a
	// transaction with SELECT FOR UPDATE on world_maps. Mirrors the
	// auto-anchor pattern in createMapEvent. Two effects:
	//  1. Crash mid-flight rolls back ALL statements (no partial state on
	//     disk).
	//  2. Concurrent paint_cells POSTs (which take the same FOR UPDATE
	//     lock) serialize with this undo — eliminates the race where the
	//     synthetic-anchor DELETE could remove an anchor a concurrent
	//     paint POST just wrote.
	return await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT id FROM world_maps WHERE id = ${worldMapId} FOR UPDATE`);

		// Retry loop: two concurrent undo requests both SELECT the same
		// latest event. One UPDATE wins (undoneAt=now); the other's
		// UPDATE matches 0 rows because the WHERE undoneAt IS NULL guard
		// filters out the just-undone row. Without retry, the second
		// caller gets 422 even though older live events exist — a
		// double-click leaves the stack only half-undone. The loop
		// re-SELECTs the next latest until either an UPDATE succeeds or
		// the SELECT finds nothing.
		//
		// Note: post-FOR-UPDATE, this loop should rarely retry because
		// concurrent undos on the same map now serialize. The retry is
		// belt + suspenders for any code path that somehow bypasses the
		// lock (currently none).
		for (let attempt = 0; attempt < 8; attempt++) {
			const [latest] = await tx
				.select()
				.from(mapEvents)
				.where(
					and(
						eq(mapEvents.worldMapId, worldMapId),
						sql`${mapEvents.undoneAt} IS NULL`
					)
				)
				.orderBy(desc(mapEvents.createdAt), desc(mapEvents.id))
				.limit(1);
			if (!latest) error(422, 'No events to undo');

			// Race-tolerant single-event UPDATE first. If the latest event
			// has a command_id, the follow-up grouped soft-delete picks up
			// its siblings.
			const [updated] = await tx
				.update(mapEvents)
				.set({ undoneAt: new Date() })
				.where(
					and(
						eq(mapEvents.id, latest.id),
						eq(mapEvents.worldMapId, worldMapId),
						sql`${mapEvents.undoneAt} IS NULL`
					)
				)
				.returning();
			if (!updated) continue; // Lost the race; loop.

			let all: (typeof mapEvents.$inferSelect)[];
			if (updated.commandId === null) {
				all = [updated];
			} else {
				const siblings = await tx
					.update(mapEvents)
					.set({ undoneAt: new Date() })
					.where(
						and(
							eq(mapEvents.worldMapId, worldMapId),
							eq(mapEvents.commandId, updated.commandId),
							sql`${mapEvents.undoneAt} IS NULL`
						)
					)
					.returning();
				all = [updated, ...siblings];
				all.sort((a, b) => {
					const am =
						a.createdAt instanceof Date ? a.createdAt.getTime() : Date.parse(String(a.createdAt));
					const bm =
						b.createdAt instanceof Date ? b.createdAt.getTime() : Date.parse(String(b.createdAt));
					if (am !== bm) return bm - am;
					return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
				});
			}

			// Slice 3 outside-voice A9 — synthetic anchor invalidation.
			// Inside the same transaction as the soft-delete so a concurrent
			// paint_cells (which would also hold FOR UPDATE) cannot insert
			// a synthetic anchor between our soft-delete and this DELETE.
			const earliestUndone = all.reduce(
				(acc, e) => {
					const t =
						e.createdAt instanceof Date ? e.createdAt.getTime() : Date.parse(String(e.createdAt));
					return acc === null || t < acc.t ? { id: e.id, t } : acc;
				},
				null as { id: string; t: number } | null
			);
			if (earliestUndone) {
				await invalidateSyntheticAnchorsFrom(tx, worldMapId, earliestUndone.id);
			}

			return all;
		}
		// Pathological contention — surface 422 rather than a 500 so the
		// client can retry the user action.
		error(422, 'No events to undo');
	});
}

// ── Layer prefs (Slice 3 E1 — outside-voice A1 + B3) ────────────────────────
//
// world_map_layer_prefs is per-user-per-map visibility for the
// background/grid/terrain/regions/placements layers. The table FK is
// only on user.id and world_maps.id; the cross-user ownership
// invariant (user_id must match world_maps.user_id) lives here, in
// the upsert helper. Every write goes through this function; direct
// DB inserts from anywhere else are a CLAUDE.md violation.
//
// Reads scope through assertMapOwnership upstream — listing prefs
// for a map the caller doesn't own returns 404, same shape as
// listing anchors/events.

export async function listWorldMapLayerPrefs(
	db: Db,
	userId: string,
	worldMapId: string
): Promise<(typeof worldMapLayerPrefs.$inferSelect)[]> {
	await assertMapOwnership(db, userId, worldMapId);
	return await db
		.select()
		.from(worldMapLayerPrefs)
		.where(
			and(
				eq(worldMapLayerPrefs.userId, userId),
				eq(worldMapLayerPrefs.worldMapId, worldMapId)
			)
		);
}

export async function upsertWorldMapLayerPref(
	db: Db,
	userId: string,
	worldMapId: string,
	layerKey: string,
	visible: 0 | 1
): Promise<typeof worldMapLayerPrefs.$inferSelect> {
	// Cross-user invariant — codex outside-voice #15. The schema accepts
	// (userA, mapB-owned-by-userB) inserts; the helper rejects them via
	// assertMapOwnership which 404s on non-owned maps.
	await assertMapOwnership(db, userId, worldMapId);
	if (typeof layerKey !== 'string' || layerKey.length === 0 || layerKey.length > 64) {
		error(400, 'layerKey must be a non-empty string ≤ 64 chars');
	}
	if (visible !== 0 && visible !== 1) {
		error(400, 'visible must be 0 or 1 (CLAUDE.md integer convention)');
	}
	const [row] = await db
		.insert(worldMapLayerPrefs)
		.values({ userId, worldMapId, layerKey, visible })
		.onConflictDoUpdate({
			target: [
				worldMapLayerPrefs.userId,
				worldMapLayerPrefs.worldMapId,
				worldMapLayerPrefs.layerKey
			],
			set: { visible }
		})
		.returning();
	return row;
}

// ── Read paths (cursor pagination — Slice 2 D5) ─────────────────────────────
//
// Keyset pagination on the sort key the projection layer relies on:
//   anchors/events  → (t_position, created_at, id)
//   factions        → (created_at, id)
//
// Cursor is opaque base64(JSON). Clients call list(after=cursor) until
// next_cursor === null. The plan's "subsequent pages fetch on demand" is
// over-engineering for an event-sourced projection that needs the complete
// stream to fold correctly — clients call loadAll() which pages through
// until exhausted. The API supports lazy on-demand pagination by future
// callers without further changes.
//
// Limit defaults to DEFAULT_PAGE_SIZE; clamped to [1, MAX_PAGE_SIZE].
// LIST_LIMIT is preserved as an alias of DEFAULT_PAGE_SIZE for back-compat
// with any external callers; new code uses DEFAULT_PAGE_SIZE.

export const DEFAULT_PAGE_SIZE = 500;
export const MAX_PAGE_SIZE = 1000;
/** @deprecated use DEFAULT_PAGE_SIZE; kept for back-compat. */
export const LIST_LIMIT = DEFAULT_PAGE_SIZE;

export type ListResponse<T> = {
	rows: T[];
	next_cursor: string | null;
};

type TPosCursor = { t: number; c: string; id: string };
type CreatedAtCursor = { c: string; id: string };

// Sentinel for non-finite tPosition values (codex review P1 #3).
// JSON.stringify({ t: -Infinity }) serializes to {"t": null}, which then
// fails the typeof decoded.t === 'number' check on decode — anchor
// pagination broke on any page boundary that landed on the baseline
// anchor (t = -Infinity). Encode non-finite values as string sentinels
// and reverse on decode.
const T_POS_NEG_INF = '__neg_inf__';
const T_POS_POS_INF = '__pos_inf__';

function encodeTPosValue(t: number): number | string {
	if (t === Number.NEGATIVE_INFINITY) return T_POS_NEG_INF;
	if (t === Number.POSITIVE_INFINITY) return T_POS_POS_INF;
	return t;
}

function decodeTPosValue(v: unknown): number | null {
	if (v === T_POS_NEG_INF) return Number.NEGATIVE_INFINITY;
	if (v === T_POS_POS_INF) return Number.POSITIVE_INFINITY;
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	return null;
}

/**
 * codex PR review: postgres-js doesn't reliably serialize JS Infinity /
 * -Infinity through the parameter binding path. The map-create handler
 * uses an inline SQL literal for the baseline anchor's tPosition; the
 * cursor pagination path needs the same treatment, otherwise following
 * a cursor that ended on the baseline anchor (t = -Infinity) fails
 * intermittently in production despite working in PGlite tests.
 */
function tPosLiteral(t: number) {
	if (t === Number.NEGATIVE_INFINITY) return sql`'-Infinity'::float8`;
	if (t === Number.POSITIVE_INFINITY) return sql`'Infinity'::float8`;
	return sql`${t}::float8`;
}

/**
 * codex PR review (iter 7): the previous cursor-precision fix put a
 * microsecond-precise text string into cursor.c, but the SQL clause
 * then wrapped it in `new Date(cursor.c)` which truncates back to
 * millisecond. Bind the cursor's text directly with an explicit
 * ::timestamptz cast so PG parses all 6 microsecond digits.
 */
function tsLiteral(c: string) {
	return sql`${c}::timestamptz`;
}

function isValidCursorDate(c: string): boolean {
	// codex review P1 #4: decodeTPosCursor / decodeCreatedAtCursor only
	// checked `typeof c === 'string'`, then SQL builders called
	// `new Date(cursor.c)`. A base64-valid cursor with "c":"not-a-date"
	// produced Invalid Date → driver/DB 500 instead of a clean 400.
	const ts = Date.parse(c);
	return Number.isFinite(ts);
}

function encodeCursor(payload: { t?: number; c: string; id: string }): string {
	const out: Record<string, unknown> = { c: payload.c, id: payload.id };
	if ('t' in payload && payload.t !== undefined) out.t = encodeTPosValue(payload.t);
	return Buffer.from(JSON.stringify(out), 'utf8').toString('base64url');
}

function decodeTPosCursor(raw: string): TPosCursor {
	try {
		const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
		const t = decodeTPosValue(decoded?.t);
		if (
			t === null ||
			typeof decoded?.c !== 'string' ||
			typeof decoded?.id !== 'string' ||
			!isValidCursorDate(decoded.c) ||
			// codex PR review: cursor.id is bound directly into UUID columns
			// (map_anchors.id / map_events.id). Without a UUID shape check,
			// "id":"not-a-uuid" passes decode and SQL casts then 500. Validate
			// against UUID_RE so the invalid-cursor path always surfaces 400.
			!UUID_RE.test(decoded.id)
		) {
			throw new Error('shape');
		}
		return { t, c: decoded.c, id: decoded.id };
	} catch {
		error(400, 'invalid cursor');
	}
}

function decodeCreatedAtCursor(raw: string): CreatedAtCursor {
	try {
		const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
		if (
			typeof decoded?.c !== 'string' ||
			typeof decoded?.id !== 'string' ||
			!isValidCursorDate(decoded.c) ||
			!UUID_RE.test(decoded.id)
		) {
			throw new Error('shape');
		}
		return decoded as CreatedAtCursor;
	} catch {
		error(400, 'invalid cursor');
	}
}

/**
 * codex PR review (iter 4): JS Date is millisecond-precision but PG
 * timestamptz with `defaultNow()` stores microseconds. `last.createdAt.
 * toISOString()` truncates microseconds; the next page's keyset
 * comparison then includes the boundary row again (sub-ms tiebreak
 * fails). At `limit=1` this loops indefinitely; at larger limits it
 * duplicates the boundary row. Re-fetch the boundary row's
 * `created_at` as a microsecond-precise text string for the cursor.
 *
 * One extra round-trip per page that has `next_cursor != null` —
 * acceptable for an authoring-time write rate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function microPreciseCreatedAt(db: any, table: any, id: string): Promise<string> {
	const result = await db.execute(sql`
		SELECT to_char(${table.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS c
		FROM ${table}
		WHERE ${table.id} = ${id}::uuid
		LIMIT 1
	`);
	// Drizzle's execute returns shape depends on driver. Handle both
	// node-postgres ({ rows: [...] }) and pg-bridge (array).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const row = ((result as any).rows ?? (result as any))?.[0];
	return (row?.c as string | undefined) ?? new Date().toISOString();
}

function clampLimit(raw: number | null | undefined): number {
	if (raw == null || !Number.isFinite(raw)) return DEFAULT_PAGE_SIZE;
	const n = Math.floor(raw);
	if (n < 1) return 1;
	if (n > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
	return n;
}

export type ListOptions = {
	after?: string | null;
	limit?: number | null;
};

export async function listFactions(
	db: Db,
	userId: string,
	opts: ListOptions = {}
): Promise<ListResponse<typeof factions.$inferSelect>> {
	const limit = clampLimit(opts.limit);
	const cursor = opts.after ? decodeCreatedAtCursor(opts.after) : null;
	const cursorClause = cursor
		? sql`(${factions.createdAt}, ${factions.id}) > (${tsLiteral(cursor.c)}, ${cursor.id})`
		: undefined;
	const rows = await db
		.select()
		.from(factions)
		.where(cursorClause ? and(eq(factions.userId, userId), cursorClause) : eq(factions.userId, userId))
		.orderBy(asc(factions.createdAt), asc(factions.id))
		.limit(limit + 1);
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const last = page[page.length - 1];
	const next_cursor =
		hasMore && last
			? encodeCursor({ c: await microPreciseCreatedAt(db, factions, last.id), id: last.id })
			: null;
	return { rows: page, next_cursor };
}

export async function listMapAnchors(
	db: Db,
	userId: string,
	worldMapId: string,
	opts: ListOptions = {}
): Promise<ListResponse<typeof mapAnchors.$inferSelect>> {
	await assertMapOwnership(db, userId, worldMapId);
	const limit = clampLimit(opts.limit);
	const cursor = opts.after ? decodeTPosCursor(opts.after) : null;
	const cursorClause = cursor
		? sql`(${mapAnchors.tPosition}, ${mapAnchors.createdAt}, ${mapAnchors.id}) > (${tPosLiteral(cursor.t)}, ${tsLiteral(cursor.c)}, ${cursor.id})`
		: undefined;
	const rows = await db
		.select()
		.from(mapAnchors)
		.where(
			cursorClause
				? and(eq(mapAnchors.worldMapId, worldMapId), cursorClause)
				: eq(mapAnchors.worldMapId, worldMapId)
		)
		.orderBy(asc(mapAnchors.tPosition), asc(mapAnchors.createdAt), asc(mapAnchors.id))
		.limit(limit + 1);
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const last = page[page.length - 1];
	const next_cursor =
		hasMore && last
			? encodeCursor({
					t: last.tPosition,
					c: await microPreciseCreatedAt(db, mapAnchors, last.id),
					id: last.id
				})
			: null;
	return { rows: page, next_cursor };
}

export async function listMapEvents(
	db: Db,
	userId: string,
	worldMapId: string,
	opts: ListOptions = {}
): Promise<ListResponse<typeof mapEvents.$inferSelect>> {
	await assertMapOwnership(db, userId, worldMapId);
	const limit = clampLimit(opts.limit);
	const cursor = opts.after ? decodeTPosCursor(opts.after) : null;
	const cursorClause = cursor
		? sql`(${mapEvents.tPosition}, ${mapEvents.createdAt}, ${mapEvents.id}) > (${tPosLiteral(cursor.t)}, ${tsLiteral(cursor.c)}, ${cursor.id})`
		: undefined;
	// Slice 2 D3 (T7): exclude soft-deleted (undone) events from the list.
	// Append-only history is preserved at the storage level; the API
	// surfaces only live rows.
	const liveClause = sql`${mapEvents.undoneAt} IS NULL`;
	const rows = await db
		.select()
		.from(mapEvents)
		.where(
			cursorClause
				? and(eq(mapEvents.worldMapId, worldMapId), liveClause, cursorClause)
				: and(eq(mapEvents.worldMapId, worldMapId), liveClause)
		)
		.orderBy(asc(mapEvents.tPosition), asc(mapEvents.createdAt), asc(mapEvents.id))
		.limit(limit + 1);
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const last = page[page.length - 1];
	const next_cursor =
		hasMore && last
			? encodeCursor({
					t: last.tPosition,
					c: await microPreciseCreatedAt(db, mapEvents, last.id),
					id: last.id
				})
			: null;
	return { rows: page, next_cursor };
}
