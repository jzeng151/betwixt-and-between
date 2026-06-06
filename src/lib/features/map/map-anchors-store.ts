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
	// codex P2: monotonic load token. lastLoadedMapId only distinguishes
	// DIFFERENT maps; two same-map loads (resyncAfterWrite fires one per
	// authored-anchor write) could resolve out of order and let an older load
	// overwrite the store with a stale anchor set. Each load captures a token
	// and only commits if it is still the latest.
	let loadToken = 0;

	// Pages through /api/maps/[id]/anchors until next_cursor is null.
	// Projection requires the complete ordered stream so loadAll-on-mount
	// is the correct semantic. The lastLoadedMapId guard remains across
	// every page fetch — if the user switches maps mid-pagination, we
	// abandon the in-progress load (Codex P1 on PR #55).
	async function load(mapId: string): Promise<void> {
		lastLoadedMapId = mapId;
		const token = ++loadToken;
		const stale = () => lastLoadedMapId !== mapId || token !== loadToken;
		const collected: MapAnchor[] = [];
		let cursor: string | null = null;
		do {
			const url = cursor
				? `/api/maps/${mapId}/anchors?after=${encodeURIComponent(cursor)}`
				: `/api/maps/${mapId}/anchors`;
			const res = await fetch(url);
			if (stale()) return;
			if (!res.ok) throw new Error(`Failed to load anchors: ${await errorMessage(res)}`);
			const body = (await res.json()) as { rows: MapAnchor[]; next_cursor: string | null };
			if (stale()) return;
			collected.push(...body.rows);
			cursor = body.next_cursor;
		} while (cursor != null);
		if (stale()) return;
		store.set(collected);
	}

	// Cycle staged-prefetch (Codex PR #72 #505). `prefetch` pages a map's anchors
	// WITHOUT touching the store, so the between-map cycling driver can buffer a
	// target map's full context and apply it all atomically on commit — no
	// half-loaded flash (old-map markers over the new map). No stale guard: the
	// caller (WorldMap's cycle-generation token) owns staleness. `applyPrefetched`
	// installs a buffered set as the canonical state, recording lastLoadedMapId +
	// bumping the load token so any load() still in flight for another map no-ops.
	async function prefetch(mapId: string): Promise<MapAnchor[]> {
		const collected: MapAnchor[] = [];
		let cursor: string | null = null;
		do {
			const url = cursor
				? `/api/maps/${mapId}/anchors?after=${encodeURIComponent(cursor)}`
				: `/api/maps/${mapId}/anchors`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`Failed to load anchors: ${await errorMessage(res)}`);
			const body = (await res.json()) as { rows: MapAnchor[]; next_cursor: string | null };
			collected.push(...body.rows);
			cursor = body.next_cursor;
		} while (cursor != null);
		return collected;
	}
	function applyPrefetched(mapId: string, rows: MapAnchor[]): void {
		lastLoadedMapId = mapId;
		++loadToken;
		store.set(rows);
	}

	// Codex P1 on PR #55 (commit be1f09c): mutation responses must also
	// honor lastLoadedMapId. If the user POSTs against map A, then
	// switches to map B before the response returns, the A response
	// must NOT merge into B's local store. The server-side write still
	// lands (a tx is a tx); only the optimistic local update is gated.
	// When the user returns to A, .load(A) refetches the canonical state.

	// codex P2 (PR #58): authored-anchor writes invalidate synthetic anchors
	// at/after their t_position server-side (invalidateSyntheticAnchorsAtOrAfter
	// in createMapAnchor / updateMapAnchor / deleteMapAnchor), but the mutation
	// response only carries the single written row (or 204 on delete). If the
	// client holds a later synthetic anchor, it stays in the local store and
	// projectState keeps selecting that stale snapshot, hiding the user's anchor
	// change until a full reload. Refetch the canonical set after the optimistic
	// update reconciles. Best-effort — a failed resync only leaves the stale
	// snapshot until the next reload, so swallow rather than fail the mutation.
	function resyncAfterWrite(mapId: string): void {
		void load(mapId).catch((err) => {
			console.error('anchor resync after write failed; projection may be stale until reload', err);
		});
	}

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
		resyncAfterWrite(mapId);
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
		resyncAfterWrite(mapId);
		return updated;
	}

	async function remove(mapId: string, anchorId: string): Promise<void> {
		const res = await fetch(`/api/maps/${mapId}/anchors/${anchorId}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Failed to delete anchor: ${await errorMessage(res)}`);
		if (lastLoadedMapId !== mapId) return;
		store.update((rows) => rows.filter((r) => r.id !== anchorId));
		resyncAfterWrite(mapId);
	}

	// codex P2 (PR #58): evict synthetic anchors the server invalidated as a
	// side effect of an event write (createMapEvent returns their ids). No
	// network call — the rows are already gone server-side; this only keeps
	// the local cache consistent so projectState doesn't pick a stale anchor.
	// Honors lastLoadedMapId like the mutation paths above.
	function dropLocal(mapId: string, anchorIds: string[]): void {
		if (anchorIds.length === 0) return;
		if (lastLoadedMapId !== mapId) return;
		const drop = new Set(anchorIds);
		store.update((rows) => rows.filter((r) => !drop.has(r.id)));
	}

	function reset(): void {
		lastLoadedMapId = null;
		store.set([]);
	}

	return {
		subscribe: store.subscribe,
		load,
		prefetch,
		applyPrefetched,
		create,
		update,
		delete: remove,
		dropLocal,
		reset
	};
}

export const mapAnchorsStore = createMapAnchorsStore();
