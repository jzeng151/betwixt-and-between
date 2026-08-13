import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { entities, entityLoadStatus, type Entity } from '../../src/lib/stores/entities.js';
import { intervals as intervalsStore } from '../../src/lib/features/timeline/intervals-store.js';
import { relationships } from '../../src/lib/stores/relationships.js';

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
		data: {},
		createdAt: 0,
		updatedAt: 0,
		...partial
	} as Entity;
}

beforeEach(async () => {
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
		expect(get(entityLoadStatus)).toBe('ready');
	});

	it('throws on non-OK response and leaves the store untouched', async () => {
		// Seed the store with known content via a successful load.
		const seeded = [entity({ id: 'seed', name: 'Seed' })];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seeded)) as unknown as typeof fetch;
		await entities.load();
		const before = get(entities);

		// Now simulate a 5xx and assert load() rejects + store unchanged.
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse('upstream boom', false, 503)) as unknown as typeof fetch;
		await expect(entities.load()).rejects.toThrow(/503.*upstream boom/);
		expect(get(entities)).toEqual(before);
		expect(get(entityLoadStatus)).toBe('error');
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

		// D19/Issue 13A: third arg is now an options object {data, parentId, position}
		const result = await entities.createEntity('Character', 'Ellie', { data: { age: 14 } });

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
		const seed = [entity({ id: 'e1', name: 'Old', type: 'Character', data: { age: 10 } })];
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
			makeResponse(entity({ id: 'e1', name: 'NewServer', type: 'Character', data: { age: 10 } }))
		);
		await pending;

		// After server response, the entry is replaced with the server version
		expect(get(entities)[0].name).toBe('NewServer');
	});

	it('applies optimistic data as object in the store (jsonb shape post-T8a)', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			makeResponse(entity({ id: 'e1', name: 'Old', type: 'Character', data: { age: 99 } }))
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const p = entities.updateEntity('e1', { data: { age: 99 } });
		// data is jsonb (object), not a JSON-stringified string
		expect(get(entities)[0].data).toEqual({ age: 99 });
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

	// Codex P2 (PR #59 follow-up): per-entity PATCH serialization. Two full-`data`
	// edits to one entity (e.g. a style save then an adjacent is_asset toggle)
	// must not race on the wire — the second PATCH is chained behind the first so
	// requests reach the API in call order and the DB can't keep the older `data`.
	const tick = () => new Promise((r) => setTimeout(r, 0));

	it('does not send the second data PATCH until the first resolves (in-order)', async () => {
		const bodies: unknown[] = [];
		let resolveFirst!: () => void;
		const firstServer = entity({ id: 'e1', name: 'Old', type: 'Character', data: { style: { color: '#aaa' } } });
		const secondServer = entity({ id: 'e1', name: 'Old', type: 'Character', data: { style: { color: '#aaa' }, is_asset: false } });
		globalThis.fetch = vi.fn((url: string, opts: { body: string }) => {
			if (url.startsWith('/api/entities/')) {
				bodies.push(JSON.parse(opts.body));
				if (bodies.length === 1) {
					return new Promise<Response>((res) => { resolveFirst = () => res(makeResponse(firstServer)); });
				}
				return Promise.resolve(makeResponse(secondServer));
			}
			return Promise.resolve(makeResponse([])); // any load()
		}) as unknown as typeof fetch;

		const first = entities.updateEntity('e1', { data: { style: { color: '#aaa' } } });
		const second = entities.updateEntity('e1', { data: { style: { color: '#aaa' }, is_asset: false } });

		await tick();
		expect(bodies).toHaveLength(1); // second PATCH queued, not yet sent

		resolveFirst();
		await first;
		await second;

		expect(bodies).toHaveLength(2); // second sent only after the first finished
		expect(get(entities)[0].data).toEqual({ style: { color: '#aaa' }, is_asset: false });
	});

	it('a failed earlier PATCH does not block or reload-revert a newer queued edit', async () => {
		const bodies: unknown[] = [];
		let rejectFirst!: () => void;
		const secondServer = entity({ id: 'e1', name: 'Old', type: 'Character', data: { is_asset: false } });
		globalThis.fetch = vi.fn((url: string, opts: { body: string }) => {
			if (url.startsWith('/api/entities/')) {
				bodies.push(JSON.parse(opts.body));
				if (bodies.length === 1) {
					return new Promise<Response>((_res, rej) => { rejectFirst = () => rej(new Error('boom')); });
				}
				return Promise.resolve(makeResponse(secondServer));
			}
			return Promise.resolve(makeResponse([])); // a load() reload, if any
		}) as unknown as typeof fetch;

		const first = entities.updateEntity('e1', { data: { style: { color: '#aaa' } } });
		const second = entities.updateEntity('e1', { data: { is_asset: false } });

		await tick();
		rejectFirst();
		await expect(first).rejects.toThrow();
		await second;

		// The newer edit ran after the failed one drained; its value stands and
		// the failed earlier PATCH did not reload-revert it. Only the 2 PATCHes
		// were issued — no /api/entities reload.
		expect(bodies).toHaveLength(2);
		expect(get(entities)[0].data).toEqual({ is_asset: false });
	});

	it('refreshes intervals for a structural PATCH even when a later edit supersedes it', async () => {
		// Codex P2: an Act reorder followed by a quick rename before the reorder
		// PATCH responds. The reorder recomputed interval bounds server-side, so
		// intervalsStore.load() must still run even though the rename supersedes
		// the row locally — otherwise the timeline stays stale until a reload.
		const seed = [entity({ id: 'a1', name: 'Act', type: 'Act', data: {} })];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await entities.load();

		const intervalsLoad = vi.spyOn(intervalsStore, 'load').mockResolvedValue(undefined);
		const reorderServer = entity({ id: 'a1', name: 'Act', type: 'Act', position: 2, data: {} });
		const renameServer = entity({ id: 'a1', name: 'Renamed', type: 'Act', position: 2, data: {} });
		let resolveReorder!: () => void;
		const responses: Array<Promise<Response>> = [
			new Promise<Response>((res) => { resolveReorder = () => res(makeResponse(reorderServer)); }),
			Promise.resolve(makeResponse(renameServer))
		];
		let i = 0;
		globalThis.fetch = vi.fn((url: string) =>
			url === '/api/entities/a1' ? responses[i++] : Promise.resolve(makeResponse([]))
		) as unknown as typeof fetch;

		// Both calls stamp their seq synchronously, so rename (issued second) is
		// already the "latest" before anything resolves — the reorder is
		// superseded. rename's PATCH is chained behind reorder's, so resolve
		// reorder first, then await both.
		const reorder = entities.updateEntity('a1', { position: 2 });
		const rename = entities.updateEntity('a1', { name: 'Renamed' });
		resolveReorder();
		await reorder; // superseded, but structural → still refreshes intervals
		await rename;

		// The superseded reorder still triggered an interval refresh.
		expect(intervalsLoad).toHaveBeenCalled();
		intervalsLoad.mockRestore();
	});

	it('refreshes relationships after a structural Scene PATCH (so click-to-jump reads fresh positions)', async () => {
		// Codex P2: a scene reorder recomputes scene-anchored caused_by
		// start/end positions server-side. The graph click-to-jump reads
		// $relationships, so the relationships store must reload alongside
		// intervals — otherwise a scoped edge jumps to the stale scene fraction.
		const seed = [entity({ id: 's1', name: 'Scene', type: 'Scene', parentId: 'a1', data: {} })];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await entities.load();

		const intervalsLoad = vi.spyOn(intervalsStore, 'load').mockResolvedValue(undefined);
		const relsLoad = vi.spyOn(relationships, 'load').mockResolvedValue(undefined);
		const server = entity({ id: 's1', name: 'Scene', type: 'Scene', parentId: 'a1', position: 0, data: {} });
		globalThis.fetch = vi.fn((url: string) =>
			url === '/api/entities/s1'
				? Promise.resolve(makeResponse(server))
				: Promise.resolve(makeResponse([]))
		) as unknown as typeof fetch;

		await entities.updateEntity('s1', { position: 0 });

		expect(intervalsLoad).toHaveBeenCalled();
		expect(relsLoad).toHaveBeenCalled();
		intervalsLoad.mockRestore();
		relsLoad.mockRestore();
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
