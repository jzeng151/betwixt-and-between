import { test, expect, type APIRequestContext } from '@playwright/test';

async function clearEntities(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	await Promise.all(ents.map((e) => request.delete(`/api/entities/${e.id}`)));
}

test.describe('Entities API', () => {
	test.beforeEach(async ({ request }) => {
		await clearEntities(request);
	});

	test('GET returns empty array', async ({ request }) => {
		const res = await request.get('/api/entities');
		expect(res.status()).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	test('POST creates entity and returns 201', async ({ request }) => {
		const res = await request.post('/api/entities', {
			data: { type: 'Character', name: 'Elara Voss' }
		});
		expect(res.status()).toBe(201);
		const body = await res.json();
		expect(body.id).toBeTruthy();
		expect(body.type).toBe('Character');
		expect(body.name).toBe('Elara Voss');
	});

	test('POST trims whitespace from name', async ({ request }) => {
		const res = await request.post('/api/entities', {
			data: { type: 'Character', name: '  Scout  ' }
		});
		expect(res.status()).toBe(201);
		expect((await res.json()).name).toBe('Scout');
	});

	test('POST rejects invalid entity type', async ({ request }) => {
		const res = await request.post('/api/entities', {
			data: { type: 'Dragon', name: 'Smaug' }
		});
		expect(res.status()).toBe(400);
	});

	test('POST rejects blank name', async ({ request }) => {
		const res = await request.post('/api/entities', {
			data: { type: 'Character', name: '   ' }
		});
		expect(res.status()).toBe(400);
	});

	test('POST accepts all valid entity types', async ({ request }) => {
		const types = ['Character', 'Location', 'Event', 'Act', 'Scene', 'Note'] as const;
		for (const type of types) {
			const res = await request.post('/api/entities', {
				data: { type, name: `Test ${type}` }
			});
			expect(res.status()).toBe(201);
			expect((await res.json()).type).toBe(type);
		}
	});

	test('GET /:id returns the entity', async ({ request }) => {
		const created = await (
			await request.post('/api/entities', { data: { type: 'Location', name: 'Ashenveil' } })
		).json();

		const res = await request.get(`/api/entities/${created.id}`);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.id).toBe(created.id);
		expect(body.name).toBe('Ashenveil');
	});

	test('GET /:id returns 404 for unknown id', async ({ request }) => {
		const res = await request.get('/api/entities/does-not-exist');
		expect(res.status()).toBe(404);
	});

	test('PATCH /:id renames entity', async ({ request }) => {
		const created = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Original' } })
		).json();

		const res = await request.patch(`/api/entities/${created.id}`, {
			data: { name: 'Renamed' }
		});
		expect(res.status()).toBe(200);
		expect((await res.json()).name).toBe('Renamed');
	});

	test('PATCH /:id updates data field', async ({ request }) => {
		const created = await (
			await request.post('/api/entities', { data: { type: 'Note', name: 'Draft' } })
		).json();

		const res = await request.patch(`/api/entities/${created.id}`, {
			data: { data: { body: '# Hello' } }
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(JSON.parse(body.data).body).toBe('# Hello');
	});

	test('PATCH /:id returns 404 for unknown id', async ({ request }) => {
		const res = await request.patch('/api/entities/does-not-exist', {
			data: { name: 'Anything' }
		});
		expect(res.status()).toBe(404);
	});

	test('DELETE /:id removes entity and returns 204', async ({ request }) => {
		const created = await (
			await request.post('/api/entities', { data: { type: 'Note', name: 'Temp' } })
		).json();

		expect((await request.delete(`/api/entities/${created.id}`)).status()).toBe(204);
		expect((await request.get(`/api/entities/${created.id}`)).status()).toBe(404);
	});

	test('DELETE /:id returns 404 for unknown id', async ({ request }) => {
		const res = await request.delete('/api/entities/does-not-exist');
		expect(res.status()).toBe(404);
	});

	test('GET returns entities ordered by created_at descending', async ({ request }) => {
		// unixepoch() has 1-second resolution — insert with a small delay to guarantee distinct timestamps
		await request.post('/api/entities', { data: { type: 'Character', name: 'First' } });
		await new Promise((r) => setTimeout(r, 1100));
		await request.post('/api/entities', { data: { type: 'Character', name: 'Second' } });

		const list: Array<{ name: string }> = await (await request.get('/api/entities')).json();
		// Most recently created should be first
		expect(list[0].name).toBe('Second');
		expect(list[1].name).toBe('First');
	});
});

test.describe('Relationships API', () => {
	let charId: string;
	let locId: string;

	test.beforeEach(async ({ request }) => {
		await clearEntities(request);
		charId = (
			await (
				await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } })
			).json()
		).id;
		locId = (
			await (
				await request.post('/api/entities', { data: { type: 'Location', name: 'Ashenveil' } })
			).json()
		).id;
	});

	test('POST creates relationship and returns 201', async ({ request }) => {
		const res = await request.post('/api/relationships', {
			data: { fromId: charId, toId: locId, type: 'located_at' }
		});
		expect(res.status()).toBe(201);
		const body = await res.json();
		expect(body.id).toBeTruthy();
		expect(body.fromId).toBe(charId);
		expect(body.toId).toBe(locId);
		expect(body.type).toBe('located_at');
	});

	test('POST accepts optional label', async ({ request }) => {
		const res = await request.post('/api/relationships', {
			data: { fromId: charId, toId: locId, type: 'located_at', label: 'home base' }
		});
		expect(res.status()).toBe(201);
		expect((await res.json()).label).toBe('home base');
	});

	test('POST accepts all valid relationship types', async ({ request }) => {
		const types = [
			'appears_in',
			'takes_place_at',
			'caused_by',
			'allied_with',
			'rivals',
			'mentor_of',
			'located_at'
		] as const;
		for (const type of types) {
			const res = await request.post('/api/relationships', {
				data: { fromId: charId, toId: locId, type }
			});
			expect(res.status()).toBe(201);
		}
	});

	test('POST rejects invalid relationship type', async ({ request }) => {
		const res = await request.post('/api/relationships', {
			data: { fromId: charId, toId: locId, type: 'friends_with' }
		});
		expect(res.status()).toBe(400);
	});

	test('POST rejects ghost fromId', async ({ request }) => {
		const res = await request.post('/api/relationships', {
			data: { fromId: 'ghost-id', toId: locId, type: 'located_at' }
		});
		expect(res.status()).toBe(400);
	});

	test('POST rejects ghost toId', async ({ request }) => {
		const res = await request.post('/api/relationships', {
			data: { fromId: charId, toId: 'ghost-id', type: 'located_at' }
		});
		expect(res.status()).toBe(400);
	});

	test('GET returns list including created relationship', async ({ request }) => {
		await request.post('/api/relationships', {
			data: { fromId: charId, toId: locId, type: 'located_at' }
		});
		const list: Array<{ fromId: string }> = await (
			await request.get('/api/relationships')
		).json();
		expect(list.some((r) => r.fromId === charId)).toBe(true);
	});

	test('DELETE /:id removes relationship', async ({ request }) => {
		const rel = await (
			await request.post('/api/relationships', {
				data: { fromId: charId, toId: locId, type: 'located_at' }
			})
		).json();

		expect((await request.delete(`/api/relationships/${rel.id}`)).status()).toBe(204);
		const list: Array<{ id: string }> = await (await request.get('/api/relationships')).json();
		expect(list.find((r) => r.id === rel.id)).toBeUndefined();
	});

	test('DELETE /:id returns 404 for unknown id', async ({ request }) => {
		const res = await request.delete('/api/relationships/does-not-exist');
		expect(res.status()).toBe(404);
	});
});

