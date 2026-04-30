/**
 * Integration tests for `splitInterval(db, intervalId, atPosition)` —
 * Decision D7 / Issue 5b A (locked 2026-04-29 in /plan-eng-review).
 *
 * Behavior:
 *   - Splits a multi-act bar at an internal act boundary into two adjacent
 *     intervals: original shrinks to [start, P), new row created [P, end).
 *   - FK resolution via existing positionToStart/EndFKs from
 *     $lib/timeline-v2-helpers.
 *   - Rejects splits outside the range or at the exact endpoints.
 *   - Both writes happen inside db.transaction.
 *   - Same entity_id on both halves.
 *
 * Tests are RED until the implementation lands.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { writeInterval, splitInterval } from '../../src/lib/server/intervals.js';

type Db = ReturnType<typeof createTestDb>;

describe('splitInterval — D7/5b A', () => {
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

	it('splits a 2-act bar at the internal boundary into [start, P) + [P, end)', async () => {
		// Ellie covers act0+act1 → [0, 2).
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});

		await splitInterval(db, original.id, 1.0);

		const all = await db
			.select()
			.from(intervals)
			.where(eq(intervals.entityId, ellie))
			.orderBy(asc(intervals.startPosition));
		expect(all).toHaveLength(2);

		// Original shrinks to [0, 1).
		const left = all[0];
		expect(left.startPosition).toBeCloseTo(0.0, 9);
		expect(left.endPosition).toBeCloseTo(1.0, 9);
		// New half: [1, 2).
		const right = all[1];
		expect(right.startPosition).toBeCloseTo(1.0, 9);
		expect(right.endPosition).toBeCloseTo(2.0, 9);

		// Both belong to the same entity.
		expect(left.entityId).toBe(ellie);
		expect(right.entityId).toBe(ellie);
	});

	it('original retains its id; new row is the high-side half', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});

		await splitInterval(db, original.id, 1.0);

		const [origAfter] = await db
			.select()
			.from(intervals)
			.where(eq(intervals.id, original.id));
		expect(origAfter).toBeDefined();
		// Original was [0, 2). After split, it becomes the LEFT half [0, 1).
		expect(origAfter.startPosition).toBeCloseTo(0.0, 9);
		expect(origAfter.endPosition).toBeCloseTo(1.0, 9);
	});

	it('FK resolution: end of left half = positionToEndFKs (act0 with no scene)', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});

		await splitInterval(db, original.id, 1.0);

		const all = await db
			.select()
			.from(intervals)
			.where(eq(intervals.entityId, ellie))
			.orderBy(asc(intervals.startPosition));

		const left = all[0];
		// Boundary at integer 1.0 → end of act0, no scene FK.
		expect(left.endActId).toBe(acts.act0);
		expect(left.endSceneId).toBeNull();
		expect(left.startActId).toBe(acts.act0);
		expect(left.startSceneId).toBeNull();

		const right = all[1];
		// Boundary at integer 1.0 → start of act1, no scene FK.
		expect(right.startActId).toBe(acts.act1);
		expect(right.startSceneId).toBeNull();
		expect(right.endActId).toBe(acts.act1);
		expect(right.endSceneId).toBeNull();
	});

	it('rejects split below the bar range (atPosition < startPosition)', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act2
		});
		await expect(splitInterval(db, original.id, 0.5)).rejects.toThrow();
	});

	it('rejects split above the bar range (atPosition > endPosition)', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});
		await expect(splitInterval(db, original.id, 2.5)).rejects.toThrow();
	});

	it('rejects split exactly at start (zero-extent left half)', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});
		await expect(splitInterval(db, original.id, 0.0)).rejects.toThrow();
	});

	it('rejects split exactly at end (zero-extent right half)', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});
		await expect(splitInterval(db, original.id, 2.0)).rejects.toThrow();
	});

	it('3-act bar split at first internal boundary produces [0, 1) + [1, 3)', async () => {
		// Ellie spans all three acts → [0, 3).
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2
		});

		await splitInterval(db, original.id, 1.0);

		const all = await db
			.select()
			.from(intervals)
			.where(eq(intervals.entityId, ellie))
			.orderBy(asc(intervals.startPosition));
		expect(all).toHaveLength(2);
		expect(all[0].startPosition).toBeCloseTo(0.0, 9);
		expect(all[0].endPosition).toBeCloseTo(1.0, 9);
		expect(all[1].startPosition).toBeCloseTo(1.0, 9);
		expect(all[1].endPosition).toBeCloseTo(3.0, 9);
	});

	it('3-act bar split at second internal boundary produces [0, 2) + [2, 3)', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2
		});

		await splitInterval(db, original.id, 2.0);

		const all = await db
			.select()
			.from(intervals)
			.where(eq(intervals.entityId, ellie))
			.orderBy(asc(intervals.startPosition));
		expect(all).toHaveLength(2);
		expect(all[0].startPosition).toBeCloseTo(0.0, 9);
		expect(all[0].endPosition).toBeCloseTo(2.0, 9);
		expect(all[1].startPosition).toBeCloseTo(2.0, 9);
		expect(all[1].endPosition).toBeCloseTo(3.0, 9);
	});

	it('atomic in db.transaction: failure leaves the original intact (no half-split state)', async () => {
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});

		// Force a failure with an out-of-range split position. Verify the original
		// row is unchanged (would-be left-side update did NOT persist).
		await expect(splitInterval(db, original.id, -1)).rejects.toThrow();

		const all = await db
			.select()
			.from(intervals)
			.where(eq(intervals.entityId, ellie));
		expect(all).toHaveLength(1);
		expect(all[0].startPosition).toBeCloseTo(0.0, 9);
		expect(all[0].endPosition).toBeCloseTo(2.0, 9);
	});

	it('scene-anchored split: scene FKs resolve correctly when boundary lands on a scene edge', async () => {
		// Plant 2 scenes in act1.
		const [s0] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		const [s1] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 })
			.returning();

		// Ellie covers all of act1 → [1, 2).
		const original = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1
		});

		// Split at 1.5 (the scene-1 boundary: k=1, m=2 → 1 + 1/2 = 1.5).
		await splitInterval(db, original.id, 1.5);

		const all = await db
			.select()
			.from(intervals)
			.where(eq(intervals.entityId, ellie))
			.orderBy(asc(intervals.startPosition));
		expect(all).toHaveLength(2);
		expect(all[0].endPosition).toBeCloseTo(1.5, 9);
		expect(all[1].startPosition).toBeCloseTo(1.5, 9);

		// Boundary k=1 of m=2 → left half ends at scene index k-1 = s0; right
		// half starts at scene index k = s1.
		expect(all[0].endSceneId).toBe(s0.id);
		expect(all[1].startSceneId).toBe(s1.id);
	});

	it('rejects split on a non-existent interval', async () => {
		await expect(splitInterval(db, 'no-such-id', 1.0)).rejects.toThrow();
	});
});
