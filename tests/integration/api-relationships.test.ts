/**
 * Vitest integration tests for /api/relationships handlers.
 *
 * Focus on the non-hijack path (other types) and the synthetic-id branches
 * of DELETE. The appears_in hijack itself is covered by appears-in-hijack.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, relationships, intervals } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

// vi.mock removed — routes now read event.locals.db (T8b S5' A1)

const relRoute = await import('../../src/routes/api/relationships/+server.js');
const relIdRoute = await import('../../src/routes/api/relationships/[id]/+server.js');

function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/relationships'),
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

describe('/api/relationships POST (non-hijack)', () => {
	let alice: string;
	let bob: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
		const [a] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Alice' })
			.returning();
		const [b] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Bob' })
			.returning();
		alice = a.id;
		bob = b.id;
	});

	it('creates a rivals relationship', async () => {
		const res = await relRoute.POST(
			mkEvent({ body: { fromId: alice, toId: bob, type: 'rivals' } })
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.fromId).toBe(alice);
		expect(body.toId).toBe(bob);
		expect(body.type).toBe('rivals');
		expect(body.label).toBeNull();
	});

	it('persists the relationship to the relationships table (not intervals)', async () => {
		await relRoute.POST(mkEvent({ body: { fromId: alice, toId: bob, type: 'allied_with' } }));
		const rels = await currentDb.select().from(relationships);
		expect(rels).toHaveLength(1);
		const ints = await currentDb.select().from(intervals);
		expect(ints).toHaveLength(0);
	});

	it('accepts optional label', async () => {
		const res = await relRoute.POST(
			mkEvent({ body: { fromId: alice, toId: bob, type: 'mentor_of', label: 'mentor' } })
		);
		const body = await readJson(res);
		expect(body.label).toBe('mentor');
	});

	it('rejects invalid relationship type with 400', async () => {
		await expect(
			relRoute.POST(mkEvent({ body: { fromId: alice, toId: bob, type: 'totally_fake' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects missing fromId with 400', async () => {
		await expect(
			relRoute.POST(mkEvent({ body: { toId: bob, type: 'rivals' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects missing toId with 400', async () => {
		await expect(
			relRoute.POST(mkEvent({ body: { fromId: alice, type: 'rivals' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects unknown fromId entity with 400', async () => {
		await expect(
			relRoute.POST(
				mkEvent({ body: { fromId: '00000000-0000-0000-0000-000000000000', toId: bob, type: 'rivals' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects unknown toId entity with 400', async () => {
		await expect(
			relRoute.POST(
				mkEvent({ body: { fromId: alice, toId: '00000000-0000-0000-0000-000000000000', type: 'rivals' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('schema enforces unique (from_id, to_id, type) — duplicate insert fails', async () => {
		// Locked 2026-04-29 in /plan-eng-review (Issue 18-revised B). Prevents
		// two relationship rows of the same type between the same pair of
		// entities. Multi-edge of DIFFERENT types between same pair is still
		// allowed; multi-edge of pov_of from same event to DIFFERENT characters
		// is also allowed (different to_id).
		await currentDb.insert(relationships).values({ userId,
			fromId: alice,
			toId: bob,
			type: 'allied_with'
		});
		await expect(
			currentDb.insert(relationships).values({ userId,
				fromId: alice,
				toId: bob,
				type: 'allied_with'
			})
		).rejects.toThrow();
		// But a different type between same pair is allowed.
		await currentDb.insert(relationships).values({ userId,
			fromId: alice,
			toId: bob,
			type: 'rivals'
		});
		const all = await currentDb.select().from(relationships);
		expect(all).toHaveLength(2);
	});
});

describe('/api/relationships GET', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('returns empty array when no relationships', async () => {
		const res = await relRoute.GET(mkEvent());
		const body = await readJson(res);
		expect(body).toEqual([]);
	});

	it('rejects appears_in writes (route is intervals API now)', async () => {
		const acts = await seedActs(currentDb, userId);
		const [ellie] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		await expect(
			relRoute.POST(
				mkEvent({ body: { fromId: ellie.id, toId: acts.act1, type: 'appears_in' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('filters by fromId query param', async () => {
		const [a] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'A' })
			.returning();
		const [b] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'B' })
			.returning();
		const [c] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'C' })
			.returning();
		await currentDb.insert(relationships).values({ userId, fromId: a.id, toId: b.id, type: 'rivals' });
		await currentDb.insert(relationships).values({ userId, fromId: c.id, toId: b.id, type: 'rivals' });

		const url = new URL(`http://localhost/api/relationships?fromId=${a.id}`);
		const res = await relRoute.GET(mkEvent({ url }));
		const body = await readJson(res);
		expect(body).toHaveLength(1);
		expect(body[0].fromId).toBe(a.id);
	});
});

describe('/api/relationships/[id] DELETE', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('deletes a real relationship and returns 204', async () => {
		const [a] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'A' })
			.returning();
		const [b] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'B' })
			.returning();
		const [rel] = await currentDb
			.insert(relationships)
			.values({ userId, fromId: a.id, toId: b.id, type: 'rivals' })
			.returning();

		const res = await relIdRoute.DELETE(mkEvent({ params: { id: rel.id } }));
		expect(res.status).toBe(204);

		const remaining = await currentDb.select().from(relationships);
		expect(remaining).toHaveLength(0);
	});

	it('returns 404 for unknown relationship id', async () => {
		await expect(
			relIdRoute.DELETE(mkEvent({ params: { id: '00000000-0000-0000-0000-000000000000' } }))
		).rejects.toMatchObject({ status: 404 });
	});

});
