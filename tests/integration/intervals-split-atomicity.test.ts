/**
 * CRITICAL REGRESSION TEST: splitInterval atomicity under transaction rollback.
 *
 * Replaces the deferred-T1 raw BEGIN/COMMIT workaround that lived in
 * splitInterval prior to T8a. With drizzle-orm/postgres-js the helper
 * stays async and callers wrap it in db.transaction(async tx => ...).
 *
 * What this test guards:
 *   - Wrapping splitInterval in a tx that throws AFTER the split completes
 *     must roll back BOTH the UPDATE (left half) and the INSERT (right half).
 *   - Without atomicity, a crash between writes would leave a permanently
 *     shortened interval with no right half — silent data corruption.
 *
 * Iron rule (CONSIDERATIONS.md → "REGRESSION RULE"): the test is part of
 * T8a, not deferred, because the workaround it replaces was protecting
 * against this exact failure mode.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { writeInterval, splitInterval } from '../../src/lib/server/intervals.js';

describe('splitInterval atomicity under tx rollback', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		db = await createTestDb();
		acts = await seedActs(db);
		const [e] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = e.id;
	});

	it('rolls back both halves of splitInterval when the wrapping tx throws', async () => {
		// Setup: one interval spanning Acts 0..2 (a 3-act bar).
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2
		});
		expect(original.startPosition).toBe(0);
		expect(original.endPosition).toBe(3);

		// Attempt the split inside a tx that throws after splitInterval.
		await expect(
			db.transaction(async (tx) => {
				await splitInterval(tx, original.id, 1.5);
				throw new Error('boom — caller failure mid-tx');
			})
		).rejects.toThrow(/boom/);

		// Post-rollback: the original interval must still be one row,
		// unchanged. The right-half insert must NOT exist.
		const all = await db.select().from(intervals);
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe(original.id);
		expect(all[0].startPosition).toBe(0);
		expect(all[0].endPosition).toBe(3);
	});

	it('commits both halves when the wrapping tx succeeds', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2
		});

		await db.transaction(async (tx) => {
			await splitInterval(tx, original.id, 1.5);
		});

		const all = await db.select().from(intervals).orderBy(intervals.startPosition);
		expect(all).toHaveLength(2);
		expect(all[0].startPosition).toBe(0);
		expect(all[0].endPosition).toBe(1.5);
		expect(all[1].startPosition).toBe(1.5);
		expect(all[1].endPosition).toBe(3);
	});
});
