/**
 * Multi-tenant isolation: relationships (T8b S6).
 *
 * - User B can't list user A's relationships.
 * - User B can't read/PATCH/DELETE user A's relationships (404).
 * - User B can't create a relationship between user A's entities (400 — fromId
 *   not found, since the lookup is userId-scoped).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, relationships } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

const relsRoute = await import('../../src/routes/api/relationships/+server.js');
const relIdRoute = await import('../../src/routes/api/relationships/[id]/+server.js');

function mkEvent(userId: string, overrides: { params?: Record<string, string>; body?: unknown; url?: string } = {}): any {
	return {
		url: new URL(overrides.url ?? 'http://localhost/api/relationships'),
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

describe('auth isolation: /api/relationships', () => {
	let userA: string;
	let userB: string;
	let aFrom: string;
	let aTo: string;
	let aRelId: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		userA = (await seedTestUser(currentDb, { email: 'a@t.com' })).id;
		userB = (await seedTestUser(currentDb, { email: 'b@t.com' })).id;

		const [f] = await currentDb
			.insert(entities)
			.values({ userId: userA, type: 'Character', name: 'A-from' })
			.returning();
		aFrom = f.id;
		const [t] = await currentDb
			.insert(entities)
			.values({ userId: userA, type: 'Character', name: 'A-to' })
			.returning();
		aTo = t.id;

		const [rel] = await currentDb
			.insert(relationships)
			.values({ userId: userA, fromId: aFrom, toId: aTo, type: 'allies_with' })
			.returning();
		aRelId = rel.id;
	});

	it('user B GET list returns empty', async () => {
		const res = await relsRoute.GET(mkEvent(userB));
		expect(await readJson(res)).toEqual([]);
	});

	it('user B PATCH user A rel returns 404', async () => {
		await expect(
			relIdRoute.PATCH(mkEvent(userB, { params: { id: aRelId }, body: { label: 'pwned' } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B DELETE user A rel returns 404 and rel survives', async () => {
		await expect(
			relIdRoute.DELETE(mkEvent(userB, { params: { id: aRelId } }))
		).rejects.toMatchObject({ status: 404 });

		const [row] = await currentDb.select().from(relationships).where(eq(relationships.id, aRelId));
		expect(row).toBeDefined();
	});

	it('user B can NOT create rel between user A entities (fromId scoped lookup)', async () => {
		await expect(
			relsRoute.POST(
				mkEvent(userB, { body: { fromId: aFrom, toId: aTo, type: 'allies_with' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});
});
