import { writable } from 'svelte/store';
import type { WorldMap, MapRegion, CreateRegionPayload, UpdateRegionPayload } from '$lib/types/world-map.js';

function createWorldMapStore() {
	const maps = writable<WorldMap[]>([]);
	const regions = writable<MapRegion[]>([]);

	async function loadMaps(): Promise<void> {
		const res = await fetch('/api/maps');
		if (!res.ok) throw new Error('Failed to load maps');
		const data: WorldMap[] = await res.json();
		maps.set(data);
	}

	async function loadMapRegions(mapId: string): Promise<WorldMap | null> {
		const res = await fetch(`/api/maps/${mapId}`);
		if (!res.ok) {
			if (res.status === 404) return null;
			throw new Error('Failed to load map');
		}
		const data = await res.json();
		const { regions: loadedRegions, ...map } = data;
		regions.set(loadedRegions as MapRegion[]);
		return map as WorldMap;
	}

	async function createMap(name: string): Promise<WorldMap> {
		const res = await fetch('/api/maps', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		if (!res.ok) throw new Error(await res.text());
		const created: WorldMap = await res.json();
		maps.update((all) => [...all, created]);
		return created;
	}

	async function updateMap(
		id: string,
		fields: { name?: string; baseImageUrl?: string; width?: number; height?: number }
	): Promise<WorldMap> {
		const res = await fetch(`/api/maps/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(fields)
		});
		if (!res.ok) throw new Error(await res.text());
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
		if (!res.ok) throw new Error(await res.text());
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
		if (!res.ok) throw new Error(await res.text());
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

	async function uploadImage(mapId: string, file: File): Promise<WorldMap> {
		const formData = new FormData();
		formData.append('file', file);
		const res = await fetch(`/api/maps/${mapId}/upload-image`, {
			method: 'POST',
			body: formData
		});
		if (!res.ok) throw new Error(await res.text());
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
		createRegion,
		updateRegion,
		deleteRegion,
		uploadImage
	};
}

export const worldMapStore = createWorldMapStore();
export const worldMaps = worldMapStore.maps;
export const mapRegions = worldMapStore.regions;
