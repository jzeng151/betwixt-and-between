/**
 * Server-side helpers for the Location parent/child hierarchy modelled as
 * `part_of` relationships (WorldMap v2 Step 2, 2026-05-14).
 *
 * Hierarchy invariants (enforced at write time; no DB CHECK possible because
 * cycles require graph traversal):
 *   1. Both endpoints must reference entities of type='Location'.
 *   2. A Location may not be `part_of` itself.
 *   3. A Location may have at most one outgoing `part_of` edge (single-parent).
 *      Multi-parent is a deliberate v3 punt — see design doc M12.
 *   4. The resulting graph must remain a DAG (no cycles). Walking up from the
 *      proposed parent must not reach the proposed child.
 *
 * The walk depth is capped at MAX_DEPTH as defence against malformed data
 * (a pre-existing cycle in the DB would otherwise loop forever).
 */
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { entities, relationships } from './db/schema.js';
import { isUuid } from './validation.js';

const MAX_DEPTH = 64;

type DB = {
	select: (...args: unknown[]) => {
		from: (...args: unknown[]) => {
			where: (...args: unknown[]) => Promise<Array<Record<string, unknown>>>;
		};
	};
	insert: (...args: unknown[]) => {
		values: (...args: unknown[]) => Promise<unknown>;
	};
	update: (...args: unknown[]) => {
		set: (...args: unknown[]) => {
			where: (...args: unknown[]) => Promise<unknown>;
		};
	};
};

/**
 * Validate a proposed `part_of` relationship from `fromId` to `toId` owned by
 * `userId`. Throws SvelteKit error(400) on any invariant violation.
 *
 * `excludingRelId` skips a specific relationship row during the single-parent
 * check — used by PATCH so updating the same row doesn't trip its own existence.
 */
export async function assertPartOfInvariants(
	db: unknown,
	userId: string,
	fromId: string,
	toId: string,
	excludingRelId: string | null = null
): Promise<void> {
	if (!isUuid(fromId) || !isUuid(toId)) {
		error(400, 'part_of endpoints must be UUIDs');
	}
	if (fromId === toId) {
		error(400, 'part_of cannot reference the same Location on both ends');
	}

	const typed = (db as DB)
		.select({ id: entities.id, type: entities.type })
		.from(entities)
		.where(and(eq(entities.userId, userId)));
	const all = (await typed) as Array<{ id: string; type: string }>;
	const byId = new Map(all.map((row) => [row.id, row.type]));

	const fromType = byId.get(fromId);
	const toType = byId.get(toId);
	if (!fromType) error(400, 'part_of fromId does not reference an existing entity');
	if (!toType) error(400, 'part_of toId does not reference an existing entity');
	if (fromType !== 'Location') {
		error(400, `part_of fromId must reference a Location (got type='${fromType}')`);
	}
	if (toType !== 'Location') {
		error(400, `part_of toId must reference a Location (got type='${toType}')`);
	}

	const partOfRows = (await (db as DB)
		.select({
			id: relationships.id,
			fromId: relationships.fromId,
			toId: relationships.toId
		})
		.from(relationships)
		.where(
			and(eq(relationships.userId, userId), eq(relationships.type, 'part_of'))
		)) as Array<{ id: string; fromId: string; toId: string }>;

	// Single-parent: the child must not already have another outgoing part_of edge.
	const existingParent = partOfRows.find(
		(r) => r.fromId === fromId && r.id !== excludingRelId
	);
	if (existingParent) {
		error(
			400,
			'Location already has a parent (single-parent in v2); remove existing part_of first'
		);
	}

	// Cycle check: walking up the proposed parent's chain must not reach the child.
	const parentByChild = new Map<string, string>();
	for (const r of partOfRows) {
		if (r.id === excludingRelId) continue;
		parentByChild.set(r.fromId, r.toId);
	}
	// Add the proposed edge to the chain for traversal.
	parentByChild.set(fromId, toId);

	let cursor: string | undefined = toId;
	for (let i = 0; i < MAX_DEPTH; i++) {
		if (cursor === fromId) {
			error(400, 'part_of would create a cycle in the Location hierarchy');
		}
		const next = parentByChild.get(cursor);
		if (!next) return;
		cursor = next;
	}
	error(400, 'part_of chain exceeded max hierarchy depth');
}

