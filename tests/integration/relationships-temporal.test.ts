/**
 * Integration tests for temporal relationship bounds (Phase 1B Lane A).
 *
 * Covers: position resolution from act/scene FKs, timeless rows, uniqueness
 * constraints (timeless vs temporal partial indexes), PATCH re-resolution,
 * and entity-aliases CRUD.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, relationships, entityAliases } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

vi.mock('$lib/server/db/index.js', () => ({
	getDb: async () => currentDb,
	withDb: async (_env: unknown, callback: (db: typeof currentDb) => Promise<unknown>) => callback(currentDb)
}));

const relRoute = await import('../../src/routes/api/relationships/+server.js');
const relIdRoute = await import('../../src/routes/api/relationships/[id]/+server.js');
const aliasRoute = await import('../../src/routes/api/entity-aliases/+server.js');
const aliasIdRoute = await import('../../src/routes/api/entity-aliases/[id]/+server.js');

function mkEvent(overrides: {
	url?: URL;
	params?: Record<string, string>;
	body?: unknown;
} = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/relationships'),
		params: overrides.params ?? {},
		request: {
			json: async () => overrides.body
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

describe('POST /api/relationships — temporal bounds', () => {
	let alice: string;
	let bob: string;
	let acts: { act0: string; act1: string; act2: string };

	beforeEach(async () => {
		currentDb = await createTestDb();
		acts = await seedActs(currentDb);
		const [a] = await currentDb.insert(entities).values({ type: 'Character', name: 'Alice' }).returning();
		const [b] = await currentDb.insert(entities).values({ type: 'Character', name: 'Bob' }).returning();
		alice = a.id;
		bob = b.id;
	});

	it('POST with startActId/endActId → positions resolved', async () => {
		const res = await relRoute.POST(
			mkEvent({
				body: {
					fromId: alice,
					toId: bob,
					type: 'rivals',
					startActId: acts.act0,
					endActId: acts.act1
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		// act0 is at index 0 → startPosition = 0.0; act1 is at index 1 → endPosition = 2.0
		expect(body.startPosition).toBeCloseTo(0.0, 9);
		expect(body.endPosition).toBeCloseTo(2.0, 9);
		expect(body.startActId).toBe(acts.act0);
		expect(body.endActId).toBe(acts.act1);
	});

	it('POST with startSceneId → scene-level start position computed', async () => {
		// Add a scene inside act0
		const [scene] = await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'Scene 1', parentId: acts.act0, position: 0 })
			.returning();

		const res = await relRoute.POST(
			mkEvent({
				body: {
					fromId: alice,
					toId: bob,
					type: 'rivals',
					startActId: acts.act0,
					startSceneId: scene.id,
					endActId: acts.act1
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		// Single scene in act0 (m=1, k=0): sceneRange(0,1,0).start = 0 + 0/1 = 0
		// endActId = act1 (index 1) → endPosition = 2.0
		expect(body.startPosition).toBeCloseTo(0.0, 9);
		expect(body.endPosition).toBeCloseTo(2.0, 9);
	});

	it('POST with NULL temporal fields → timeless (startPosition IS NULL in DB)', async () => {
		const res = await relRoute.POST(
			mkEvent({ body: { fromId: alice, toId: bob, type: 'rivals' } })
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.startPosition).toBeNull();
		expect(body.endPosition).toBeNull();
		expect(body.startActId).toBeNull();
		expect(body.endActId).toBeNull();
	});

	it('POST with start >= end → 400 error', async () => {
		// Same act for start and end produces [i, i+1) which is valid; to force
		// start >= end we need the positions to be equal — supply act1 for start
		// and act0 for end so derived start (1.0) > derived end (1.0... actually 1.0)
		// The only way to get start >= end with act FKs: same single-scene act with
		// start_scene_id on the LAST scene and end_scene_id on the FIRST scene of a
		// multi-scene act. Simpler: we can't inject this via the API directly since
		// computeIntervalPositions uses actRange which gives [i, i+1). Instead,
		// start act index > end act index: act1 (idx 1) start, act0 (idx 0) end.
		// startPosition = 1.0, endPosition = 1.0 — same! actually actRange(1).end = 2
		// and actRange(0).end = 1. So start=1, end=1. That violates start < end.
		// Actually: start = actRange(act1).start = 1.0, end = actRange(act0).end = 1.0 → equal → throws.
		await expect(
			relRoute.POST(
				mkEvent({
					body: {
						fromId: alice,
						toId: bob,
						type: 'rivals',
						startActId: acts.act1,
						endActId: acts.act0
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('two temporal rows same pair+type different start_position → both accepted', async () => {
		// First temporal row: act0 → act0
		const r1 = await relRoute.POST(
			mkEvent({
				body: { fromId: alice, toId: bob, type: 'rivals', startActId: acts.act0, endActId: acts.act0 }
			})
		);
		expect(r1.status).toBe(201);

		// Second temporal row: act1 → act1 (different start_position)
		const r2 = await relRoute.POST(
			mkEvent({
				body: { fromId: alice, toId: bob, type: 'rivals', startActId: acts.act1, endActId: acts.act1 }
			})
		);
		expect(r2.status).toBe(201);

		const all = await currentDb.select().from(relationships);
		expect(all).toHaveLength(2);
	});

	it('two timeless rows same pair+type → second rejected (unique constraint)', async () => {
		await relRoute.POST(
			mkEvent({ body: { fromId: alice, toId: bob, type: 'rivals' } })
		);
		await expect(
			relRoute.POST(
				mkEvent({ body: { fromId: alice, toId: bob, type: 'rivals' } })
			)
		).rejects.toThrow();
	});

	it('one timeless + one temporal same pair+type → both accepted', async () => {
		// Timeless first
		const r1 = await relRoute.POST(
			mkEvent({ body: { fromId: alice, toId: bob, type: 'rivals' } })
		);
		expect(r1.status).toBe(201);

		// Temporal second
		const r2 = await relRoute.POST(
			mkEvent({
				body: {
					fromId: alice,
					toId: bob,
					type: 'rivals',
					startActId: acts.act0,
					endActId: acts.act0
				}
			})
		);
		expect(r2.status).toBe(201);

		const all = await currentDb.select().from(relationships);
		expect(all).toHaveLength(2);
	});
});

describe('PATCH /api/relationships/[id] — temporal update', () => {
	let alice: string;
	let bob: string;
	let acts: { act0: string; act1: string; act2: string };

	beforeEach(async () => {
		currentDb = await createTestDb();
		acts = await seedActs(currentDb);
		const [a] = await currentDb.insert(entities).values({ type: 'Character', name: 'Alice' }).returning();
		const [b] = await currentDb.insert(entities).values({ type: 'Character', name: 'Bob' }).returning();
		alice = a.id;
		bob = b.id;
	});

	it('PATCH updates temporal fields and recomputes positions', async () => {
		// Create a timeless relationship first
		const [rel] = await currentDb
			.insert(relationships)
			.values({ fromId: alice, toId: bob, type: 'rivals' })
			.returning();

		const res = await relIdRoute.PATCH(
			mkEvent({
				params: { id: rel.id },
				body: { startActId: acts.act0, endActId: acts.act1 }
			})
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.startPosition).toBeCloseTo(0.0, 9);
		expect(body.endPosition).toBeCloseTo(2.0, 9);
		expect(body.startActId).toBe(acts.act0);
		expect(body.endActId).toBe(acts.act1);
	});

	it('PATCH returns 404 for unknown id', async () => {
		await expect(
			relIdRoute.PATCH(
				mkEvent({
					params: { id: '00000000-0000-0000-0000-000000000000' },
					body: { startActId: acts.act0, endActId: acts.act1 }
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});
});

describe('POST /api/entity-aliases', () => {
	let alice: string;
	let aliceAlias: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const [a] = await currentDb.insert(entities).values({ type: 'Character', name: 'Alice' }).returning();
		const [b] = await currentDb.insert(entities).values({ type: 'Character', name: 'Alice (alias)' }).returning();
		alice = a.id;
		aliceAlias = b.id;
	});

	it('creates an alias', async () => {
		const res = await aliasRoute.POST(
			mkEvent({ body: { primaryEntityId: alice, aliasEntityId: aliceAlias } })
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.primaryEntityId).toBe(alice);
		expect(body.aliasEntityId).toBe(aliceAlias);
		expect(body.revealedAtPosition).toBeNull();
	});

	it('creates alias with revealedAtPosition', async () => {
		const res = await aliasRoute.POST(
			mkEvent({
				body: { primaryEntityId: alice, aliasEntityId: aliceAlias, revealedAtPosition: 1.5 }
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.revealedAtPosition).toBeCloseTo(1.5, 9);
	});

	it('rejects self-alias with 400', async () => {
		await expect(
			aliasRoute.POST(
				mkEvent({ body: { primaryEntityId: alice, aliasEntityId: alice } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects duplicate alias with 409', async () => {
		await aliasRoute.POST(
			mkEvent({ body: { primaryEntityId: alice, aliasEntityId: aliceAlias } })
		);
		await expect(
			aliasRoute.POST(
				mkEvent({ body: { primaryEntityId: alice, aliasEntityId: aliceAlias } })
			)
		).rejects.toMatchObject({ status: 409 });
	});

	it('rejects unknown primaryEntityId with 400', async () => {
		await expect(
			aliasRoute.POST(
				mkEvent({
					body: {
						primaryEntityId: '00000000-0000-0000-0000-000000000000',
						aliasEntityId: aliceAlias
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('DELETE /api/entity-aliases/[id]', () => {
	let alice: string;
	let aliceAlias: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const [a] = await currentDb.insert(entities).values({ type: 'Character', name: 'Alice' }).returning();
		const [b] = await currentDb.insert(entities).values({ type: 'Character', name: 'Alice (alias)' }).returning();
		alice = a.id;
		aliceAlias = b.id;
	});

	it('deletes an alias and returns 204', async () => {
		const [created] = await currentDb
			.insert(entityAliases)
			.values({ primaryEntityId: alice, aliasEntityId: aliceAlias })
			.returning();

		const res = await aliasIdRoute.DELETE(mkEvent({ params: { id: created.id } }));
		expect(res.status).toBe(204);

		const remaining = await currentDb.select().from(entityAliases);
		expect(remaining).toHaveLength(0);
	});

	it('returns 404 for unknown alias id', async () => {
		await expect(
			aliasIdRoute.DELETE(
				mkEvent({ params: { id: '00000000-0000-0000-0000-000000000000' } })
			)
		).rejects.toMatchObject({ status: 404 });
	});
});

describe('partial-unique-constraint — timeless vs temporal dedup', () => {
	let alice: string;
	let bob: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const [a] = await currentDb.insert(entities).values({ type: 'Character', name: 'Alice' }).returning();
		const [b] = await currentDb.insert(entities).values({ type: 'Character', name: 'Bob' }).returning();
		alice = a.id;
		bob = b.id;
	});

	it('DB rejects duplicate timeless row for same (from, to, type)', async () => {
		await currentDb.insert(relationships).values({ fromId: alice, toId: bob, type: 'rivals' });
		await expect(
			currentDb.insert(relationships).values({ fromId: alice, toId: bob, type: 'rivals' })
		).rejects.toThrow();
	});

	it('DB accepts two temporal rows with different start_positions', async () => {
		// Two temporal rows same pair+type but different start_position
		await currentDb.insert(relationships).values({
			fromId: alice,
			toId: bob,
			type: 'rivals',
			startPosition: 0.0,
			endPosition: 1.0
		});
		await currentDb.insert(relationships).values({
			fromId: alice,
			toId: bob,
			type: 'rivals',
			startPosition: 1.0,
			endPosition: 2.0
		});
		const all = await currentDb.select().from(relationships);
		expect(all).toHaveLength(2);
	});
});
