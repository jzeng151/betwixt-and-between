import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { entities, type Entity } from '../../src/lib/stores/entities.js';

// =============================================================================
// Helpers
// =============================================================================

function makeResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	} as unknown as Response;
}

function entity(partial: Partial<Entity> & { id: string; name: string }): Entity {
	return {
		type: 'Character',
		data: '{}',
		createdAt: 0,
		updatedAt: 0,
		...partial
	} as Entity;
}

beforeEach(() => {
	// Reset store between tests by setting via a load() with empty array
	const fetchMock = vi.fn().mockResolvedValue(makeResponse([]));
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return entities.load();
});

// =============================================================================
// load()
// =============================================================================

describe('entities.load', () => {
	it('fetches /api/entities and replaces store contents', async () => {
		const data = [entity({ id: 'a', name: 'A' }), entity({ id: 'b', name: 'B' })];
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(data));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await entities.load();

		expect(fetchMock).toHaveBeenCalledWith('/api/entities');
		expect(get(entities)).toHaveLength(2);
		expect(get(entities)[0].id).toBe('a');
	});
});

// =============================================================================
// createEntity()
// =============================================================================

describe('entities.createEntity', () => {
	it('POSTs to /api/entities and appends the returned entity', async () => {
		const created = entity({ id: 'new1', name: 'Ellie', type: 'Character' });
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await entities.createEntity('Character', 'Ellie', { age: 14 });

		expect(result.id).toBe('new1');
		const call = fetchMock.mock.calls[0];
		expect(call[0]).toBe('/api/entities');
		expect(call[1].method).toBe('POST');
		const body = JSON.parse(call[1].body as string);
		expect(body).toEqual({ type: 'Character', name: 'Ellie', data: { age: 14 } });
		expect(get(entities)).toHaveLength(1);
		expect(get(entities)[0].id).toBe('new1');
	});

	it('throws and does not append when fetch is not ok', async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeResponse('boom', false, 400));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(entities.createEntity('Character', 'Bad')).rejects.toThrow(/boom/);
		expect(get(entities)).toHaveLength(0);
	});

	it('serializes data=undefined as undefined in the body', async () => {
		const created = entity({ id: 'x', name: 'Plain' });
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await entities.createEntity('Note', 'Plain');
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.type).toBe('Note');
		expect(body.name).toBe('Plain');
		expect('data' in body && body.data === undefined ? true : body.data === undefined).toBe(true);
	});
});

// =============================================================================
// updateEntity()
// =============================================================================

describe('entities.updateEntity', () => {
	beforeEach(async () => {
		const seed = [entity({ id: 'e1', name: 'Old', type: 'Character', data: '{"age":10}' })];
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(seed));
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		await entities.load();
	});

	it('optimistically updates the name before the server responds', async () => {
		let resolveServer: (v: Response) => void = () => {};
		const serverPromise = new Promise<Response>((resolve) => {
			resolveServer = resolve;
		});
		const fetchMock = vi.fn().mockReturnValue(serverPromise);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const pending = entities.updateEntity('e1', { name: 'New' });

		// Optimistic update should have happened synchronously before fetch resolves
		expect(get(entities)[0].name).toBe('New');

		resolveServer(
			makeResponse(entity({ id: 'e1', name: 'NewServer', type: 'Character', data: '{"age":10}' }))
		);
		await pending;

		// After server response, the entry is replaced with the server version
		expect(get(entities)[0].name).toBe('NewServer');
	});

	it('serializes optimistic data to JSON string in the store', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			makeResponse(entity({ id: 'e1', name: 'Old', type: 'Character', data: '{"age":99}' }))
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const p = entities.updateEntity('e1', { data: { age: 99 } });
		expect(get(entities)[0].data).toBe('{"age":99}');
		await p;
	});

	it('PATCHes the right URL with the patch payload', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			makeResponse(entity({ id: 'e1', name: 'X', type: 'Character' }))
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await entities.updateEntity('e1', { name: 'X' });

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/entities/e1',
			expect.objectContaining({ method: 'PATCH' })
		);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body).toEqual({ name: 'X' });
	});

	it('reloads from server and throws when PATCH fails', async () => {
		const reloaded = [entity({ id: 'e1', name: 'Reverted', type: 'Character' })];
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(makeResponse('forbidden', false, 403))
			.mockResolvedValueOnce(makeResponse(reloaded));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(entities.updateEntity('e1', { name: 'Will Fail' })).rejects.toThrow(/forbidden/);

		// Second call must be the reload
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toBe('/api/entities');
		expect(get(entities)[0].name).toBe('Reverted');
	});

	it('leaves other entities untouched', async () => {
		const seed = [
			entity({ id: 'e1', name: 'One', type: 'Character' }),
			entity({ id: 'e2', name: 'Two', type: 'Character' })
		];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await entities.load();

		globalThis.fetch = vi.fn().mockResolvedValue(
			makeResponse(entity({ id: 'e1', name: 'OneX', type: 'Character' }))
		) as unknown as typeof fetch;
		await entities.updateEntity('e1', { name: 'OneX' });

		const all = get(entities);
		expect(all.find((e) => e.id === 'e2')!.name).toBe('Two');
	});
});

// =============================================================================
// deleteEntity()
// =============================================================================

describe('entities.deleteEntity', () => {
	beforeEach(async () => {
		const seed = [
			entity({ id: 'd1', name: 'A', type: 'Character' }),
			entity({ id: 'd2', name: 'B', type: 'Character' })
		];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await entities.load();
	});

	it('optimistically removes the entity before the server responds', async () => {
		let resolveServer: (v: Response) => void = () => {};
		const serverPromise = new Promise<Response>((resolve) => {
			resolveServer = resolve;
		});
		globalThis.fetch = vi.fn().mockReturnValue(serverPromise) as unknown as typeof fetch;

		const pending = entities.deleteEntity('d1');
		expect(get(entities).map((e) => e.id)).toEqual(['d2']);

		resolveServer(makeResponse({}, true, 204));
		await pending;
		expect(get(entities).map((e) => e.id)).toEqual(['d2']);
	});

	it('uses the correct URL and method', async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeResponse({}, true, 204));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await entities.deleteEntity('d1');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/entities/d1',
			expect.objectContaining({ method: 'DELETE' })
		);
	});

	it('reloads on failure and throws', async () => {
		const reloaded = [
			entity({ id: 'd1', name: 'A', type: 'Character' }),
			entity({ id: 'd2', name: 'B', type: 'Character' })
		];
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(makeResponse('nope', false, 500))
			.mockResolvedValueOnce(makeResponse(reloaded));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(entities.deleteEntity('d1')).rejects.toThrow(/nope/);
		expect(get(entities)).toHaveLength(2);
	});
});
