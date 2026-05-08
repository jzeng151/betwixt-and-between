/**
 * Multi-tenant isolation: intervals (T8b S6).
 *
 * - User B can't list/read/modify user A's intervals.
 * - User B can't write an interval against user A's entityId/actId (validateFKTypes fails).
 * - moveSceneToAct is scoped — user A moving a scene leaves user B's intervals untouched.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { moveSceneToAct, writeInterval } from '../../src/lib/server/intervals.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

const intervalsRoute = await import('../../src/routes/api/intervals/+server.js');
const intervalIdRoute = await import('../../src/routes/api/intervals/[id]/+server.js');

function mkEvent(userId: string, overrides: { params?: Record<string, string>; body?: unknown; url?: string } = {}): any {
	return {
		url: new URL(overrides.url ?? 'http://localhost/api/intervals'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db: currentDb,
			user: { id: userId, name: 'u', email: `${userId}@t.com`, emailVerified: true },
			session: { id: crypto.randomUUID(), userId, expiresAt: new Date(Date.now() + 86400000), token: 't' }
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

describe('auth isolation: /api/intervals', () => {
	let userA: string;
	let userB: string;
	let actsA: { act0: string; act1: string; act2: string };
	let aChar: string;
	let aIntervalId: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		userA = (await seedTestUser(currentDb, { email: 'a@t.com' })).id;
		userB = (await seedTestUser(currentDb, { email: 'b@t.com' })).id;
		actsA = await seedActs(currentDb, userA);
		const [c] = await currentDb
			.insert(entities)
			.values({ userId: userA, type: 'Character', name: 'A-char' })
			.returning();
		aChar = c.id;
		const created = await writeInterval(
			currentDb,
			{ entityId: aChar, startActId: actsA.act0, endActId: actsA.act0 },
			userA
		);
		aIntervalId = created.id;
	});

	it('user B GET list returns empty', async () => {
		const res = await intervalsRoute.GET(mkEvent(userB));
		expect(await readJson(res)).toEqual([]);
	});

	it('user B GET single returns 404', async () => {
		await expect(
			intervalIdRoute.GET(mkEvent(userB, { params: { id: aIntervalId } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B PATCH returns 404', async () => {
		await expect(
			intervalIdRoute.PATCH(
				mkEvent(userB, { params: { id: aIntervalId }, body: { startActId: actsA.act1 } })
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B DELETE returns 404 and interval survives', async () => {
		await expect(
			intervalIdRoute.DELETE(mkEvent(userB, { params: { id: aIntervalId } }))
		).rejects.toMatchObject({ status: 404 });

		const [row] = await currentDb.select().from(intervals).where(eq(intervals.id, aIntervalId));
		expect(row).toBeDefined();
	});

	it('user B POST against user A entityId fails (entity not found)', async () => {
		await expect(
			intervalsRoute.POST(
				mkEvent(userB, {
					body: {
						entityId: aChar,
						startActId: actsA.act0,
						endActId: actsA.act0
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('moveSceneToAct scoped by userId — user A moves scene, user B intervals unchanged', async () => {
		const actsB = await seedActs(currentDb, userB);
		const [bChar] = await currentDb
			.insert(entities)
			.values({ userId: userB, type: 'Character', name: 'B-char' })
			.returning();
		const [bScene] = await currentDb
			.insert(entities)
			.values({ userId: userB, type: 'Scene', name: 'B-S0', parentId: actsB.act1, position: 0 })
			.returning();
		await writeInterval(
			currentDb,
			{
				entityId: bChar.id,
				startActId: actsB.act1,
				startSceneId: bScene.id,
				endActId: actsB.act1,
				endSceneId: bScene.id
			},
			userB
		);

		// User A: seed scene + interval, then move scene.
		const [aScene] = await currentDb
			.insert(entities)
			.values({ userId: userA, type: 'Scene', name: 'A-S0', parentId: actsA.act1, position: 0 })
			.returning();
		await writeInterval(
			currentDb,
			{
				entityId: aChar,
				startActId: actsA.act1,
				startSceneId: aScene.id,
				endActId: actsA.act1,
				endSceneId: aScene.id
			},
			userA
		);
		await moveSceneToAct(currentDb, aScene.id, actsA.act2, 0, userA);

		// User B's interval still anchored to its own scene + act.
		const bRows = await currentDb
			.select()
			.from(intervals)
			.where(eq(intervals.userId, userB));
		expect(bRows).toHaveLength(1);
		expect(bRows[0].startActId).toBe(actsB.act1);
		expect(bRows[0].startSceneId).toBe(bScene.id);
	});
});
