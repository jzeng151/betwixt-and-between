import { writable } from 'svelte/store';
import type { WorldMap, MapRegion, CreateRegionPayload, UpdateRegionPayload } from './types.js';
import type { MapArtLayer } from './projection.js';
import { errorMessage } from '$lib/util/api-error-message.js';

export const worldMapsLoadStatus = writable<'idle' | 'loading' | 'ready' | 'error'>('idle');

// Result of loadMapRegions. `superseded` is distinct from `not-found` so the
// caller does NOT flip its region-readiness gate on a stale A→B→A load that
// resolved after a newer load became authoritative (Codex PR #72): only a
// `loaded` result is healthy; `not-found` settles the overlay but stays
// unhealthy; `superseded` is a no-op (the newer load owns the gate).
export type LoadRegionsResult =
	| { status: 'loaded'; map: WorldMap }
	| { status: 'not-found' }
	| { status: 'superseded' };

function createWorldMapStore() {
	const maps = writable<WorldMap[]>([]);
	// SINGLE-ACTIVE-WINDOW assumption: `regions` is a singleton holding exactly ONE
	// map's regions at a time — every load/apply does `regions.set(...)`, replacing
	// the whole list, and each WorldMap instance filters it by its own activeMapId.
	// This is correct only because the app surfaces ONE map view at a time. If two
	// World Map windows are ever mounted at once, a load/commit in one would blank the
	// other's regions (it would filter the shared store to an absent map). Known
	// follow-up (Codex PR #72 #449): multi-window support needs window-local region
	// state (a per-instance store, or keying this by mapId). Confirmed 2026-06-06 that
	// multi-window maps are NOT reachable today, so this is deferred, not a live bug.
	const regions = writable<MapRegion[]>([]);
	// Codex P1 on PR #55 (commit e32c973): rapid map switches A→B→C
	// could let B's loadMapRegions response arrive AFTER C's started and
	// clobber the regions store with B's data. Mirror the pattern from
	// map-anchors-store / map-events-store: drop out-of-order writes. The
	// caller's activeMapId === mapId guard alone isn't enough because this
	// function writes to the shared regions store unconditionally.
	//
	// Slice 8 PR2 review (Codex): a map-id-only guard has an A→B→A ABA hole —
	// after load(A-old) → applyPrefetched(B) → applyPrefetched(A), the stale
	// load(A-old) response would match "A" again and clobber the newer commit.
	// Use a monotonic generation token instead (same pattern as the relationships
	// store): every commit — load OR cached apply — bumps it, so any older
	// in-flight load is dropped regardless of which map it was for.
	let loadSeq = 0;
	let mapListLoadPromise: Promise<void> | null = null;
	let mapListGeneration = 0;

	function commitMapMutation() {
		mapListGeneration++;
		mapListLoadPromise = null;
		worldMapsLoadStatus.set('ready');
	}

	function loadMaps(): Promise<void> {
		if (mapListLoadPromise) return mapListLoadPromise;
		const generation = ++mapListGeneration;
		worldMapsLoadStatus.set('loading');
		const request = (async () => {
			const res = await fetch('/api/maps');
			if (!res.ok) throw new Error('Failed to load maps');
			const data: WorldMap[] = await res.json();
			if (generation !== mapListGeneration) return;
			maps.set(data);
			worldMapsLoadStatus.set('ready');
		})().catch((error) => {
			if (generation === mapListGeneration) worldMapsLoadStatus.set('error');
			throw error;
		});
		mapListLoadPromise = request;
		return request.finally(() => {
			if (mapListLoadPromise === request) mapListLoadPromise = null;
		});
	}

	async function loadMapRegions(mapId: string): Promise<LoadRegionsResult> {
		const seq = ++loadSeq;
		const res = await fetch(`/api/maps/${mapId}`);
		if (seq !== loadSeq) return { status: 'superseded' }; // a newer load/commit superseded this
		if (!res.ok) {
			if (res.status === 404) return { status: 'not-found' };
			throw new Error('Failed to load map');
		}
		const data = await res.json();
		if (seq !== loadSeq) return { status: 'superseded' }; // re-check after JSON parse
		const { regions: loadedRegions, ...map } = data;
		regions.set(loadedRegions as MapRegion[]);
		return { status: 'loaded', map: map as WorldMap };
	}

	// Cinematic Spotlight (Slice 8) PR2 — between-map cycling, switch-only-when-
	// ready. Fetch a candidate map's regions WITHOUT touching the shared regions
	// store, so the cycling resolver can cache them and commit a switch only once
	// the data is in hand (no loading flash mid-playback). Returns null on 404.
	async function prefetchMapRegions(
		mapId: string
	): Promise<{ map: WorldMap; regions: MapRegion[] } | null> {
		const res = await fetch(`/api/maps/${mapId}`);
		if (!res.ok) {
			if (res.status === 404) return null;
			throw new Error('Failed to prefetch map');
		}
		const data = await res.json();
		const { regions: loadedRegions, ...map } = data;
		return { map: map as WorldMap, regions: loadedRegions as MapRegion[] };
	}

	// Commit regions already fetched by prefetchMapRegions. Bumps the generation
	// token so any in-flight loadMapRegions (for any map) is dropped as stale,
	// keeping the ordering guarantee intact across a cached commit. mapId is
	// retained for call-site clarity; the guard is generation-based, not map-based.
	function applyPrefetchedRegions(_mapId: string, loadedRegions: MapRegion[]): void {
		++loadSeq;
		regions.set(loadedRegions);
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
		commitMapMutation();
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
			artLayersJsonb?: MapArtLayer[];
		}
	): Promise<WorldMap> {
		const res = await fetch(`/api/maps/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(fields)
		});
		if (!res.ok) throw new Error(await errorMessage(res));
		const updated: WorldMap = await res.json();
		commitMapMutation();
		// codex P2: write back ONLY the fields THIS PATCH changed, taken from the
		// authoritative response; keep every other field from the current store
		// row. A concurrent PATCH (e.g. a toolbar rename) returns a full row whose
		// untouched fields (artLayersJsonb) may be a snapshot from before a just-
		// saved art-layer edit; a wholesale row replace would revert that edit in
		// the client until reload even though the DB is correct. (Within-field art
		// PATCHes are already serialized by MapSidebar's artBusy/artPending queue.)
		const changed = Object.keys(fields) as (keyof typeof fields)[];
		maps.update((all) =>
			all.map((m) => {
				if (m.id !== id) return m;
				const merged = { ...m };
				for (const k of changed) {
					(merged as Record<string, unknown>)[k] = (updated as Record<string, unknown>)[k];
				}
				return merged;
			})
		);
		return updated;
	}

	async function deleteMap(id: string): Promise<void> {
		maps.update((all) => all.filter((m) => m.id !== id));
		const res = await fetch(`/api/maps/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			await loadMaps();
			throw new Error('Failed to delete map');
		}
		commitMapMutation();
		maps.update((all) => all.filter((m) => m.id !== id));
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
		commitMapMutation();
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
		commitMapMutation();
		maps.update((all) => all.map((m) => (m.id === mapId ? updated : m)));
		return updated;
	}

	return {
		maps,
		regions,
		loadMaps,
		loadMapRegions,
		prefetchMapRegions,
		applyPrefetchedRegions,
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
