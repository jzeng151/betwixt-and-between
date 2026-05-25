<script lang="ts">
	// MapStage — owns the Leaflet map lifecycle (canvas element + L.map(...) +
	// drawControl + zoomControl + imageOverlay) and exposes the live handles
	// via $bindable so sibling layers (RegionLayer, PlacementLayer) can render
	// onto the same map instance. Slice 1b will introduce a parallel
	// PixiStage; both will satisfy the same handle contract.

	import { onMount } from 'svelte';
	import type { WorldMap } from './types.js';
	import { wirePopupHandlers, type PopupCallbacks } from './leaflet-controller.js';

	type LeafletNS = typeof import('leaflet');

	let {
		activeMap,
		hasImage,
		armedPlaceableId,
		accentColor,
		popupCallbacks,
		onPolygonCreated,
		onCanvasClick,
		leafletMap = $bindable(null),
		L = $bindable(null),
		drawnItems = $bindable(null),
		resolveCssColors
	}: {
		activeMap: WorldMap | null;
		hasImage: boolean;
		armedPlaceableId: string | null;
		accentColor: string;
		popupCallbacks: PopupCallbacks;
		onPolygonCreated: (latLngs: number[][]) => void;
		onCanvasClick: (fx: number, fy: number) => void;
		leafletMap: any;
		L: LeafletNS | null;
		drawnItems: any;
		resolveCssColors: () => void;
	} = $props();

	let mapContainer: HTMLDivElement = $state(null!);
	// Internal: tracks "Leaflet finished dynamic-import" so the initMap
	// effect knows when to fire. Parent doesn't need this signal — the
	// `{#if leafletMap && L}` gate around the layers serves the same role.
	let mapReady = $state(false);
	let imageOverlay: any = null;
	let drawControl: any = null;
	let zoomControl: any = null;

	onMount(() => {
		// Rapid renderer-flag toggles (Slice 1b) can unmount MapStage while
		// the leaflet dynamic-import is mid-flight (~4 awaits). Without this
		// cancelled flag, the stale promise resolves AFTER unmount and writes
		// to $bindable props that now belong to a remounted MapStage —
		// poisoning the new instance's L/drawnItems with a half-initialized
		// Leaflet from the old mount, which surfaces later as
		// `_leaflet_pos undefined` when removeLayer touches the orphan.
		let cancelled = false;
		(async () => {
			const leaflet = await import('leaflet');
			await import('leaflet/dist/leaflet.css');
			await import('leaflet-draw');
			await import('leaflet-draw/dist/leaflet.draw.css');
			if (cancelled) return;
			L = leaflet.default;
			drawnItems = new L.FeatureGroup();
			mapReady = true;
			resolveCssColors();
		})();

		return () => {
			cancelled = true;
			if (leafletMap) {
				// stop() aborts in-flight pan/zoom animations + detaches their
				// CSS transitionend handlers. Without it, a rapid renderer-flag
				// toggle during fitBounds()'s zoom animation lets transitionend
				// fire after remove() has nulled _mapPane — surfaces as
				// `_leaflet_pos undefined` from _onZoomTransitionEnd ~250ms post-
				// unmount.
				leafletMap.stop();
				leafletMap.remove();
				leafletMap = null;
			}
		};
	});

	function initMap() {
		if (!L || !mapContainer) return;
		if (leafletMap) leafletMap.remove();

		leafletMap = L.map(mapContainer, {
			crs: L.CRS.Simple,
			minZoom: -2,
			maxZoom: 4,
			zoomControl: false,
			attributionControl: false
		});

		leafletMap.addLayer(drawnItems);

		leafletMap.on(L.Draw.Event.CREATED, (e: any) => {
			const layer = e.layer;
			const latLngs = layer.getLatLngs()[0].map((ll: any) => [ll.lat, ll.lng]);
			onPolygonCreated(latLngs);
		});

		leafletMap.on('popupopen', (e: any) => {
			const popupEl = e.popup.getElement();
			if (!popupEl) return;
			wirePopupHandlers(popupEl, () => leafletMap.closePopup(), popupCallbacks);
		});

		// Step 4 — placement-creation click. When a chip is armed in the
		// PlaceablesPalette, the next map click drops a placement at the
		// clicked location. We translate Leaflet (lat=y, lng=x) into fractional
		// coords against the source-image dimensions so re-export at a new
		// resolution (B11) leaves the placement at the same relative point.
		leafletMap.on('click', (e: any) => {
			if (!armedPlaceableId) return;
			if (!activeMap?.width || !activeMap?.height) return;
			// Skip clicks that landed on an existing interactive layer (region
			// polygon, placement marker, popup): those have their own UX and
			// shouldn't also drop a new placement underneath.
			const target = e.originalEvent?.target as HTMLElement | undefined;
			if (target?.closest?.('.leaflet-interactive, .leaflet-popup, .leaflet-marker-icon')) return;
			const fx = e.latlng.lng / activeMap.width;
			const fy = e.latlng.lat / activeMap.height;
			if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
			onCanvasClick(fx, fy);
		});

		// Set initial view.
		leafletMap.setView([0, 0], 1);
	}

	$effect(() => {
		// Initialize map once Leaflet is loaded and DOM is ready.
		if (mapReady && mapContainer && !leafletMap) {
			initMap();
		}
	});

	$effect(() => {
		// Draw tools only make sense once an image has been imported, so
		// gate them on hasImage. The map-canvas mounts before any image is
		// present (to keep Leaflet initialized across the upload prompt),
		// so we attach/detach the control instead of conditionally rendering.
		if (!leafletMap || !L) return;
		if (hasImage && !drawControl) {
			zoomControl = L.control.zoom();
			leafletMap.addControl(zoomControl);
			drawControl = new L.Control.Draw({
				draw: {
					polygon: {
						allowIntersection: false,
						shapeOptions: { color: accentColor, weight: 2 }
					},
					polyline: false,
					circle: false,
					rectangle: false,
					marker: false,
					circlemarker: false
				},
				// leaflet-draw's runtime accepts `false` here to disable the edit
				// toolbar entirely, but @types/leaflet-draw only allows EditOptions.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				edit: false as any
			});
			leafletMap.addControl(drawControl);
		} else if (!hasImage && drawControl) {
			leafletMap.removeControl(drawControl);
			drawControl = null;
			if (zoomControl) {
				leafletMap.removeControl(zoomControl);
				zoomControl = null;
			}
		}
	});

	$effect(() => {
		// Bitmap image overlay. Driven by activeMap changes.
		if (!leafletMap) return;
		const map = activeMap;
		if (!map) return;

		if (imageOverlay) {
			leafletMap.removeLayer(imageOverlay);
			imageOverlay = null;
		}

		if (map.baseImageUrl && map.width && map.height && L) {
			const bounds = L.latLngBounds([[0, 0], [map.height, map.width]]);
			imageOverlay = L.imageOverlay(map.baseImageUrl, bounds).addTo(leafletMap);
			// When this effect fires from the {#if !hasImage}→{:else} branch
			// swap (first upload), the map-canvas div was just mounted and
			// Leaflet measured the container at 0×0. Force a re-measure so
			// fitBounds has real pixel dimensions to work with.
			leafletMap.invalidateSize();
			// animate:false — the initial bitmap centering doesn't need a zoom
			// animation; skipping it also removes the orphan-transitionend race
			// when the user toggles renderers while fitBounds is mid-flight.
			leafletMap.fitBounds(bounds, { padding: [20, 20], animate: false });
		}
	});
</script>

<div
	class="map-canvas"
	class:armed={armedPlaceableId !== null}
	bind:this={mapContainer}
></div>
