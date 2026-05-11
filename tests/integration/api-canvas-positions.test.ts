/**
 * Vitest integration tests for /api/canvas-positions handlers.
 * Focuses on the upsert-by-entity_id semantics of PUT.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, canvasPositions } from '../../src/lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

// vi.mock removed — routes now read event.locals.db (T8b S5' A1)

const route = await import('../../src/routes/api/canvas-positions/+server.js');

function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/canvas-positions'),
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

describe('/api/canvas-positions GET', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('returns empty array initially', async () => {
		const res = await route.GET(mkEvent());
		expect(await readJson(res)).toEqual([]);
	});

	it('returns inserted rows', async () => {
		const [e] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'A' })
			.returning();
		await route.PUT(mkEvent({ body: { entityId: e.id, x: 10, y: 20 } }));

		const res = await route.GET(mkEvent());
		const body = await readJson(res);
		expect(body).toHaveLength(1);
		expect(body[0].entityId).toBe(e.id);
	});
});

describe('/api/canvas-positions PUT', () => {
	let entityId: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
		const [e] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		entityId = e.id;
	});

	it('inserts a new position when entity has no row', async () => {
		const res = await route.PUT(
			mkEvent({ body: { entityId, x: 100, y: 200, width: 300, height: 150 } })
		);
		const body = await readJson(res);
		expect(body.entityId).toBe(entityId);
		expect(body.x).toBe(100);
		expect(body.y).toBe(200);
		expect(body.width).toBe(300);
		expect(body.height).toBe(150);
	});

	it('applies default dimensions when omitted', async () => {
		const res = await route.PUT(mkEvent({ body: { entityId } }));
		const body = await readJson(res);
		expect(body.x).toBe(0);
		expect(body.y).toBe(0);
		expect(body.width).toBe(160);
		expect(body.height).toBe(80);
	});

	it('upserts: second PUT for same entity overwrites first', async () => {
		await route.PUT(mkEvent({ body: { entityId, x: 1, y: 2 } }));
		await route.PUT(mkEvent({ body: { entityId, x: 99, y: 88 } }));

		const rows = await currentDb
			.select()
			.from(canvasPositions)
			.where(eq(canvasPositions.entityId, entityId));
		expect(rows).toHaveLength(1);
		expect(rows[0].x).toBe(99);
		expect(rows[0].y).toBe(88);
	});

	it('rejects missing entityId with 400', async () => {
		await expect(
			route.PUT(mkEvent({ body: { x: 1, y: 2 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects unknown entity with 400', async () => {
		await expect(
			route.PUT(mkEvent({ body: { entityId: '00000000-0000-0000-0000-000000000000', x: 1, y: 2 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('cascades position deletion when entity is deleted', async () => {
		await route.PUT(mkEvent({ body: { entityId, x: 5, y: 5 } }));
		await currentDb.delete(entities).where(eq(entities.id, entityId));

		const remaining = await currentDb.select().from(canvasPositions);
		expect(remaining).toHaveLength(0);
	});
});
