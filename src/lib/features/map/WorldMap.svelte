<script lang="ts">
	import { onMount } from 'svelte';
	import { worldMapStore, worldMaps, mapRegions } from '$lib/features/map/store.js';
	import { entities } from '$lib/stores/entities.js';
	import { isInScope } from '$lib/os/scope-store.js';
	import { intervals as intervalsStore } from '$lib/features/timeline/intervals-store.js';
	import { relationships } from '$lib/stores/relationships.js';
	import { playhead } from '$lib/features/timeline/playhead-store.js';
	import { get } from 'svelte/store';
	import { windowStore } from '$lib/os/windows-store.js';
	import { buildHierarchyIndex, walkAncestors } from '$lib/location-hierarchy.js';
	import { resolveActiveVariant } from '$lib/features/map/variants.js';
	import {
		coalesceToRanges,
		scenesInInterval as scenesInIntervalPure
	} from '$lib/features/map/scene-ranges.js';
	import CreateMapOfferModal from '$lib/features/map/CreateMapOfferModal.svelte';
	import VariantFormModal from '$lib/features/map/VariantFormModal.svelte';
	import RegionFormModal from '$lib/features/map/RegionFormModal.svelte';
	import MapBreadcrumb from '$lib/features/map/MapBreadcrumb.svelte';
	import MapToolbar from '$lib/features/map/MapToolbar.svelte';
	import PixiStage from '$lib/features/map/PixiStage.svelte';
	import PixiBackgroundLayer from '$lib/features/map/PixiBackgroundLayer.svelte';
	import PixiGridLayer from '$lib/features/map/PixiGridLayer.svelte';
	import PixiTerrainLayer from '$lib/features/map/PixiTerrainLayer.svelte';
	import PixiRegionLayer from '$lib/features/map/PixiRegionLayer.svelte';
	import PixiPolygonDraw from '$lib/features/map/PixiPolygonDraw.svelte';
	import PixiPlacementLayer from '$lib/features/map/PixiPlacementLayer.svelte';
	import MapSidebar from '$lib/features/map/MapSidebar.svelte';
	import { projectState, type ProjectionContext, type RenderedState } from '$lib/features/map/projection.js';
	import { factions as factionsStore } from '$lib/features/map/factions-store.js';
	import { mapAnchorsStore } from '$lib/features/map/map-anchors-store.js';
	import { mapEventsStore } from '$lib/features/map/map-events-store.js';
	import { layerPrefs } from '$lib/features/map/layer-prefs-store.js';
	import DeleteConfirmDialog, { type DeleteImpact } from '$lib/components/DeleteConfirmDialog.svelte';
	import PlaceablesPalette from '$lib/components/PlaceablesPalette.svelte';
	import BrushPalette from '$lib/components/BrushPalette.svelte';
	import AssetLibrary from '$lib/components/AssetLibrary.svelte';
	import { ASSET_DRAG_MIME } from '$lib/components/asset-drag.js';
	import PixiBrushLayer from '$lib/features/map/PixiBrushLayer.svelte';
	import type { BiomeKind } from '$lib/features/map/projection.js';
	import { mapPlacements as placementsStore } from '$lib/stores/map-placements.js';

	let { entityId = $bindable<string | undefined>(undefined) }: { entityId?: string } = $props();

	// armed placeable id (chip selected in PlaceablesPalette). When non-null,
	// the next click on the Pixi canvas creates a placement at the clicked
	// fractional coords for this entity.
	let armedPlaceableId = $state<string | null>(null);
	// Disarm if the palette goes away (active map loses its Location anchor or
	// switches to one without an image). Prevents a stale arm from creating a
	// placement with locationId=null after the palette unmounts.
	$effect(() => {
		if (!activeMap?.locationId || !hasImage) armedPlaceableId = null;
	});

	// Slice 3 T5 — brush authoring state. When `brushActive` is true,
	// PixiBrushLayer captures pointer events and paints cells. Mutually
	// exclusive with armedPlaceableId (you can't be placing and painting
	// at the same time — both take the canvas pointer).
	let brushActive = $state(false);
	let brushBiome = $state<BiomeKind>('plains');
	let brushSize = $state<1 | 3 | 5>(1);
	$effect(() => {
		// Disable brush if the active map can't host paint (no image,
		// no canvas dimensions). Auto-unarm so the user doesn't get
		// stuck in a no-op brush state.
		if (!activeMap || !activeMap.width || !activeMap.height) brushActive = false;
	});
	$effect(() => {
		// Cross-exclusion: arming a placement disables the brush, and
		// vice versa. Paint-and-place at the same time would conflict
		// on the pointer.
		if (brushActive && armedPlaceableId !== null) armedPlaceableId = null;
	});
	let placementError = $state('');

	// Slice 3 T8' (codex P2) — the live pixi-viewport, handed up from
	// PixiStage. The AssetLibrary drop handler is a DOM listener outside the
	// Pixi stage context, so it can't call getLocalPosition(viewport) the way
	// the click-to-place path does; it uses this reference to convert the
	// drop's screen coords → world coords through the pan/zoom transform.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let pixiViewport = $state<any>(null);

	// UI state
	let activeMapId = $state<string | null>(null);
	let showRegionForm = $state(false);
	let pendingPolygon: number[][] | null = $state(null);
	// Slice 2 D4 prep (T8): Pixi polygon-draw state. `pixiDrawingActive`
	// drives the PixiPolygonDraw overlay; `pixiDrawSeed` is the right-click
	// origin point that seeds the first vertex (Variant D, Cartographer's
	// tool). Both reset on commit / cancel / map switch.
	let pixiDrawingActive = $state(false);
	let pixiDrawSeed = $state<{ x: number; y: number } | null>(null);
	// codex PR review iter 7: reset polygon-draw state when the user
	// switches maps via the toolbar. Without this, vertices placed on
	// map A linger after switchMap → committing on map B saves the
	// stale polygon against the newly active map.
	$effect(() => {
		// Read activeMapId so the effect tracks it; the read is the
		// dependency, the body unconditionally clears.
		void activeMapId;
		pixiDrawingActive = false;
		pixiDrawSeed = null;
	});
	let regionFormLocationId = $state<string | null>(null);
	let regionFormColor = $state('#e8a838');
	let regionFormSceneIds = $state<Set<string>>(new Set());
	let uploadError = $state<string | null>(null);
	let editingRegionId: string | null = $state(null);
	let editingOriginalLocationId: string | null = $state(null);
	let renamingMapName = $state<string | null>(null);
	let deleteConfirm = $state<{ id: string; name: string; regionCount: number } | null>(null);
	let deleting = $state(false);
	let deleteError = $state('');

	// Variant editor state (Step 3)
	let showVariantForm = $state(false);
	let variantFormIsDefault = $state(false);
	let variantFormStartActId = $state<string | null>(null);
	let variantFormStartSceneId = $state<string | null>(null);
	let variantFormEndActId = $state<string | null>(null);
	let variantFormEndSceneId = $state<string | null>(null);
	let variantFormError = $state('');
	let duplicating = $state(false);

	// Computed — $worldMaps / $mapRegions / $entities / $isInScope are Svelte store subscriptions.
	// T13 removed the strangler-fig renderer flag. Pixi is the only renderer.
	let activeMap = $derived($worldMaps.find((m) => m.id === activeMapId) ?? null);
	let locations = $derived($entities.filter((e) => e.type === 'Location'));
	let hasMaps = $derived($worldMaps.length > 0);
	let hasImage = $derived(activeMap?.baseImageUrl != null && activeMap.width != null && activeMap.height != null);
	let acts = $derived(
		$entities
			.filter((e) => e.type === 'Act')
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
	);
	// Location hierarchy (part_of) — index built once per relationships snapshot
	let hierarchyIndex = $derived(buildHierarchyIndex($relationships));
	let breadcrumbAncestors = $derived.by(() => {
		const locId = activeMap?.locationId;
		if (!locId) return [] as { id: string; name: string }[];
		const ids = walkAncestors(hierarchyIndex, locId);
		return ids
			.map((id) => {
				const e = $entities.find((x) => x.id === id);
				return e ? { id: e.id, name: e.name } : null;
			})
			.filter((x): x is { id: string; name: string } => x !== null);
	});

	// Locations valid to link inside the current map's regions: every Location
	// except the map's own anchor + that anchor's ancestors. Assigning an
	// ancestor to a region inside its own descendant's map would create a cycle
	// in the part_of hierarchy.
	let regionFormLocations = $derived.by(() => {
		const anchor = activeMap?.locationId ?? null;
		if (!anchor) return locations;
		const blocked = new Set<string>([anchor, ...walkAncestors(hierarchyIndex, anchor)]);
		return locations.filter((l) => !blocked.has(l.id));
	});

	// Drill-down offer state: a child Location has no map yet — surface CTA.
	let createMapOffer = $state<{ childId: string; childName: string } | null>(null);

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
	// ── Store loads ───────────────────────────────────────────────────────

	// Codex P2 on PR #55 (commit 4ccb183): factionsStore is loaded once on
	// mount but isn't part of the per-map readiness signal. If /api/factions
	// resolves AFTER /api/maps/[id]/anchors|events, projectState briefly
	// runs with an empty allowedFactions Map and faction overrides drop —
	// then re-runs cleanly once factions arrive. Snapshot taken during that
	// window would persist null faction_ids. Track factionsLoaded so the
	// dataLoading prop reflects all three sources.
	let factionsLoaded = $state(false);

	onMount(() => {
		worldMapStore.loadMaps();
		intervalsStore.load();
		relationships.load();
		// Factions are user-scoped (not map-scoped) — load once per session.
		// The map-scoped stores (anchors, events) load on activeMapId change.
		// Codex P2 on PR #55 (da20221): only flip factionsLoaded on success
		// — on failure, leaving it true would clear dataLoading and let
		// snapshots persist with empty allowedFactions. On failure the
		// loading signal stays live and ownership-write UX (snapshot,
		// changeOwner) stays gated. User can refresh to retry.
		void factionsStore
			.load()
			.then(() => {
				factionsLoaded = true;
			})
			.catch((err) => {
				console.error('Failed to load factions:', err);
			});
	});

	// ── Slice 1b projection pipeline ────────────────────────────────────
	//
	// Computed RenderedState for the Pixi path. Refetches the cross-user-
	// scoped projection context on map change, and per-map anchors + events;
	// projectState() is pure and runs on every playhead tick via $derived.
	// Leaflet path doesn't consume this (it reads map_regions directly) so
	// the iron-rule parity is preserved by feeding both paths from the same
	// region geometry, with Pixi additionally layering faction overrides.

	// Codex P1 on PR #55 (commit 5ef25e5): projectionCtx was fetched only
	// when activeMapId changed, so in-session mutations (creating a faction
	// in MapSidebar, deleting a region via the popup, etc.) couldn't refresh
	// the allowed sets. Stale ctx caused projectState's lazy GC to drop
	// just-created factions/regions or keep references to just-deleted ones.
	//
	// Fix: derive ctx directly from the client stores that ALREADY carry
	// the cross-user-scoped data ($factionsStore loaded from
	// GET /api/factions; $mapRegions loaded per-map from GET /api/maps/[id]
	// — both endpoints scope by userId server-side). The derive auto-fires
	// when either store mutates, so mid-session adds/deletes immediately
	// reach projectState. The /projection-context endpoint stays as a
	// defense-in-depth audit point (and remains covered by G3 tests), but
	// the client no longer fetches it.
	let projectionCtx = $derived.by<ProjectionContext | null>(() => {
		if (!activeMapId) return null;
		const allowedFactions = new Map();
		for (const f of $factionsStore) {
			allowedFactions.set(f.id, { id: f.id, color: f.color });
		}
		const allowedRegions = new Set<string>();
		for (const r of $mapRegions) {
			allowedRegions.add(r.id);
		}
		return { allowedFactions, allowedRegions };
	});
	// Codex P1 on PR #55 (commit f3948e1): projectionCtxLoading clearing
	// in .finally() left ownership writes unblocked after a failed load.
	// Replaced with projectionCtxHealthy (default false, true only on
	// Promise.all success). The dataLoading derived treats !healthy as
	// "still loading or known-broken" so snapshot/changeOwner stay gated
	// until the user reloads the page or switches to a working map.
	let projectionCtxHealthy = $state(false);
	// Codex P1 on PR #55 (commit 4856a07): tracking mapRegionsLoading
	// as a true/false-then-clear-in-finally signal silently passed
	// failure as completion. Switched to the same Healthy-only pattern
	// projectionCtxHealthy uses: default false, true only on successful
	// load. On failure stays false, dataLoading stays live, ownership
	// writes stay blocked. Tracked by switchMap / handleCreateMap /
	// confirmDelete around each loadMapRegions call.
	let mapRegionsHealthy = $state(false);

	$effect(() => {
		const id = activeMapId;
		if (!id) {
			mapAnchorsStore.reset();
			mapEventsStore.reset();
			layerPrefs.reset();
			projectionCtxHealthy = false;
			return;
		}
		let cancelled = false;
		projectionCtxHealthy = false;
		// Slice 3 E2 — layer prefs are independent of anchors/events; load
		// in parallel. Failure is non-blocking (store returns defaults).
		void layerPrefs.load(id).catch((err) => {
			if (cancelled) return;
			console.error('Failed to load layer prefs:', err);
		});
		void Promise.all([mapAnchorsStore.load(id), mapEventsStore.load(id)])
			.then(() => {
				if (cancelled) return;
				// Slice 2 D5: stores now page through completely via cursor
				// pagination. The Slice 1b 500-row truncated guard is no
				// longer needed; loadAll exhausts the stream before
				// resolving. If a future regression ships truncated
				// results, the projection will be wrong silently — guard
				// against that at the server invariant level, not here.
				projectionCtxHealthy = true;
			})
			.catch((err) => {
				if (cancelled) return;
				// Transient 500/network: clear stores AND leave healthy
				// at false so dataLoading stays live, blocking writes
				// until the next map switch (or page reload).
				console.error('Failed to load anchors/events:', err);
				mapAnchorsStore.reset();
				mapEventsStore.reset();
			});
		return () => {
			cancelled = true;
		};
	});

	let renderedState = $derived.by<RenderedState | null>(() => {
		if (!projectionCtx) return null;
		const t = $playhead ?? Number.NEGATIVE_INFINITY;
		return projectState(t, $mapAnchorsStore, $mapEventsStore, projectionCtx);
	});

	// Combined readiness signal piped through to PixiRegionLayer as
	// dataLoading. True while ANY of these are in flight or unhealthy:
	//  - anchors+events for the active map (projectionCtxHealthy)
	//  - factions for the user (factionsLoaded)
	//  - map_regions for the active map (mapRegionsLoading — see below)
	// snapshotWorldState + changeOwner gate on this so writes can't
	// race a load and persist partial state.
	//
	// Codex P1 on PR #55 (commit f3948e1): mapRegionsLoading was missing.
	// switchMap sets activeMapId synchronously before awaiting
	// loadMapRegions, so scopedRegions briefly empties during a switch.
	// A snapshot in that window would persist an empty regions[] for a
	// map that actually has regions.
	let dataLoading = $derived(
		!projectionCtxHealthy || !factionsLoaded || !mapRegionsHealthy
	);

	// Codex P2 on PR #55 (commits 4ccb183 + da20221): regions and
	// activeMapId update independently during a map switch. switchMap()
	// sets activeMapId synchronously, then awaits loadMapRegions. In
	// between, $mapRegions still holds the previous map's rows while
	// activeMapId points at the new map. A right-click landing in that
	// window would POST against the new mapId using old-map region ids.
	//
	// First cut used a binary regionsMatchMap gate that hid PixiRegionLayer
	// entirely during the mismatch — but Codex flagged that if
	// loadMapRegions FAILS (5xx, network), the stale rows linger and the
	// layer stays hidden forever with no error surface. Replaced with a
	// filtered derive: scopedRegions only contains rows for the current
	// activeMapId. During transition or load failure, scopedRegions is
	// empty → PixiRegionLayer stays mounted and renders an empty canvas
	// (honest "no data yet"), instead of hiding indefinitely.
	let scopedRegions = $derived(
		activeMapId ? $mapRegions.filter((r) => r.mapId === activeMapId) : []
	);

	// Auto-scrub the playhead past the latest event when entering Pixi mode
	// with events present. Lives in its own $effect (instead of inside the
	// map-load effect) so it ALSO fires when the user toggles renderer
	// mid-session — Codex P2 on PR #55 noticed the prior version only fired
	// on activeMapId change, leaving a map opened under Leaflet without
	// auto-jump when the user later switched to Pixi.
	//
	// One-shot per "playhead is null" episode: tracked via
	// pixiAutoScrubAppliedFor so the auto-scrub doesn't re-fire every time
	// events mutate (e.g., user adds another transfer_region). Once the
	// playhead is set, this effect no-ops until playhead returns to null
	// AND a fresh activeMapId arrives.
	let pixiAutoScrubAppliedFor = $state<string | null>(null);

	$effect(() => {
		// T13: Pixi is the only renderer now; the renderer-flag gate is gone.
		if (!activeMapId) return;
		if (pixiAutoScrubAppliedFor === activeMapId) return;
		if (dataLoading) return;
		const events = $mapEventsStore;
		if (events.length === 0) return;
		if (get(playhead) != null) {
			pixiAutoScrubAppliedFor = activeMapId;
			return;
		}
		const maxT = events.reduce(
			(acc, e) => (e.tPosition > acc ? e.tPosition : acc),
			Number.NEGATIVE_INFINITY
		);
		if (Number.isFinite(maxT) && maxT >= 0) {
			playhead.scrubTo(maxT);
			pixiAutoScrubAppliedFor = activeMapId;
		}
	});

	// Reset the auto-scrub gate when activeMapId changes so a freshly-
	// loaded map gets its own auto-scrub attempt.
	$effect(() => {
		const _id = activeMapId;
		pixiAutoScrubAppliedFor = null;
		void _id;
	});

	// ── Stage callbacks ──────────────────────────────────────────────────
	// Pixi polygon-draw entry + commit/cancel + click-to-place. The Pixi
	// stack (PixiPolygonDraw + PixiPlacementLayer + PixiRegionLayer) emits
	// these events back into the orchestrator; T13 deleted the parallel
	// Leaflet flow.

	function handlePolygonCreated(latLngs: number[][]) {
		pendingPolygon = latLngs;
		showRegionForm = true;
	}

	function startPixiDraw(stageX: number, stageY: number) {
		pixiDrawSeed = { x: stageX, y: stageY };
		pixiDrawingActive = true;
	}
	function handlePixiPolygonCommit(polygon: number[][]) {
		pixiDrawingActive = false;
		pixiDrawSeed = null;
		// Open RegionFormModal so the user picks a Location. D1 dropped
		// the color field server-side; the modal's color picker is legacy
		// and ignored on save.
		handlePolygonCreated(polygon);
	}
	function cancelPixiDraw() {
		pixiDrawingActive = false;
		pixiDrawSeed = null;
	}

	function handleCanvasClick(fx: number, fy: number) {
		// Disarm synchronously before the await so a quick second click can't
		// fire createPlacementAt twice while the POST is in flight.
		if (!armedPlaceableId) return;
		const placeableId = armedPlaceableId;
		armedPlaceableId = null;
		void createPlacementAt(placeableId, fx, fy);
	}

	async function createPlacementAt(
		placeableId: string,
		x: number,
		y: number,
		options: { sourceAssetId?: string } = {}
	) {
		placementError = '';
		try {
			// Slice 3 T17 — source_asset_id stored in placement.data.
			// Click-to-place path (PlaceablesPalette) leaves it undefined;
			// drag-drop path (AssetLibrary) passes it through. Slice 4's
			// sync-from-template button reads this field to look up the
			// asset entity.
			const data = options.sourceAssetId
				? { source_asset_id: options.sourceAssetId }
				: undefined;
			await placementsStore.create({
				placeableId,
				locationId: activeMap?.locationId ?? null,
				mapId: activeMap?.id ?? null,
				x,
				y,
				...(data ? { data } : {})
			});
		} catch (err) {
			placementError = err instanceof Error ? err.message : String(err);
		}
	}

	// Slice 3 T8' — drop handler for AssetLibrary drags. Pixi canvas
	// lives inside PixiStage's pixi-stage div; we wrap the stage with
	// listeners. dragover must preventDefault so the drop event fires.
	function handleAssetDragOver(e: DragEvent): void {
		if (!e.dataTransfer) return;
		// Accept only our custom MIME type. Files / text / images get
		// the "no drop" cursor — the user can't accidentally place from
		// an OS file drag.
		if (!Array.from(e.dataTransfer.types).includes(ASSET_DRAG_MIME)) return;
		// Block the drop if the active map can't host a placement (no
		// linked Location → no anchor for the placement to bind to).
		if (!activeMap?.locationId) {
			e.dataTransfer.dropEffect = 'none';
			return;
		}
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}

	function handleAssetDrop(e: DragEvent): void {
		if (!e.dataTransfer) return;
		const assetId = e.dataTransfer.getData(ASSET_DRAG_MIME);
		if (!assetId) return;
		if (!activeMap?.width || !activeMap?.height || !activeMap?.locationId) return;
		e.preventDefault();
		// Codex /review P2 — drop coords must reference the actual Pixi
		// canvas, not the .pixi-drop-target wrapper. When the wrapper is
		// letterboxed (wide map in a tall viewport, or extra chrome
		// inside the flex column), wrapper.boundingClientRect is larger
		// than the canvas and fx/fy land off-image. Query the inner
		// <canvas> element so the rect matches the rendered map area.
		const target = e.currentTarget as HTMLElement;
		const canvas = target.querySelector('canvas');
		const rect = (canvas ?? target).getBoundingClientRect();
		// Guard against zero-area target (unmounted between dragover and drop).
		if (rect.width <= 0 || rect.height <= 0) return;
		let fx: number;
		let fy: number;
		// Codex P2 — when the viewport has been panned/zoomed, the cursor's
		// position in the visible canvas is NOT the underlying world
		// coordinate. Convert through the pixi-viewport transform (same world
		// space the click-to-place path reaches via getLocalPosition) so the
		// placement lands where the user dropped on the MAP, not on screen.
		// screenWidth/Height track activeMap dimensions (PixiStage keeps them
		// in sync), so map CSS position → viewport screen space → world.
		if (pixiViewport && typeof pixiViewport.toWorld === 'function') {
			const screenX = ((e.clientX - rect.left) / rect.width) * pixiViewport.screenWidth;
			const screenY = ((e.clientY - rect.top) / rect.height) * pixiViewport.screenHeight;
			const world = pixiViewport.toWorld(screenX, screenY);
			fx = world.x / activeMap.width;
			fy = world.y / activeMap.height;
		} else {
			// No viewport yet (race) — fall back to the linear mapping, which
			// is exact at the identity transform (no pan/zoom).
			fx = (e.clientX - rect.left) / rect.width;
			fy = (e.clientY - rect.top) / rect.height;
		}
		if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
		void createPlacementAt(assetId, fx, fy, { sourceAssetId: assetId });
	}

	async function deletePlacement(id: string) {
		try {
			await placementsStore.delete(id);
		} catch (err) {
			placementError = err instanceof Error ? err.message : String(err);
		}
	}

	// ── Load placements ───────────────────────────────────────────────────
	//
	// Load placements scoped to the active map's anchor Location. Per M3, the
	// projection is keyed on location_id so a variant swap doesn't drop the
	// placements. Loads on map change; per-tick rendering filters in-memory
	// via PlacementLayer (no DB roundtrip on tick).
	$effect(() => {
		const locId = activeMap?.locationId;
		if (!locId) {
			// No anchor Location → no placements to show. Clear the store locally
			// rather than issuing a request the server would reject as invalid
			// UUID syntax (locationId column is uuid, no sentinel works).
			placementsStore.reset();
			return;
		}
		void placementsStore.load({ locationId: locId });
	});

	// ── Auto-select map ────────────────────────────────────────────────────
	//
	// Initial selection runs ONCE, with explicit priority — merging this with
	// the post-mount entityId watcher would race two switchMap calls (and two
	// region loads) on the same flush, letting the slower response overwrite
	// the faster one's regions in the global store.
	//   1) Step-1 anchor: resolveActiveVariant picks the variant covering the
	//      current playhead for `entityId` (Step 3 promotes 'locationId match'
	//      to 'locationId match at correct playhead position').
	//   2) Legacy fallback: a region on some map already links to entityId.
	//   3) First map.
	let initialSelectionDone = false;
	// Tracks the last `entityId` prop value the watcher has resolved to a map.
	// Plain `let` (not $state) so writes don't trigger effect re-runs. The
	// watcher below compares against it to distinguish a real prop change (new
	// deep-link) from a reactive re-run caused by internal navigation
	// (switchMap → activeMapId/$mapRegions change). Without this, the watcher
	// would force the map back to entityId's variant every time the user
	// switched maps via the dropdown or drilled into a sublocation.
	let lastAppliedEntityId: string | undefined = undefined;
	$effect(() => {
		if (initialSelectionDone || $worldMaps.length === 0) return;
		initialSelectionDone = true;
		lastAppliedEntityId = entityId;
		if (entityId) {
			const variant = resolveActiveVariant($worldMaps, entityId, $playhead);
			if (variant) {
				switchMap(variant.id);
				return;
			}
			const targetRegion = $mapRegions.find((r) => r.locationId === entityId);
			if (targetRegion) {
				switchMap(targetRegion.mapId);
				return;
			}
		}
		switchMap($worldMaps[0].id);
	});

	// React to an external deep-link change (parent rewrote win.entityId) by
	// switching to that Location's active variant. Internal navigation must
	// NOT trip this — see `lastAppliedEntityId` above.
	$effect(() => {
		if (!entityId || !initialSelectionDone || $worldMaps.length === 0) return;
		if (entityId === lastAppliedEntityId) return;
		lastAppliedEntityId = entityId;
		const variant = resolveActiveVariant($worldMaps, entityId, $playhead);
		if (variant && variant.id !== activeMapId) {
			switchMap(variant.id);
			return;
		}
		const targetRegion = $mapRegions.find((r) => r.locationId === entityId);
		if (targetRegion && targetRegion.mapId !== activeMapId) {
			switchMap(targetRegion.mapId);
		}
	});

	// ── Drill-down navigation ────────────────────────────────────────────────
	//
	// Resolve a child Location's active variant and switch to it. The 0/1/many
	// child-resolution policy from design Decision #3 (2026-05-14) lives in
	// leaflet-controller.ts's popup-click handler — this function just answers
	// "is there a variant?". Returns false → caller surfaces the "Create map
	// for X?" CTA.
	//
	// Deliberately does NOT mutate the `entityId` prop: that prop is the
	// *external* deep-link signal watched by the reactive effect below.
	// Mutating it from in-component navigation causes a feedback loop — the
	// parent's prop expression keeps re-supplying the original entityId,
	// which trips the watcher into switching the map back. switchMap is
	// enough; breadcrumb + active map both derive from activeMap.locationId,
	// not from entityId.
	function drillIntoLocation(locationId: string) {
		const variant = resolveActiveVariant($worldMaps, locationId, $playhead);
		if (variant) {
			switchMap(variant.id);
			return true;
		}
		return false;
	}

	function navigateBreadcrumb(locationId: string) {
		drillIntoLocation(locationId);
	}

	async function acceptCreateMapOffer() {
		if (!createMapOffer) return;
		const offer = createMapOffer;
		createMapOffer = null;
		const created = await worldMapStore.createMap(`${offer.childName} map`, offer.childId);
		await switchMap(created.id);
	}

	function dismissCreateMapOffer() {
		createMapOffer = null;
	}

	// ── Scene scope helpers ──────────────────────────────────────────────────

	function toggleScene(sceneId: string) {
		const next = new Set(regionFormSceneIds);
		if (next.has(sceneId)) next.delete(sceneId);
		else next.add(sceneId);
		regionFormSceneIds = next;
	}

	function scenesInInterval(iv: typeof $intervalsStore[0]): string[] {
		return scenesInIntervalPure(iv, scenesByAct);
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
		// The server may have dropped an implied part_of edge — refresh the
		// store so breadcrumb + drill-down stop pretending the sublocation
		// is still part of this map's anchor.
		await relationships.load();
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
		creatingRegionLocation = false;
		regionNewLocationName = '';
		regionNewLocationError = '';
		// T13: drawnItems was the leaflet-draw layer handle; Pixi
		// polygon-draw resets its own vertices via PixiPolygonDraw's
		// active=false effect, so nothing to clear here.
	}

	// ── Actions ────────────────────────────────────────────────────────────

	async function switchMap(mapId: string) {
		activeMapId = mapId;
		mapRegionsHealthy = false;
		try {
			await worldMapStore.loadMapRegions(mapId);
			// Only mark healthy if THIS switchMap call is still the active
			// one. A rapid switch A → B could leave switchMap(A) resolving
			// after switchMap(B) started; checking activeMapId avoids
			// flipping healthy on stale data.
			if (activeMapId === mapId) mapRegionsHealthy = true;
		} catch (err) {
			console.error('Failed to load regions for map:', mapId, err);
			// Stay unhealthy — dataLoading remains true, blocking writes.
		}
	}

	async function changeLinkedLocation(value: string) {
		if (!activeMapId) return;
		const next = value === '' ? null : value;
		await worldMapStore.updateMap(activeMapId, { locationId: next });
	}

	// Inline "+ New Location" for the toolbar picker (T2). Closes the chicken-
	// and-egg gap: a brand-new user can mint a Location at the moment they
	// need one — right after importing a map image — without leaving WorldMap.
	let creatingToolbarLocation = $state(false);
	let toolbarNewLocationName = $state('');
	let toolbarNewLocationError = $state('');
	let toolbarNewLocationBusy = $state(false);

	function startCreateToolbarLocation() {
		if (!activeMapId) return;
		creatingToolbarLocation = true;
		toolbarNewLocationName = '';
		toolbarNewLocationError = '';
	}

	function cancelCreateToolbarLocation() {
		creatingToolbarLocation = false;
		toolbarNewLocationName = '';
		toolbarNewLocationError = '';
	}

	// Inline "+ New Location" for the region form (T3). Authoring a polygon
	// for a child sublocation that doesn't yet exist would otherwise dead-end
	// at the dropdown.
	let creatingRegionLocation = $state(false);
	let regionNewLocationName = $state('');
	let regionNewLocationError = $state('');
	let regionNewLocationBusy = $state(false);

	function startCreateRegionLocation() {
		creatingRegionLocation = true;
		regionNewLocationName = '';
		regionNewLocationError = '';
	}

	function cancelCreateRegionLocation() {
		creatingRegionLocation = false;
		regionNewLocationName = '';
		regionNewLocationError = '';
	}

	async function commitCreateRegionLocation() {
		const name = regionNewLocationName.trim();
		if (!name) {
			cancelCreateRegionLocation();
			return;
		}
		if (regionNewLocationBusy) return;
		regionNewLocationBusy = true;
		regionNewLocationError = '';
		try {
			const created = await entities.createEntity('Location', name);
			regionFormLocationId = created.id;
			creatingRegionLocation = false;
			regionNewLocationName = '';
		} catch (err) {
			regionNewLocationError = err instanceof Error ? err.message : String(err);
		} finally {
			regionNewLocationBusy = false;
		}
	}

	async function commitCreateToolbarLocation() {
		const name = toolbarNewLocationName.trim();
		if (!name) {
			cancelCreateToolbarLocation();
			return;
		}
		if (!activeMapId || toolbarNewLocationBusy) return;
		toolbarNewLocationBusy = true;
		toolbarNewLocationError = '';
		try {
			const created = await entities.createEntity('Location', name);
			await worldMapStore.updateMap(activeMapId, { locationId: created.id });
			creatingToolbarLocation = false;
			toolbarNewLocationName = '';
		} catch (err) {
			toolbarNewLocationError = err instanceof Error ? err.message : String(err);
		} finally {
			toolbarNewLocationBusy = false;
		}
	}

	async function handleCreateMap() {
		const map = await worldMapStore.createMap('New Map');
		activeMapId = map.id;
		mapRegionsHealthy = false;
		try {
			await worldMapStore.loadMapRegions(map.id);
			if (activeMapId === map.id) mapRegionsHealthy = true;
		} catch (err) {
			console.error('Failed to load regions for new map:', err);
		}
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
		mapRegionsHealthy = false;
		if (nextId) {
			try {
				await worldMapStore.loadMapRegions(nextId);
				if (activeMapId === nextId) mapRegionsHealthy = true;
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

		// The server may have just upserted (or dropped) the implied part_of
		// edge between region.locationId and this map's anchor. Refresh so the
		// breadcrumb/drill-down hierarchy sees the new sublocation.
		await relationships.load();

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

	// ── Variant editor ───────────────────────────────────────────────────────

	function variantLabel(map: typeof activeMap): string {
		if (!map) return '';
		if (!map.locationId) return 'Unlinked';
		if (map.startActId === null && map.endActId === null) return 'Default variant';
		const startAct = $entities.find((e) => e.id === map.startActId);
		const endAct = $entities.find((e) => e.id === map.endActId);
		const startScene = map.startSceneId
			? $entities.find((e) => e.id === map.startSceneId)
			: null;
		const endScene = map.endSceneId
			? $entities.find((e) => e.id === map.endSceneId)
			: null;
		const startStr = startScene
			? `${startAct?.name ?? '?'} · ${startScene.name}`
			: (startAct?.name ?? '?');
		const endStr = endScene
			? `${endAct?.name ?? '?'} · ${endScene.name}`
			: (endAct?.name ?? '?');
		return `${startStr} → ${endStr}`;
	}

	function openVariantForm() {
		if (!activeMap) return;
		const isDefault = activeMap.startActId === null && activeMap.endActId === null;
		variantFormIsDefault = isDefault;
		variantFormStartActId = activeMap.startActId;
		variantFormStartSceneId = activeMap.startSceneId;
		variantFormEndActId = activeMap.endActId;
		variantFormEndSceneId = activeMap.endSceneId;
		variantFormError = '';
		showVariantForm = true;
	}

	function closeVariantForm() {
		showVariantForm = false;
		variantFormError = '';
	}

	async function saveVariant() {
		if (!activeMapId) return;
		variantFormError = '';
		const payload = variantFormIsDefault
			? {
					startActId: null,
					startSceneId: null,
					endActId: null,
					endSceneId: null
				}
			: {
					startActId: variantFormStartActId,
					startSceneId: variantFormStartSceneId,
					endActId: variantFormEndActId,
					endSceneId: variantFormEndSceneId
				};

		if (!variantFormIsDefault) {
			if (!payload.startActId || !payload.endActId) {
				variantFormError = 'Pick a start and end Act for a scoped variant';
				return;
			}
		}

		try {
			await worldMapStore.updateMap(activeMapId, payload);
			showVariantForm = false;
		} catch (err) {
			variantFormError = (err as Error).message || 'Save failed';
		}
	}

	async function handleDuplicate() {
		if (!activeMapId || duplicating) return;
		duplicating = true;
		try {
			const clone = await worldMapStore.duplicateMap(activeMapId);
			await switchMap(clone.id);
		} catch (err) {
			console.error('Duplicate map failed:', err);
		}
		duplicating = false;
	}

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
	<div
		class="map-wrapper"
		class:has-breadcrumb={breadcrumbAncestors.length > 0 && activeMap}
	>
		{#if breadcrumbAncestors.length > 0 && activeMap}
			<MapBreadcrumb
				ancestors={breadcrumbAncestors}
				currentName={$entities.find((e) => e.id === activeMap.locationId)?.name ?? '(current)'}
				onNavigate={navigateBreadcrumb}
			/>
		{/if}
		<MapToolbar
			worldMaps={$worldMaps}
			{activeMap}
			{activeMapId}
			{hasImage}
			{locations}
			{duplicating}
			bind:renamingMapName
			bind:creatingToolbarLocation
			bind:toolbarNewLocationName
			{toolbarNewLocationBusy}
			{variantLabel}
			onSwitchMap={switchMap}
			onCreateMap={handleCreateMap}
			onOpenDeleteConfirm={openDeleteConfirm}
			onImageUpload={handleImageUpload}
			onChangeLinkedLocation={changeLinkedLocation}
			onStartRename={startRename}
			onCommitRename={commitRename}
			onCancelRename={cancelRename}
			onStartCreateToolbarLocation={startCreateToolbarLocation}
			onCommitCreateToolbarLocation={commitCreateToolbarLocation}
			onCancelCreateToolbarLocation={cancelCreateToolbarLocation}
			onOpenVariantForm={openVariantForm}
			onDuplicate={handleDuplicate}
		/>
		{#if toolbarNewLocationError}
			<div class="placement-error" role="alert">
				Couldn't create location: {toolbarNewLocationError}
				<button type="button" onclick={() => (toolbarNewLocationError = '')}>✕</button>
			</div>
		{/if}
		<!-- Slice 3 T8' drop target. Wraps PixiStage so AssetLibrary drags
		     can drop onto the canvas. dragover preventDefault enables drop;
		     ASSET_DRAG_MIME filter rejects accidental file drops. -->
		<div
			class="pixi-drop-target"
			role="region"
			aria-label="Map canvas drop zone"
			ondragover={handleAssetDragOver}
			ondrop={handleAssetDrop}
		>
		<PixiStage {activeMap} onViewport={(vp) => (pixiViewport = vp)}>
			{#snippet children()}
				<PixiBackgroundLayer {activeMap} />
				<PixiGridLayer {activeMap} />
				<PixiTerrainLayer {activeMap} cells={renderedState?.cells ?? []} />
				<PixiRegionLayer
					regions={scopedRegions}
					{renderedState}
					mapId={activeMapId}
					{dataLoading}
					isInScope={$isInScope}
					onDrawHere={startPixiDraw}
					onEditRegion={(id) => startEditRegion(id)}
					onDeleteRegion={(id) => void handleDeleteRegion(id)}
					onDrillIntoLocation={(locId) => {
						// codex PR#57 iter3 P2: drillIntoLocation returns false
						// when the linked Location has no map variant yet. The
						// deleted Leaflet popup used that signal to open
						// CreateMapOfferModal. Surface the same offer here.
						const drilled = drillIntoLocation(locId);
						if (!drilled) {
							const loc = $entities.find((e) => e.id === locId);
							if (loc)
								createMapOffer = { childId: locId, childName: loc.name };
						}
					}}
					onOpenLocation={(locId) => windowStore.open('entity-detail', locId)}
				/>
				<PixiPlacementLayer
					{activeMap}
					playhead={$playhead}
					placements={$placementsStore}
					entities={$entities}
					isInScope={$isInScope}
					armedPlaceableId={pixiDrawingActive ? null : armedPlaceableId}
					onOpenEntity={(id) => windowStore.open('entity-detail', id)}
					onDeletePlacement={(id) => void deletePlacement(id)}
					onCanvasClick={handleCanvasClick}
				/>
				<PixiPolygonDraw
					bind:active={pixiDrawingActive}
					seedPoint={pixiDrawSeed}
					{activeMap}
					onCommit={handlePixiPolygonCommit}
					onCancel={cancelPixiDraw}
				/>
				<!-- Slice 3 T5 — brush layer. Active only when the user enters
				     brush mode via BrushPalette. Captures pointer events on
				     the viewport when active. Inactive: zero overhead, no
				     listeners attached.
				     codex P2: suspend the brush while a polygon is being drawn
				     (pixiDrawingActive) — otherwise each left-click that places
				     a vertex also drives the brush pointer path and paints a
				     paint_cells stroke at that vertex. One-way prop (the layer
				     only reads `active`; BrushPalette owns brushActive). -->
				<PixiBrushLayer
					active={brushActive && !pixiDrawingActive}
					{activeMap}
					biome={brushBiome}
					size={brushSize}
				/>
			{/snippet}
		</PixiStage>
		</div>
		{#if pixiDrawingActive}
			<!-- T8 drawing-mode status overlay. 9px Inter uppercase tracked
			     per Variant A/D from docs/plans/world-map-v3-slice-2-plan.md. -->
			<div class="pixi-draw-status" role="status">
				DRAWING · ESC TO EXIT · DBL-CLICK OR SNAP TO CLOSE
			</div>
		{/if}
		<MapSidebar {activeMapId} />
		{#if hasImage && activeMap?.locationId}
			<!-- PlaceablesPalette: armed chip → PixiPlacementLayer's stage-
			     level pointertap → handleCanvasClick → create placement. -->
			<PlaceablesPalette armedId={armedPlaceableId} onArm={(id) => (armedPlaceableId = id)} />
			<!-- Slice 3 T8' asset library — drag source for placements.
			     Drop target lives on the pixi-drop-target wrapper above. -->
			<AssetLibrary />
			<!-- Slice 3 T5 brush palette. Mounts under the canvas alongside
			     PlaceablesPalette. Toggling brush ON disarms any placement
			     chip (cross-exclusion in $effect above). -->
			<BrushPalette
				active={brushActive}
				biome={brushBiome}
				size={brushSize}
				onSetActive={(a) => (brushActive = a)}
				onSetBiome={(b) => (brushBiome = b)}
				onSetSize={(s) => (brushSize = s)}
			/>
			{#if placementError}
				<div class="placement-error" role="alert">
					{placementError}
					<button type="button" onclick={() => (placementError = '')}>✕</button>
				</div>
			{/if}
		{/if}
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
	<RegionFormModal
		isEditing={editingRegionId !== null}
		{regionFormLocations}
		{acts}
		{scenesByAct}
		bind:locationId={regionFormLocationId}
		bind:color={regionFormColor}
		sceneIds={regionFormSceneIds}
		bind:creatingLocation={creatingRegionLocation}
		bind:newLocationName={regionNewLocationName}
		newLocationError={regionNewLocationError}
		newLocationBusy={regionNewLocationBusy}
		onSave={handleSaveRegion}
		onCancel={handleCancelRegion}
		onStartCreateLocation={startCreateRegionLocation}
		onCancelCreateLocation={cancelCreateRegionLocation}
		onCommitCreateLocation={commitCreateRegionLocation}
		onToggleScene={toggleScene}
	/>
{/if}

{#if createMapOffer}
	<CreateMapOfferModal
		offer={createMapOffer}
		onAccept={acceptCreateMapOffer}
		onDismiss={dismissCreateMapOffer}
	/>
{/if}

{#if showVariantForm && activeMap}
	<VariantFormModal
		{acts}
		{scenesByAct}
		bind:isDefault={variantFormIsDefault}
		bind:startActId={variantFormStartActId}
		bind:startSceneId={variantFormStartSceneId}
		bind:endActId={variantFormEndActId}
		bind:endSceneId={variantFormEndSceneId}
		error={variantFormError}
		onSave={saveVariant}
		onCancel={closeVariantForm}
	/>
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

	:global(.map-toolbar) {
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

	.map-wrapper.has-breadcrumb :global(.map-toolbar) {
		/* Breadcrumb bar sits in normal flow above the canvas; nudge the
		   absolutely-positioned toolbar below it so the two don't overlap. */
		top: 36px;
	}

	:global(.map-switcher),
	:global(.map-location-picker) {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 2px 6px;
		font-size: 13px;
	}

	:global(.map-location-picker) {
		margin-left: auto;
		max-width: 180px;
	}

	:global(.map-location-new-input) {
		margin-left: auto;
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-accent);
		border-radius: 4px;
		padding: 2px 6px;
		font-size: 13px;
		font-family: inherit;
		outline: none;
		max-width: 200px;
	}

	:global(.map-breadcrumb) {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 6px;
		padding: 4px 10px;
		background: var(--color-surface, transparent);
		border-bottom: 1px solid var(--color-border, #2a2a2a);
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
	}

	:global(.breadcrumb-link) {
		background: none;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 11px;
		font-family: inherit;
		padding: 0;
		cursor: pointer;
	}

	:global(.breadcrumb-link:hover) {
		color: var(--color-accent);
		text-decoration: underline;
	}

	:global(.breadcrumb-sep) {
		color: var(--color-text-muted, #6b7280);
		opacity: 0.6;
	}

	:global(.breadcrumb-current) {
		color: var(--color-text);
		font-weight: 600;
	}

	:global(.map-variant-chip) {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-rel-loc, var(--color-border));
		border-radius: 12px;
		padding: 2px 10px;
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;
		max-width: 220px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:global(.map-variant-chip:hover) {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	:global(.variant-help) {
		margin: 0 0 12px 0;
		font-size: 12px;
		color: var(--color-text-muted, #6b7280);
	}

	:global(.variant-default) {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		margin-bottom: 12px;
		cursor: pointer;
	}

	:global(.variant-grid) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px 12px;
	}

	:global(.variant-grid label) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
	}

	:global(.variant-grid select) {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 4px 6px;
		font-size: 12px;
		font-family: inherit;
	}

	:global(.variant-error) {
		margin: 10px 0 0 0;
		color: var(--color-rel-rival, #ef4444);
		font-size: 12px;
	}

	:global(.map-name-input) {
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 13px;
		width: 120px;
		outline: none;
		border-bottom: 1px solid var(--color-accent);
	}

	:global(.btn-icon) {
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
	:global(.btn-icon:hover) { background: var(--color-border); }
	:global(.btn-danger:hover) { background: #c0392b; color: #fff; }

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

	:global(.btn-primary) {
		background: var(--color-accent);
		color: #000;
		border: none;
		border-radius: 6px;
		padding: 8px 16px;
		font-size: 14px;
		cursor: pointer;
	}
	:global(.btn-primary:hover) { filter: brightness(1.1); }

	:global(.btn-secondary) {
		background: transparent;
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 8px 16px;
		font-size: 14px;
		cursor: pointer;
	}

	.pixi-draw-status {
		/* Slice 2 D4 prep (T8): top-left status text while drawing mode is
		   active. 9px Inter uppercase tracked, matches Variant A/D spec.
		   pointer-events: none so the canvas under the text still gets
		   pointer events for vertex placement. */
		position: absolute;
		top: 12px;
		left: 12px;
		z-index: 1100;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted, #6b7280);
		pointer-events: none;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
	}
	.hint-overlay {
		position: absolute;
		/* bottom-center: the hint shows only on an empty new map ($mapRegions
		   is empty), which is the moment the .map-toolbar is most needed for
		   picking a Location. Centering at top:12 collides horizontally with
		   the toolbar's controls. Bottom is unused real estate. */
		bottom: 16px;
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
	:global(.modal-overlay) {
		position: fixed;
		inset: 0;
		z-index: 2000;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	:global(.modal-content) {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 20px;
		min-width: 300px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	:global(.modal-content h3) {
		margin: 0;
	}

	:global(.modal-content label) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--color-text-muted);
	}

	:global(.modal-content select) {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 14px;
	}

	:global(.region-loc-row),
	:global(.region-new-loc-row) {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	:global(.region-loc-row select) {
		flex: 1;
	}
	:global(.region-new-loc-input) {
		flex: 1;
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-accent);
		border-radius: 4px;
		padding: 5px 7px;
		font-size: 14px;
		font-family: inherit;
		outline: none;
	}
	:global(.region-new-loc-row button) {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: 4px;
		padding: 4px 10px;
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;
	}
	:global(.region-new-loc-row button:hover:not(:disabled)) {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}
	:global(.region-new-loc-row button:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	:global(.region-new-loc-error) {
		font-size: 11px;
		color: var(--color-rel-rival, #ef4444);
	}

	:global(.color-palette) {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	:global(.color-swatch) {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
	}
	:global(.color-swatch.active) {
		border-color: var(--color-text);
	}

	:global(.modal-actions) {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: 4px;
	}
	:global(.scene-tree) {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 200px;
		overflow-y: auto;
	}

	:global(.act-group) {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	:global(.act-label) {
		font-weight: 600;
		font-size: 12px;
		color: var(--color-text);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-top: 4px;
	}

	:global(.scene-check) {
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
	:global(.region-popup-btn-drill) {
		align-self: stretch;
		color: var(--color-accent, #e8a838);
		border-color: var(--color-accent, #e8a838);
	}
	:global(.region-popup-btn-drill:hover) {
		background: var(--color-accent, #e8a838);
		color: #1a1a1a;
	}
	:global(.region-popup-hint) {
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}

	/* T13 removed the Leaflet placement-marker / placement-popup styles —
	   Pixi placements live in Pixi.Graphics (PixiPlacementLayer) and use
	   the ContextMenu component for click popups. Only .placement-error
	   (the error toast) remains. */
	.placement-error {
		padding: 6px 10px;
		font-size: 12px;
		background: #7f1d1d;
		color: #fee2e2;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	/* Slice 3 T8' drop target wraps the Pixi canvas. Must have a real box
	   so getBoundingClientRect() in the drop handler returns the canvas
	   area for pixel → fractional conversion. Inherits the same flex
	   behavior PixiStage had as a direct child. */
	.pixi-drop-target {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.placement-error button {
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
	}
</style>
