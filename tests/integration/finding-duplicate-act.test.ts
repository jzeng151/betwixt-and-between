/**
 * Reproduction harness for docs/findings/duplicate-act-on-cross-act-scene-move.md.
 *
 * The finding reports a phantom Act entity appearing after a single
 * PATCH /api/entities/{sceneId} that moves a Scene to a different Act.
 * Per the finding's code-path walk, nothing in moveSceneToAct issues an
 * INSERT into entities — so if the bug exists today it's either in the
 * PATCH handler itself or in state cumulative from preceding requests.
 *
 * tests/integration/intervals-move-scene.test.ts already asserts the
 * direct-function path is clean. This file drives the same recipe through
 * the route handler so the PATCH-handler-shaped path is also under guard.
 *
 * Status: both shapes pass today. If a future change reintroduces the
 * phantom, one of these tests will catch it before the QA report does.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

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
			session: { id: crypto.randomUUID(), userId, expiresAt: new Date(Date.now() + 86400000), token: 'test-token' }
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

async function countActs(): Promise<number> {
	const rows = await currentDb
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.userId, userId), eq(entities.type, 'Act')));
	return rows.length;
}

describe('finding: duplicate Act on cross-act Scene move (via PATCH)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const u = await seedTestUser(currentDb);
		userId = u.id;
	});

	it('exact recipe from the finding doc produces Acts: 3 (no phantom)', async () => {
		// Seed: 3 Acts at positions 0/1/2.
		const a1 = await readJson(
			await POST(mkEvent({ body: { type: 'Act', name: 'Act I', position: 0 } }))
		);
		const a2 = await readJson(
			await POST(mkEvent({ body: { type: 'Act', name: 'Act II', position: 1 } }))
		);
		const a3 = await readJson(
			await POST(mkEvent({ body: { type: 'Act', name: 'Act III', position: 2 } }))
		);

		// Seed: 4 Scenes — Scene 3 + Scene 4 in Act II, Scene 5 + Scene 6 in Act III.
		const s2a = await readJson(
			await POST(mkEvent({ body: { type: 'Scene', name: 'Scene 3', parentId: a2.id, position: 0 } }))
		);
		await readJson(
			await POST(mkEvent({ body: { type: 'Scene', name: 'Scene 4', parentId: a2.id, position: 1 } }))
		);
		await readJson(
			await POST(mkEvent({ body: { type: 'Scene', name: 'Scene 5', parentId: a3.id, position: 0 } }))
		);
		await readJson(
			await POST(mkEvent({ body: { type: 'Scene', name: 'Scene 6', parentId: a3.id, position: 1 } }))
		);

		expect(await countActs()).toBe(3);

		// PATCH /api/entities/{Scene 3.id} { parentId: Act III.id, position: 2 }
		const res = await idRoute.PATCH(
			mkEvent({ params: { id: s2a.id }, body: { parentId: a3.id, position: 2 } })
		);
		expect(res.status).toBe(200);

		expect(await countActs()).toBe(3);

		// Final scene placement: Scene 3 lives in Act III at position 2.
		const [moved] = await currentDb
			.select()
			.from(entities)
			.where(and(eq(entities.userId, userId), eq(entities.id, s2a.id)));
		expect(moved.parentId).toBe(a3.id);
		expect(moved.position).toBe(2);
	});

	it('act count survives a second cross-act move on the same scene', async () => {
		// The finding noted the second move in the original QA session did NOT
		// reproduce. Guard the second-move path too in case the intermittency
		// is order-of-operations dependent.
		const a1 = await readJson(
			await POST(mkEvent({ body: { type: 'Act', name: 'A', position: 0 } }))
		);
		const a2 = await readJson(
			await POST(mkEvent({ body: { type: 'Act', name: 'B', position: 1 } }))
		);
		const a3 = await readJson(
			await POST(mkEvent({ body: { type: 'Act', name: 'C', position: 2 } }))
		);
		const s = await readJson(
			await POST(mkEvent({ body: { type: 'Scene', name: 'Scene', parentId: a1.id, position: 0 } }))
		);

		await idRoute.PATCH(mkEvent({ params: { id: s.id }, body: { parentId: a2.id, position: 0 } }));
		expect(await countActs()).toBe(3);

		await idRoute.PATCH(mkEvent({ params: { id: s.id }, body: { parentId: a3.id, position: 0 } }));
		expect(await countActs()).toBe(3);
	});
});
