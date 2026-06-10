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
import { and, eq, inArray } from 'drizzle-orm';
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

	// Only the two endpoint rows are needed for the type check (2026-06 perf
	// audit — this previously loaded the user's ENTIRE entities table per
	// part_of write).
	const typed = (db as DB)
		.select({ id: entities.id, type: entities.type })
		.from(entities)
		.where(and(eq(entities.userId, userId), inArray(entities.id, [fromId, toId])));
	const endpoints = (await typed) as Array<{ id: string; type: string }>;
	const byId = new Map(endpoints.map((row) => [row.id, row.type]));

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
 * Drop the part_of edge from `fromId` → `toId` ONLY if no region on ANY map
 * whose anchor location is `toId` still links to `fromId`. The "region
 * implies part_of" semantic is implied by *at least one* polygon assignment
 * on *any* map anchored at the parent — Step 3 variants mean a single
 * parent Location may have multiple maps, and the implication holds as long
 * as any sibling variant still draws the child.
 *
 * Cross-map check is required: scoping the orphan check to a single mapId
 * would wrongly delete the edge when the user removes a polygon on variant
 * A even though variant B of the same parent still draws the child.
 */
export async function removeImpliedPartOf(
	db: unknown,
	userId: string,
	fromId: string | null | undefined,
	toId: string | null | undefined
): Promise<void> {
	if (!fromId || !toId) return;

	type ExecutableDB = {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		execute: (q: unknown) => Promise<{ rows?: any[] } | any[]>;
		delete: (...args: unknown[]) => {
			where: (...args: unknown[]) => Promise<unknown>;
		};
	};

	// Slice 2 D2 PR-B: cross-map sibling check now reads from anchor JSON
	// rather than map_regions. The baseline anchor (t_position = -Infinity)
	// is the canonical snapshot whose regions[] match map_regions content
	// post-T4 backfill. fanOutRegionGeometryUpdate keeps the locationId
	// field in sync across all anchors on a PATCH, so reading from baseline
	// alone is sound.
	const { sql } = await import('drizzle-orm');
	const result = await (db as ExecutableDB).execute(sql`
		SELECT 1
		FROM map_anchors ma
		INNER JOIN world_maps wm ON wm.id = ma.world_map_id
		CROSS JOIN LATERAL jsonb_array_elements(
			COALESCE(ma.state_jsonb->'regions', '[]'::jsonb)
		) AS r
		WHERE wm.user_id = ${userId}
			AND wm.location_id = ${toId}
			AND r->>'locationId' = ${fromId}
			AND ma.t_position = '-Infinity'::float8
		LIMIT 1
	`);
	// drizzle-orm's execute returns either an array (postgres-js) or
	// { rows } (pglite). Normalize both shapes.
	const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
	if (rows.length > 0) return;

	await (db as ExecutableDB)
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
