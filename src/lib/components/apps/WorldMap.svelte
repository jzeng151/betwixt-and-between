<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { worldMapStore, worldMaps, mapRegions } from '$lib/stores/world-map.js';
	import { entities } from '$lib/stores/entities.js';
	import { isInScope } from '$lib/stores/scope.js';
	import { intervals as intervalsStore } from '$lib/stores/intervals.js';
	import { windowStore } from '$lib/stores/windows.js';
	import DeleteConfirmDialog, { type DeleteImpact } from '$lib/components/DeleteConfirmDialog.svelte';

	type LeafletNS = typeof import('leaflet');

	let { entityId = $bindable<string | undefined>(undefined) }: { entityId?: string } = $props();

	let mapContainer: HTMLDivElement = $state(null!);
	let leafletMap: any = $state(null);
	let imageOverlay: any = null;
	let regionLayers: any[] = [];
	let drawnItems: any = null;
	let drawControl: any = null;
	let zoomControl: any = null;
	let L: LeafletNS = $state(null as any);

	// UI state
	let activeMapId = $state<string | null>(null);
	let showRegionForm = $state(false);
	let pendingPolygon: number[][] | null = $state(null);
	let regionFormLocationId = $state<string | null>(null);
	let regionFormColor = $state('#e8a838');
	let regionFormSceneIds = $state<Set<string>>(new Set());
	let uploadError = $state<string | null>(null);
	let editingRegionId: string | null = $state(null);
	let editingOriginalLocationId: string | null = $state(null);
	let mapReady = $state(false);
	let renamingMapName = $state<string | null>(null);
	let deleteConfirm = $state<{ id: string; name: string; regionCount: number } | null>(null);
	let deleting = $state(false);
	let deleteError = $state('');

	// Computed — $worldMaps / $mapRegions / $entities / $isInScope are Svelte store subscriptions
	let activeMap = $derived($worldMaps.find((m) => m.id === activeMapId) ?? null);
	let locations = $derived($entities.filter((e) => e.type === 'Location'));
	let hasMaps = $derived($worldMaps.length > 0);
	let hasImage = $derived(activeMap?.baseImageUrl != null && activeMap.width != null && activeMap.height != null);
	let acts = $derived(
		$entities
			.filter((e) => e.type === 'Act')
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
	);
	let scenesByAct = $derived.by(() => {
		const map = new Map<string, typeof $entities[0][]>();
		for (const act of acts) {
			const scenes = $entities
				.filter((e) => e.type === 'Scene' && e.parentId === act.id)
				.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
			map.set(act.id, scenes);
		}
		return map;
	});

	// Resolve CSS custom properties to actual color values for Leaflet
		// Pre-fill scene checkboxes from existing intervals when location changes
		$effect(() => {
			const locId = regionFormLocationId;
			if (!locId) {
				regionFormSceneIds = new Set();
				return;
			}
			const sceneIds = new Set<string>();
			for (const iv of $intervalsStore.filter((i) => i.entityId === locId)) {
				for (const sid of scenesInInterval(iv)) {
					sceneIds.add(sid);
				}
			}
			regionFormSceneIds = sceneIds;
		});
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
		intervalsStore.load();

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
			zoomControl: false,
			attributionControl: false
		});

		leafletMap.addLayer(drawnItems);

		leafletMap.on(L.Draw.Event.CREATED, (e: any) => {
			const layer = e.layer;
			const latLngs = layer.getLatLngs()[0].map((ll: any) => [ll.lat, ll.lng]);
			pendingPolygon = latLngs;
			showRegionForm = true;
		});

		leafletMap.on('popupopen', (e: any) => {
			const popupEl = e.popup.getElement();
			if (!popupEl) return;
			const editBtn = popupEl.querySelector('[data-action="edit"]');
			const deleteBtn = popupEl.querySelector('[data-action="delete"]');
			const nameEl = popupEl.querySelector('.region-popup-name');
			if (editBtn) {
				editBtn.addEventListener('click', () => {
					startEditRegion((editBtn as HTMLElement).dataset.regionId!);
					leafletMap.closePopup();
				});
			}
			if (deleteBtn) {
				deleteBtn.addEventListener('click', () => {
					handleDeleteRegion((deleteBtn as HTMLElement).dataset.regionId!);
					leafletMap.closePopup();
				});
			}
			if (nameEl) {
				nameEl.addEventListener('click', () => {
					const locId = (nameEl as HTMLElement).dataset.locationId;
					if (locId) windowStore.open('entity-detail', locId);
					leafletMap.closePopup();
				});
			}
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
				edit: { featureGroup: drawnItems, edit: false, remove: false }
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
			// When this effect fires from the {#if !hasImage}→{:else} branch
			// swap (first upload), the map-canvas div was just mounted and
			// Leaflet measured the container at 0×0. Force a re-measure so
			// fitBounds has real pixel dimensions to work with.
			leafletMap.invalidateSize();
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

			// Tooltip and popup with location info
			const loc = region.locationId
				? $entities.find((e) => e.id === region.locationId)
				: null;
			if (loc) layer.bindTooltip(loc.name, { sticky: true });
			layer.bindPopup(buildRegionPopup(region, loc?.name ?? null), {
				closeButton: false,
				minWidth: 140
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

	// ── Scene scope helpers ──────────────────────────────────────────────────

	function toggleScene(sceneId: string) {
		const next = new Set(regionFormSceneIds);
		if (next.has(sceneId)) next.delete(sceneId);
		else next.add(sceneId);
		regionFormSceneIds = next;
	}

	type SceneRange = { startActId: string; startSceneId: string; endActId: string; endSceneId: string };

	function coalesceToRanges(
		selectedSceneIds: Set<string>,
		scenesByAct: Map<string, typeof $entities[0][]>
	): SceneRange[] {
		const ranges: SceneRange[] = [];
		for (const [actId, scenes] of scenesByAct) {
			const selected = scenes.filter((s) => selectedSceneIds.has(s.id));
			if (selected.length === 0) continue;
			let runStart = selected[0];
			let runEnd = selected[0];
			for (let i = 1; i < selected.length; i++) {
				const prevIdx = scenes.indexOf(runEnd);
				const currIdx = scenes.indexOf(selected[i]);
				if (currIdx === prevIdx + 1) {
					runEnd = selected[i];
				} else {
					ranges.push({
						startActId: actId, startSceneId: runStart.id,
						endActId: actId, endSceneId: runEnd.id
					});
					runStart = selected[i];
					runEnd = selected[i];
				}
			}
			ranges.push({
				startActId: actId, startSceneId: runStart.id,
				endActId: actId, endSceneId: runEnd.id
			});
		}
		return ranges;
	}

	function scenesInInterval(iv: typeof $intervalsStore[0]): string[] {
		if (!iv.startSceneId || !iv.endSceneId || iv.startActId !== iv.endActId) return [];
		const scenes = scenesByAct.get(iv.startActId) ?? [];
		const startIdx = scenes.findIndex((s) => s.id === iv.startSceneId);
		const endIdx = scenes.findIndex((s) => s.id === iv.endSceneId);
		if (startIdx < 0 || endIdx < 0) return [];
		const lo = Math.min(startIdx, endIdx);
		const hi = Math.max(startIdx, endIdx);
		return scenes.slice(lo, hi + 1).map((s) => s.id);
	}

	function buildRegionPopup(region: typeof $mapRegions[0], locName: string | null): string {
		const locHtml = locName && region.locationId
			? `<button class="region-popup-name" data-location-id="${region.locationId}">${locName}</button>`
			: '<span class="region-popup-name">Unlinked region</span>';
		return `<div class="region-popup">${locHtml}<div class="region-popup-actions"><button class="region-popup-btn" data-action="edit" data-region-id="${region.id}">Edit</button><button class="region-popup-btn region-popup-btn-danger" data-action="delete" data-region-id="${region.id}">Delete</button></div></div>`;
	}

	function startEditRegion(regionId: string) {
		const region = $mapRegions.find((r) => r.id === regionId);
		if (!region || !activeMapId) return;
		editingRegionId = regionId;
		editingOriginalLocationId = region.locationId;
		regionFormLocationId = region.locationId;
		regionFormColor = region.color ?? '#e8a838';
		const sceneIds = new Set<string>();
		if (region.locationId) {
			for (const iv of $intervalsStore.filter((i) => i.entityId === region.locationId)) {
				for (const sid of scenesInInterval(iv)) {
					sceneIds.add(sid);
				}
			}
		}
		regionFormSceneIds = sceneIds;
		showRegionForm = true;
	}

	async function handleDeleteRegion(regionId: string) {
		if (!activeMapId) return;
		const region = $mapRegions.find((r) => r.id === regionId);
		try {
			await worldMapStore.deleteRegion(activeMapId, regionId);
		} catch (err) {
			console.error('Failed to delete region:', err);
		}
		if (region?.locationId) {
			const otherRegions = $mapRegions.filter(
				(r) => r.locationId === region.locationId && r.id !== regionId
			);
			if (otherRegions.length === 0) {
				for (const iv of $intervalsStore.filter((i) => i.entityId === region.locationId)) {
					try { await intervalsStore.deleteInterval(iv.id); } catch {}
				}
			}
		}
		if (editingRegionId === regionId) resetRegionForm();
	}

	function resetRegionForm() {
		showRegionForm = false;
		pendingPolygon = null;
		regionFormLocationId = null;
		regionFormColor = '#e8a838';
		regionFormSceneIds = new Set();
		editingRegionId = null;
		editingOriginalLocationId = null;
		drawnItems.clearLayers();
	}

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

	function openDeleteConfirm() {
		if (!activeMap) return;
		const regionCount = $mapRegions.filter((r) => r.mapId === activeMap.id).length;
		deleteConfirm = { id: activeMap.id, name: activeMap.name, regionCount };
		deleting = false;
		deleteError = '';
	}

	async function confirmDelete() {
		if (!deleteConfirm) return;
		deleting = true;
		deleteError = '';
		const oldId = deleteConfirm.id;
		try {
			await worldMapStore.deleteMap(oldId);
		} catch {
			deleteError = "Couldn't delete. The server rejected the request.";
			deleting = false;
			return;
		}
		// Delete succeeded — the dialog is done. Switching maps and
		// loading the next map's regions are post-delete UX; failures
		// there are not delete failures and must not resurrect the dialog.
		deleteConfirm = null;
		const nextId = $worldMaps.find((m) => m.id !== oldId)?.id ?? null;
		activeMapId = nextId;
		if (nextId) {
			try {
				await worldMapStore.loadMapRegions(nextId);
			} catch (err) {
				console.error('Failed to load regions for switched map:', err);
			}
		}
		deleting = false;
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
		if (!activeMapId) return;
		if (!editingRegionId && !pendingPolygon) return;
			// Snapshot form state before any async work — the pre-fill $effect
			// re-fires when deletes update $intervalsStore and can clear sceneIds.
			const saveLocationId = regionFormLocationId;
			const saveSceneIds = new Set(regionFormSceneIds);
			const saveColor = regionFormColor;
			const saveEditingId = editingRegionId;
			const saveOrigLocId = editingOriginalLocationId;
			const savePolygon = pendingPolygon;


		if (editingRegionId) {
			try {
				await worldMapStore.updateRegion(activeMapId, editingRegionId, {
					locationId: regionFormLocationId,
					color: regionFormColor
				});
			} catch (err) {
				console.error('Failed to update region:', err);
			}
			// Clean up old location intervals if location changed
			if (editingOriginalLocationId && editingOriginalLocationId !== regionFormLocationId) {
				await Promise.all(
					$intervalsStore
						.filter((i) => i.entityId === editingOriginalLocationId)
						.map((iv) => intervalsStore.deleteInterval(iv.id).catch(() => {}))
				);
			}
		} else {
			try {
				await worldMapStore.createRegion(activeMapId, {
					locationId: regionFormLocationId,
					polygon: pendingPolygon!,
					color: regionFormColor
				});
			} catch (err) {
				console.error('Failed to create region:', err);
			}
		}

		// Write intervals for the selected location
		if (saveLocationId && saveSceneIds.size > 0) {
			// Clear existing intervals for this location first (both create and edit)
			await Promise.all(
				$intervalsStore
					.filter((i) => i.entityId === saveLocationId)
					.map((iv) => intervalsStore.deleteInterval(iv.id))
			);
				const ranges = coalesceToRanges(saveSceneIds, scenesByAct);
			await Promise.all(
				ranges.map((range) =>
					intervalsStore.createInterval({
						entityId: saveLocationId,
						startActId: range.startActId,
						startSceneId: range.startSceneId,
						endActId: range.endActId,
						endSceneId: range.endSceneId
					}).catch((err) => { console.error('Failed to create interval:', err); })
				)
			);
		}

		resetRegionForm();
	}

	function handleCancelRegion() {
		resetRegionForm();
	}

	function startRename() {
		if (!activeMap) return;
		renamingMapName = activeMap.name;
	}

	async function commitRename() {
		if (!activeMapId || renamingMapName === null) return;
		const trimmed = renamingMapName.trim();
		const original = activeMap?.name ?? '';
		renamingMapName = null;
		if (!trimmed || trimmed === original) return;
		await worldMapStore.updateMap(activeMapId, { name: trimmed });
	}

	function cancelRename() {
		renamingMapName = null;
	}

	const PALETTE = ['#e8a838', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#ec4899', '#f97316', '#06b6d4'];
</script>

{#if !hasMaps}
	<!-- Empty state: no maps -->
	<div class="empty-state">
		<p class="empty-title">No maps yet</p>
		<button class="btn-primary" onclick={handleCreateMap}>Create your first map</button>
	</div>
{:else}
	<!-- Active map. Always render the map-canvas (so Leaflet initializes
	     once on open and survives the hasImage transition AND the brief
	     activeMap=null gap during map delete); overlay the upload prompt
	     on top when no image is imported yet. -->
	<div class="map-wrapper">
		<div class="map-toolbar">
			<select class="map-switcher" onchange={(e) => switchMap((e.target as HTMLSelectElement).value)}>
				{#each $worldMaps as m}
					<option value={m.id} selected={m.id === activeMapId}>{m.name}</option>
				{/each}
			</select>
			{#if renamingMapName !== null}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="map-name-input"
					type="text"
					bind:value={renamingMapName}
					autofocus
					onblur={commitRename}
					onkeydown={(e) => {
						if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
						if (e.key === 'Escape') cancelRename();
					}}
				/>
			{:else}
				<button
					class="btn-icon"
					onclick={startRename}
					title="Rename map"
					aria-label="Rename map"
					disabled={!activeMap}
				>
					<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
						<path d="M7.5 1.5 l2 2 -6 6 -2.5 0.5 0.5-2.5 6-6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
					</svg>
				</button>
			{/if}
			<button class="btn-icon" onclick={handleCreateMap} title="New map">+</button>
			<button
				class="btn-icon btn-danger"
				onclick={openDeleteConfirm}
				title="Delete map"
				disabled={!activeMap}>×</button
			>
			{#if hasImage}
				<label class="btn-icon" title="Replace image">
					📁
					<input type="file" accept=".jpg,.jpeg,.png,.webp" onchange={handleImageUpload} hidden />
				</label>
			{/if}
		</div>
		<div class="map-canvas" bind:this={mapContainer}></div>
		{#if !hasImage}
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
		{:else if $mapRegions.length === 0 && !showRegionForm}
			<div class="hint-overlay">Use the draw tool to create regions linked to locations.</div>
		{/if}
	</div>
{/if}

{#if showRegionForm}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal-content">
			<h3>{editingRegionId ? "Edit Region" : "New Region"}</h3>

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

			{#if regionFormLocationId}
				<label>
					Active during
					<div class="scene-tree">
						{#each acts as act}
							{@const scenes = scenesByAct.get(act.id) ?? []}
							{#if scenes.length > 0}
								<div class="act-group">
									<div class="act-label">{act.name}</div>
									{#each scenes as scene}
										<label class="scene-check">
											<input type="checkbox"
												checked={regionFormSceneIds.has(scene.id)}
												onchange={() => toggleScene(scene.id)} />
											{scene.name}
										</label>
									{/each}
								</div>
							{/if}
						{/each}
						{#if acts.length === 0 || acts.every((a) => (scenesByAct.get(a.id) ?? []).length === 0)}
							<span class="hint">Create acts and scenes in the Timeline first.</span>
						{/if}
					</div>
				</label>
			{/if}

			<div class="modal-actions">
				<button class="btn-secondary" onclick={handleCancelRegion}>Cancel</button>
				<button class="btn-primary" onclick={handleSaveRegion}>Save Region</button>
			</div>
		</div>
	</div>
{/if}

{#if deleteConfirm}
	{@const dc = deleteConfirm}
	{@const impacts = [
		{ parts: ['The map ', { bold: dc.name }, ' and its background image'] },
		...(dc.regionCount > 0
			? [
					{
						parts: [
							`${dc.regionCount} region${dc.regionCount === 1 ? '' : 's'} drawn on this map (location links remain intact)`
						]
					}
				]
			: [])
	] satisfies DeleteImpact[]}
	<DeleteConfirmDialog
		name={dc.name}
		{impacts}
		confirmLabel="Delete Map"
		{deleting}
		error={deleteError}
		onConfirm={confirmDelete}
		onCancel={() => (deleteConfirm = null)}
	/>
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
		left: 60px;
		z-index: 1000;
		display: flex;
		gap: 4px;
		align-items: center;
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 4px 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.map-switcher {
		background: var(--color-surface);
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
		border-bottom: 1px solid var(--color-accent);
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
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: var(--color-surface);
		padding: 32px;
		z-index: 10;
	}

	.upload-area p {
		color: var(--color-text);
		font-size: 15px;
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
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 6px 12px;
		font-size: 13px;
		color: var(--color-text-muted);
		pointer-events: none;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
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
		background: var(--color-surface);
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
		background: var(--color-surface);
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
.scene-tree {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 200px;
		overflow-y: auto;
	}

	.act-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.act-label {
		font-weight: 600;
		font-size: 12px;
		color: var(--color-text);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-top: 4px;
	}

	.scene-check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text);
		padding-left: 12px;
		cursor: pointer;
	}

	/* Scope transition on Leaflet SVG paths */
	:global(.region-active),
	:global(.region-inactive) {
		transition: opacity 200ms ease-in-out;
	}

	:global(.region-popup) {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-family: inherit;
		font-size: 13px;
	}
	:global(.region-popup-name) {
		background: none;
		border: none;
		color: var(--color-accent, #e8a838);
		cursor: pointer;
		font-size: 13px;
		padding: 0;
		text-align: left;
		font-weight: 600;
	}
	:global(.region-popup-name:hover) {
		text-decoration: underline;
	}
	:global(.region-popup-actions) {
		display: flex;
		gap: 6px;
	}
	:global(.region-popup-btn) {
		background: var(--color-surface, #fff);
		border: 1px solid var(--color-border, #555);
		border-radius: 4px;
		padding: 3px 10px;
		font-size: 12px;
		cursor: pointer;
		color: var(--color-text, #222);
	}
	:global(.region-popup-btn:hover) {
		background: var(--color-border, #eee);
	}
	:global(.region-popup-btn-danger) {
		color: #c0392b;
	}
	:global(.region-popup-btn-danger:hover) {
		background: #c0392b;
		color: #fff;
	}
</style>
