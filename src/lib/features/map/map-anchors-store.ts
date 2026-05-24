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
	// Tracks the most recent load() target so out-of-order responses from
	// stale map switches don't clobber the current map's data. Codex P1 on
	// PR #55: a slow load(A) resolving after the user switched to map B
	// would otherwise overwrite B's freshly-loaded rows with A's stale
	// content. Each load() records its target; on response, we no-op the
	// store.set() if the target changed during the await.
	let lastLoadedMapId: string | null = null;

	async function load(mapId: string): Promise<{ truncated: boolean }> {
		lastLoadedMapId = mapId;
		const res = await fetch(`/api/maps/${mapId}/anchors`);
		if (lastLoadedMapId !== mapId) return { truncated: false };
		if (!res.ok) throw new Error(`Failed to load anchors: ${await errorMessage(res)}`);
		const body = (await res.json()) as { rows: MapAnchor[]; truncated: boolean };
		if (lastLoadedMapId !== mapId) return { truncated: false };
		store.set(body.rows);
		if (body.truncated) console.warn('anchors list truncated at server cap');
		// Surface truncated to the caller so projection readiness can stay
		// false when the load returns capped data. Codex P1 on PR #55
		// (commit e32c973): healthy flipped true on partial data,
		// allowing snapshots that dropped ownership state for anchors
		// past the 500-row cap.
		return { truncated: body.truncated };
	}

	// Codex P1 on PR #55 (commit be1f09c): mutation responses must also
	// honor lastLoadedMapId. If the user POSTs against map A, then
	// switches to map B before the response returns, the A response
	// must NOT merge into B's local store. The server-side write still
	// lands (a tx is a tx); only the optimistic local update is gated.
	// When the user returns to A, .load(A) refetches the canonical state.

	async function create(mapId: string, input: AnchorInput): Promise<MapAnchor> {
		const res = await fetch(`/api/maps/${mapId}/anchors`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`Failed to create anchor: ${await errorMessage(res)}`);
		const created = (await res.json()) as MapAnchor;
		if (lastLoadedMapId !== mapId) return created;
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
		if (lastLoadedMapId !== mapId) return updated;
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
		if (lastLoadedMapId !== mapId) return;
		store.update((rows) => rows.filter((r) => r.id !== anchorId));
	}

	function reset(): void {
		lastLoadedMapId = null;
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
