/**
 * Integration tests for transaction-threading behavior on the interval write
 * helpers. Decision D17 / Issue 11A + 17A — REVISED 2026-04-29 during
 * implementation: better-sqlite3's `db.transaction()` requires a synchronous
 * callback, but our helper chain is async/await for Drizzle compatibility.
 * Wrapping the helpers in transactions requires the sync refactor (TODO T1)
 * which is deferred to a follow-up PR.
 *
 * HISTORICAL skip: these tests were paused while the codebase was on
 * better-sqlite3 (sync-callback-only db.transaction). The Postgres port
 * retired that constraint — see docs/adr/0004-neon-postgres-better-auth.md
 * and docs/adr/0005-editor-and-entity-detail.md → "Endpoints — extend,
 * don't proliferate" (handler bodies now wrap in db.transaction(async tx
 * => ...)). The Db type alias is in place; un-skipping should pass against
 * the current contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import {
	writeInterval,
	updateInterval,
	splitInterval,
	moveSceneToAct
} from '../../src/lib/server/intervals.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

describe('Interval helpers — transaction threading and atomicity (D17/17A)', () => {
	let db: Db;
	let userId: string;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		db = await createTestDb();
		const _user = await seedTestUser(db);
		userId = _user.id;
		acts = await seedActs(db, userId);
		const [c] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		ellie = c.id;
	});

	it.skip('writeInterval composes inside db.transaction without nested tx errors', async () => {
		await db.transaction(async (tx) => {
			await writeInterval(tx as unknown as Db, {
				entityId: ellie,
				startActId: acts.act1,
				endActId: acts.act1
			}, userId);
		});
		const all = await db.select().from(intervals);
		expect(all).toHaveLength(1);
	});

	it.skip('updateInterval composes inside db.transaction', async () => {
		const created = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act0
		}, userId);

		await db.transaction(async (tx) => {
			await updateInterval(tx as unknown as Db, created.id, { endActId: acts.act2 }, userId);
		});

		const [row] = await db.select().from(intervals);
		expect(row.endPosition).toBeCloseTo(3.0, 9);
	});

	it.skip('splitInterval composes inside db.transaction', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		}, userId);

		await db.transaction(async (tx) => {
			await splitInterval(tx as unknown as Db, original.id, 1.0, userId);
		});

		const all = await db.select().from(intervals).where(eq(intervals.entityId, ellie));
		expect(all).toHaveLength(2);
	});

	it.skip('moveSceneToAct composes inside db.transaction', async () => {
		const [s] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();

		await db.transaction(async (tx) => {
			await moveSceneToAct(tx as unknown as Db, s.id, acts.act2, 0, userId);
		});

		const [moved] = await db.select().from(entities).where(eq(entities.id, s.id));
		expect(moved.parentId).toBe(acts.act2);
	});

	it.skip('rollback: throwing inside a tx undoes prior writeInterval calls atomically', async () => {
		await expect(
			db.transaction(async (tx) => {
				await writeInterval(tx as unknown as Db, {
					entityId: ellie,
					startActId: acts.act0,
					endActId: acts.act0
				}, userId);
				// Force a failure (overlap) — first write must roll back.
				await writeInterval(tx as unknown as Db, {
					entityId: ellie,
					startActId: acts.act0,
					endActId: acts.act0
				}, userId);
			})
		).rejects.toThrow();

		const all = await db.select().from(intervals);
		expect(all).toHaveLength(0);
	});

	it.skip('rollback: failure mid-split leaves both old and new rows untouched', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		}, userId);

		await expect(
			db.transaction(async (tx) => {
				await splitInterval(tx as unknown as Db, original.id, 1.0, userId);
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

	it.skip('rollback: failure mid-moveSceneToAct leaves scene + intervals untouched', async () => {
		const [s] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s.id,
			endActId: acts.act1,
			endSceneId: s.id
		}, userId);

		await expect(
			db.transaction(async (tx) => {
				await moveSceneToAct(tx as unknown as Db, s.id, acts.act2, 0, userId);
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
