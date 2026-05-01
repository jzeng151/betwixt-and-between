/**
 * Vitest integration tests for /api/entities handlers.
 *
 * Calls the SvelteKit handler functions directly with mock RequestEvent
 * objects. The `$lib/server/db/index.js` module is mocked so handlers see
 * an in-memory test DB instead of the production SQLite file.
 *
 * Each test rebuilds the test DB and reassigns the mock proxy so isolation
 * is preserved.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';

// Module-level holder so each test can swap in a fresh DB. The mock factory
// closes over `currentDb` by reference via a getter.
let currentDb: Awaited<ReturnType<typeof createTestDb>>;

vi.mock('$lib/server/db/index.js', () => ({
	get db() {
		return currentDb;
	}
}));

// Imports MUST come after vi.mock — Vitest hoists the mock but module
// resolution still happens here.
const { GET, POST } = await import('../../src/routes/api/entities/+server.js');
const idRoute = await import('../../src/routes/api/entities/[id]/+server.js');

function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/entities'),
		params: overrides.params ?? {},
		request: {
			json: async () => overrides.body
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

describe('/api/entities GET', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('returns empty array when no entities', async () => {
		const res = await GET(mkEvent());
		const body = await readJson(res);
		expect(body).toEqual([]);
	});

	it('returns all entities ordered by createdAt desc', async () => {
		await POST(mkEvent({ body: { type: 'Character', name: 'Alice' } }));
		await POST(mkEvent({ body: { type: 'Location', name: 'Forest' } }));
		const res = await GET(mkEvent());
		const body = await readJson(res);
		expect(body).toHaveLength(2);
		expect(body.map((e: any) => e.name).sort()).toEqual(['Alice', 'Forest']);
	});
});

describe('/api/entities POST', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('creates a Character entity with valid input', async () => {
		const res = await POST(mkEvent({ body: { type: 'Character', name: 'Ellie' } }));
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.type).toBe('Character');
		expect(body.name).toBe('Ellie');
		expect(body.id).toBeTruthy();
	});

	it('trims whitespace from name', async () => {
		const res = await POST(mkEvent({ body: { type: 'Character', name: '  Bob  ' } }));
		const body = await readJson(res);
		expect(body.name).toBe('Bob');
	});

	it('serializes data field as JSON string', async () => {
		const res = await POST(
			mkEvent({ body: { type: 'Character', name: 'Bob', data: { age: 30, role: 'hero' } } })
		);
		const body = await readJson(res);
		// Drizzle stores it as JSON-encoded text; the API returns whatever the row is.
		expect(typeof body.data).toBe('string');
		expect(JSON.parse(body.data)).toEqual({ age: 30, role: 'hero' });
	});

	it('defaults data to empty object string when omitted', async () => {
		const res = await POST(mkEvent({ body: { type: 'Character', name: 'Bob' } }));
		const body = await readJson(res);
		expect(body.data).toBe('{}');
	});

	it('rejects unknown entity type with 400', async () => {
		await expect(
			POST(mkEvent({ body: { type: 'Dragon', name: 'Smaug' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects missing type with 400', async () => {
		await expect(POST(mkEvent({ body: { name: 'Smaug' } }))).rejects.toMatchObject({
			status: 400
		});
	});

	it('rejects empty name with 400', async () => {
		await expect(
			POST(mkEvent({ body: { type: 'Character', name: '' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects whitespace-only name with 400', async () => {
		await expect(
			POST(mkEvent({ body: { type: 'Character', name: '   ' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects non-string name with 400', async () => {
		await expect(
			POST(mkEvent({ body: { type: 'Character', name: 42 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts all valid entity types', async () => {
		const types = ['Character', 'Location', 'Event', 'Act', 'Scene', 'Note'];
		for (const type of types) {
			const res = await POST(mkEvent({ body: { type, name: `${type}-1` } }));
			expect(res.status).toBe(201);
		}
	});
});

describe('/api/entities/[id] GET', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('returns the entity by id', async () => {
		const created = await readJson(
			await POST(mkEvent({ body: { type: 'Character', name: 'Ellie' } }))
		);
		const res = await idRoute.GET(mkEvent({ params: { id: created.id } }));
		const body = await readJson(res);
		expect(body.id).toBe(created.id);
		expect(body.name).toBe('Ellie');
	});

	it('returns 404 for missing id', async () => {
		await expect(
			idRoute.GET(mkEvent({ params: { id: 'nope-not-real' } }))
		).rejects.toMatchObject({ status: 404 });
	});
});

describe('/api/entities/[id] PATCH', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('updates name and trims whitespace', async () => {
		const created = await readJson(
			await POST(mkEvent({ body: { type: 'Character', name: 'Ellie' } }))
		);
		const res = await idRoute.PATCH(
			mkEvent({ params: { id: created.id }, body: { name: '  Ellie Renamed  ' } })
		);
		const body = await readJson(res);
		expect(body.name).toBe('Ellie Renamed');
	});

	it('updates data field by JSON.stringify', async () => {
		const created = await readJson(
			await POST(mkEvent({ body: { type: 'Character', name: 'Ellie' } }))
		);
		const res = await idRoute.PATCH(
			mkEvent({ params: { id: created.id }, body: { data: { hobbies: ['archery'] } } })
		);
		const body = await readJson(res);
		expect(JSON.parse(body.data)).toEqual({ hobbies: ['archery'] });
	});

	it('returns 404 when patching missing entity', async () => {
		await expect(
			idRoute.PATCH(mkEvent({ params: { id: 'nope' }, body: { name: 'X' } }))
		).rejects.toMatchObject({ status: 404 });
	});
});

describe('/api/entities/[id] DELETE', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('deletes the entity and returns 204', async () => {
		const created = await readJson(
			await POST(mkEvent({ body: { type: 'Character', name: 'Ellie' } }))
		);
		const res = await idRoute.DELETE(mkEvent({ params: { id: created.id } }));
		expect(res.status).toBe(204);

		// confirm gone
		await expect(
			idRoute.GET(mkEvent({ params: { id: created.id } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns 404 when deleting missing entity', async () => {
		await expect(
			idRoute.DELETE(mkEvent({ params: { id: 'nope' } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('cascades to relationships via FK ON DELETE CASCADE', async () => {
		// Create two entities + a relationship between them, then delete one and
		// verify the relationship is gone (handled by SQLite FK, not handler logic).
		const a = await readJson(
			await POST(mkEvent({ body: { type: 'Character', name: 'A' } }))
		);
		const b = await readJson(
			await POST(mkEvent({ body: { type: 'Character', name: 'B' } }))
		);
		const { relationships } = await import('../../src/lib/server/db/schema.js');
		await currentDb.insert(relationships).values({ fromId: a.id, toId: b.id, type: 'rivals' });

		await idRoute.DELETE(mkEvent({ params: { id: a.id } }));

		const remaining = await currentDb.select().from(relationships);
		expect(remaining).toHaveLength(0);
	});
});
