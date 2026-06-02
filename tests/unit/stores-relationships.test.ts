import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { relationships, type Relationship } from '../../src/lib/stores/relationships.js';

function makeResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	} as unknown as Response;
}

function rel(partial: Partial<Relationship> & { id: string }): Relationship {
	return {
		fromId: 'a',
		toId: 'b',
		type: 'other',
		label: null,
		...partial
	} as Relationship;
}

beforeEach(async () => {
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([])) as unknown as typeof fetch;
	return relationships.load();
});

describe('relationships.load', () => {
	it('fetches /api/relationships and replaces store contents', async () => {
		const data = [rel({ id: 'r1' }), rel({ id: 'r2' })];
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(data));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await relationships.load();

		expect(fetchMock).toHaveBeenCalledWith('/api/relationships');
		expect(get(relationships)).toHaveLength(2);
	});

	it('drops a stale load whose response resolves after a newer load (Codex P2)', async () => {
		// Two concurrent structural edits each fire load(). The FIRST request
		// (stale positions) is made to resolve LAST; without the load token its
		// set() would clobber the newer state. Latest-wins must hold.
		const stale = [rel({ id: 'stale', startPosition: 0.1 })];
		const fresh = [rel({ id: 'fresh', startPosition: 0.9 })];

		let releaseStale: (r: Response) => void = () => {};
		const stalePending = new Promise<Response>((resolve) => (releaseStale = resolve));

		globalThis.fetch = vi
			.fn()
			.mockReturnValueOnce(stalePending) // load #1 — hangs
			.mockResolvedValueOnce(makeResponse(fresh)) as unknown as typeof fetch; // load #2 — resolves first

		const p1 = relationships.load(); // seq 1, in flight
		const p2 = relationships.load(); // seq 2, resolves immediately
		await p2;
		expect(get(relationships)).toEqual(fresh);

		// Now let the older request resolve — it must NOT overwrite `fresh`.
		releaseStale(makeResponse(stale));
		await p1;
		expect(get(relationships)).toEqual(fresh);
	});

	it('a local mutation invalidates an in-flight load so it cannot clobber the mutation (Codex P2)', async () => {
		// A structural edit fires load() (in flight). The user then edits a
		// relationship; the PATCH commits to the store. The older load response
		// must NOT restore the pre-edit row.
		const seeded = [rel({ id: 'r1', label: 'old' })];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seeded)) as unknown as typeof fetch;
		await relationships.load();

		let releaseLoad: (r: Response) => void = () => {};
		const loadPending = new Promise<Response>((resolve) => (releaseLoad = resolve));

		globalThis.fetch = vi
			.fn()
			.mockReturnValueOnce(loadPending) // the structural-edit load() — hangs
			.mockResolvedValueOnce(makeResponse(rel({ id: 'r1', label: 'new' }))) as unknown as typeof fetch; // PATCH

		const p = relationships.load(); // in flight, seq captured
		await relationships.updateRelationship('r1', { label: 'new' }); // commits + bumps token
		expect(get(relationships)[0].label).toBe('new');

		// The stale load resolves with the pre-edit row — must be dropped.
		releaseLoad(makeResponse([rel({ id: 'r1', label: 'old' })]));
		await p;
		expect(get(relationships)[0].label).toBe('new');
	});

	it('throws on non-OK response and leaves the store untouched', async () => {
		// Seed the store with known content via a successful load.
		const seeded = [rel({ id: 'seed' })];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seeded)) as unknown as typeof fetch;
		await relationships.load();
		const before = get(relationships);

		// Now simulate a 5xx and assert load() rejects + store unchanged.
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse('upstream boom', false, 503)) as unknown as typeof fetch;
		await expect(relationships.load()).rejects.toThrow(/503.*upstream boom/);
		expect(get(relationships)).toEqual(before);
	});
});

describe('relationships.createRelationship', () => {
	it('POSTs and appends the created relationship', async () => {
		const created = rel({ id: 'new', fromId: 'x', toId: 'y', type: 'other', label: 'in' });
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await relationships.createRelationship('x', 'y', 'other', 'in');

		expect(result.id).toBe('new');
		const call = fetchMock.mock.calls[0];
		expect(call[0]).toBe('/api/relationships');
		expect(call[1].method).toBe('POST');
		const body = JSON.parse(call[1].body as string);
		expect(body).toEqual({ fromId: 'x', toId: 'y', type: 'other', label: 'in' });
		expect(get(relationships)).toHaveLength(1);
	});

	it('defaults label to null when omitted', async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(rel({ id: 'n' })));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await relationships.createRelationship('a', 'b', 'other');

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.label).toBeNull();
	});

	it('throws and does not append when fetch is not ok', async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeResponse('bad', false, 400));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			relationships.createRelationship('a', 'b', 'other')
		).rejects.toThrow(/bad/);
		expect(get(relationships)).toHaveLength(0);
	});
});

describe('relationships.deleteRelationship', () => {
	beforeEach(async () => {
		const seed = [rel({ id: 'r1' }), rel({ id: 'r2' })];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await relationships.load();
	});

	it('optimistically removes the relationship before the server responds', async () => {
		let resolveServer: (v: Response) => void = () => {};
		const serverPromise = new Promise<Response>((resolve) => {
			resolveServer = resolve;
		});
		globalThis.fetch = vi.fn().mockReturnValue(serverPromise) as unknown as typeof fetch;

		const pending = relationships.deleteRelationship('r1');
		expect(get(relationships).map((r) => r.id)).toEqual(['r2']);

		resolveServer(makeResponse({}, true, 204));
		await pending;
		expect(get(relationships).map((r) => r.id)).toEqual(['r2']);
	});

	it('uses the correct URL and DELETE method', async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeResponse({}, true, 204));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await relationships.deleteRelationship('r1');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/relationships/r1',
			expect.objectContaining({ method: 'DELETE' })
		);
	});

	it('reloads on failure and throws', async () => {
		const reloaded = [rel({ id: 'r1' }), rel({ id: 'r2' })];
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(makeResponse('nope', false, 500))
			.mockResolvedValueOnce(makeResponse(reloaded));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(relationships.deleteRelationship('r1')).rejects.toThrow(/nope/);
		expect(get(relationships)).toHaveLength(2);
	});
});
