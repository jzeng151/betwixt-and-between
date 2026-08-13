import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	entityAliases,
	entityAliasesLoadStatus
} from '$lib/stores/entity-aliases.js';

function response(body: unknown, ok = true): Response {
	return { ok, json: async () => body, text: async () => String(body) } as Response;
}

beforeEach(() => {
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
	});

	it('exposes errors for retry UI', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(response('offline', false)) as unknown as typeof fetch;

		await expect(entityAliases.load()).rejects.toThrow('offline');

		expect(get(entityAliasesLoadStatus)).toBe('error');
	});
});
