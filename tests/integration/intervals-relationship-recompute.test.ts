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

	it('orphaned relationship (act anchors nulled, stale positions left) is cleared to timeless', async () => {
		// Slice 5 PR-D / Codex P2. When an Act holding BOTH act anchors of a
		// scoped caused_by edge is plain-deleted, ON DELETE SET NULL nulls the
		// FKs but leaves start/end_position holding the deleted Act's story-time.
		// recomputeAllIntervals must clear those positions so the edge reverts to
		// timeless — otherwise isCausalEdgeClickable (which only checks
		// startPosition != null) keeps it jumpable and leaks the deleted timing.
		const [bob] = await db.insert(entities).values({ userId, type: 'Character', name: 'Bob' }).returning();

		// Simulate the post-cascade state: caused_by scoped to act0 but its act
		// FKs already nulled (as ON DELETE SET NULL would leave them), with the
		// stale positions still present.
		await db.insert(relationships).values({ userId,
			fromId: alice,
			toId: bob.id,
			type: 'caused_by',
			startActId: null,
			endActId: null,
			startPosition: 0.0,
			endPosition: 1.0
		});

		await recomputeAllIntervals(db, userId);

		const [rel] = await db.select().from(relationships).where(eq(relationships.fromId, alice));
		expect(rel.startPosition).toBeNull();
		expect(rel.endPosition).toBeNull();
	});

	it('partial anchor (one act FK nulled by delete, the other surviving) reverts to timeless without throwing', async () => {
		// Slice 5 PR-D / Codex P1. The modal lets start/end acts differ, so a
		// caused_by edge can span act0 → act1. A plain delete of act0 nulls
		// startActId via ON DELETE SET NULL but leaves endActId = act1. The row
		// then has exactly one act anchor, which resolveRelationshipBounds rejects
		// (both-or-neither) — that throw would abort the Act-delete transaction.
		// recompute must instead revert the unscopable row to timeless.
		const [bob] = await db.insert(entities).values({ userId, type: 'Character', name: 'Bob' }).returning();

		// Post-cascade partial state: startAct nulled, endAct still act1, stale
		// positions left behind.
		await db.insert(relationships).values({ userId,
			fromId: alice,
			toId: bob.id,
			type: 'caused_by',
			startActId: null,
			endActId: act1,
			startPosition: 0.0,
			endPosition: 2.0
		});

		// Must not throw (a throw here is what aborts the delete transaction).
		await expect(recomputeAllIntervals(db, userId)).resolves.toBeTypeOf('number');

		const [rel] = await db.select().from(relationships).where(eq(relationships.fromId, alice));
		expect(rel.startActId).toBeNull();
		expect(rel.endActId).toBeNull();
		expect(rel.startPosition).toBeNull();
		expect(rel.endPosition).toBeNull();
	});

	it('scene swap of two same-endpoint caused_by edges does not trip the temporal dedup unique index', async () => {
		// Slice 5 PR-D / Codex P2. relationships_temporal_dedup is UNIQUE
		// (from,to,type,start_position) WHERE start_position IS NOT NULL — so two
		// caused_by(alice→bob) edges can coexist only because they're scoped to
		// different scenes (different start_position). A scene reorder swaps those
		// positions; a row-by-row recompute would momentarily write one edge onto
		// the other's still-current position and trip the unique index, aborting
		// the reorder. The staged (two-phase) write must let the swap complete.
		const [bob] = await db.insert(entities).values({ userId, type: 'Character', name: 'Bob' }).returning();
		const [sceneA] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'A', parentId: act0, position: 0 })
			.returning();
		const [sceneB] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'B', parentId: act0, position: 1 })
			.returning();

		// act0 is index 0, two scenes → A occupies [0, 0.5), B occupies [0.5, 1).
		const [relA] = await db.insert(relationships).values({ userId,
			fromId: alice, toId: bob.id, type: 'caused_by',
			startActId: act0, startSceneId: sceneA.id, endActId: act0, endSceneId: sceneA.id,
			startPosition: 0.0, endPosition: 0.5
		}).returning();
		const [relB] = await db.insert(relationships).values({ userId,
			fromId: alice, toId: bob.id, type: 'caused_by',
			startActId: act0, startSceneId: sceneB.id, endActId: act0, endSceneId: sceneB.id,
			startPosition: 0.5, endPosition: 1.0
		}).returning();

		// Swap the two scenes' order within act0.
		await db.update(entities).set({ position: 1 }).where(eq(entities.id, sceneA.id));
		await db.update(entities).set({ position: 0 }).where(eq(entities.id, sceneB.id));

		// Must NOT throw a unique-violation (that would abort the reorder).
		await expect(recomputeAllIntervals(db, userId)).resolves.toBeTypeOf('number');

		const [aAfter] = await db.select().from(relationships).where(eq(relationships.id, relA.id));
		const [bAfter] = await db.select().from(relationships).where(eq(relationships.id, relB.id));
		// Positions swapped: A now at index 1 → [0.5,1), B now at index 0 → [0,0.5).
		expect(aAfter.startPosition).toBeCloseTo(0.5, 9);
		expect(bAfter.startPosition).toBeCloseTo(0.0, 9);
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

		// Attempt a transaction that reorders acts AND recomputes, but then rolls back.
		// Assert on the forced-rollback message specifically — a bare catch would
		// swallow a real recomputeAllIntervals failure and let the post-rollback
		// assertions green for the wrong reason.
		await expect(
			db.transaction(async (tx) => {
				await tx.update(entities).set({ position: 1 }).where(eq(entities.id, act0));
				await tx.update(entities).set({ position: 0 }).where(eq(entities.id, act1));
				await recomputeAllIntervals(tx, userId);
				// Force rollback by throwing
				throw new Error('forced rollback');
			})
		).rejects.toThrow('forced rollback');

		// Both interval and relationship positions must be unchanged
		const [ivAfter] = await db.select().from(intervals).where(eq(intervals.entityId, alice));
		const [relAfter] = await db.select().from(relationships).where(eq(relationships.fromId, alice));

		expect(ivAfter.startPosition).toBeCloseTo(ivBefore.startPosition, 9);
		expect(ivAfter.endPosition).toBeCloseTo(ivBefore.endPosition, 9);
		expect(relAfter.startPosition).toBeCloseTo(relBefore.startPosition!, 9);
		expect(relAfter.endPosition).toBeCloseTo(relBefore.endPosition!, 9);
	});
});
