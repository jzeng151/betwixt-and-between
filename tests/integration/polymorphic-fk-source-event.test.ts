/**
 * World Map v3 Slice 1a Δ1a-A — polymorphic FK invariant for
 * map_events.source_event_id.
 *
 * Per CLAUDE.md → "Polymorphic FK invariants", adding a new polymorphic FK
 * requires both the application-layer assertion (assertSourceEventIdIsEvent
 * in src/lib/server/intervals/polymorphic-fk.ts) AND this Vitest invariant
 * test. The DB cannot CHECK that the entities row referenced by
 * source_event_id has type='Event', so this test pins the regression class:
 * a future caller of writeMapEvent that forgets the assertion is caught here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities } from '../../src/lib/server/db/schema.js';
import { assertSourceEventIdIsEvent } from '../../src/lib/server/intervals/polymorphic-fk.js';

describe('assertSourceEventIdIsEvent (Δ1a-A)', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;
	let userId: string;

	beforeEach(async () => {
		db = await createTestDb();
		const user = await seedTestUser(db);
		userId = user.id;
	});

	it('accepts an entity with type=Event owned by the caller', async () => {
		const [event] = await db
			.insert(entities)
			.values({ userId, type: 'Event', name: 'Coronation' })
			.returning();
		await expect(assertSourceEventIdIsEvent(db, event.id, userId)).resolves.toBeUndefined();
	});

	it('rejects an entity of a different type (e.g., Location)', async () => {
		const [loc] = await db
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Castle' })
			.returning();
		await expect(assertSourceEventIdIsEvent(db, loc.id, userId)).rejects.toThrow(
			/Polymorphic FK violation.*type='Location'.*expected 'Event'/
		);
	});

	it('rejects a missing entity id', async () => {
		const fakeId = '00000000-0000-0000-0000-000000000000';
		await expect(assertSourceEventIdIsEvent(db, fakeId, userId)).rejects.toThrow(
			/Entity not found/
		);
	});

	it('rejects an Event owned by a different user (cross-user defense)', async () => {
		const otherUser = await seedTestUser(db, { email: 'other@test.com' });
		const [event] = await db
			.insert(entities)
			.values({ userId: otherUser.id, type: 'Event', name: 'Foreign event' })
			.returning();
		// Look up under the original user's scope — assertion should fail at
		// the same "Entity not found" branch (scoped WHERE userId=...) rather
		// than leaking the foreign Event as accepted.
		await expect(assertSourceEventIdIsEvent(db, event.id, userId)).rejects.toThrow(
			/Entity not found/
		);
	});
});
