<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { worldMapStore, worldMaps, mapRegions } from '$lib/stores/world-map.js';
	import { entities } from '$lib/stores/entities.js';
	import { isInScope } from '$lib/stores/scope.js';
	import { windowStore } from '$lib/stores/windows.js';

	type LeafletNS = typeof import('leaflet');

	let { entityId = $bindable<string | undefined>(undefined) }: { entityId?: string } = $props();

	let mapContainer: HTMLDivElement = $state(null!);
	let leafletMap: any = $state(null);
	let imageOverlay: any = $state(null);
	let regionLayers: any[] = [];
	let drawnItems: any = null;
	let L: LeafletNS = $state(null as any);

	// UI state
	let activeMapId = $state<string | null>(null);
	let showRegionForm = $state(false);
	let pendingPolygon: number[][] | null = $state(null);
	let regionFormLocationId = $state<string | null>(null);
	let regionFormColor = $state('#e8a838');
	let uploadError = $state<string | null>(null);
	let mapReady = $state(false);

	// Computed — $worldMaps / $mapRegions / $entities / $isInScope are Svelte store subscriptions
	let activeMap = $derived($worldMaps.find((m) => m.id === activeMapId) ?? null);
	let locations = $derived($entities.filter((e) => e.type === 'Location'));
	let hasMaps = $derived($worldMaps.length > 0);
	let hasImage = $derived(activeMap?.baseImageUrl != null && activeMap.width != null && activeMap.height != null);

	// Resolve CSS custom properties to actual color values for Leaflet
	let accentColor = '#e8a838';
	let borderColor = '#555';

	function resolveCssColors() {
		const root = document.documentElement;
		const style = getComputedStyle(root);
		accentColor = style.getPropertyValue('--color-accent').trim() || '#e8a838';
		borderColor = style.getPropertyValue('--color-border').trim() || '#555';
	}

	// ── Map lifecycle ──────────────────────────────────────────────────────

	onMount(() => {
		worldMapStore.loadMaps();

		(async () => {
			// Dynamic-import Leaflet (browser-only)
			const leaflet = await import('leaflet');
			await import('leaflet/dist/leaflet.css');
			await import('leaflet-draw');
			await import('leaflet-draw/dist/leaflet.draw.css');
			L = leaflet.default;
			drawnItems = new L.FeatureGroup();
			mapReady = true;
			resolveCssColors();
		})();

		return () => {
			if (leafletMap) {
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
			zoomControl: true,
			attributionControl: false
		});

		leafletMap.addLayer(drawnItems);

		// Draw control
		const drawControl = new L.Control.Draw({
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
			edit: { featureGroup: drawnItems, remove: true }
		});
		leafletMap.addControl(drawControl);

		leafletMap.on(L.Draw.Event.CREATED, (e: any) => {
			const layer = e.layer;
			const latLngs = layer.getLatLngs()[0].map((ll: any) => [ll.lat, ll.lng]);
			pendingPolygon = latLngs;
			showRegionForm = true;
		});

		// Set initial view
		leafletMap.setView([0, 0], 1);
	}

	$effect(() => {
		// Initialize map once Leaflet is loaded and DOM is ready
		if (mapReady && mapContainer && !leafletMap) {
			initMap();
		}
	});

	// ── Render bitmap overlay ──────────────────────────────────────────────

	$effect(() => {
		if (!leafletMap) return;
		const map = activeMap;
		if (!map) return;

		// Remove old overlay
		if (imageOverlay) {
			leafletMap.removeLayer(imageOverlay);
			imageOverlay = null;
		}

		if (map.baseImageUrl && map.width && map.height) {
			const bounds = L.latLngBounds([[0, 0], [map.height, map.width]]);
			imageOverlay = L.imageOverlay(map.baseImageUrl, bounds).addTo(leafletMap);
			leafletMap.fitBounds(bounds, { padding: [20, 20] });
		}
	});

	// ── Render regions with scope glow/dim ─────────────────────────────────

	$effect(() => {
		if (!leafletMap) return;
		const regions = $mapRegions;
		const checkScope = $isInScope;

		// Remove old layers
		for (const layer of regionLayers) {
			leafletMap!.removeLayer(layer);
		}
		regionLayers = [];

		for (const region of regions) {
			const inScope = region.locationId ? checkScope(region.locationId) : false;
			const isActive = inScope;

			const latLngs = region.polygon.map(([lat, lng]) => L.latLng(lat, lng));

			const layer = L.polygon(latLngs, {
				color: isActive ? accentColor : (region.color || borderColor),
				weight: isActive ? 2 : 1,
				fillColor: isActive ? accentColor : (region.color || borderColor),
				fillOpacity: isActive ? 0.13 : 0.08,
				opacity: isActive ? 1 : 0.3,
				className: isActive ? 'region-active' : 'region-inactive'
			}).addTo(leafletMap!);

			// Tooltip with linked location name
			if (region.locationId) {
				const loc = $entities.find((e) => e.id === region.locationId);
				if (loc) layer.bindTooltip(loc.name, { sticky: true });
			}

			// Click to open linked location
			layer.on('click', () => {
				if (region.locationId) {
					windowStore.open('entity-detail', region.locationId);
				}
			});

			regionLayers.push(layer);
		}
	});

	// ── Auto-select map ────────────────────────────────────────────────────

	$effect(() => {
		if ($worldMaps.length > 0 && !activeMapId) {
			switchMap($worldMaps[0].id);
		}
	});

	// If entityId was passed (clicked a Location from elsewhere), auto-select
	$effect(() => {
		if (entityId && $worldMaps.length > 0) {
			const targetRegion = $mapRegions.find((r) => r.locationId === entityId);
			if (targetRegion && targetRegion.mapId !== activeMapId) {
				switchMap(targetRegion.mapId);
			}
		}
	});

	// ── Actions ────────────────────────────────────────────────────────────

	async function switchMap(mapId: string) {
		activeMapId = mapId;
		await worldMapStore.loadMapRegions(mapId);
	}

	async function handleCreateMap() {
		const map = await worldMapStore.createMap('New Map');
		activeMapId = map.id;
		await worldMapStore.loadMapRegions(map.id);
	}

	async function handleDeleteMap() {
		if (!activeMapId) return;
		await worldMapStore.deleteMap(activeMapId);
		activeMapId = $worldMaps.length > 0 ? $worldMaps[0].id : null;
		if (activeMapId) {
			await worldMapStore.loadMapRegions(activeMapId);
		}
	}

	async function handleImageUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !activeMapId) return;

		uploadError = null;
		try {
			await worldMapStore.uploadImage(activeMapId, file);
		} catch (err) {
			uploadError = 'Couldn\'t upload map image. Try again.';
		}
		input.value = '';
	}

	async function handleSaveRegion() {
		if (!activeMapId || !pendingPolygon) return;
		try {
			await worldMapStore.createRegion(activeMapId, {
				locationId: regionFormLocationId,
				polygon: pendingPolygon,
				color: regionFormColor
			});
		} catch (err) {
			// Self-intersecting or other error — the toast can show this
			console.error('Failed to create region:', err);
		}
		showRegionForm = false;
		pendingPolygon = null;
		regionFormLocationId = null;
		regionFormColor = '#e8a838';
		drawnItems.clearLayers();
	}

	function handleCancelRegion() {
		showRegionForm = false;
		pendingPolygon = null;
		drawnItems.clearLayers();
	}

	async function handleRenameMap(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!activeMapId || !input.value.trim()) return;
		await worldMapStore.updateMap(activeMapId, { name: input.value.trim() });
	}

	const PALETTE = ['#e8a838', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#ec4899', '#f97316', '#06b6d4'];
</script>

{#if !hasMaps}
	<!-- Empty state: no maps -->
	<div class="empty-state">
		<p class="empty-title">No maps yet</p>
		<button class="btn-primary" onclick={handleCreateMap}>Create your first map</button>
	</div>
{:else if activeMap && !hasImage}
	<!-- Map exists but no bitmap imported -->
	<div class="map-wrapper">
		<div class="map-toolbar">
			<select class="map-switcher" onchange={(e) => switchMap((e.target as HTMLSelectElement).value)}>
				{#each $worldMaps as m}
					<option value={m.id} selected={m.id === activeMapId}>{m.name}</option>
				{/each}
			</select>
			<input
				class="map-name-input"
				type="text"
				value={activeMap?.name ?? ''}
				onblur={handleRenameMap}
				onkeydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
			/>
			<button class="btn-icon" onclick={handleCreateMap} title="New map">+</button>
			<button class="btn-icon btn-danger" onclick={handleDeleteMap} title="Delete map">×</button>
		</div>
		<div class="upload-area">
			<p>Import a map image to get started</p>
			<label class="btn-primary upload-btn">
				Import image
				<input type="file" accept=".jpg,.jpeg,.png,.webp" onchange={handleImageUpload} hidden />
			</label>
			{#if uploadError}
				<p class="upload-error">{uploadError} <button onclick={() => uploadError = null}>✕</button></p>
			{/if}
		</div>
	</div>
{:else}
	<!-- Active map with bitmap -->
	<div class="map-wrapper">
		<div class="map-toolbar">
			<select class="map-switcher" onchange={(e) => switchMap((e.target as HTMLSelectElement).value)}>
				{#each $worldMaps as m}
					<option value={m.id} selected={m.id === activeMapId}>{m.name}</option>
				{/each}
			</select>
			<input
				class="map-name-input"
				type="text"
				value={activeMap?.name ?? ''}
				onblur={handleRenameMap}
				onkeydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
			/>
			<button class="btn-icon" onclick={handleCreateMap} title="New map">+</button>
			<button class="btn-icon btn-danger" onclick={handleDeleteMap} title="Delete map">×</button>
			<label class="btn-icon" title="Replace image">
				📁
				<input type="file" accept=".jpg,.jpeg,.png,.webp" onchange={handleImageUpload} hidden />
			</label>
		</div>
		<div class="map-canvas" bind:this={mapContainer}></div>
		{#if $mapRegions.length === 0 && !showRegionForm}
			<div class="hint-overlay">Use the draw tool to create regions linked to locations.</div>
		{/if}
	</div>
{/if}

{#if showRegionForm}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal-content">
			<h3>New Region</h3>

			<label>
				Linked Location
				<select bind:value={regionFormLocationId}>
					<option value={null}>None (unlinked)</option>
					{#each locations as loc}
						<option value={loc.id}>{loc.name}</option>
					{/each}
				</select>
			</label>

			<label>
				Color
				<div class="color-palette">
					{#each PALETTE as c}
						<button
							class="color-swatch"
							class:active={regionFormColor === c}
							aria-label="Color {c}"
							style="background: {c}"
							onclick={() => regionFormColor = c}
						></button>
					{/each}
				</div>
			</label>

			<div class="modal-actions">
				<button class="btn-secondary" onclick={handleCancelRegion}>Cancel</button>
				<button class="btn-primary" onclick={handleSaveRegion}>Save Region</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.map-wrapper {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.map-toolbar {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 1000;
		display: flex;
		gap: 4px;
		align-items: center;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 4px 8px;
	}

	.map-switcher {
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 2px 6px;
		font-size: 13px;
	}

	.map-name-input {
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 13px;
		width: 120px;
		outline: none;
		border-bottom: 1px solid transparent;
	}
	.map-name-input:focus {
		border-bottom-color: var(--color-accent);
	}

	.map-canvas {
		flex: 1;
		width: 100%;
		min-height: 0;
	}

	.btn-icon {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: 4px;
		width: 24px;
		height: 24px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		padding: 0;
	}
	.btn-icon:hover { background: var(--color-border); }
	.btn-danger:hover { background: #c0392b; color: #fff; }

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 16px;
	}

	.empty-title {
		font-size: 18px;
		color: var(--color-text-muted);
		margin: 0;
	}

	.upload-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}

	.upload-btn {
		cursor: pointer;
		display: inline-block;
	}

	.upload-error {
		color: #e74c3c;
		font-size: 13px;
	}
	.upload-error button {
		background: none;
		border: none;
		color: #e74c3c;
		cursor: pointer;
		font-size: 14px;
	}

	.btn-primary {
		background: var(--color-accent);
		color: #000;
		border: none;
		border-radius: 6px;
		padding: 8px 16px;
		font-size: 14px;
		cursor: pointer;
	}
	.btn-primary:hover { filter: brightness(1.1); }

	.btn-secondary {
		background: transparent;
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 8px 16px;
		font-size: 14px;
		cursor: pointer;
	}

	.hint-overlay {
		position: absolute;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1000;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 6px 12px;
		font-size: 13px;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 2000;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 20px;
		min-width: 300px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.modal-content h3 {
		margin: 0;
	}

	.modal-content label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.modal-content select {
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 14px;
	}

	.color-palette {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.color-swatch {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
	}
	.color-swatch.active {
		border-color: var(--color-text);
	}

	.modal-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: 4px;
	}

	/* Scope transition on Leaflet SVG paths */
	:global(.region-active),
	:global(.region-inactive) {
		transition: opacity 200ms ease-in-out;
	}
</style>
