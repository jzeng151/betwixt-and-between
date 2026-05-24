// map_anchors store. Scoped per world_map — load(mapId) replaces the
// current list. Mutations write-through and update locally.

import { writable } from 'svelte/store';
import { errorMessage } from '$lib/util/api-error-message.js';
import type { AnchorState } from './projection.js';

export type MapAnchor = {
	id: string;
	worldMapId: string;
	tPosition: number;
	stateJsonb: AnchorState;
	createdAt: string;
	updatedAt: string;
};

export type AnchorInput = {
	tPosition: number;
	stateJsonb: AnchorState;
};

function createMapAnchorsStore() {
	const store = writable<MapAnchor[]>([]);

	async function load(mapId: string): Promise<void> {
		const res = await fetch(`/api/maps/${mapId}/anchors`);
		if (!res.ok) throw new Error(`Failed to load anchors: ${await errorMessage(res)}`);
		store.set((await res.json()) as MapAnchor[]);
	}

	async function create(mapId: string, input: AnchorInput): Promise<MapAnchor> {
		const res = await fetch(`/api/maps/${mapId}/anchors`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`Failed to create anchor: ${await errorMessage(res)}`);
		const created = (await res.json()) as MapAnchor;
		store.update((rows) =>
			[...rows, created].sort((a, b) => a.tPosition - b.tPosition || a.id.localeCompare(b.id))
		);
		return created;
	}

	async function update(
		mapId: string,
		anchorId: string,
		patch: Partial<AnchorInput>
	): Promise<MapAnchor> {
		const res = await fetch(`/api/maps/${mapId}/anchors/${anchorId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) throw new Error(`Failed to update anchor: ${await errorMessage(res)}`);
		const updated = (await res.json()) as MapAnchor;
		store.update((rows) =>
			rows
				.map((r) => (r.id === anchorId ? updated : r))
				.sort((a, b) => a.tPosition - b.tPosition || a.id.localeCompare(b.id))
		);
		return updated;
	}

	async function remove(mapId: string, anchorId: string): Promise<void> {
		const res = await fetch(`/api/maps/${mapId}/anchors/${anchorId}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Failed to delete anchor: ${await errorMessage(res)}`);
		store.update((rows) => rows.filter((r) => r.id !== anchorId));
	}

	function reset(): void {
		store.set([]);
	}

	return {
		subscribe: store.subscribe,
		load,
		create,
		update,
		delete: remove,
		reset
	};
}

export const mapAnchorsStore = createMapAnchorsStore();
