import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	entityAliases,
	entityAliasesLoadStatus,
	entityAliasesSnapshotReady
} from '$lib/stores/entity-aliases.js';

function response(body: unknown, ok = true): Response {
	return { ok, json: async () => body, text: async () => String(body) } as Response;
}

beforeEach(() => {
	entityAliasesSnapshotReady.set(false);
	entityAliasesLoadStatus.set('idle');
	globalThis.fetch = vi.fn().mockResolvedValue(response([])) as unknown as typeof fetch;
});

describe('entityAliases load state', () => {
	it('deduplicates loads and exposes ready state', async () => {
		let resolveLoad!: (value: Response) => void;
		const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
			resolveLoad = resolve;
		}));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const first = entityAliases.load();
		const second = entityAliases.load();
		resolveLoad(response([{ id: 'a', primaryEntityId: 'p', aliasEntityId: 'x', revealedAtPosition: null }]));
		await Promise.all([first, second]);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(get(entityAliases)).toHaveLength(1);
		expect(get(entityAliasesLoadStatus)).toBe('ready');
		expect(get(entityAliasesSnapshotReady)).toBe(true);
	});

	it('exposes errors for retry UI', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(response('offline', false)) as unknown as typeof fetch;

		await expect(entityAliases.load()).rejects.toThrow('offline');

		expect(get(entityAliasesLoadStatus)).toBe('error');
	});

	it('ignores a stale load after creating an alias', async () => {
		let resolveLoad!: (value: Response) => void;
		const created = { id: 'new', primaryEntityId: 'p', aliasEntityId: 'x', revealedAtPosition: null };
		globalThis.fetch = vi.fn((_url, options) => options?.method === 'POST'
			? Promise.resolve(response(created))
			: new Promise<Response>((resolve) => { resolveLoad = resolve; })
		) as unknown as typeof fetch;

		const load = entityAliases.load();
		await entityAliases.createAlias('p', 'x');
		resolveLoad(response([]));
		await load;

		expect(get(entityAliases)).toContainEqual(created);
		expect(get(entityAliasesLoadStatus)).toBe('ready');
	});

	it('upserts an alias already returned by an overlapping refresh', async () => {
		const created = { id: 'overlap', primaryEntityId: 'p', aliasEntityId: 'x', revealedAtPosition: null };
		let resolveLoad!: (value: Response) => void;
		let resolveCreate!: (value: Response) => void;
		globalThis.fetch = vi.fn((_url, options) => options?.method === 'POST'
			? new Promise<Response>((resolve) => { resolveCreate = resolve; })
			: new Promise<Response>((resolve) => { resolveLoad = resolve; })
		) as unknown as typeof fetch;

		const load = entityAliases.load();
		const creation = entityAliases.createAlias('p', 'x');
		resolveLoad(response([created]));
		await load;
		resolveCreate(response(created));
		await creation;

		expect(get(entityAliases).filter((alias) => alias.id === created.id)).toHaveLength(1);
	});
});