test.describe('Canvas Positions API', () => {
	let entityId: string;

	test.beforeEach(async ({ request }) => {
		await clearEntities(request);
		entityId = (
			await (
				await request.post('/api/entities', { data: { type: 'Character', name: 'Test' } })
			).json()
		).id;
	});

	test('PUT upserts a position and returns 200', async ({ request }) => {
		const res = await request.put('/api/canvas-positions', {
			data: { entityId, x: 100, y: 200, width: 160, height: 80 }
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.entityId).toBe(entityId);
		expect(body.x).toBe(100);
		expect(body.y).toBe(200);
		expect(body.width).toBe(160);
		expect(body.height).toBe(80);
	});

	test('PUT updates an existing position', async ({ request }) => {
		await request.put('/api/canvas-positions', { data: { entityId, x: 10, y: 20 } });
		const res = await request.put('/api/canvas-positions', { data: { entityId, x: 300, y: 400 } });
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.x).toBe(300);
		expect(body.y).toBe(400);
	});

	test('GET returns list including upserted position', async ({ request }) => {
		await request.put('/api/canvas-positions', { data: { entityId, x: 50, y: 75 } });
		const res = await request.get('/api/canvas-positions');
		expect(res.status()).toBe(200);
		const list: Array<{ entityId: string }> = await res.json();
		expect(list.some((p) => p.entityId === entityId)).toBe(true);
	});

	test('PUT returns 400 when entityId is missing', async ({ request }) => {
		const res = await request.put('/api/canvas-positions', { data: { x: 0, y: 0 } });
		expect(res.status()).toBe(400);
	});

	test('PUT returns 400 for unknown entityId', async ({ request }) => {
		const res = await request.put('/api/canvas-positions', {
			data: { entityId: 'ghost-id', x: 0, y: 0 }
		});
		expect(res.status()).toBe(400);
	});
});