/**
 * Drop the part_of edge from `fromId` → `toId` ONLY if no region in `mapId`
 * still links to `fromId`. The "region implies part_of" semantic is implied
 * by *at least one* polygon assignment on the anchor's map — if another
 * region still references the location, the implication stands. If none do,
 * the implication is gone and the edge should follow.
 *
 * The orphan check is scoped to `mapId` (not global), since the same
 * Location may be drawn as multiple polygons on the same map (rare, but
 * legal). A different map's region wouldn't carry this same edge because
 * each map's anchor is different.
 */
export async function removeImpliedPartOf(
	db: unknown,
	userId: string,
	fromId: string | null | undefined,
	toId: string | null | undefined,
	mapId: string
): Promise<void> {
	if (!fromId || !toId) return;

	type SelectableDB = {
		select: (...args: unknown[]) => {
			from: (...args: unknown[]) => {
				where: (...args: unknown[]) => Promise<Array<Record<string, unknown>>>;
			};
		};
		delete: (...args: unknown[]) => {
			where: (...args: unknown[]) => Promise<unknown>;
		};
	};

	const { mapRegions } = await import('./db/schema.js');
	const stillLinked = (await (db as SelectableDB)
		.select({ id: mapRegions.id })
		.from(mapRegions)
		.where(
			and(eq(mapRegions.mapId, mapId), eq(mapRegions.locationId, fromId))
		)) as Array<{ id: string }>;
	if (stillLinked.length > 0) return;

	await (db as SelectableDB)
		.delete(relationships)
		.where(
			and(
				eq(relationships.userId, userId),
				eq(relationships.fromId, fromId),
				eq(relationships.toId, toId),
				eq(relationships.type, 'part_of')
			)
		);
}

/**
 * Upsert the part_of edge from `fromId` → `toId`. Used by the map-region
 * write path: assigning a Location to a region inside a map of Location P
 * implies the assigned Location is part_of P.
 *
 * Single-parent invariant: if `fromId` already has a different parent edge,
 * the existing edge is rewritten to point at `toId` (the polygon assignment
 * is treated as authoritative). Cycle / type guards still run through
 * assertPartOfInvariants. No-op when fromId/toId match or either is missing.
 */
export async function ensurePartOf(
	db: unknown,
	userId: string,
	fromId: string | null | undefined,
	toId: string | null | undefined
): Promise<void> {
	if (!fromId || !toId || fromId === toId) return;

	const existing = (await (db as DB)
		.select({ id: relationships.id, toId: relationships.toId })
		.from(relationships)
		.where(
			and(
				eq(relationships.userId, userId),
				eq(relationships.fromId, fromId),
				eq(relationships.type, 'part_of')
			)
		)) as Array<{ id: string; toId: string }>;

	if (existing.length > 0 && existing[0].toId === toId) return;

	if (existing.length > 0) {
		await assertPartOfInvariants(db, userId, fromId, toId, existing[0].id);
		await (db as DB)
			.update(relationships)
			.set({
				toId,
				startActId: null,
				startSceneId: null,
				endActId: null,
				endSceneId: null,
				startPosition: null,
				endPosition: null
			})
			.where(eq(relationships.id, existing[0].id));
		return;
	}

	await assertPartOfInvariants(db, userId, fromId, toId);
	await (db as DB).insert(relationships).values({
		userId,
		fromId,
		toId,
		type: 'part_of',
		label: null,
		startActId: null,
		startSceneId: null,
		endActId: null,
		endSceneId: null,
		startPosition: null,
		endPosition: null,
		revealedAtPosition: null
	});
}
