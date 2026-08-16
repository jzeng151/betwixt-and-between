import { cleanup, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocationEditor from '$lib/components/LocationEditor.svelte';
import { entities } from '$lib/stores/entities.js';
import { worldMaps, worldMapsLoadStatus } from '$lib/features/map/store.js';

function response(body: unknown): Response {
	return { ok: true, json: async () => body, text: async () => '' } as Response;
}

beforeEach(async () => {
	cleanup();
	worldMaps.set([]);
	worldMapsLoadStatus.set('idle');
	globalThis.fetch = vi.fn().mockResolvedValue(response([
		{ id: 'loc-1', type: 'Location', name: 'Harbor', data: {}, parentId: null, position: null }
	])) as unknown as typeof fetch;
	await entities.load();
});

describe('LocationEditor map action', () => {
	it('waits for the authoritative map list before offering creation', async () => {
		let resolveMaps!: (value: Response) => void;
		globalThis.fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
			resolveMaps = resolve;
		})) as unknown as typeof fetch;
		const view = render(LocationEditor, { props: { entityId: 'loc-1', readOnly: true } });

		expect(view.queryByRole('button', { name: /Create a map/ })).not.toBeInTheDocument();
		expect(view.getByRole('status')).toHaveTextContent('Checking for maps');
		resolveMaps(response([{ id: 'map-1', name: 'Harbor map', locationId: 'loc-1' }]));

		await waitFor(() => expect(view.getByRole('button', { name: 'Open map' })).toBeInTheDocument());
	});
});
