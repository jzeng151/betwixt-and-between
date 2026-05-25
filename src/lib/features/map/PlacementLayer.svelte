<script lang="ts">
	// Renders Step 4 placement markers onto a live Leaflet map handle. Same
	// shape as RegionLayer: this component owns the diff effect; popup
	// button wiring (open entity, delete placement) lives in MapStage via
	// wirePopupHandlers matching on data-action attributes.

	import type { Entity } from '$lib/stores/entities.js';
	import type { WorldMap } from './types.js';
	import type { MapPlacement } from '$lib/types/map-placement.js';
	import { placementsAtPlayhead } from '$lib/types/map-placement.js';
	import { getEntityTypeColor } from '$lib/entity-type-colors.js';
	import { escapeHtml } from './region-popup.js';

	type LeafletNS = typeof import('leaflet');

	let {
		leafletMap,
		L,
		activeMap,
		playhead,
		placements,
		entities
	}: {
		leafletMap: any;
		L: LeafletNS;
		activeMap: WorldMap | null;
		playhead: number | null;
		placements: MapPlacement[];
		entities: Entity[];
	} = $props();

	let placementMarkers: any[] = [];

	$effect(() => {
		if (!leafletMap || !L) return;
		const map = activeMap;
		const all = placements;

		// Previous markers are torn down by this effect's cleanup return below.

		if (!map?.width || !map?.height) return;

		// Null playhead = pre-scrub state. Show only default (both-null-bounds)
		// placements; t=0 would otherwise leak any time-scoped placement whose
		// range happens to cover position 0.
		const active =
			playhead === null
				? all.filter((p) => p.startPosition === null && p.endPosition === null)
				: placementsAtPlayhead(all, playhead);
		for (const placement of active) {
			const placeable = entities.find((e) => e.id === placement.placeableId);
			if (!placeable) continue;
			const lat = placement.y * map.height;
			const lng = placement.x * map.width;
			const color = getEntityTypeColor(placeable.type);
			const html = `<span class="placement-pin" style="background:${color}"></span>`;
			const icon = L.divIcon({
				className: 'placement-marker',
				html,
				iconSize: [16, 16],
				iconAnchor: [8, 8]
			});
			const marker = L.marker([lat, lng], { icon }).addTo(leafletMap);
			const safeName = escapeHtml(placeable.name);
			const safeType = escapeHtml(placeable.type);
			marker.bindTooltip(`${safeName} (${safeType})`, { direction: 'top' });
			const popupHtml = `
				<div class="placement-popup">
					<div class="placement-popup-name">${safeName}</div>
					<div class="placement-popup-type">${safeType}</div>
					<button data-action="open-entity" data-entity-id="${placeable.id}" type="button">Open ${safeType}</button>
					<button data-action="delete-placement" data-placement-id="${placement.id}" type="button" class="danger">Delete placement</button>
				</div>
			`;
			marker.bindPopup(popupHtml, { closeButton: false, minWidth: 160 });
			placementMarkers.push(marker);
		}

		return () => {
			// See RegionLayer's matching cleanup comment: a renderer-flag flip
			// unmounts MapStage + this layer in the same teardown; MapStage's
			// leafletMap.remove() may run first, leaving removeLayer to throw
			// `_leaflet_pos undefined`. Swallow — the map's destroy already
			// cascade-removed our markers.
			for (const m of placementMarkers) {
				try {
					leafletMap?.removeLayer(m);
				} catch {
					/* map already destroyed by sibling unmount */
				}
			}
			placementMarkers = [];
		};
	});
</script>
