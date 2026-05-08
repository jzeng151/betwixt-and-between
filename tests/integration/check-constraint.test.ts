/**
 * intervals_position_order CHECK constraint preserved through the
 * sqlite→pg port (T8a).
 *
 * Drizzle's check() declaration generates the right pg syntax in the
 * regenerated migration. This test confirms the constraint actually
 * fires server-side — pg rejects rows where start_position >= end_position
 * with a 23514 (check_violation) error.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';

describe('intervals_position_order CHECK constraint', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;
	let userId: string;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		db = await createTestDb();
		const _user = await seedTestUser(db);
		userId = _user.id;
		acts = await seedActs(db, userId);
		const [e] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		ellie = e.id;
	});

	it('rejects start_position > end_position', async () => {
		await expect(
			db.insert(intervals).values({
				userId,
			entityId: ellie,
				startActId: acts.act0,
				endActId: acts.act0,
				startPosition: 1.0,
				endPosition: 0.5
			})
		).rejects.toThrow();
	});

	it('rejects start_position == end_position (strict <)', async () => {
		await expect(
			db.insert(intervals).values({
				userId,
			entityId: ellie,
				startActId: acts.act0,
				endActId: acts.act0,
				startPosition: 0.5,
				endPosition: 0.5
			})
		).rejects.toThrow();
	});

	it('accepts start_position < end_position', async () => {
		const [row] = await db
			.insert(intervals)
			.values({
				entityId: ellie,
				startActId: acts.act0,
				endActId: acts.act0,
				startPosition: 0.0,
				endPosition: 1.0
			})
			.returning();
		expect(row.startPosition).toBe(0);
		expect(row.endPosition).toBe(1);
	});

	it('rejects an UPDATE that violates the constraint', async () => {
		const [row] = await db
			.insert(intervals)
			.values({
				entityId: ellie,
				startActId: acts.act0,
				endActId: acts.act0,
				startPosition: 0.0,
				endPosition: 1.0
			})
			.returning();
		await expect(
			db.execute(
				sql.raw(
					`UPDATE intervals SET start_position = 2.0 WHERE id = '${row.id}'`
				)
			)
		).rejects.toThrow();
	});
});
