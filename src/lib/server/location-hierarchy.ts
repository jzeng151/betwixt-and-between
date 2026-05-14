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
