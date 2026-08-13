import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoryGraph from '$lib/features/graph/StoryGraph.svelte';
import { entityAliasesLoadStatus, entityAliasesSnapshotReady } from '$lib/stores/entity-aliases.js';
import { worldMaps, worldMapsLoadStatus } from '$lib/features/map/store.js';

function response(body: unknown, ok = true): Response {
	return { ok, status: ok ? 200 : 503, json: async () => body, text: async () => String(body) } as Response;
}

beforeEach(() => {
	cleanup();
	entityAliasesSnapshotReady.set(true);
	entityAliasesLoadStatus.set('ready');
	worldMaps.set([]);
	worldMapsLoadStatus.set('idle');
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

describe('StoryGraph map loading', () => {
	it('offers recovery after a deferred map load fails', async () => {
		let mapLoads = 0;
		globalThis.fetch = vi.fn((input) => {
			if (String(input) === '/api/maps') {
				mapLoads++;
				return Promise.resolve(mapLoads === 1 ? response('offline', false) : response([]));
			}
			return Promise.resolve(response([]));
		}) as unknown as typeof fetch;
		const view = render(StoryGraph);

		const alert = await waitFor(() => view.getByRole('alert'));
		expect(alert).toHaveTextContent("Couldn't load maps");
		await fireEvent.click(view.getByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(get(worldMapsLoadStatus)).toBe('ready'));
		expect(mapLoads).toBe(2);
	});
});
