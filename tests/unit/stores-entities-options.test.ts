import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { entities, type Entity } from '../../src/lib/stores/entities.js';

// =============================================================================
// Tests for the D19 / Issue 13A extension to the entities store:
//   createEntity(type, name, options?) where options accepts {data, parentId, position}
//   updateEntity(id, patch) where patch accepts parentId and position
//   createEntities(items) plural batch helper hitting /api/entities/batch
//
// These tests target signatures that aren't shipped yet — they will fail until
// the implementation lands. Style mirrors `stores-entities.test.ts`.
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
		parentId: null,
		position: null,
		createdAt: 0,
		updatedAt: 0,
		...partial
	} as Entity;
}

beforeEach(() => {
	const fetchMock = vi.fn().mockResolvedValue(makeResponse([]));
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return entities.load();
});

// =============================================================================
// createEntity options form
// =============================================================================

describe('entities.createEntity (D19 — options form)', () => {
	it('createEntity(type, name, {data, parentId, position}) sends all fields in POST body', async () => {
		const created = entity({
			id: 'sc1',
			name: 'Opening',
			type: 'Scene',
			parentId: 'act-1',
			position: 0
		});
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await entities.createEntity('Scene', 'Opening', {
			data: { synopsis: 'pilot' },
			parentId: 'act-1',
			position: 0
		});

		expect(result.id).toBe('sc1');
		const call = fetchMock.mock.calls[0];
		expect(call[0]).toBe('/api/entities');
		expect(call[1].method).toBe('POST');
		const body = JSON.parse(call[1].body as string);
		expect(body.type).toBe('Scene');
		expect(body.name).toBe('Opening');
		expect(body.data).toEqual({ synopsis: 'pilot' });
		expect(body.parentId).toBe('act-1');
		expect(body.position).toBe(0);
	});

	it('createEntity with only parentId/position (no data) still serializes those fields', async () => {
		const created = entity({ id: 'sc2', name: 'Midpoint', type: 'Scene' });
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await entities.createEntity('Scene', 'Midpoint', { parentId: 'act-1', position: 1 });

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.parentId).toBe('act-1');
		expect(body.position).toBe(1);
	});

	it('createEntity with position=0 explicitly serializes 0 (not undefined)', async () => {
		const created = entity({ id: 'a0', name: 'A', type: 'Act' });
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await entities.createEntity('Act', 'A', { position: 0 });

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.position).toBe(0);
	});

	it('backward-compat: 2-arg createEntity(type, name) still works', async () => {
		const created = entity({ id: 'c1', name: 'Ellie', type: 'Character' });
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await entities.createEntity('Character', 'Ellie');
		expect(result.id).toBe('c1');
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.type).toBe('Character');
		expect(body.name).toBe('Ellie');
	});

	it('appends the created entity to the store on success', async () => {
		const created = entity({ id: 'sc3', name: 'X', type: 'Scene' });
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(created)) as unknown as typeof fetch;

		await entities.createEntity('Scene', 'X', { parentId: 'act-1', position: 2 });
		expect(get(entities).map((e) => e.id)).toContain('sc3');
	});

	it('throws and does not append on !res.ok', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse('bad', false, 400)) as unknown as typeof fetch;

		await expect(
			entities.createEntity('Scene', 'X', { parentId: 'act-1', position: 0 })
		).rejects.toThrow(/bad/);
		expect(get(entities)).toHaveLength(0);
	});
});

// =============================================================================
// updateEntity with parentId / position
// =============================================================================

