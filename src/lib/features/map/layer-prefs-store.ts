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

// 'loading' is the window between a map switch and the prefs landing. We
// surface it so the canvas can hide layers instead of flashing everything
// visible (the default) and then snapping to the saved config ~0.25s later.
// 'error' falls back to defaults-visible rather than a permanent blank.
type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

type MapState = {
	mapId: string | null;
	prefs: Map<string, boolean>; // layerKey -> visible
	status: LoadStatus;
};

function createLayerPrefsStore() {
	const state = writable<MapState>({ mapId: null, prefs: new Map(), status: 'idle' });
	let loadToken = 0;

	function reset(): void {
		loadToken += 1;
		state.set({ mapId: null, prefs: new Map(), status: 'idle' });
	}

	async function load(mapId: string): Promise<void> {
		const token = ++loadToken;
		// Flip to 'loading' synchronously (before the await) so the canvas
		// hides layers for the whole round-trip instead of painting the
		// default-visible state first.
		state.set({ mapId: null, prefs: new Map(), status: 'loading' });
		let res: Response;
		try {
			res = await fetch(
				`/api/world-map-layer-prefs?worldMapId=${encodeURIComponent(mapId)}`
			);
		} catch (err) {
			// Network failure — fall back to defaults-visible so the canvas
			// doesn't stay blank forever, then let the caller log.
			if (token === loadToken) {
				state.set({ mapId: null, prefs: new Map(), status: 'error' });
			}
			throw err;
		}
		if (!res.ok) {
			// 404 = map not found / not owned. Don't crash — fall back to
			// defaults-visible (status 'error') rather than a permanent blank.
			if (token === loadToken) {
				state.set({ mapId: null, prefs: new Map(), status: 'error' });
			}
			return;
		}
		const rows = (await res.json()) as RawPref[];
		if (token !== loadToken) return;
		const prefs = new Map<string, boolean>();
		for (const row of rows) {
			prefs.set(row.layerKey, row.visible === 1);
		}
		state.set({ mapId, prefs, status: 'loaded' });
	}

	/** Read the visibility for a layer on the currently-loaded map.
	 * Missing keys default to true (per the schema's column default).
	 * Accepts the static LayerKey enum or a namespaced free-text key
	 * (WM3 Slice B `art:<layerId>` — the DB column is free text and the
	 * reader lazy-GCs unknown keys). */
	function isVisible(layerKey: LayerKey | string): boolean {
		const s = get(state);
		const v = s.prefs.get(layerKey);
		return v === undefined ? true : v;
	}

	async function toggle(mapId: string, layerKey: LayerKey | string): Promise<void> {
		const prior = isVisible(layerKey);
		const next = !prior;
		// Optimistic update so the canvas reflects the toggle before the
		// API round-trip lands.
		state.update((s) => {
			if (s.mapId !== mapId) return s; // map switched mid-flight
			const newPrefs = new Map(s.prefs);
			newPrefs.set(layerKey, next);
			return { ...s, prefs: newPrefs };
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
					return { ...s, prefs: rolled };
				});
			}
			throw err;
		}
	}

	// Cycle staged-prefetch (Codex PR #72 #505). `prefetch` reads a map's prefs
	// WITHOUT touching the store (so the cycling driver can buffer them and apply on
	// commit); like load() it's non-blocking — a network/404 failure yields an empty
	// map (defaults-visible) rather than throwing, so a prefs miss can't fail the
	// whole cycle commit. `applyPrefetched` installs the buffered prefs as the loaded
	// state (bumping the token so an in-flight load() of another map no-ops), avoiding
	// the load()-path flash to an empty 'loading' state during an auto-cycle.
	async function prefetch(mapId: string): Promise<Map<string, boolean>> {
		const prefs = new Map<string, boolean>();
		// Unlike load() (which falls back to defaults-visible to avoid a permanent blank
		// on the ACTIVE map), prefetch must NOT mask a transient failure as authoritative
		// defaults: the cycle commit installs the result as status:'loaded' and skips the
		// normal load(), so a network/500 error would silently turn every saved-hidden
		// layer visible with no retry. A genuine 404 (map has no prefs row) IS a real
		// empty → defaults. So: 404 → empty; any other failure → throw, which fails the
		// cycle bundle (prefetchCycle → cycleFailed → hold + retry next Play) (Codex PR
		// #72 #859).
		const res = await fetch(`/api/world-map-layer-prefs?worldMapId=${encodeURIComponent(mapId)}`);
		if (res.status === 404) return prefs;
		if (!res.ok) throw new Error(`Failed to prefetch layer prefs: ${res.status}`);
		const rows = (await res.json()) as RawPref[];
		for (const row of rows) prefs.set(row.layerKey, row.visible === 1);
		return prefs;
	}
	function applyPrefetched(mapId: string, prefs: Map<string, boolean>): void {
		loadToken += 1;
		state.set({ mapId, prefs, status: 'loaded' });
	}

	const subscribe: Readable<MapState>['subscribe'] = state.subscribe;
	return { subscribe, load, prefetch, applyPrefetched, toggle, reset, isVisible };
}

export const layerPrefs = createLayerPrefsStore();

/** Derived store for a single layer's visibility — components subscribe
 *  to just this to avoid re-rendering on unrelated layer toggles.
 *  Returns true if the layer is visible (including the default-missing
 *  case). */
export function layerVisibility(layerKey: LayerKey): Readable<boolean> {
	return derived(layerPrefs, ($state) => {
		// While the saved prefs are still loading, report NOT visible so the
		// canvas stays blank instead of flashing every layer on and then
		// snapping to the saved config a moment later. 'loaded'/'error'/'idle'
		// fall through to the default-visible behavior.
		if ($state.status === 'loading') return false;
		const v = $state.prefs.get(layerKey);
		return v === undefined ? true : v;
	});
}

// Re-export LAYER_KEYS for convenient iteration in UI components.
export { LAYER_KEYS };
