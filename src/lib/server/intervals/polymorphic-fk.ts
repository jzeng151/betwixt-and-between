/**
 * Polymorphic FK type assertions for the intervals subsystem.
 *
 * The `intervals` table's start_act_id / end_act_id / start_scene_id /
 * end_scene_id all point at `entities.id`, but the runtime type ('Act' or
 * 'Scene') is enforced here at the application layer — not at the DB.
 * Adding a new polymorphic FK requires both: (1) a row-type assertion in
 * this file, and (2) a Vitest invariant test in
 * tests/integration/intervals-invariant.test.ts.
 *
 * Per `CLAUDE.md` → "Polymorphic FK invariants".
 */

import { eq, and } from 'drizzle-orm';
import { entities } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import type { Db } from './types.js';
import type { WriteIntervalInput } from './types.js';

/**
 * Assert that the entity with the given id has the expected `type` value.
 * Throws if the entity is missing, scoped to another user, or has the wrong
 * type. Module-internal — `validateFKTypes` is the public surface.
 */
async function assertEntityType(
	db: Db,
	id: string,
	expected: schema.EntityType,
	userId: string
): Promise<void> {
	const [row] = await db
		.select({ id: entities.id, type: entities.type })
		.from(entities)
		.where(and(eq(entities.id, id), eq(entities.userId, userId)));
	if (!row) throw new Error(`Entity not found: ${id}`);
	if (row.type !== expected) {
		throw new Error(
			`Polymorphic FK violation: entity ${id} has type='${row.type}', expected '${expected}'`
		);
	}
}

/**
 * Validate every FK on a writeInterval input:
 *  - `entityId` exists and belongs to the user (any type — Character, Event, etc.)
 *  - `startActId` / `endActId` exist, belong to the user, and have type='Act'
 *  - `startSceneId` / `endSceneId` (when set) have type='Scene'
 *
 * Called by crud's `writeInterval` and `updateInterval` before any position
 * derivation. Read+check happens outside a DB transaction; safe today,
 * see `writeInterval` docstring for the future-Turso-replica caveat.
 */
export async function validateFKTypes(
	db: Db,
	input: WriteIntervalInput,
	userId: string
): Promise<void> {
	const [entity] = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.id, input.entityId), eq(entities.userId, userId)));
	if (!entity) throw new Error(`entity_id not found: ${input.entityId}`);

	await assertEntityType(db, input.startActId, 'Act', userId);
	await assertEntityType(db, input.endActId, 'Act', userId);
	if (input.startSceneId) await assertEntityType(db, input.startSceneId, 'Scene', userId);
	if (input.endSceneId) await assertEntityType(db, input.endSceneId, 'Scene', userId);
}

/**
 * Assert that `id` is an entity of type='Event' owned by `userId`. Used to
 * enforce the polymorphic FK invariant on `map_events.source_event_id`
 * (World Map v3, Slice 1a) at the application layer — Postgres cannot
 * CHECK a column's referent type cleanly. Same pattern as the start_act_id /
 * end_act_id guards above. Per CLAUDE.md → "Polymorphic FK invariants":
 * adding a new polymorphic FK requires (1) this assertion + (2) a Vitest
 * invariant test (the latter ships with U8).
 *
 * Callers: `writeMapEvent` (Slice 1b) and any other path that writes
 * `map_events.source_event_id` to a non-null value.
 */
export async function assertSourceEventIdIsEvent(
	db: Db,
	id: string,
	userId: string
): Promise<void> {
	await assertEntityType(db, id, 'Event', userId);
}
