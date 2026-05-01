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
		type: 'appears_in',
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
});

describe('relationships.createRelationship', () => {
	it('POSTs and appends the created relationship', async () => {
		const created = rel({ id: 'new', fromId: 'x', toId: 'y', type: 'appears_in', label: 'in' });
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await relationships.createRelationship('x', 'y', 'appears_in', 'in');

		expect(result.id).toBe('new');
		const call = fetchMock.mock.calls[0];
		expect(call[0]).toBe('/api/relationships');
		expect(call[1].method).toBe('POST');
		const body = JSON.parse(call[1].body as string);
		expect(body).toEqual({ fromId: 'x', toId: 'y', type: 'appears_in', label: 'in' });
		expect(get(relationships)).toHaveLength(1);
	});

	it('defaults label to null when omitted', async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(rel({ id: 'n' })));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await relationships.createRelationship('a', 'b', 'appears_in');

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.label).toBeNull();
	});

	it('throws and does not append when fetch is not ok', async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeResponse('bad', false, 400));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			relationships.createRelationship('a', 'b', 'appears_in')
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
