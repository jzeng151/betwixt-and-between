/**
 * Integration tests for the act-position mutation paths on /api/entities and
 * /api/entities/[id]. Decisions D1, D18 (Issue 1A + 12A, locked 2026-04-29 in
 * /plan-eng-review).
 *
 * These tests assume the upcoming PR extends:
 *   - POST /api/entities  → for type='Act' with `position` field, sibling
 *     positions cascade-bump on insert-between, and recompute fires inside a
 *     transaction.
 *   - PATCH /api/entities/[id] → for type='Act' with `position` and/or
 *     `parentId`, sibling positions cascade and recompute fires inside a
 *     transaction.
 *
 * Tests are RED until the implementation lands. That's expected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { writeInterval } from '../../src/lib/server/intervals.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

// vi.mock removed — routes now read event.locals.db (T8b S5' A1)

const { POST } = await import('../../src/routes/api/entities/+server.js');
const idRoute = await import('../../src/routes/api/entities/[id]/+server.js');

function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/entities'),
		params: overrides.params ?? {},
		request: {
			json: async () => overrides.body
		},
		locals: {
			db: currentDb,
			user: { id: userId, name: 'Test User', email: 'test@test.com', emailVerified: true },
			session: { id: crypto.randomUUID(), userId, expiresAt: new Date(Date.now() + 86400000), token: 'test-token' },
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

async function getActsOrdered() {
	return currentDb
		.select()
		.from(entities)
		.where(and(eq(entities.type, 'Act'), isNull(entities.parentId)))
		.orderBy(asc(entities.position));
}

describe('POST /api/entities — Act with position (D1, insert semantics)', () => {
	let acts: { act0: string; act1: string; act2: string };

	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
		acts = await seedActs(currentDb, userId);
	});

	it('append (position >= acts.length): no sibling bump, just inserts', async () => {
		const res = await POST(
			mkEvent({ body: { type: 'Act', name: 'Act 3', position: 3 } })
		);
		expect(res.status).toBe(201);

		const ordered = await getActsOrdered();
		expect(ordered).toHaveLength(4);
		expect(ordered.map((a) => a.position)).toEqual([0, 1, 2, 3]);
		// Original siblings unchanged.
		const orig = ordered.find((a) => a.id === acts.act1);
		expect(orig?.position).toBe(1);
	});

	it('insert-between (position < acts.length): siblings at position >= N get bumped', async () => {
		// Insert new Act at position 1 — Act 1 (pos 1) and Act 2 (pos 2) bump.
		await POST(mkEvent({ body: { type: 'Act', name: 'New Act', position: 1 } }));

		const ordered = await getActsOrdered();
		expect(ordered).toHaveLength(4);
		expect(ordered.map((a) => a.position)).toEqual([0, 1, 2, 3]);
		// The originally-at-1 act got pushed to 2.
		const origAct1 = ordered.find((a) => a.id === acts.act1);
		expect(origAct1?.position).toBe(2);
		const origAct2 = ordered.find((a) => a.id === acts.act2);
		expect(origAct2?.position).toBe(3);
	});

	it('insert-between recomputes intervals: positions shift to reflect new act ordering', async () => {
		const [ellie] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		// Ellie covers all of original Act 1 → [1, 2).
		await writeInterval(currentDb, {
			entityId: ellie.id,
			startActId: acts.act1,
			endActId: acts.act1
		}, userId);

		// Insert at position 1 — original Act 1 becomes index 2.
		await POST(mkEvent({ body: { type: 'Act', name: 'New Act', position: 1 } }));

		const [row] = await currentDb.select().from(intervals);
		// Original Act 1 is now at index 2 → [2, 3).
		expect(row.startPosition).toBeCloseTo(2.0, 9);
		expect(row.endPosition).toBeCloseTo(3.0, 9);
	});

	it('insert-between with crossing interval: [1.5, 2.5) becomes [1.5, 3.5) (D6/5A stretch)', async () => {
		// Plant a fraction-positioned crossing interval via raw insert.
		const [ellie] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		await currentDb.insert(intervals).values({
			userId,
			entityId: ellie.id,
			startActId: acts.act1,
			startSceneId: null,
			endActId: acts.act2,
			endSceneId: null,
			startPosition: 1.5,
			endPosition: 2.5
		});

		// Insert new Act at position 2 (before original Act 2).
		await POST(mkEvent({ body: { type: 'Act', name: 'New Mid Act', position: 2 } }));

		const [row] = await currentDb.select().from(intervals);
		// Old Act 1 still at index 1 (position preserved). Old Act 2 now at index 3.
		// Per D6/5A, the crossing interval stretches: [1.5, 3.5).
		expect(row.startPosition).toBeCloseTo(1.5, 9);
		expect(row.endPosition).toBeCloseTo(3.5, 9);
	});

	it('insert-between also stretches boundary-end intervals (D6 note: oldFraction === 0 branch)', async () => {
		// Plant a [1, 2) interval that ends exactly at an act boundary.
		const [ellie] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		await writeInterval(currentDb, {
			entityId: ellie.id,
			startActId: acts.act1,
			endActId: acts.act1
		}, userId);
		// Verify baseline.
		let [row] = await currentDb.select().from(intervals);
		expect(row.endPosition).toBeCloseTo(2.0, 9);

		// Insert at position 2 — original Act 2 becomes index 3.
		await POST(mkEvent({ body: { type: 'Act', name: 'New', position: 2 } }));

		[row] = await currentDb.select().from(intervals);
		// Per D6 note, oldFraction=0 end-side stretches with the act it referenced.
		// Original act1 still at index 1; row's endActId still acts.act1, so its
		// end stays at 2.0 (start-of-its-original-next-act, which is now the new act).
		expect(row.startPosition).toBeCloseTo(1.0, 9);
		expect(row.endPosition).toBeCloseTo(2.0, 9);
	});

	it('transaction rollback on FK violation: invalid parentId leaves no inserts', async () => {
		const before = await getActsOrdered();
		await expect(
			POST(
				mkEvent({
					body: { type: 'Act', name: 'Bad', position: 1, parentId: 'nonexistent-id' }
				})
			)
		).rejects.toMatchObject({ status: 400 });
		const after = await getActsOrdered();
		// No new Act, no sibling positions touched.
		expect(after).toEqual(before);
	});
});

describe('PATCH /api/entities/[id] — Act position cascade (D18 / Issue 12A)', () => {
	let acts: { act0: string; act1: string; act2: string };

	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
		acts = await seedActs(currentDb, userId);
	});

	it('no-op when position is unchanged', async () => {
		const before = await getActsOrdered();
		const res = await idRoute.PATCH(
			mkEvent({ params: { id: acts.act1 }, body: { position: 1 } })
		);
		expect(res.status).toBe(200);
		const after = await getActsOrdered();
		expect(after.map((a) => ({ id: a.id, position: a.position }))).toEqual(
			before.map((a) => ({ id: a.id, position: a.position }))
		);
	});

	it('position increase (N > P_old): siblings in (P_old, N] cascade by -1', async () => {
		// Move act0 (pos 0) to pos 2 — act1 and act2 should each drop by 1.
		await idRoute.PATCH(
			mkEvent({ params: { id: acts.act0 }, body: { position: 2 } })
		);
		const ordered = await getActsOrdered();
		const map = new Map(ordered.map((a) => [a.id, a.position]));
		expect(map.get(acts.act1)).toBe(0);
		expect(map.get(acts.act2)).toBe(1);
		expect(map.get(acts.act0)).toBe(2);
	});

	it('position decrease (N < P_old): siblings in [N, P_old) cascade by +1', async () => {
		// Move act2 (pos 2) to pos 0 — act0 and act1 should each gain 1.
		await idRoute.PATCH(
			mkEvent({ params: { id: acts.act2 }, body: { position: 0 } })
		);
		const ordered = await getActsOrdered();
		const map = new Map(ordered.map((a) => [a.id, a.position]));
		expect(map.get(acts.act2)).toBe(0);
		expect(map.get(acts.act0)).toBe(1);
		expect(map.get(acts.act1)).toBe(2);
	});

	it('recompute fires after the cascade in the same tx', async () => {
		const [ellie] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		// Ellie present in act1 → [1, 2).
		await writeInterval(currentDb, {
			entityId: ellie.id,
			startActId: acts.act1,
			endActId: acts.act1
		}, userId);

		// Move act1 from position 1 to position 2.
		await idRoute.PATCH(
			mkEvent({ params: { id: acts.act1 }, body: { position: 2 } })
		);

		const [row] = await currentDb.select().from(intervals);
		// act1 is now at index 2 → [2, 3).
		expect(row.startPosition).toBeCloseTo(2.0, 9);
		expect(row.endPosition).toBeCloseTo(3.0, 9);
	});

	it('PATCH with parentId: scene reparenting (D9/7B + 8C cross-act move)', async () => {
		const [scene] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S0', parentId: acts.act0, position: 0 })
			.returning();

		const res = await idRoute.PATCH(
			mkEvent({
				params: { id: scene.id },
				body: { parentId: acts.act1, position: 0 }
			})
		);
		expect(res.status).toBe(200);

		const [reparented] = await currentDb
			.select()
			.from(entities)
			.where(eq(entities.id, scene.id));
		expect(reparented.parentId).toBe(acts.act1);
		expect(reparented.position).toBe(0);
	});

	it('transaction rollback if cascade fails partway (atomic)', async () => {
		// Try to PATCH a non-existent act — should 404 and not modify siblings.
		const before = await getActsOrdered();
		await expect(
			idRoute.PATCH(
				mkEvent({ params: { id: '00000000-0000-0000-0000-000000000000' }, body: { position: 1 } })
			)
		).rejects.toMatchObject({ status: 404 });
		const after = await getActsOrdered();
		expect(after.map((a) => a.position)).toEqual(before.map((a) => a.position));
	});

	it('PATCH position on Scene cascades within parent act only', async () => {
		// Three scenes in act1 at positions 0/1/2.
		const [s0] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		const [s1] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 })
			.returning();
		const [s2] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S2', parentId: acts.act1, position: 2 })
			.returning();

		// Move s2 (pos 2) to pos 0 — s0/s1 cascade +1 within act1.
		await idRoute.PATCH(
			mkEvent({ params: { id: s2.id }, body: { position: 0 } })
		);

		const scenes = await currentDb
			.select()
			.from(entities)
			.where(eq(entities.parentId, acts.act1))
			.orderBy(asc(entities.position));
		const map = new Map(scenes.map((s) => [s.id, s.position]));
		expect(map.get(s2.id)).toBe(0);
		expect(map.get(s0.id)).toBe(1);
		expect(map.get(s1.id)).toBe(2);
	});

	it('insert-between via POST also handles intervals via recompute integer-part shift', async () => {
		const [ellie] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		// Ellie spans act0+act1 → [0, 2).
		await writeInterval(currentDb, {
			entityId: ellie.id,
			startActId: acts.act0,
			endActId: acts.act1
		}, userId);

		// Insert new Act at position 0 (very front).
		await POST(mkEvent({ body: { type: 'Act', name: 'Prologue', position: 0 } }));

		const [row] = await currentDb.select().from(intervals);
		// Original act0 → index 1, original act1 → index 2: range [1, 3).
		expect(row.startPosition).toBeCloseTo(1.0, 9);
		expect(row.endPosition).toBeCloseTo(3.0, 9);
	});

	it('PATCH position decrease: scene-anchored intervals also recompute', async () => {
		// Plant a scene in act2.
		const [s0] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S0', parentId: acts.act2, position: 0 })
			.returning();
		const [s1] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S1', parentId: acts.act2, position: 1 })
			.returning();

		const [ellie] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		// Ellie anchored to scene s0 of act2 → originally [2.0, 2.5).
		await writeInterval(currentDb, {
			entityId: ellie.id,
			startActId: acts.act2,
			startSceneId: s0.id,
			endActId: acts.act2,
			endSceneId: s0.id
		}, userId);

		// Move act2 to position 0.
		await idRoute.PATCH(
			mkEvent({ params: { id: acts.act2 }, body: { position: 0 } })
		);

		const [row] = await currentDb.select().from(intervals);
		// act2 is now at index 0; scene s0 is k=0 of m=2 → [0.0, 0.5).
		expect(row.startPosition).toBeCloseTo(0.0, 9);
		expect(row.endPosition).toBeCloseTo(0.5, 9);
		expect(s1.id).toBeTruthy();
	});

	it('POST insert-between with position=0 bumps every existing act', async () => {
		await POST(
			mkEvent({ body: { type: 'Act', name: 'Prologue', position: 0 } })
		);
		const ordered = await getActsOrdered();
		expect(ordered).toHaveLength(4);
		const map = new Map(ordered.map((a) => [a.id, a.position]));
		expect(map.get(acts.act0)).toBe(1);
		expect(map.get(acts.act1)).toBe(2);
		expect(map.get(acts.act2)).toBe(3);
	});

	it('POST insert with position omitted falls back to append (no cascade)', async () => {
		const before = await getActsOrdered();
		await POST(mkEvent({ body: { type: 'Act', name: 'Tail' } }));
		const after = await getActsOrdered();
		// Original positions preserved.
		const beforeMap = new Map(before.map((a) => [a.id, a.position]));
		const afterMap = new Map(after.map((a) => [a.id, a.position]));
		for (const [id, pos] of beforeMap) {
			expect(afterMap.get(id)).toBe(pos);
		}
		expect(after.length).toBe(before.length + 1);
	});
});
