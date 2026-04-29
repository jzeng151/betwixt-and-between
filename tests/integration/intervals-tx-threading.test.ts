/**
 * Integration tests for transaction-threading behavior on the interval write
 * helpers. Decision D17 / Issue 11A + 17A (locked 2026-04-29 in /plan-eng-review).
 *
 * The contract says all of `writeInterval`, `updateInterval`, `splitInterval`,
 * and `moveSceneToAct` accept a polymorphic `tx | db` parameter so callers can
 * compose them inside a parent `db.transaction(async (tx) => {...})`. These
 * tests verify the BEHAVIOR (atomicity inside a transaction, no orphan rows
 * on rollback) rather than the type signatures themselves.
 *
 * Tests are RED until the implementation lands.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import {
	writeInterval,
	updateInterval,
	splitInterval,
	moveSceneToAct
} from '../../src/lib/server/intervals.js';

type Db = ReturnType<typeof createTestDb>;

describe('Interval helpers — transaction threading and atomicity (D17/17A)', () => {
	let db: Db;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		db = createTestDb();
		acts = await seedActs(db);
		const [c] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = c.id;
	});

	it('writeInterval composes inside db.transaction without nested tx errors', async () => {
		await db.transaction(async (tx) => {
			await writeInterval(tx as unknown as Db, {
				entityId: ellie,
				startActId: acts.act1,
				endActId: acts.act1
			});
		});
		const all = await db.select().from(intervals);
		expect(all).toHaveLength(1);
	});

	it('updateInterval composes inside db.transaction', async () => {
		const created = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act0
		});

		await db.transaction(async (tx) => {
			await updateInterval(tx as unknown as Db, created.id, { endActId: acts.act2 });
		});

		const [row] = await db.select().from(intervals);
		expect(row.endPosition).toBeCloseTo(3.0, 9);
	});

	it('splitInterval composes inside db.transaction', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});

		await db.transaction(async (tx) => {
			await splitInterval(tx as unknown as Db, original.id, 1.0);
		});

		const all = await db.select().from(intervals).where(eq(intervals.entityId, ellie));
		expect(all).toHaveLength(2);
	});

	it('moveSceneToAct composes inside db.transaction', async () => {
		const [s] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();

		await db.transaction(async (tx) => {
			await moveSceneToAct(tx as unknown as Db, s.id, acts.act2, 0);
		});

		const [moved] = await db.select().from(entities).where(eq(entities.id, s.id));
		expect(moved.parentId).toBe(acts.act2);
	});

	it('rollback: throwing inside a tx undoes prior writeInterval calls atomically', async () => {
		await expect(
			db.transaction(async (tx) => {
				await writeInterval(tx as unknown as Db, {
					entityId: ellie,
					startActId: acts.act0,
					endActId: acts.act0
				});
				// Force a failure (overlap) — first write must roll back.
				await writeInterval(tx as unknown as Db, {
					entityId: ellie,
					startActId: acts.act0,
					endActId: acts.act0
				});
			})
		).rejects.toThrow();

		const all = await db.select().from(intervals);
		expect(all).toHaveLength(0);
	});

	it('rollback: failure mid-split leaves both old and new rows untouched', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});

		await expect(
			db.transaction(async (tx) => {
				await splitInterval(tx as unknown as Db, original.id, 1.0);
				// Force a constraint violation — should roll back the split entirely.
				throw new Error('synthetic mid-tx failure');
			})
		).rejects.toThrow(/synthetic mid-tx failure/);

		const all = await db.select().from(intervals).where(eq(intervals.entityId, ellie));
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe(original.id);
		expect(all[0].startPosition).toBeCloseTo(0.0, 9);
		expect(all[0].endPosition).toBeCloseTo(2.0, 9);
	});

	it('rollback: failure mid-moveSceneToAct leaves scene + intervals untouched', async () => {
		const [s] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s.id,
			endActId: acts.act1,
			endSceneId: s.id
		});

		await expect(
			db.transaction(async (tx) => {
				await moveSceneToAct(tx as unknown as Db, s.id, acts.act2, 0);
				throw new Error('synthetic mid-tx failure');
			})
		).rejects.toThrow(/synthetic mid-tx failure/);

		// Scene parent unchanged.
		const [sceneAfter] = await db.select().from(entities).where(eq(entities.id, s.id));
		expect(sceneAfter.parentId).toBe(acts.act1);
		// Interval still anchored to act1.
		const [row] = await db.select().from(intervals);
		expect(row.startActId).toBe(acts.act1);
		expect(row.endActId).toBe(acts.act1);
	});
});
