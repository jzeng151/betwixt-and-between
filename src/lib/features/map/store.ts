import { writable } from 'svelte/store';
import type { WorldMap, MapRegion, CreateRegionPayload, UpdateRegionPayload } from './types.js';
import { errorMessage } from '$lib/util/api-error-message.js';

function createWorldMapStore() {
	const maps = writable<WorldMap[]>([]);
	const regions = writable<MapRegion[]>([]);
	// Codex P1 on PR #55 (commit e32c973): rapid map switches A→B→C
	// could let B's loadMapRegions response arrive AFTER C's started and
	// clobber the regions store with B's data. Mirror the pattern from
	// map-anchors-store / map-events-store: track lastLoadedMapId and
	// drop out-of-order writes. The caller's activeMapId === mapId
	// guard alone isn't enough because this function writes to the
	// shared regions store unconditionally.
	let lastLoadedMapId: string | null = null;

	async function loadMaps(): Promise<void> {
		const res = await fetch('/api/maps');
		if (!res.ok) throw new Error('Failed to load maps');
		const data: WorldMap[] = await res.json();
		maps.set(data);
	}

	async function loadMapRegions(mapId: string): Promise<WorldMap | null> {
		lastLoadedMapId = mapId;
		const res = await fetch(`/api/maps/${mapId}`);
		if (lastLoadedMapId !== mapId) return null; // stale — newer load() in flight
		if (!res.ok) {
			if (res.status === 404) return null;
			throw new Error('Failed to load map');
		}
		const data = await res.json();
		if (lastLoadedMapId !== mapId) return null; // stale — re-check after JSON parse
		const { regions: loadedRegions, ...map } = data;
		regions.set(loadedRegions as MapRegion[]);
		return map as WorldMap;
	}

	async function createMap(
		name: string,
		locationId: string | null = null,
		variantBounds?: {
			startActId?: string | null;
			startSceneId?: string | null;
			endActId?: string | null;
			endSceneId?: string | null;
		}
	): Promise<WorldMap> {
		const res = await fetch('/api/maps', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, locationId, ...(variantBounds ?? {}) })
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const created: WorldMap = await res.json();
		maps.update((all) => [...all, created]);
		return created;
	}

	async function updateMap(
		id: string,
		fields: {
			name?: string;
			baseImageUrl?: string;
			width?: number;
			height?: number;
			locationId?: string | null;
			startActId?: string | null;
			startSceneId?: string | null;
			endActId?: string | null;
			endSceneId?: string | null;
		}
	): Promise<WorldMap> {
		const res = await fetch(`/api/maps/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(fields)
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const updated: WorldMap = await res.json();
		maps.update((all) => all.map((m) => (m.id === id ? updated : m)));
		return updated;
	}

	async function deleteMap(id: string): Promise<void> {
		maps.update((all) => all.filter((m) => m.id !== id));
		const res = await fetch(`/api/maps/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			await loadMaps();
			throw new Error('Failed to delete map');
		}
		regions.update((all) => all.filter((r) => r.mapId !== id));
	}

	async function createRegion(mapId: string, payload: CreateRegionPayload): Promise<MapRegion> {
		const res = await fetch(`/api/maps/${mapId}/regions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const created: MapRegion = await res.json();
		regions.update((all) => [...all, created]);
		return created;
	}

	async function updateRegion(
		mapId: string,
		regionId: string,
		payload: UpdateRegionPayload
	): Promise<MapRegion> {
		const res = await fetch(`/api/maps/${mapId}/regions/${regionId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const updated: MapRegion = await res.json();
		regions.update((all) => all.map((r) => (r.id === regionId ? updated : r)));
		return updated;
	}

	async function deleteRegion(mapId: string, regionId: string): Promise<void> {
		regions.update((all) => all.filter((r) => r.id !== regionId));
		const res = await fetch(`/api/maps/${mapId}/regions/${regionId}`, { method: 'DELETE' });
		if (!res.ok) {
			await loadMapRegions(mapId);
			throw new Error('Failed to delete region');
		}
	}

	async function duplicateMap(mapId: string): Promise<WorldMap> {
		const res = await fetch(`/api/maps/${mapId}/duplicate`, { method: 'POST' });
		if (!res.ok) throw new Error(await errorMessage(res));
		const data = await res.json();
		const { regions: cloneRegions, ...clone } = data;
		maps.update((all) => [...all, clone as WorldMap]);
		// New regions belong to a different mapId, so they won't collide with the
		// currently-loaded set. Append rather than replace — caller switches to
		// the clone via the picker, which triggers loadMapRegions if needed.
		regions.update((all) => [...all, ...(cloneRegions as MapRegion[])]);
		return clone as WorldMap;
	}

	async function uploadImage(mapId: string, file: File): Promise<WorldMap> {
		const formData = new FormData();
		formData.append('file', file);
		const res = await fetch(`/api/maps/${mapId}/upload-image`, {
			method: 'POST',
			body: formData
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const updated: WorldMap = await res.json();
		maps.update((all) => all.map((m) => (m.id === mapId ? updated : m)));
		return updated;
	}

	return {
		maps,
		regions,
		loadMaps,
		loadMapRegions,
		createMap,
		updateMap,
		deleteMap,
		duplicateMap,
		createRegion,
		updateRegion,
		deleteRegion,
		uploadImage
	};
}

export const worldMapStore = createWorldMapStore();
export const worldMaps = worldMapStore.maps;
export const mapRegions = worldMapStore.regions;
