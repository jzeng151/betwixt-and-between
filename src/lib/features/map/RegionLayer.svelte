<script lang="ts">
	// Renders region polygons onto a live Leaflet map handle. Owns the
	// $effect that diffs against the latest regions snapshot — old layers
	// torn down, new ones added with scope-driven styling and tooltip/popup
	// wiring. The popupopen handler that hooks up edit/delete/drill buttons
	// lives in MapStage; this component only emits the HTML via
	// buildRegionPopup so MapStage's wirePopupHandlers can find the buttons
	// by data-attribute.
	//
	// Slice 1b will replace this with a Pixi.Graphics-backed sibling that
	// consumes the same RenderedState from projection.ts. The Leaflet path
	// here stays the default until end-of-Slice-2.

	import type { Entity } from '$lib/stores/entities.js';
	import type { MapRegion, WorldMap } from './types.js';
	import { buildRegionPopup } from './region-popup.js';
	import { NEUTRAL_REGION_COLOR } from './projection.js';

	type LeafletNS = typeof import('leaflet');

	let {
		leafletMap,
		L,
		regions,
		entities,
		worldMaps,
		activeMap,
		playhead,
		isInScope,
		accentColor,
		borderColor
	}: {
		leafletMap: any;
		L: LeafletNS;
		regions: MapRegion[];
		entities: Entity[];
		worldMaps: WorldMap[];
		activeMap: WorldMap | null;
		playhead: number | null;
		isInScope: (id: string) => boolean;
		accentColor: string;
		borderColor: string;
	} = $props();

	let regionLayers: any[] = [];

	$effect(() => {
		if (!leafletMap || !L) return;

		// Previous layers are torn down by this effect's cleanup return below.
		// No need to re-clear at the top — Svelte runs cleanup before re-run.

		for (const region of regions) {
			const inScope = region.locationId ? isInScope(region.locationId) : false;
			const isActive = inScope;

			const latLngs = region.polygon.map(([lat, lng]) => L.latLng(lat, lng));

			// codex PR review iter 4: post-D1 (T3) the GET /api/maps/[id]
			// response no longer carries `region.color` — the baseline color
			// field was dropped along with the column. Falling back to
			// `borderColor` (the theme's accent border, often a non-gray) was
			// the wrong visual default; substitute the per-user Neutral gray
			// instead so out-of-scope regions still read as neutral on the
			// Leaflet path. (Faction-color resolution remains Pixi-only until
			// the renderer is unified — T13 deletes Leaflet anyway, so a full
			// projection wiring here would be wasted scope.)
			const outOfScopeColor = region.color || NEUTRAL_REGION_COLOR;
			const layer = L.polygon(latLngs, {
				color: isActive ? accentColor : outOfScopeColor,
				weight: isActive ? 2 : 1,
				fillColor: isActive ? accentColor : outOfScopeColor,
				fillOpacity: isActive ? 0.13 : 0.08,
				opacity: isActive ? 1 : 0.3,
				className: isActive ? 'region-active' : 'region-inactive'
			}).addTo(leafletMap);

			const loc = region.locationId
				? entities.find((e) => e.id === region.locationId)
				: null;
			if (loc) layer.bindTooltip(loc.name, { sticky: true });
			layer.bindPopup(
				buildRegionPopup(region, loc?.name ?? null, {
					activeMapLocationId: activeMap?.locationId,
					entities,
					worldMaps,
					playhead
				}),
				{ closeButton: false, minWidth: 140 }
			);

			regionLayers.push(layer);
		}

		return () => {
			// MapStage's onMount cleanup runs leafletMap.remove() during the same
			// teardown as the renderer-flag flip — by the time this $effect cleanup
			// fires, the Leaflet map may already be destroyed (DOM nuked, internal
			// state cleared). Calling removeLayer in that window throws
			// `_leaflet_pos undefined`. Swallow: leafletMap.remove() already
			// cascade-destroyed our layers.
			for (const layer of regionLayers) {
				try {
					leafletMap?.removeLayer(layer);
				} catch {
					/* map already destroyed by sibling unmount */
				}
			}
			regionLayers = [];
		};
	});
</script>
