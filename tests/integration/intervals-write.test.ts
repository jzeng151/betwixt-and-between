/**
 * Integration tests for writeInterval (chokepoint), updateInterval,
 * recomputeIntervalsForAct, and recomputeAllIntervals.
 *
 * These exercise the polymorphic FK type validation, position derivation,
 * dual-write invariant enforcement, and recompute branching logic — without
 * spinning up the SvelteKit server.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import {
	writeInterval,
	updateInterval,
	recomputeIntervalsForAct,
	recomputeAllIntervals
} from '../../src/lib/server/intervals.js';

type Db = ReturnType<typeof createTestDb>;

describe('writeInterval — chokepoint', () => {
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

	it('creates a full-act interval from FKs alone (positions derived)', async () => {
		const row = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1
		});
		expect(row.startPosition).toBeCloseTo(1.0, 9);
		expect(row.endPosition).toBeCloseTo(2.0, 9);
		expect(row.startSceneId).toBeNull();
		expect(row.endSceneId).toBeNull();
	});

	it('creates a multi-act interval', async () => {
		const row = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2
		});
		expect(row.startPosition).toBeCloseTo(0.0, 9);
		expect(row.endPosition).toBeCloseTo(3.0, 9);
	});

	it('rejects polymorphic FK violation on start_act_id (Character pointer)', async () => {
		await expect(
			writeInterval(db, { entityId: ellie, startActId: ellie, endActId: acts.act0 })
		).rejects.toThrow(/Polymorphic FK violation/);
	});

	it('rejects polymorphic FK violation on start_scene_id (non-Scene)', async () => {
		// ellie is a Character, not a Scene
		await expect(
			writeInterval(db, {
				entityId: ellie,
				startActId: acts.act0,
				startSceneId: ellie,
				endActId: acts.act0
			})
		).rejects.toThrow(/Polymorphic FK violation/);
	});

	it('rejects when supplied positions disagree with FK derivation', async () => {
		await expect(
			writeInterval(db, {
				entityId: ellie,
				startActId: acts.act1,
				endActId: acts.act1,
				startPosition: 1.0,
				endPosition: 1.5 // wrong; full Act 1 ends at 2.0
			})
		).rejects.toThrow(/does not match derived/);
	});

	it('accepts supplied positions when they match FK derivation (within epsilon)', async () => {
		const row = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1,
			startPosition: 1.0,
			endPosition: 2.0 + 1e-12 // within epsilon
		});
		expect(row.startPosition).toBeCloseTo(1.0, 9);
		expect(row.endPosition).toBeCloseTo(2.0, 9);
	});

	it('CHECK constraint prevents start_position >= end_position via raw SQL', async () => {
		// This goes around writeInterval to confirm the DB-level guard exists.
		// (writeInterval's own validation also rejects this case.)
		expect(() =>
			db
				.$client.exec(
					`INSERT INTO intervals (id, entity_id, start_act_id, end_act_id, start_position, end_position) VALUES ('bad', '${ellie}', '${acts.act0}', '${acts.act0}', 1.0, 0.5)`
				)
		).toThrow(/CHECK constraint/);
	});

	it('cascades delete when entity is deleted', async () => {
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1
		});
		const before = await db.select().from(intervals);
		expect(before).toHaveLength(1);

		await db.delete(entities).where(eq(entities.id, ellie));

		const after = await db.select().from(intervals);
		expect(after).toHaveLength(0);
	});

	it('cascades delete when start_act is deleted', async () => {
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1
		});
		await db.delete(entities).where(eq(entities.id, acts.act1));

		const after = await db.select().from(intervals);
		expect(after).toHaveLength(0);
	});

	it('SET NULL on start_scene when scene is deleted', async () => {
		const [s0] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s0.id,
			endActId: acts.act1,
			endSceneId: s0.id
		});
		await db.delete(entities).where(eq(entities.id, s0.id));

		const [row] = await db.select().from(intervals);
		expect(row).toBeDefined();
		expect(row.startSceneId).toBeNull();
		expect(row.endSceneId).toBeNull();
	});
});

describe('updateInterval', () => {
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

	it('recomputes positions when end_act_id changes', async () => {
		const row = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act0
		});
		expect(row.endPosition).toBeCloseTo(1.0, 9);

		const updated = await updateInterval(db, row.id, { endActId: acts.act2 });
		expect(updated.endPosition).toBeCloseTo(3.0, 9);
	});

	it('rejects new range that would overlap an existing interval', async () => {
		// Ellie present in Act 0 → [0, 1) and Act 2 → [2, 3).
		await writeInterval(db, { entityId: ellie, startActId: acts.act0, endActId: acts.act0 });
		const second = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act2,
			endActId: acts.act2
		});

		// Try to extend the Act-2 interval back to start at Act 0 → would overlap
		// [0, 1) with the first interval.
		await expect(
			updateInterval(db, second.id, { startActId: acts.act0 })
		).rejects.toThrow(/Overlap with existing interval/);
	});

	it('allows updating to a non-overlapping range, even if it shrinks', async () => {
		// Ellie covers Act 0–Act 2 → [0, 3).
		const row = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2
		});

		// Shrink to just Act 1 → [1, 2). No other rows for Ellie, so no overlap.
		const updated = await updateInterval(db, row.id, {
			startActId: acts.act1,
			endActId: acts.act1
		});
		expect(updated.startPosition).toBeCloseTo(1.0, 9);
		expect(updated.endPosition).toBeCloseTo(2.0, 9);
	});
});

describe('writeInterval — same-entity overlap rejection', () => {
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

	it('rejects same-entity overlapping interval', async () => {
		// Ellie [0, 2): spans Acts 0 and 1.
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1
		});
		// Now try Ellie [1, 2): overlaps with Act 1 portion of the first row.
		await expect(
			writeInterval(db, { entityId: ellie, startActId: acts.act1, endActId: acts.act1 })
		).rejects.toThrow(/Overlap with existing interval/);
	});

	it('allows same-entity adjacent intervals (touching at boundary)', async () => {
		// Ellie [0, 1) — Act 0 only.
		await writeInterval(db, { entityId: ellie, startActId: acts.act0, endActId: acts.act0 });
		// Ellie [1, 2) — Act 1 only. Touches [0, 1) at 1.0 but does not overlap
		// under half-open semantics.
		const row2 = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1
		});
		expect(row2.startPosition).toBeCloseTo(1.0, 9);
		expect(row2.endPosition).toBeCloseTo(2.0, 9);
	});

	it('allows different-entity overlapping intervals', async () => {
		const [j] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Joel' })
			.returning();

		await writeInterval(db, { entityId: ellie, startActId: acts.act1, endActId: acts.act1 });
		// Joel covers the same range — fine, different entity.
		const joelRow = await writeInterval(db, {
			entityId: j.id,
			startActId: acts.act1,
			endActId: acts.act1
		});
		expect(joelRow.startPosition).toBeCloseTo(1.0, 9);
		expect(joelRow.endPosition).toBeCloseTo(2.0, 9);
	});

	it('rejects same-entity duplicate range', async () => {
		await writeInterval(db, { entityId: ellie, startActId: acts.act1, endActId: acts.act1 });
		// Identical range — total overlap.
		await expect(
			writeInterval(db, { entityId: ellie, startActId: acts.act1, endActId: acts.act1 })
		).rejects.toThrow(/Overlap with existing interval/);
	});
});

describe('recomputeIntervalsForAct', () => {
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

	it('updates scene-anchored intervals when scenes are reordered', async () => {
		// 3 scenes in Act 1, positions 0/1/2 → ranges [1.0,1.333), [1.333,1.667), [1.667,2.0)
		const [s0] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		const [s1] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 })
			.returning();
		const [s2] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S2', parentId: acts.act1, position: 2 })
			.returning();

		// Ellie anchored to scene s1 only.
		const before = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s1.id,
			endActId: acts.act1,
			endSceneId: s1.id
		});
		expect(before.startPosition).toBeCloseTo(1 + 1 / 3, 9);
		expect(before.endPosition).toBeCloseTo(1 + 2 / 3, 9);

		// Reorder: swap s0 and s1's positions.
		await db.update(entities).set({ position: 1 }).where(eq(entities.id, s0.id));
		await db.update(entities).set({ position: 0 }).where(eq(entities.id, s1.id));

		// Recompute.
		const touched = await recomputeIntervalsForAct(db, acts.act1);
		expect(touched).toBe(1);

		const [after] = await db.select().from(intervals);
		expect(after.startPosition).toBeCloseTo(1 + 0 / 3, 9);
		expect(after.endPosition).toBeCloseTo(1 + 1 / 3, 9);
		// silence
		expect(s2.id).toBeTruthy();
	});

	it('leaves fraction-positioned intervals frozen', async () => {
		// First write a scene-anchored interval to establish baseline numbers.
		await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 });

		// Now plant a fraction-positioned interval (no scene FK) at start=1.5, end=1.75.
		// We can't create this via writeInterval (which derives from FKs only), so we use
		// raw insert. This simulates a future PR 2 capability.
		await db.insert(intervals).values({
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: null,
			endActId: acts.act1,
			endSceneId: null,
			startPosition: 1.5,
			endPosition: 1.75
		});

		// Recompute should NOT touch this row (no scene FK on either side).
		const touched = await recomputeIntervalsForAct(db, acts.act1);
		expect(touched).toBe(0);

		const [row] = await db.select().from(intervals);
		expect(row.startPosition).toBeCloseTo(1.5, 9);
		expect(row.endPosition).toBeCloseTo(1.75, 9);
	});
});

describe('recomputeAllIntervals (Act-level mutations)', () => {
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

	it('updates positions when Act ordering changes', async () => {
		// Ellie present in all of Act 1 originally → positions [1.0, 2.0).
		const before = await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1
		});
		expect(before.startPosition).toBeCloseTo(1.0, 9);
		expect(before.endPosition).toBeCloseTo(2.0, 9);

		// Swap Act 1 and Act 2's positions: act1 → 2, act2 → 1.
		await db.update(entities).set({ position: 2 }).where(eq(entities.id, acts.act1));
		await db.update(entities).set({ position: 1 }).where(eq(entities.id, acts.act2));

		const touched = await recomputeAllIntervals(db);
		expect(touched).toBe(1);

		const [after] = await db.select().from(intervals);
		// act1 is now at index 2 → positions [2.0, 3.0).
		expect(after.startPosition).toBeCloseTo(2.0, 9);
		expect(after.endPosition).toBeCloseTo(3.0, 9);
	});
});
