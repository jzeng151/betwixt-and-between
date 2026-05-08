/**
 * Integration tests: recomputeAllIntervals cascades to temporal relationships.
 *
 * Covers: act reorder → relationship positions updated, and the critical
 * regression test that a mid-recompute transaction failure rolls back both
 * interval AND relationship positions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, relationships } from '../../src/lib/server/db/schema.js';
import { recomputeAllIntervals, writeInterval } from '../../src/lib/server/intervals.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedTwoActs(db: Db, userId: string) {
	const [act0] = await db.insert(entities).values({ userId, type: 'Act', name: 'Act 0', position: 0 }).returning();
	const [act1] = await db.insert(entities).values({ userId, type: 'Act', name: 'Act 1', position: 1 }).returning();
	return { act0: act0.id, act1: act1.id };
}

describe('recomputeAllIntervals — cascades to temporal relationships', () => {
	let db: Db;
	let userId: string;
	let act0: string;
	let act1: string;
	let alice: string;

	beforeEach(async () => {
		db = await createTestDb();
		const _user = await seedTestUser(db);
		userId = _user.id;
		const acts = await seedTwoActs(db, userId);
		act0 = acts.act0;
		act1 = acts.act1;

		const [c] = await db.insert(entities).values({ userId, type: 'Character', name: 'Alice' }).returning();
		alice = c.id;
	});

	it('reorder acts → recomputeAllIntervals updates relationship start_position', async () => {
		const [bob] = await db.insert(entities).values({ userId, type: 'Character', name: 'Bob' }).returning();

		// Temporal relationship anchored to act0 (position 0 → startPosition = 0.0)
		await db.insert(relationships).values({ userId,
			fromId: alice,
			toId: bob.id,
			type: 'rivals',
			startActId: act0,
			endActId: act0,
			startPosition: 0.0,
			endPosition: 1.0
		});

		// Reorder: act0 gets position 1, act1 gets position 0
		await db.update(entities).set({ position: 1 }).where(eq(entities.id, act0));
		await db.update(entities).set({ position: 0 }).where(eq(entities.id, act1));

		await recomputeAllIntervals(db, userId);

		const [rel] = await db.select().from(relationships).where(eq(relationships.fromId, alice));
		// act0 is now at index 1 → startPosition = 1.0, endPosition = 2.0
		expect(rel.startPosition).toBeCloseTo(1.0, 9);
		expect(rel.endPosition).toBeCloseTo(2.0, 9);
	});

	it('interval with same act anchor also recomputes after reorder', async () => {
		// Give alice an interval anchored to act0
		await writeInterval(db, { entityId: alice, startActId: act0, endActId: act0 }, userId);

		// Reorder: swap positions
		await db.update(entities).set({ position: 1 }).where(eq(entities.id, act0));
		await db.update(entities).set({ position: 0 }).where(eq(entities.id, act1));

		await recomputeAllIntervals(db, userId);

		// Interval startPosition should now be 1.0 (act0 moved to index 1)
		const { intervals } = await import('../../src/lib/server/db/schema.js');
		const [iv] = await db.select().from(intervals).where(eq(intervals.entityId, alice));
		expect(iv.startPosition).toBeCloseTo(1.0, 9);
		expect(iv.endPosition).toBeCloseTo(2.0, 9);
	});

	it('CRITICAL regression: transaction failure rolls back both interval and relationship positions', async () => {
		const [bob] = await db.insert(entities).values({ userId, type: 'Character', name: 'Bob' }).returning();

		// Interval for alice anchored to act0
		await writeInterval(db, { entityId: alice, startActId: act0, endActId: act0 }, userId);

		// Temporal relationship anchored to act0
		await db.insert(relationships).values({ userId,
			fromId: alice,
			toId: bob.id,
			type: 'rivals',
			startActId: act0,
			endActId: act0,
			startPosition: 0.0,
			endPosition: 1.0
		});

		// Snapshot positions before
		const { intervals } = await import('../../src/lib/server/db/schema.js');
		const [ivBefore] = await db.select().from(intervals).where(eq(intervals.entityId, alice));
		const [relBefore] = await db.select().from(relationships).where(eq(relationships.fromId, alice));

		// Attempt a transaction that reorders acts AND recomputes, but then rolls back
		try {
			await db.transaction(async (tx) => {
				await tx.update(entities).set({ position: 1 }).where(eq(entities.id, act0));
				await tx.update(entities).set({ position: 0 }).where(eq(entities.id, act1));
				await recomputeAllIntervals(tx, userId);
				// Force rollback by throwing
				throw new Error('forced rollback');
			});
		} catch {
			// Expected — the transaction rolled back
		}

		// Both interval and relationship positions must be unchanged
		const [ivAfter] = await db.select().from(intervals).where(eq(intervals.entityId, alice));
		const [relAfter] = await db.select().from(relationships).where(eq(relationships.fromId, alice));

		expect(ivAfter.startPosition).toBeCloseTo(ivBefore.startPosition, 9);
		expect(ivAfter.endPosition).toBeCloseTo(ivBefore.endPosition, 9);
		expect(relAfter.startPosition).toBeCloseTo(relBefore.startPosition!, 9);
		expect(relAfter.endPosition).toBeCloseTo(relBefore.endPosition!, 9);
	});
});
