/**
 * Vitest integration tests for /api/intervals handlers.
 * Focus on the GET filter (entity_id) and the snake/camel case body coercion
 * in POST/PATCH. The underlying writeInterval/updateInterval logic is covered
 * by intervals-write.test.ts — these tests verify the handler wiring only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

vi.mock('$lib/server/db/index.js', () => ({
	get db() {
		return currentDb;
	}
}));

const route = await import('../../src/routes/api/intervals/+server.js');
const idRoute = await import('../../src/routes/api/intervals/[id]/+server.js');

function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/intervals'),
		params: overrides.params ?? {},
		request: {
			json: async () => overrides.body
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

describe('/api/intervals GET', () => {
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;
	let bob: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		acts = await seedActs(currentDb);
		const [e] = await currentDb
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		const [b] = await currentDb
			.insert(entities)
			.values({ type: 'Character', name: 'Bob' })
			.returning();
		ellie = e.id;
		bob = b.id;
	});

	it('returns empty array initially', async () => {
		const res = await route.GET(mkEvent());
		expect(await readJson(res)).toEqual([]);
	});

	it('returns all intervals when no filter', async () => {
		await route.POST(
			mkEvent({ body: { entity_id: ellie, start_act_id: acts.act0, end_act_id: acts.act0 } })
		);
		await route.POST(
			mkEvent({ body: { entity_id: bob, start_act_id: acts.act1, end_act_id: acts.act1 } })
		);

		const res = await route.GET(mkEvent());
		const body = await readJson(res);
		expect(body).toHaveLength(2);
	});

	it('filters by entity_id query param', async () => {
		await route.POST(
			mkEvent({ body: { entity_id: ellie, start_act_id: acts.act0, end_act_id: acts.act0 } })
		);
		await route.POST(
			mkEvent({ body: { entity_id: bob, start_act_id: acts.act1, end_act_id: acts.act1 } })
		);

		const url = new URL(`http://localhost/api/intervals?entity_id=${ellie}`);
		const res = await route.GET(mkEvent({ url }));
		const body = await readJson(res);
		expect(body).toHaveLength(1);
		expect(body[0].entityId).toBe(ellie);
	});

	it('orders results by start_position ascending', async () => {
		await route.POST(
			mkEvent({ body: { entity_id: ellie, start_act_id: acts.act2, end_act_id: acts.act2 } })
		);
		await route.POST(
			mkEvent({ body: { entity_id: ellie, start_act_id: acts.act0, end_act_id: acts.act0 } })
		);

		const url = new URL(`http://localhost/api/intervals?entity_id=${ellie}`);
		const res = await route.GET(mkEvent({ url }));
		const body = await readJson(res);
		expect(body[0].startPosition).toBeLessThan(body[1].startPosition);
	});
});

describe('/api/intervals POST', () => {
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		acts = await seedActs(currentDb);
		const [e] = await currentDb
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = e.id;
	});

	it('creates an interval with snake_case fields', async () => {
		const res = await route.POST(
			mkEvent({ body: { entity_id: ellie, start_act_id: acts.act1, end_act_id: acts.act1 } })
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.entityId).toBe(ellie);
		expect(body.startActId).toBe(acts.act1);
	});

	it('creates an interval with camelCase fields', async () => {
		const res = await route.POST(
			mkEvent({ body: { entityId: ellie, startActId: acts.act0, endActId: acts.act0 } })
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.entityId).toBe(ellie);
		expect(body.startActId).toBe(acts.act0);
	});

	it('rejects missing entity_id with 400', async () => {
		await expect(
			route.POST(mkEvent({ body: { start_act_id: acts.act1, end_act_id: acts.act1 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects missing start_act_id with 400', async () => {
		await expect(
			route.POST(mkEvent({ body: { entity_id: ellie, end_act_id: acts.act1 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects missing end_act_id with 400', async () => {
		await expect(
			route.POST(mkEvent({ body: { entity_id: ellie, start_act_id: acts.act1 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('surfaces writeInterval errors as 400', async () => {
		// Pointing start_act_id at a non-Act entity triggers polymorphic FK validation
		await expect(
			route.POST(
				mkEvent({ body: { entity_id: ellie, start_act_id: ellie, end_act_id: ellie } })
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('/api/intervals/[id] GET/PATCH/DELETE', () => {
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;
	let intervalId: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		acts = await seedActs(currentDb);
		const [e] = await currentDb
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = e.id;
		const created = await readJson(
			await route.POST(
				mkEvent({ body: { entity_id: ellie, start_act_id: acts.act1, end_act_id: acts.act1 } })
			)
		);
		intervalId = created.id;
	});

	it('GET returns the interval', async () => {
		const res = await idRoute.GET(mkEvent({ params: { id: intervalId } }));
		const body = await readJson(res);
		expect(body.id).toBe(intervalId);
		expect(body.entityId).toBe(ellie);
	});

	it('GET returns 404 for missing id', async () => {
		await expect(
			idRoute.GET(mkEvent({ params: { id: '00000000-0000-0000-0000-000000000000' } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('PATCH updates start/end acts', async () => {
		const res = await idRoute.PATCH(
			mkEvent({
				params: { id: intervalId },
				body: { start_act_id: acts.act0, end_act_id: acts.act2 }
			})
		);
		const body = await readJson(res);
		expect(body.startActId).toBe(acts.act0);
		expect(body.endActId).toBe(acts.act2);
	});

	it('PATCH returns 404 for missing id', async () => {
		await expect(
			idRoute.PATCH(mkEvent({ params: { id: '00000000-0000-0000-0000-000000000000' }, body: {} }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('PATCH surfaces updateInterval errors as 400', async () => {
		// Setting start_act_id to a non-Act triggers polymorphic FK validation
		await expect(
			idRoute.PATCH(
				mkEvent({ params: { id: intervalId }, body: { start_act_id: ellie } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('DELETE removes the interval and returns 204', async () => {
		const res = await idRoute.DELETE(mkEvent({ params: { id: intervalId } }));
		expect(res.status).toBe(204);
		const remaining = await currentDb.select().from(intervals);
		expect(remaining).toHaveLength(0);
	});

	it('DELETE returns 404 for missing id', async () => {
		await expect(
			idRoute.DELETE(mkEvent({ params: { id: '00000000-0000-0000-0000-000000000000' } }))
		).rejects.toMatchObject({ status: 404 });
	});
});
