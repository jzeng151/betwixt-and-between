/**
 * Client-side store for /api/map-placements. Mirrors the world-map.ts store
 * shape (writable list + load/create/update/delete + JSON-error surfacing).
 *
 * Per the M3 client-projection design, callers that only need a slice (one
 * Location subtree, or one map) should pass filters to load() so the wire
 * payload stays small at scene-change time.
 */
import { writable } from 'svelte/store';
import type {
	MapPlacement,
	CreatePlacementPayload,
	UpdatePlacementPayload
} from '$lib/types/map-placement.js';
import { errorMessage } from '$lib/util/api-error-message.js';

function createPlacementsStore() {
	const placements = writable<MapPlacement[]>([]);
	// Monotonic load token. WorldMap re-issues load() on every locationId
	// change without cancelling in-flight requests, so a slower earlier
	// response could overwrite a newer one. Drop results whose token no
	// longer matches the latest load(), and treat reset() as a load too so
	// a quick locId → null → locId swap can't be resurrected by a stale fetch.
	let loadToken = 0;
	// Per-placement update sequence. update() applies an optimistic merge then
	// installs the PATCH response; without sequencing, two edits to the same row
	// racing on the wire can land out of order — an earlier PATCH resolving after
	// a later one, or failing after the later one succeeded — and revert the newer
	// edit until reload. Track the newest in-flight seq per id and only apply the
	// server row / revert if our call is still the latest for that id (Codex P2).
	let updateSeq = 0;
	const latestUpdate = new Map<string, number>();

	async function load(filters?: {
		locationId?: string;
		placeableId?: string;
		mapId?: string;
	}): Promise<void> {
		const token = ++loadToken;
		const params = new URLSearchParams();
		if (filters?.locationId) params.set('locationId', filters.locationId);
		if (filters?.placeableId) params.set('placeableId', filters.placeableId);
		if (filters?.mapId) params.set('mapId', filters.mapId);
		const qs = params.toString();
		const res = await fetch(`/api/map-placements${qs ? `?${qs}` : ''}`);
		if (!res.ok) throw new Error('Failed to load placements');
		const data: MapPlacement[] = await res.json();
		if (token !== loadToken) return;
		placements.set(data);
	}

	async function create(payload: CreatePlacementPayload): Promise<MapPlacement> {
		// Capture the context token at request start. If a load() or reset()
		// fires before the POST resolves (user switched map/location), drop
		// the new row instead of merging it into a list it doesn't belong to —
		// the next load() of the original context will pick it up server-side.
		const token = loadToken;
		const res = await fetch('/api/map-placements', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const created: MapPlacement = await res.json();
		if (token === loadToken) {
			placements.update((all) => [created, ...all]);
		}
		return created;
	}

	async function update(id: string, payload: UpdatePlacementPayload): Promise<MapPlacement> {
		// Optimistic merge: apply the payload to the matching row before the
		// PATCH resolves so consumers — and the NEXT edit's merge base — see the
		// change immediately. Without this, rapid multi-field edits from the
		// StyleEditor (e.g. pick a color, then move a slider before the first
		// PATCH returns) re-derived from a stale row and dropped the earlier key
		// (Codex P2). Revert on failure so a rejected PATCH doesn't leave the
		// store ahead of the server.
		const seq = ++updateSeq;
		latestUpdate.set(id, seq);
		let prev: MapPlacement | undefined;
		placements.update((all) =>
			all.map((p) => {
				if (p.id !== id) return p;
				prev = p;
				return { ...p, ...payload } as MapPlacement;
			})
		);
		try {
			const res = await fetch(`/api/map-placements/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) throw new Error(await errorMessage(res));
			const updated: MapPlacement = await res.json();
			// Only install the server row if no newer edit to this row was issued
			// meanwhile — otherwise a slow earlier PATCH would clobber it.
			if (latestUpdate.get(id) === seq) {
				placements.update((all) => all.map((p) => (p.id === id ? updated : p)));
			}
			return updated;
		} catch (err) {
			// Same guard on revert: if a newer edit superseded ours, leave its
			// optimistic value in place rather than reverting to our stale prev.
			if (latestUpdate.get(id) === seq && prev) {
				const restore = prev;
				placements.update((all) => all.map((p) => (p.id === id ? restore : p)));
			}
			throw err;
		} finally {
			if (latestUpdate.get(id) === seq) latestUpdate.delete(id);
		}
	}

	async function remove(id: string): Promise<void> {
		const res = await fetch(`/api/map-placements/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(await errorMessage(res));
		placements.update((all) => all.filter((p) => p.id !== id));
	}

	function reset(): void {
		loadToken++;
		placements.set([]);
	}

	return { subscribe: placements.subscribe, load, create, update, delete: remove, reset };
}

export const mapPlacements = createPlacementsStore();
