/**
 * 2026-06 security/bug audit — regression tests for the fix branch.
 *
 *   B1 — an Act reorder that inverts an interval's anchor order is
 *        swap-normalized instead of 500ing the whole reorder.
 *   B2 — DELETE Act ?moveScenesTo=<act> with an interval [scene-in-deleted →
 *        end-of-deleted] follows the scenes to the target act instead of
 *        rescoping to prevAct and aborting on the inverted range.
 *   B5 — computeIntervalPositions enforces half-open act ranges for explicit
 *        positions (start == range.end / end == range.start rejected).
 *   B8 — Scene insert at an occupied position bumps siblings (parity with
 *        the Act insert-between cascade).
 *   REL — POST /api/relationships clears scene FKs when their act FK is
 *        absent (previously persisted unvalidated scene UUIDs verbatim).
 *   PLC — placement `data` jsonb is size-capped.
 *   ENT — entities PATCH validates name/position scalars (400, not 500).
 *   CNV — canvas batch upsert dedupes same-entity rows (single-statement
 *        upsert can't touch one conflict target twice).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, intervals, relationships, windowCanvasState } from '../../src/lib/server/db/schema.js';
import { writeInterval } from '../../src/lib/server/intervals.js';

let db: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db,
			user: { id: userId, name: 'Test User', email: 'test@test.com', emailVerified: true }
		}
	};
}

const { POST: POST_ENTITY } = await import('../../src/routes/api/entities/+server.js');
const { PATCH: PATCH_ENTITY, DELETE: DELETE_ENTITY } = await import(
	'../../src/routes/api/entities/[id]/+server.js'
);
const { POST: POST_RELATIONSHIP } = await import('../../src/routes/api/relationships/+server.js');
const { POST: POST_PLACEMENT } = await import('../../src/routes/api/map-placements/+server.js');
const { POST: POST_CANVAS_BATCH } = await import(
	'../../src/routes/api/canvas-positions/window/[windowId]/batch/+server.js'
);

async function seedCharacter(name: string): Promise<string> {
	const [row] = await db
		.insert(entities)
		.values({ userId, type: 'Character', name })
		.returning();
	return row.id;
}

async function seedScene(parentId: string, name: string, position: number): Promise<string> {
	const [row] = await db
		.insert(entities)
		.values({ userId, type: 'Scene', name, parentId, position })
		.returning();
	return row.id;
}

beforeEach(async () => {
	db = await createTestDb();
	userId = (await seedTestUser(db)).id;
});

describe('B1 — act reorder inversion is swap-normalized', () => {
	it('swapping the two anchor acts of a spanning interval succeeds and swaps the endpoints', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		const created = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act0, endActId: acts.act1 },
			userId
		);
		expect([created.startPosition, created.endPosition]).toEqual([0, 2]);

		// Move act0 to position 1 (swap with act1). Pre-fix this 500ed: the
		// derived start (act0 now idx 1) >= derived end (act1 now idx 0).
		const res = await PATCH_ENTITY(
			mkEvent({ params: { id: acts.act0 }, body: { position: 1 } })
		);
		expect(res.status).toBe(200);

		const [row] = await db.select().from(intervals).where(eq(intervals.id, created.id));
		expect(row.startActId).toBe(acts.act1);
		expect(row.endActId).toBe(acts.act0);
		expect(row.startPosition).toBe(0);
		expect(row.endPosition).toBe(2);
		expect(row.startPosition).toBeLessThan(row.endPosition);
	});
});

describe('B1b — swap-normalization that would overlap a sibling rolls back', () => {
	it('a reorder whose swap widens an interval across a same-entity sibling aborts instead of writing an overlap', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		// A spans [act0, act1) = [0, 2); B sits in act2 = [2, 3). Adjacent, no overlap.
		const a = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act0, endActId: acts.act1 },
			userId
		);
		const b = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act2, endActId: acts.act2 },
			userId
		);
		// Move act0 after act2 (position 2). Order becomes act1, act2, act0; A
		// swap-normalizes to [0, 3) which would intersect B's recomputed [1, 2).
		// The guard aborts with an actionable 409 (entity name + both spans + how
		// to resolve), not an opaque 500.
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: acts.act0 }, body: { position: 2 } }))
		).rejects.toMatchObject({
			status: 409,
			body: { message: expect.stringMatching(/"Ellie".+overlapping time spans/i) }
		});
		// Transaction rolled back: both intervals AND the act reorder are untouched.
		const [rowA] = await db.select().from(intervals).where(eq(intervals.id, a.id));
		const [rowB] = await db.select().from(intervals).where(eq(intervals.id, b.id));
		expect([rowA.startPosition, rowA.endPosition]).toEqual([0, 2]);
		expect([rowB.startPosition, rowB.endPosition]).toEqual([2, 3]);
		const [act0row] = await db.select().from(entities).where(eq(entities.id, acts.act0));
		expect(act0row.position).toBe(0);
	});
});

describe('B2 — DELETE act with moveScenesTo follows the scenes', () => {
	it('an interval [scene-in-deleted → end-of-deleted] lands in the target act', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		const scene = await seedScene(acts.act1, 'S', 0);
		const created = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act1, startSceneId: scene, endActId: acts.act1 },
			userId
		);

		// Pre-fix this 500ed when a prev act existed: the start side followed
		// its scene to act2 while the end side was rescoped to act0 → inverted.
		const res = await DELETE_ENTITY(
			mkEvent({
				url: new URL(`http://localhost/api/entities/${acts.act1}?moveScenesTo=${acts.act2}`),
				params: { id: acts.act1 }
			})
		);
		expect(res.status).toBe(204);

		const [scn] = await db.select().from(entities).where(eq(entities.id, scene));
		expect(scn.parentId).toBe(acts.act2);

		const [row] = await db.select().from(intervals).where(eq(intervals.id, created.id));
		expect(row).toBeDefined();
		expect(row.startActId).toBe(acts.act2);
		expect(row.startSceneId).toBe(scene);
		expect(row.endActId).toBe(acts.act2);
		expect(row.endSceneId).toBeNull();
		// act2's post-delete index is 1: the interval covers [scene start, end-of-act2).
		expect(row.startPosition).toBe(1);
		expect(row.endPosition).toBe(2);
	});
});

describe('B5 — half-open act-range checks on explicit positions', () => {
	it('rejects a start position exactly at the act range end', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		await expect(
			writeInterval(
				db,
				{ entityId: ellie, startActId: acts.act0, endActId: acts.act1, startPosition: 1 },
				userId
			)
		).rejects.toThrow(/outside act range/);
	});

	it('rejects an end position exactly at the act range start', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		await expect(
			writeInterval(
				db,
				{ entityId: ellie, startActId: acts.act0, endActId: acts.act1, endPosition: 1 },
				userId
			)
		).rejects.toThrow(/outside act range/);
	});

	it('still accepts interior free-fraction positions', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		const created = await writeInterval(
			db,
			{
				entityId: ellie,
				startActId: acts.act0,
				endActId: acts.act1,
				startPosition: 0.25,
				endPosition: 1.75
			},
			userId
		);
		expect(created.startPosition).toBe(0.25);
		expect(created.endPosition).toBe(1.75);
	});
});

describe('B8 — scene insert-between bumps siblings', () => {
	it('creating a scene at an occupied position shifts the occupant up', async () => {
		const acts = await seedActs(db, userId);
		const s0 = await seedScene(acts.act0, 'S0', 0);
		const s1 = await seedScene(acts.act0, 'S1', 1);

		const res = await POST_ENTITY(
			mkEvent({ body: { type: 'Scene', name: 'S-mid', parentId: acts.act0, position: 1 } })
		);
		expect(res.status).toBe(201);

		const scenes = await db
			.select({ id: entities.id, position: entities.position })
			.from(entities)
			.where(and(eq(entities.parentId, acts.act0), eq(entities.type, 'Scene')))
			.orderBy(asc(entities.position));
		expect(scenes.map((s) => s.position)).toEqual([0, 1, 2]);
		expect(scenes[0].id).toBe(s0);
		expect(scenes[2].id).toBe(s1);
	});
});

describe('REL — relationships POST clears scene FKs without their act FK', () => {
	it('a scene FK with no act FKs is normalized to null, not persisted verbatim', async () => {
		const acts = await seedActs(db, userId);
		const scene = await seedScene(acts.act0, 'S', 0);
		const ellie = await seedCharacter('Ellie');
		const damien = await seedCharacter('Damien');

		const res = await POST_RELATIONSHIP(
			mkEvent({
				body: { fromId: ellie, toId: damien, type: 'other', startSceneId: scene }
			})
		);
		expect(res.status).toBe(201);
		const created = (await res.json()) as { id: string };

		const [row] = await db
			.select()
			.from(relationships)
			.where(eq(relationships.id, created.id));
		expect(row.startSceneId).toBeNull();
		expect(row.startActId).toBeNull();
		expect(row.startPosition).toBeNull();
	});
});

describe('PLC — placement data jsonb size cap', () => {
	it('rejects a data blob over the cap with 400', async () => {
		await expect(
			POST_PLACEMENT(
				mkEvent({
					body: { x: 0.5, y: 0.5, data: { pad: 'x'.repeat(17000) } }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('measures true UTF-8 bytes: a multibyte blob under the char-count but over the byte cap is rejected', async () => {
		// 6000 emoji = 6000 UTF-16 length but 24000 UTF-8 bytes (> 16384 cap).
		// The old String.length check would have accepted this.
		await expect(
			POST_PLACEMENT(
				mkEvent({ body: { x: 0.5, y: 0.5, data: { pad: '😀'.repeat(6000) } } })
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('ENT — entities PATCH scalar validation', () => {
	it('rejects a non-string name with 400 (was a TypeError 500)', async () => {
		const ellie = await seedCharacter('Ellie');
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: ellie }, body: { name: 123 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a non-integer position with 400', async () => {
		const acts = await seedActs(db, userId);
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: acts.act0 }, body: { position: 1.5 } }))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('CNV — canvas batch upsert handles duplicate entityIds', () => {
	it('dedupes same-entity rows last-wins in one statement', async () => {
		const ellie = await seedCharacter('Ellie');
		const windowId = crypto.randomUUID();
		const res = await POST_CANVAS_BATCH(
			mkEvent({
				params: { windowId },
				body: [
					{ entityId: ellie, x: 1, y: 1 },
					{ entityId: ellie, x: 9, y: 9 }
				]
			})
		);
		expect(res.status).toBe(200);

		const rows = await db
			.select()
			.from(windowCanvasState)
			.where(eq(windowCanvasState.windowId, windowId));
		expect(rows).toHaveLength(1);
		expect(rows[0].x).toBe(9);
		expect(rows[0].y).toBe(9);
	});

	it('rejects an oversized batch with 400 (bounds the bind-parameter count)', async () => {
		const windowId = crypto.randomUUID();
		const big = Array.from({ length: 2001 }, () => ({
			entityId: crypto.randomUUID(),
			x: 0,
			y: 0
		}));
		await expect(
			POST_CANVAS_BATCH(mkEvent({ params: { windowId }, body: big }))
		).rejects.toMatchObject({ status: 400 });
	});
});
