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

async function errorMessage(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const parsed: unknown = JSON.parse(text);
		if (
			parsed &&
			typeof parsed === 'object' &&
			'message' in parsed &&
			typeof (parsed as Record<string, unknown>).message === 'string'
		) {
			return (parsed as { message: string }).message;
		}
	} catch {
		/* fall through */
	}
	return text;
}

function createPlacementsStore() {
	const placements = writable<MapPlacement[]>([]);

	async function load(filters?: {
		locationId?: string;
		placeableId?: string;
		mapId?: string;
	}): Promise<void> {
		const params = new URLSearchParams();
		if (filters?.locationId) params.set('locationId', filters.locationId);
		if (filters?.placeableId) params.set('placeableId', filters.placeableId);
		if (filters?.mapId) params.set('mapId', filters.mapId);
		const qs = params.toString();
		const res = await fetch(`/api/map-placements${qs ? `?${qs}` : ''}`);
		if (!res.ok) throw new Error('Failed to load placements');
		const data: MapPlacement[] = await res.json();
		placements.set(data);
	}

	async function create(payload: CreatePlacementPayload): Promise<MapPlacement> {
		const res = await fetch('/api/map-placements', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const created: MapPlacement = await res.json();
		placements.update((all) => [created, ...all]);
		return created;
	}

	async function update(id: string, payload: UpdatePlacementPayload): Promise<MapPlacement> {
		const res = await fetch(`/api/map-placements/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const updated: MapPlacement = await res.json();
		placements.update((all) => all.map((p) => (p.id === id ? updated : p)));
		return updated;
	}

	async function remove(id: string): Promise<void> {
		const res = await fetch(`/api/map-placements/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(await errorMessage(res));
		placements.update((all) => all.filter((p) => p.id !== id));
	}

	function reset(): void {
		placements.set([]);
	}

	return { subscribe: placements.subscribe, load, create, update, delete: remove, reset };
}

export const mapPlacements = createPlacementsStore();