describe('entities.updateEntity (D19 — parentId + position)', () => {
	beforeEach(async () => {
		const seed = [
			entity({ id: 'a1', name: 'Act A', type: 'Act', position: 0 }),
			entity({ id: 'a2', name: 'Act B', type: 'Act', position: 1 }),
			entity({ id: 'a3', name: 'Act C', type: 'Act', position: 2 })
		];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await entities.load();
	});

	it('updateEntity(id, {position}) PATCHes with position field', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				makeResponse(entity({ id: 'a3', name: 'Act C', type: 'Act', position: 0 }))
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await entities.updateEntity('a3', { position: 0 });

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/entities/a3',
			expect.objectContaining({ method: 'PATCH' })
		);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body).toEqual({ position: 0 });
	});

	it('updateEntity(id, {parentId}) PATCHes with parentId field', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				makeResponse(
					entity({ id: 'sc1', name: 'X', type: 'Scene', parentId: 'a2', position: 0 })
				)
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await entities.updateEntity('sc1', { parentId: 'a2' });

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body).toEqual({ parentId: 'a2' });
	});

	it('updateEntity optimistically applies position to the store', async () => {
		let resolveServer: (v: Response) => void = () => {};
		const serverPromise = new Promise<Response>((r) => {
			resolveServer = r;
		});
		globalThis.fetch = vi.fn().mockReturnValue(serverPromise) as unknown as typeof fetch;

		const pending = entities.updateEntity('a3', { position: 0 });
		expect(get(entities).find((e) => e.id === 'a3')!.position).toBe(0);

		resolveServer(
			makeResponse(entity({ id: 'a3', name: 'Act C', type: 'Act', position: 0 }))
		);
		await pending;
	});

	it('rolls back via load() when PATCH with position fails', async () => {
		const reloaded = [entity({ id: 'a3', name: 'Act C', type: 'Act', position: 2 })];
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(makeResponse('boom', false, 500))
			.mockResolvedValueOnce(makeResponse(reloaded));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(entities.updateEntity('a3', { position: 0 })).rejects.toThrow(/boom/);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toBe('/api/entities');
		expect(get(entities).find((e) => e.id === 'a3')!.position).toBe(2);
	});
});

// =============================================================================
// createEntities (batch)
// =============================================================================

describe('entities.createEntities (D21 — batch)', () => {
	it('POSTs to /api/entities/batch with the entities array', async () => {
		const created = [
			entity({ id: 's1', name: 'S1', type: 'Scene', parentId: 'a1', position: 0 }),
			entity({ id: 's2', name: 'S2', type: 'Scene', parentId: 'a1', position: 1 })
		];
		const fetchMock = vi.fn().mockResolvedValue(makeResponse(created));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const items = [
			{ type: 'Scene' as const, name: 'S1', parentId: 'a1', position: 0 },
			{ type: 'Scene' as const, name: 'S2', parentId: 'a1', position: 1 }
		];
		const result = await entities.createEntities(items);

		expect(result).toHaveLength(2);
		const call = fetchMock.mock.calls[0];
		expect(call[0]).toBe('/api/entities/batch');
		expect(call[1].method).toBe('POST');
		const body = JSON.parse(call[1].body as string);
		expect(body.entities).toHaveLength(2);
		expect(body.entities[0].name).toBe('S1');
	});

	it('appends all created entities to the store', async () => {
		const created = [
			entity({ id: 's1', name: 'S1', type: 'Scene' }),
			entity({ id: 's2', name: 'S2', type: 'Scene' })
		];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(created)) as unknown as typeof fetch;

		await entities.createEntities([
			{ type: 'Scene', name: 'S1', parentId: 'a1', position: 0 },
			{ type: 'Scene', name: 'S2', parentId: 'a1', position: 1 }
		]);

		const ids = get(entities).map((e) => e.id);
		expect(ids).toContain('s1');
		expect(ids).toContain('s2');
	});

	it('throws on !res.ok and does not partial-append', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse('partial-fail', false, 500)) as unknown as typeof fetch;

		await expect(
			entities.createEntities([
				{ type: 'Scene', name: 'S1', parentId: 'a1', position: 0 }
			])
		).rejects.toThrow(/partial-fail/);
		expect(get(entities)).toHaveLength(0);
	});
});
