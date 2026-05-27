// Slice 3 E2 — layer visibility client store.
//
// Holds per-map layer visibility prefs as a Map<LayerKey, boolean>.
// Default for missing keys is TRUE (every layer visible until the
// user toggles it off). load(mapId) reads world_map_layer_prefs
// rows from the API; toggle(mapId, layerKey) optimistically updates
// the store and PATCHes the row.
//
// On API failure the optimistic write rolls back. Per the Slice 2
// store pattern, a monotonic token guards against stale responses
// from a previous map load racing in after a switch.

import { derived, get, writable, type Readable } from 'svelte/store';
import { LAYER_KEYS, type LayerKey } from './layers.js';

type RawPref = {
	userId: string;
	worldMapId: string;
	layerKey: string;
	visible: number;
};

type MapState = {
	mapId: string | null;
	prefs: Map<string, boolean>; // layerKey -> visible
};

function createLayerPrefsStore() {
	const state = writable<MapState>({ mapId: null, prefs: new Map() });
	let loadToken = 0;

	function reset(): void {
		loadToken += 1;
		state.set({ mapId: null, prefs: new Map() });
	}

	async function load(mapId: string): Promise<void> {
		const token = ++loadToken;
		const res = await fetch(
			`/api/world-map-layer-prefs?worldMapId=${encodeURIComponent(mapId)}`
		);
		if (!res.ok) {
			// 404 = map not found / not owned. Don't crash — clear the
			// store so callers can render the defaults.
			if (token === loadToken) {
				state.set({ mapId: null, prefs: new Map() });
			}
			return;
		}
		const rows = (await res.json()) as RawPref[];
		if (token !== loadToken) return;
		const prefs = new Map<string, boolean>();
		for (const row of rows) {
			prefs.set(row.layerKey, row.visible === 1);
		}
		state.set({ mapId, prefs });
	}

	/** Read the visibility for a layer on the currently-loaded map.
	 * Missing keys default to true (per the schema's column default). */
	function isVisible(layerKey: LayerKey): boolean {
		const s = get(state);
		const v = s.prefs.get(layerKey);
		return v === undefined ? true : v;
	}

	async function toggle(mapId: string, layerKey: LayerKey): Promise<void> {
		const prior = isVisible(layerKey);
		const next = !prior;
		// Optimistic update so the canvas reflects the toggle before the
		// API round-trip lands.
		state.update((s) => {
			if (s.mapId !== mapId) return s; // map switched mid-flight
			const newPrefs = new Map(s.prefs);
			newPrefs.set(layerKey, next);
			return { mapId: s.mapId, prefs: newPrefs };
		});
		const token = loadToken;
		try {
			const res = await fetch('/api/world-map-layer-prefs', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					worldMapId: mapId,
					layerKey,
					visible: next ? 1 : 0
				})
			});
			if (!res.ok) throw new Error(`PATCH layer-prefs failed: ${res.status}`);
		} catch (err) {
			// Rollback on failure — but only if the map hasn't switched.
			if (token === loadToken) {
				state.update((s) => {
					if (s.mapId !== mapId) return s;
					const rolled = new Map(s.prefs);
					rolled.set(layerKey, prior);
					return { mapId: s.mapId, prefs: rolled };
				});
			}
			throw err;
		}
	}

	const subscribe: Readable<MapState>['subscribe'] = state.subscribe;
	return { subscribe, load, toggle, reset, isVisible };
}

export const layerPrefs = createLayerPrefsStore();

/** Derived store for a single layer's visibility — components subscribe
 *  to just this to avoid re-rendering on unrelated layer toggles.
 *  Returns true if the layer is visible (including the default-missing
 *  case). */
export function layerVisibility(layerKey: LayerKey): Readable<boolean> {
	return derived(layerPrefs, ($state) => {
		const v = $state.prefs.get(layerKey);
		return v === undefined ? true : v;
	});
}

// Re-export LAYER_KEYS for convenient iteration in UI components.
export { LAYER_KEYS };
