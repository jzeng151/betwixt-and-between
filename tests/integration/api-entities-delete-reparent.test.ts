/**
 * Integration tests for DELETE /api/entities/[id] with optional scene
 * reparenting. Decisions D9 / Issue 7B and the P2-3 fix (locked 2026-04-29
 * in /plan-eng-review).
 *
 * The handler accepts an optional `?moveScenesTo=<targetActId>` query param.
 * Without it, default cascade applies. With it, the handler:
 *   1. UPDATEs scenes' parent_id → target, position appended at end of target's
 *      existing scenes.
 *   2. UPDATEs intervals' start_act_id / end_act_id to target where the
 *      anchored scene is being reparented (P2-3 critical fix).
 *   3. DELETEs source act (FK cascade picks up remaining intervals).
 *   4. Recomputes survivors.
 *   5. Atomic in db.transaction.
 *
 * Tests are RED until the implementation lands.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and, asc } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { writeInterval } from '../../src/lib/server/intervals.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

vi.mock('$lib/server/db/index.js', () => ({
	getDb: async () => currentDb,
	withDb: async (_env: unknown, callback: (db: typeof currentDb) => Promise<unknown>) => callback(currentDb)
}));

const idRoute = await import('../../src/routes/api/entities/[id]/+server.js');

function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/entities/x'),
		params: overrides.params ?? {},
		request: {
			json: async () => overrides.body
		}
	};
}

describe('DELETE /api/entities/[id] — Act delete cascade and reparent', () => {
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		acts = await seedActs(currentDb);
		const [c] = await currentDb
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = c.id;
	});

	it('default cascade (no moveScenesTo): act + scenes + intervals all vanish, survivors recompute', async () => {
		// 2 scenes in act1.
		const [s0] = await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 });

		// Interval anchored inside act1.
		await writeInterval(currentDb, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s0.id,
			endActId: acts.act1,
			endSceneId: s0.id
		});
		// Survivor: interval in act2 → [2, 3).
		const [damienE] = await currentDb
			.insert(entities)
			.values({ type: 'Character', name: 'Damien' })
			.returning();
		await writeInterval(currentDb, {
			entityId: damienE.id,
			startActId: acts.act2,
			endActId: acts.act2
		});

		const url = new URL(`http://localhost/api/entities/${acts.act1}`);
		await idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }));

		// Scenes for act1 gone.
		const remainingScenes = await currentDb
			.select()
			.from(entities)
			.where(eq(entities.parentId, acts.act1));
		expect(remainingScenes).toHaveLength(0);

		// Only Damien's interval remains.
		const remaining = await currentDb.select().from(intervals);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].entityId).toBe(damienE.id);

		// REGRESSION (Decision D1): position now reflects the new act ordering.
		// act1 was index 1; after delete, original act2 (now sole survivor besides
		// act0) sits at index 1. Damien's [2, 3) becomes [1, 2).
		expect(remaining[0].startPosition).toBeCloseTo(1.0, 9);
		expect(remaining[0].endPosition).toBeCloseTo(2.0, 9);
	});

	it('moveScenesTo reparents scenes: scenes UPDATE parent_id to target, appended at end', async () => {
		// 2 scenes in act1, 1 scene in act2 (target gets 2 scenes appended after position 0).
		const [s0] = await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		const [s1] = await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 })
			.returning();
		await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'Existing', parentId: acts.act2, position: 0 });

		const url = new URL(
			`http://localhost/api/entities/${acts.act1}?moveScenesTo=${acts.act2}`
		);
		await idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }));

		// Scenes now belong to act2, appended after the existing scene.
		const inTarget = await currentDb
			.select()
			.from(entities)
			.where(and(eq(entities.parentId, acts.act2), eq(entities.type, 'Scene')))
			.orderBy(asc(entities.position));
		expect(inTarget).toHaveLength(3);

		const movedS0 = inTarget.find((s) => s.id === s0.id);
		const movedS1 = inTarget.find((s) => s.id === s1.id);
		expect(movedS0).toBeDefined();
		expect(movedS1).toBeDefined();
		// Appended after position 0 → positions 1 and 2 (in original order).
		expect(movedS0?.position).toBe(1);
		expect(movedS1?.position).toBe(2);
	});

	it('moveScenesTo updates intervals.start_act_id / end_act_id (P2-3 critical fix)', async () => {
		const [s0] = await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		const [s1] = await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 })
			.returning();

		// Interval anchored to scenes inside act1.
		await writeInterval(currentDb, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s0.id,
			endActId: acts.act1,
			endSceneId: s1.id
		});

		const url = new URL(
			`http://localhost/api/entities/${acts.act1}?moveScenesTo=${acts.act2}`
		);
		await idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }));

		// Without P2-3, FK cascade would have nuked the interval on act1 delete.
		// With P2-3, start_act_id and end_act_id were UPDATEd to act2 BEFORE the
		// source delete, so the interval survives anchored to act2.
		const remaining = await currentDb.select().from(intervals);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].startActId).toBe(acts.act2);
		expect(remaining[0].endActId).toBe(acts.act2);
		// Scene anchors preserved.
		expect(remaining[0].startSceneId).toBe(s0.id);
		expect(remaining[0].endSceneId).toBe(s1.id);
	});

	it('moveScenesTo: source act is deleted after reparent', async () => {
		await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 });
		const url = new URL(
			`http://localhost/api/entities/${acts.act1}?moveScenesTo=${acts.act2}`
		);
		const res = await idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }));
		expect(res.status).toBe(204);

		const [stillThere] = await currentDb
			.select()
			.from(entities)
			.where(eq(entities.id, acts.act1));
		expect(stillThere).toBeUndefined();
	});

	it('rejects moveScenesTo with non-existent target (400)', async () => {
		const url = new URL(
			`http://localhost/api/entities/${acts.act1}?moveScenesTo=00000000-0000-0000-0000-000000000000`
		);
		await expect(
			idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects moveScenesTo with target = source (400)', async () => {
		const url = new URL(
			`http://localhost/api/entities/${acts.act1}?moveScenesTo=${acts.act1}`
		);
		await expect(
			idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects moveScenesTo to a non-Act entity (400)', async () => {
		const url = new URL(
			`http://localhost/api/entities/${acts.act1}?moveScenesTo=${ellie}`
		);
		await expect(
			idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('transaction rollback if reparent fails midway: source act survives', async () => {
		// Force failure mid-flight by pointing moveScenesTo at a Scene-typed
		// entity (a non-Act target). This must abort cleanly with no partial
		// state — the source act must remain.
		const [scene] = await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'Decoy', parentId: acts.act0, position: 0 })
			.returning();

		await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'X', parentId: acts.act1, position: 0 });

		const url = new URL(
			`http://localhost/api/entities/${acts.act1}?moveScenesTo=${scene.id}`
		);
		await expect(
			idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }))
		).rejects.toMatchObject({ status: 400 });

		// Source act still there.
		const [stillThere] = await currentDb
			.select()
			.from(entities)
			.where(eq(entities.id, acts.act1));
		expect(stillThere).toBeDefined();
		// Scene under act1 still parented to act1.
		const stillUnderAct1 = await currentDb
			.select()
			.from(entities)
			.where(eq(entities.parentId, acts.act1));
		expect(stillUnderAct1).toHaveLength(1);
	});

	it('default cascade with no scenes still works (act with intervals only)', async () => {
		await writeInterval(currentDb, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1
		});
		const url = new URL(`http://localhost/api/entities/${acts.act1}`);
		await idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }));

		const intervalsAfter = await currentDb.select().from(intervals);
		expect(intervalsAfter).toHaveLength(0);

		const actsAfter = await currentDb
			.select()
			.from(entities)
			.where(eq(entities.type, 'Act'));
		expect(actsAfter.map((a) => a.id).sort()).toEqual([acts.act0, acts.act2].sort());
	});

	it('moveScenesTo with empty source act behaves as plain delete', async () => {
		const url = new URL(
			`http://localhost/api/entities/${acts.act1}?moveScenesTo=${acts.act2}`
		);
		const res = await idRoute.DELETE(mkEvent({ params: { id: acts.act1 }, url }));
		expect(res.status).toBe(204);

		const [stillThere] = await currentDb
			.select()
			.from(entities)
			.where(eq(entities.id, acts.act1));
		expect(stillThere).toBeUndefined();
	});
});
