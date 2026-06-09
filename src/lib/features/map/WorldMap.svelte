<script lang="ts">
	import { onMount } from 'svelte';
	import {
		worldMapStore,
		worldMaps,
		mapRegions,
		type LoadRegionsResult
	} from '$lib/features/map/store.js';
	import type { MapRegion } from '$lib/features/map/types.js';
	import type { MapAnchor } from '$lib/features/map/map-anchors-store.js';
	import type { MapEvent } from '$lib/features/map/map-events-store.js';
	import type { MapPlacement } from '$lib/types/map-placement.js';
	import { entities } from '$lib/stores/entities.js';
	import { isInScope } from '$lib/os/scope-store.js';
	import { intervals as intervalsStore } from '$lib/features/timeline/intervals-store.js';
	import { relationships } from '$lib/stores/relationships.js';
	import { playhead, isPlaying } from '$lib/features/timeline/playhead-store.js';
	import { jumpToCause } from '$lib/features/timeline/jump-to-cause.js';
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
	import PixiTerrainTileLayer from '$lib/features/map/PixiTerrainTileLayer.svelte';
	import PixiArtLayer from '$lib/features/map/PixiArtLayer.svelte';
	import PixiFreeformBrushLayer from '$lib/features/map/PixiFreeformBrushLayer.svelte';
	import PixiWaterLayer from '$lib/features/map/PixiWaterLayer.svelte';
	import PixiRegionLayer from '$lib/features/map/PixiRegionLayer.svelte';
	import PixiCausalEdgeLayer from '$lib/features/map/PixiCausalEdgeLayer.svelte';
	import PixiPunctuationLayer from '$lib/features/map/PixiPunctuationLayer.svelte';
	import PixiCameraLayer from '$lib/features/map/PixiCameraLayer.svelte';
	import PixiPolygonDraw from '$lib/features/map/PixiPolygonDraw.svelte';
	import PixiPlacementLayer from '$lib/features/map/PixiPlacementLayer.svelte';
	import { createPlaybackReaction } from '$lib/features/map/playback-controller.js';
	import { computeCameraTarget, type CameraTarget } from '$lib/features/map/camera-director.js';
	import {
		groupTakesPlaceAt,
		activeLocationsAtT,
		activeEventIdsAtT,
		diffNewlyActiveEvents,
		decideCycleAction,
		cycleLookaheadTarget,
		pickCyclingTarget
	} from '$lib/features/map/active-location.js';
	import type {
		ConquestFlip,
		MarchTrail,
		CausalRipple,
		Punctuation
	} from '$lib/features/map/punctuation-diff.js';
	import MapSidebar from '$lib/features/map/MapSidebar.svelte';
	import MapToolSelector from '$lib/features/map/MapToolSelector.svelte';
	import {
		projectState,
		polygonCentroid,
		type ProjectionContext,
		type RenderedState,
		type ArtifactPosition
	} from '$lib/features/map/projection.js';
	import { computeCanvasMode, type MapTool } from '$lib/features/map/canvas-mode.js';
	import { factions as factionsStore } from '$lib/features/map/factions-store.js';
	import { mapAnchorsStore } from '$lib/features/map/map-anchors-store.js';
	import { mapEventsStore } from '$lib/features/map/map-events-store.js';
	import { layerPrefs } from '$lib/features/map/layer-prefs-store.js';
	import DeleteConfirmDialog, { type DeleteImpact } from '$lib/components/DeleteConfirmDialog.svelte';
	import PlaceablePalette from '$lib/components/PlaceablePalette.svelte';
	import BrushPalette from '$lib/components/BrushPalette.svelte';
	import FreeformBrushPalette from '$lib/components/FreeformBrushPalette.svelte';
	import { ASSET_DRAG_MIME } from '$lib/components/asset-drag.js';
	import PixiBrushLayer from '$lib/features/map/PixiBrushLayer.svelte';
	import { mapPlacements as placementsStore } from '$lib/stores/map-placements.js';

	// windowId is this WorldMap instance's window id (from WindowManager). Two
	// world-map windows can coexist (the default `world-map` plus a location-
	// specific `world-map-<entityId>`), so the keyboard-shortcut handler scopes
	// to THIS window's id, not just appId — otherwise one Ctrl+Z would undo in
	// every open map instance.
	let { entityId = $bindable<string | undefined>(undefined), windowId = undefined }: { entityId?: string; windowId?: string } = $props();

	// Slice 4 PR-F (DS4) — the unified tool selector's active tool is the single
	// source of truth for which authoring mode the canvas is in. brush/place/move
	// are mutually exclusive by construction (one tool at a time), which retires
	// the hand-rolled cross-exclusion effects the per-flag model needed.
	let activeTool = $state<MapTool>('select');
	// Brush/move are thin derivations of the active tool; the rest of the
	// component still reads these names. 'place' stays distinct from
	// 'place-armed': the Place tool reveals the palette, but the canvas only
	// enters place-armed mode once a chip is actually armed (armedPlaceableId).
	let brushActive = $derived(activeTool === 'brush');
	let moveActive = $derived(activeTool === 'move');
	// Open terrain-key vocabulary (Slice 6 D15): a manifest category, water
	// color key, or 'unset'. Defaults to a real category so first paint lands a
	// tile (BrushPalette resolves the live list from the manifest).
	let brushBiome = $state<string>('Grass');
	let brushSize = $state<1 | 3 | 5>(1);

	// WM3 Slice A — freeform brush sub-mode of the Brush tool. 'grid' keeps the
	// existing cell painting (PixiBrushLayer); 'freeform' emits paint_stroke
	// (PixiFreeformBrushLayer). The grid stays first-class (amendment §3) — this
	// is a toggle, not a replacement. Freeform params are normalized [0,1].
	let brushMode = $state<'grid' | 'freeform'>('grid');
	let strokeMode = $state<'fill' | 'stamp' | 'erase'>('fill');
	let strokeTextureKey = $state<string>('Grass'); // fill→terrain key, stamp→Objects/ key
	let strokeBrushSize = $state<number>(0.04);
	let strokeSoftness = $state<number>(0.5);
	// Slice D — time-varying terrain authoring. Both brushes commit at the
	// CURRENT playhead T (paint_cells PixiBrushLayer.svelte:156, paint_stroke
	// PixiFreeformBrushLayer commitStroke), and the fold windows events by
	// (anchorT, t] — so scrubbing the playhead and painting authors a terrain
	// BEAT (forest→ash) that appears from that story-time onward. The data path
	// shipped with Slices A–C; what makes it an authoring feature is telling
	// the author WHEN they're painting — invisible-T painting reads as "my art
	// vanished" the first time they scrub backward.
	let paintAtLabel = $derived.by(() => {
		const t = $playhead;
		if (t === null || t <= 0) return 'from the story start';
		const act = [...acts].reverse().find((a) => (a.position ?? 0) <= t);
		return act
			? `from “${act.name}” (t=${t.toFixed(2)}) onward`
			: `from t=${t.toFixed(2)} onward`;
	});

	// Slice B — paint-target art layer (world_maps.art_layers_jsonb id). null =
	// the implicit base art layer. Reset on map switch (ids are per-map) and
	// when the selected layer is deleted from the defs.
	let strokeLayerId = $state<string | null>(null);
	$effect(() => {
		void activeMapId;
		strokeLayerId = null;
	});
	$effect(() => {
		const defs = activeMap?.artLayersJsonb ?? [];
		if (strokeLayerId && !defs.some((l) => l.id === strokeLayerId)) strokeLayerId = null;
	});

	// armed placeable id (chip selected in PlaceablePalette). When non-null,
	// the next click on the Pixi canvas creates a placement at the clicked
	// fractional coords for this entity.
	let armedPlaceableId = $state<string | null>(null);
	// Arming only ever happens under the Place tool; leaving Place (or losing the
	// Location/image the palette needs) clears any stale arm so the next canvas
	// tap can't drop a placement with locationId=null after the palette unmounts.
	$effect(() => {
		if (activeTool !== 'place' || !activeMap?.locationId || !hasImage) armedPlaceableId = null;
	});

	// Fall back to Select when the active map can't host the current tool, so the
	// user is never stuck in a no-op mode. Brush needs canvas dimensions; Place
	// and Move act on Location-scoped placements so they need a linked Location.
	$effect(() => {
		const canPaint = !!(activeMap?.width && activeMap?.height);
		const canPlaceOrMove = !!(activeMap?.locationId && hasImage);
		if (activeTool === 'brush' && !canPaint) activeTool = 'select';
		if ((activeTool === 'place' || activeTool === 'move') && !canPlaceOrMove) activeTool = 'select';
	});
	let placementError = $state('');
	// In-flight flag for the per-map placements fetch (see the placements
	// loader effect below). Read by the `mapLoading` overlay gate.
	let placementsLoading = $state(false);

	// Slice 3 — undo/redo for map events (brush strokes, region transfers).
	// The store + /events/undo endpoint existed but nothing in the UI called
	// them. canUndo follows the live event log; canRedo follows the client
	// redo stack the store maintains.
	const mapEventsRedoStack = mapEventsStore.redoStack;
	let canUndo = $derived($mapEventsStore.length > 0);
	let canRedo = $derived($mapEventsRedoStack.length > 0);

	async function handleUndo() {
		if (!activeMapId) return;
		// codex P2: block undo while the map is loading. On a map switch
		// activeMapId flips before mapEventsStore.load() clears the old map's
		// rows, so canUndo can read true from the PREVIOUS map while the overlay
		// is up — and undo would POST /events/undo against the NEW map, deleting
		// its latest event. mapLoading stays true until anchors/events settle.
		if (mapLoading) return;
		// Capture before await: undo/redo are keyboard-triggerable (no pointerdown to
		// pin), so a cycle can move on mid-request; invalidate the mutated map's staged
		// bundle, not the active one (Codex PR #72 #104).
		const mapId = activeMapId;
		try {
			await mapEventsStore.undo(activeMapId);
			invalidateCycleCache(mapId);
		} catch (err) {
			console.error('Undo failed:', err);
		}
	}
	async function handleRedo() {
		if (!activeMapId) return;
		if (mapLoading) return;
		const mapId = activeMapId;
		try {
			await mapEventsStore.redo(activeMapId);
			invalidateCycleCache(mapId);
		} catch (err) {
			console.error('Redo failed:', err);
		}
	}

	// Slice 4 PR-F (DS4) — author a move_entity keyframe at the current playhead.
	// Shared by the Move-tool drag (PixiPlacementLayer) and keyboard nudge. Uses
	// the same optimistic events-store create path as brush/region writes; the
	// projection then folds the keyframe into a position override on the next tick
	// so the marker lands at the committed point. The server validates the
	// placement_id by Location scope and rejects out-of-window keyframes (D-PRF-8/9);
	// surface any rejection in the existing placement-error banner.
	async function handleMoveCommit(placementId: string, x: number, y: number) {
		if (!activeMapId || mapLoading) return;
		// Author at the current playhead, defaulting to 0 when idle. When the
		// playhead is null the projection renders at -∞ (before any keyframe →
		// baseline), so a freshly-authored keyframe would briefly snap back. We
		// scrub to the committed T after a null-playhead commit so the marker stays
		// at the dropped position — the auto-scrub effect's one-shot gate can't be
		// relied on (it no-ops once consumed). (code-reviewer MEDIUM.)
		const wasNull = $playhead == null;
		const tPosition = $playhead ?? 0;
		try {
			await mapEventsStore.create(activeMapId, {
				tPosition,
				kind: 'move_entity',
				payloadJsonb: { placement_id: placementId, position: { x, y }, tween: 'ease_in_out' }
			});
			if (wasNull) playhead.scrubTo(tPosition);
			moveAnnouncement = `Moved to ${(x * 100).toFixed(0)}%, ${(y * 100).toFixed(0)}% at T ${tPosition.toFixed(3)}`;
		} catch (err) {
			placementError = err instanceof Error ? err.message : String(err);
		}
	}
	// ARIA live-region text announcing the most recent move-keyframe commit
	// (DS4 a11y). Read by the visually-hidden status node in the template.
	let moveAnnouncement = $state('');

	// Slice 4 PR-F (DS4) — keyboard move authoring. Clicking a marker in Move mode
	// selects it for nudging (no drag); arrow keys adjust the pending fractional
	// position, Enter commits a keyframe at the playhead, Escape cancels. The
	// pending position is previewed on the marker via movePreview below.
	let moveKbSelection = $state<{ id: string; name: string; x: number; y: number } | null>(null);
	// Leaving Move mode drops any keyboard selection.
	$effect(() => {
		if (!moveActive) moveKbSelection = null;
	});

	function handleMoveSelect(placementId: string) {
		const pl = $placementsStore.find((p) => p.id === placementId);
		if (!pl) return;
		// Seed the nudge from the placement's CURRENT rendered position (the
		// movement override if it has one at this T, else its static baseline).
		const ov = renderedState?.artifactOverrides.get(placementId);
		const ent = $entities.find((e) => e.id === pl.placeableId);
		moveKbSelection = {
			id: placementId,
			name: ent?.name ?? 'placement',
			x: ov ? ov.x : pl.x,
			y: ov ? ov.y : pl.y
		};
	}

	// Returns true if the key was a move-nudge key (so the caller stops here).
	function handleMoveKeydown(e: KeyboardEvent): boolean {
		if (!moveKbSelection) return false;
		const sel = moveKbSelection;
		// Shift = coarse 10× step (DS4). Fractional [0,1] units.
		const step = e.shiftKey ? 0.1 : 0.01;
		const clamp = (v: number) => Math.min(1, Math.max(0, v));
		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				moveKbSelection = { ...sel, x: clamp(sel.x - step) };
				return true;
			case 'ArrowRight':
				e.preventDefault();
				moveKbSelection = { ...sel, x: clamp(sel.x + step) };
				return true;
			case 'ArrowUp':
				e.preventDefault();
				moveKbSelection = { ...sel, y: clamp(sel.y - step) };
				return true;
			case 'ArrowDown':
				e.preventDefault();
				moveKbSelection = { ...sel, y: clamp(sel.y + step) };
				return true;
			case 'Enter':
				e.preventDefault();
				void handleMoveCommit(sel.id, sel.x, sel.y);
				moveKbSelection = null;
				return true;
			case 'Escape':
				e.preventDefault();
				moveKbSelection = null;
				return true;
			default:
				return false;
		}
	}

	// Position overrides handed to PixiPlacementLayer: the projection's committed
	// movement overrides, plus the live keyboard-nudge preview for the selected
	// placement so its marker tracks the pending position before commit.
	let movePreview = $derived.by<Map<string, ArtifactPosition>>(() => {
		const base = renderedState?.artifactOverrides ?? new Map<string, ArtifactPosition>();
		if (!moveKbSelection) return base;
		const merged = new Map(base);
		merged.set(moveKbSelection.id, { x: moveKbSelection.x, y: moveKbSelection.y });
		return merged;
	});

	// Committed move_entity keyframe positions per placement_id, sorted by
	// t_position — feeds the Move-tool amber path (DS4). Malformed payloads are
	// skipped (lazy-GC, matching the projection fold's tolerance).
	let moveKeyframes = $derived.by<Map<string, ArtifactPosition[]>>(() => {
		const byPlacement = new Map<string, Array<{ t: number; x: number; y: number }>>();
		for (const ev of $mapEventsStore) {
			if (ev.kind !== 'move_entity') continue;
			const p = ev.payloadJsonb as { placement_id?: unknown; position?: { x?: unknown; y?: unknown } };
			const pid = p?.placement_id;
			const pos = p?.position;
			if (typeof pid !== 'string' || !pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
				continue;
			}
			const arr = byPlacement.get(pid) ?? [];
			arr.push({ t: ev.tPosition, x: pos.x, y: pos.y });
			byPlacement.set(pid, arr);
		}
		const result = new Map<string, ArtifactPosition[]>();
		for (const [pid, arr] of byPlacement) {
			arr.sort((a, b) => a.t - b.t);
			result.set(pid, arr.map((k) => ({ x: k.x, y: k.y })));
		}
		return result;
	});

	// Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. Scoped to the
	// focused World Map window so the shortcut doesn't undo map events while
	// the user is working in another app, and ignored while typing in a field.
	function handleMapKeydown(e: KeyboardEvent) {
		if (!activeMapId) return;
		if (mapLoading) return; // codex P2: don't undo/redo against a still-loading map
		// Scope to THIS window instance. Multiple world-map windows can be open
		// (default + location-specific), each with its own handler + activeMapId;
		// comparing the focused window's id (not just appId) ensures only the
		// focused map undoes/redoes. Falls back to appId when windowId is unset.
		const focused = windowStore.focusedWindow();
		if (windowId ? focused?.id !== windowId : focused?.appId !== 'world-map') return;
		const target = e.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable)
		)
			return;
		// Slice 4 PR-F (DS4) — Move-tool keyboard nudge. Window-scoped (same as
		// undo/redo) so the focused map handles arrows/Enter/Escape when a marker
		// is selected, without a focusable canvas proxy. Runs before the
		// meta/ctrl guard since the nudge keys carry no modifier.
		if (moveActive && moveKbSelection && handleMoveKeydown(e)) return;
		if (!(e.metaKey || e.ctrlKey)) return;
		const key = e.key.toLowerCase();
		if (key === 'z' && !e.shiftKey) {
			e.preventDefault();
			void handleUndo();
		} else if ((key === 'z' && e.shiftKey) || key === 'y') {
			e.preventDefault();
			void handleRedo();
		}
	}

	// Slice 3 T8' (codex P2) — the live pixi-viewport, handed up from
	// PixiStage. The palette drop handler is a DOM listener outside the
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
	// Slice 4 T7 — single source of truth for the active canvas interaction
	// mode, derived from the gesture flags (which stay child-owned). Gates read
	// `canvasMode` instead of re-deriving the precedence inline; PR-F adds
	// 'move'. See canvas-mode.ts for the priority cascade.
	let canvasMode = $derived(
		computeCanvasMode({
			drawing: pixiDrawingActive,
			brushing: brushActive,
			armed: armedPlaceableId !== null,
			moving: moveActive
		})
	);
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
	// Toolbar "New Location" flow open-state. Declared here (with the other form/modal
	// state) so the `authoringOpen` cycling gate can read it; its sibling input vars
	// live with the toolbar handlers below.
	let creatingToolbarLocation = $state(false);

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
	// Bounded "settled" flags (success OR failure) for the loading overlay.
	// Distinct from the *Healthy/*Loaded flags above, which stay false on error
	// (to keep writes gated): these flip true once the load SETTLES so the
	// overlay can't get stuck on a failed load. See `mapLoading`.
	let factionsSettled = $state(false);
	let anchorsEventsSettled = $state(false);
	let regionsSettled = $state(false);

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
			})
			.finally(() => {
				factionsSettled = true;
			});
	});

	// Cinematic Spotlight (Slice 8) PR1 — track prefers-reduced-motion for the
	// jump-cut. Kept in its own onMount so the matchMedia listener is cleaned up
	// independently of the factions load above.
	onMount(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mq.matches;
		const onChange = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
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
			anchorsEventsSettled = false;
			return;
		}
		// Staged-prefetch commit (#505) already applied this map's anchors/events/
		// layer-prefs and marked them healthy. Skip the redundant reload — crucially
		// the layerPrefs.load() below would otherwise flash an empty 'loading' state
		// over the just-committed prefs. One-shot: consume the flag so a later genuine
		// switch to the same map reloads normally (Codex PR #72).
		if (id === cyclePreloadedMapId) {
			cyclePreloadedMapId = null;
			projectionCtxHealthy = true;
			anchorsEventsSettled = true;
			return;
		}
		let cancelled = false;
		projectionCtxHealthy = false;
		anchorsEventsSettled = false;
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
			})
			.finally(() => {
				// Bounded settle for the overlay — true on success OR failure so
				// the overlay never sticks. Guarded by cancelled so a stale load
				// can't clear the overlay for a newer map.
				if (!cancelled) anchorsEventsSettled = true;
			});
		return () => {
			cancelled = true;
		};
	});

	// Slice 5 PR-C (D2/D5, ADR 0006) — causal-edge projection input. caused_by
	// rows are the EventChain links; locationOf maps an Event endpoint → its
	// Location via takes_place_at (Event AT Location, edge-policy.ts:14);
	// centroidByLocation maps a Location → its on-map region centroid, sourced
	// from scopedRegions — the SAME live geometry PixiRegionLayer draws (NOT the
	// anchor, which isn't reloaded on region create/edit). This $derived
	// recomputes only when relationships / regions change, not per playhead tick,
	// which is where the per-frame-cost (T7) concern is handled. Relationship is
	// structurally assignable to ProjectionCausalEdge.
	// Loaded Event ids — used to filter the takes_place_at index to genuine Events.
	// Endpoint types aren't API-enforced, so a non-Event (e.g. Character) can author a
	// takes_place_at to a Location; that's not "an Event occurs here" and must not feed
	// the cycling/caption selection (Codex PR #72 #084-cycling).
	const eventIds = $derived(
		new Set($entities.filter((e) => e.type === 'Event').map((e) => e.id))
	);
	// The takes_place_at grouping, built ONCE per relationships snapshot (eng
	// decision #5). Shared by causalInput, the cycling resolver, and the caption
	// diff so the indexing isn't rebuilt 3× per playhead tick. Filtered to Event
	// sources (above). Depends on $relationships + $entities.
	const takesPlaceAtIndex = $derived(groupTakesPlaceAt($relationships, eventIds));

	const causalInput = $derived.by(() => {
		const edges = $relationships.filter((r) => r.type === 'caused_by');
		// Group every takes_place_at edge (with its bounds) by Event id. The active
		// Location at the playhead is resolved inside foldCausalEdges via
		// isEdgeVisibleAtT — an Event's location can be temporally scoped, so a
		// timeless lowest-id pick could anchor an edge to an inactive/off-map
		// Location at T (FU1, Codex #66). Cheap t-independent grouping here; the
		// t-dependent pick is per-tick but small. Shared with the between-map
		// cycling resolver (active-location.ts, eng decision #5) so the
		// takes_place_at indexing exists once.
		const takesPlaceAt = takesPlaceAtIndex;
		// Location → centroid from scopedRegions (already user- and scope-filtered).
		// First region wins per Location (deterministic: scopedRegions order).
		// MapRegion.polygon is stored as [[lat, lng], …] in source-image PIXELS
		// (Leaflet convention — PixiRegionLayer draws it as world-space [lng, lat]).
		// PixiCausalEdgeLayer expects FRACTIONAL [0,1] {x,y} and multiplies by
		// activeMap.width/height, so normalize each vertex to [lng/W, lat/H] here:
		// this rescales pixels→fraction AND fixes the lat/lng→y/x transpose, so
		// edges land exactly on the regions PixiRegionLayer draws (Codex review #66).
		const centroidByLocation = new Map<string, ArtifactPosition>();
		const mapW = activeMap?.width ?? 0;
		const mapH = activeMap?.height ?? 0;
		if (mapW > 0 && mapH > 0) {
			for (const r of scopedRegions) {
				if (!r.locationId || !r.polygon) continue;
				if (centroidByLocation.has(r.locationId)) continue;
				const fractional = r.polygon.map(([lat, lng]) => [lng / mapW, lat / mapH]);
				const c = polygonCentroid(fractional);
				if (c) centroidByLocation.set(r.locationId, c);
			}
		}
		return { edges, takesPlaceAt, centroidByLocation };
	});

	// Slice 5 PR-E — Events offered in the "Change owner with cause…" picker.
	const causeEvents = $derived(
		$entities.filter((e) => e.type === 'Event').map((e) => ({ id: e.id, name: e.name }))
	);

	let renderedState = $derived.by<RenderedState | null>(() => {
		if (!projectionCtx) return null;
		const t = $playhead ?? Number.NEGATIVE_INFINITY;
		// Suppress causal edges while the playhead is idle (null). Maps carry a
		// baseline anchor at t_position = -Infinity, so the fold WOULD otherwise run
		// at idle and render timeless caused_by links (scoped ones already filtered
		// by -Infinity) — a half-state that contradicts the playhead-driven causal
		// view. Geometry (takesPlaceAt/centroidByLocation) is preserved so the input
		// identity is stable; only edges are emptied (Codex review #66).
		const causal =
			$playhead === null
				? {
						edges: [],
						takesPlaceAt: causalInput.takesPlaceAt,
						centroidByLocation: causalInput.centroidByLocation
					}
				: causalInput;
		return projectState(t, $mapAnchorsStore, $mapEventsStore, projectionCtx, $placementsStore, causal);
	});

	// ── Cinematic Spotlight (Slice 8) PR1 — playback reaction ───────────────
	//
	// The map's cinematic reaction to the shipped autoplay. The pure controller
	// (playback-controller.ts) owns the frame-diff baseline + pin state; this
	// component just drives it with reactive values and renders the beats. Logic
	// stays OUT of this file beyond the thin wiring below (eng decision #4).
	const playback = createPlaybackReaction();
	// Reactive mirror of playback.pinned (the controller's pin flag is a plain
	// getter, not a rune, so the template can't react to it). Kept in sync via
	// pinView()/unpinView(). Used to distinguish an automatic cycle (playing AND
	// not pinned) from a manual map switch during playback (which pins) — the
	// loading overlay is suppressed only for the former (Codex PR #72).
	let viewPinned = $state(false);
	function pinView(): void {
		playback.pin();
		viewPinned = true;
	}
	function unpinView(): void {
		playback.unpin();
		viewPinned = false;
	}
	// Systemic cycling-suspend on DIRECT interaction: any pointerdown OR focus-in inside
	// the map window during unpinned playback pins the view, so an auto-cycle can't flip
	// activeMapId while the user is acting on a surface that reads it — toolbar selects
	// (linked-location, incl. KEYBOARD focus → focusin), palette drag-and-drop, the
	// canvas, the region menu, file pickers, etc. This is the catch-all backstop for the
	// recurring per-flow pin gaps (Codex PR #72 #101/#102/#856/… — the specific
	// gates/pins remain for the "form stays open across a Play" case the pin alone
	// wouldn't cover). Capture phase so the pin lands BEFORE the child handler reads
	// activeMapId. Idempotent; only during playback (a Play unpins, restoring follow).
	function pinOnMapInteraction(): void {
		if (get(isPlaying) && !playback.pinned) pinView();
	}
	// prefers-reduced-motion → jump-cut: suppress the flashing FX (the owner
	// change still reads via the region tint). Set from matchMedia on mount.
	let reducedMotion = $state(false);
	// Imperative handle to the FX layer (spawnConquest / clearAll).
	let punctuationLayer = $state<ReturnType<typeof PixiPunctuationLayer> | null>(null);
	// The FX layer's spawn*() methods no-op until the dynamic Pixi import + overlay
	// container are live (onReady). Unlike captions, the non-caption beats had no
	// retry path, so an opening conquest/march/ripple that fired before Pixi finished
	// importing was lost even though playback.frame() had already advanced its diff
	// baseline. Buffer those beats here and flush them once onReady fires (Codex
	// PR #72). pixiReady is the readiness flag; pendingBeats holds the init-window beats.
	let pixiReady = false;
	let pendingBeats: Punctuation[] = [];
	// Reset readiness when the FX layer unmounts (e.g. the last map is deleted → the
	// {#if !hasMaps} branch destroys PixiPunctuationLayer). A later remount re-imports
	// Pixi asynchronously and fires onReady again; without this reset, pixiReady would
	// still be true, so the FX effect would call the not-yet-ready layer's no-op spawn*
	// and permanently lose beats in that window instead of buffering them (Codex PR #72
	// #955). Reading punctuationLayer tracks it; null = unmounted.
	$effect(() => {
		if (!punctuationLayer) {
			pixiReady = false;
			pendingBeats = [];
		}
	});
	// Within-map camera target — the changed-this-frame bbox the viewport eases
	// toward. $state so PixiCameraLayer sees it; updated only when beats fire
	// (per boundary), not per frame. Null = hold.
	let cameraTarget = $state<CameraTarget | null>(null);

	// A region's polygon in world [x, y] order (regions store [lat, lng] px, which
	// PixiRegionLayer draws as [lng, lat]). For the camera bbox.
	function regionPolyXY(regionId: string): number[][] | null {
		const r = scopedRegions.find((x) => x.id === regionId);
		if (!r?.polygon || r.polygon.length < 3) return null;
		return r.polygon.map(([lat, lng]) => [lng, lat]);
	}

	// ADR 0007 Fix B — project the CURRENT map at an arbitrary playhead, for the
	// controller's map-switch ripple baseline. Same inputs as the renderedState
	// derive (minus the idle edge-suppression: the controller only calls this
	// with a non-null prior T, where edges are legitimate). Consistency holds
	// because commitCycle populates every store BEFORE flipping activeMapId, so
	// on the first post-switch frame these stores already describe the map
	// renderedState came from.
	function projectAtForRippleBaseline(t: number): RenderedState | null {
		if (!projectionCtx) return null;
		return projectState(
			t,
			$mapAnchorsStore,
			$mapEventsStore,
			projectionCtx,
			$placementsStore,
			causalInput
		);
	}

	// Frame-diff the projected state into punctuation beats; spawn FX and aim the
	// camera at the changed regions. Runs whenever renderedState / playhead /
	// activeMapId changes (the controller guards idle + map-switch + first-frame
	// internally). Reads no $state it writes except cameraTarget (which nothing
	// here reads back), so no reactive loop. FX fire on manual scrub too (by
	// design); the pin flag gates only the camera, not punctuation.
	$effect(() => {
		// Re-run when the FX layer becomes ready so buffered init-window beats flush.
		void captionReadyTick;
		const fresh = playback.frame(renderedState, $playhead, activeMapId, projectAtForRippleBaseline);
		if (!pixiReady) {
			// Pixi import not finished — spawn*() would silently no-op and the beats
			// would be lost (the diff baseline already advanced). Buffer and flush on
			// ready (Codex PR #72).
			if (fresh.length) pendingBeats.push(...fresh);
			return;
		}
		const beats = pendingBeats.length ? pendingBeats.concat(fresh) : fresh;
		pendingBeats = [];
		if (beats.length === 0) return;
		const conquests = beats.filter((b): b is ConquestFlip => b.type === 'conquest');
		const marches = beats.filter((b): b is MarchTrail => b.type === 'march');
		const ripples = beats.filter((b): b is CausalRipple => b.type === 'ripple');
		punctuationLayer?.spawnConquest(conquests);
		punctuationLayer?.spawnMarch(marches);
		punctuationLayer?.spawnRipple(ripples);

		// Aim the camera at the LOCALIZED changes this frame — flipped regions and
		// the markers that actually moved. Marches only (not every mover): an
		// unrelated marker elsewhere shouldn't pull the camera off the action.
		// Ripples can span the whole map (cause↔effect far apart), so they don't
		// drive the camera — framing them would yank it out on every causal link.
		const mapW = activeMap?.width ?? 0;
		const mapH = activeMap?.height ?? 0;
		const polys = conquests
			.map((b) => regionPolyXY(b.regionId))
			.filter((p): p is number[][] => !!p);
		const movers =
			mapW > 0 && mapH > 0 ? marches.map((m) => ({ x: m.toX * mapW, y: m.toY * mapH })) : [];
		if (polys.length === 0 && movers.length === 0) return;
		const vp = pixiViewport as { screenWidth?: number; screenHeight?: number } | null;
		const screen = { width: vp?.screenWidth ?? mapW, height: vp?.screenHeight ?? mapH };
		const t = computeCameraTarget(polys, movers, screen);
		if (t) cameraTarget = t;
	});

	// A map switch drops the camera target so the camera doesn't drift toward the
	// previous map's coordinates before the next flip on the new map. It also drops
	// any beats buffered while Pixi was still importing (G/#893): they belong to the
	// previous map, so flushing them after the switch would render old-map march/
	// ripple FX over the new map and pull its camera to stale coordinates (Codex PR #72).
	$effect(() => {
		void activeMapId;
		cameraTarget = null;
		pendingBeats = [];
	});

	// Unpin the view when playback (re)starts: pressing Play resumes camera-follow
	// even if the user had pinned by panning. One-shot on the false→true edge.
	let wasPlaying = false;
	$effect(() => {
		const playing = $isPlaying;
		if (playing && !wasPlaying) {
			unpinView();
			// Restart cycling hysteresis from a clean slate: the previous run's
			// target Location must not stick across a fresh Play (or the user may
			// have manually navigated while paused).
			cyclePrevTargetLoc = null;
			// A stale settled-T from the previous run must not feed a fresh Play's
			// first cycle commit (Fix B baseline).
			cycleSettledT = null;
			// Drop the prefetch cache so a fresh Play never commits a STALE region
			// snapshot. A map's regions can be edited while paused (manual nav pins,
			// so edits only happen off-playback); re-prefetching on the next Play
			// keeps cached commits in sync with the store. (review: cycleCache never
			// invalidated — confirmed by codex + code-reviewer subagent.)
			cycleDataCache.clear();
			cyclePrefetching.clear();
			cycleFailed.clear(); // give failed/absent targets one retry on this fresh Play
			// Invalidate any prefetch still in flight from the previous run so its
			// late result can't repopulate the just-cleared cache (Codex PR #72).
			cycleGeneration++;
			// Replay / start-over: playhead.play() rewinds the playhead to 0 when it
			// was idle or had reached maxT. The diff baseline is dropped in
			// playback.frame() on that backward jump (no reverse flashes), but any FX
			// still gliding from the final scene — and the last camera target — would
			// otherwise linger over the rewound map; clear them so the replay starts clean.
			if (get(playhead) === 0) {
				punctuationLayer?.clearAll();
				cameraTarget = null;
			}
		}
		wasPlaying = playing;
	});

	// Camera-follow is active during playback when not pinned. Reduced motion does
	// NOT disable it: the camera still frames conquests, but PixiCameraLayer eases
	// with tau=0 so the move is an instant jump-cut rather than a glide — matching
	// the changelog ("camera moves become instant jump-cuts") and the layer's own
	// reduced-motion path. Suppressing follow here would leave a reduced-motion user
	// panned away from a conquest with no way to see it. A getter (not reactive) the
	// camera ticker calls each frame.
	function cameraActive(): boolean {
		return get(isPlaying) && !playback.pinned;
	}

	// ── Between-map Spotlight cycling (Slice 8) PR2 ─────────────────────────
	//
	// The macro camera: as the playhead crosses into a different most-specific
	// active Location's map, the view switches to that map. Built on the pure
	// resolver (active-location.ts) + switch-only-when-ready so a switch never
	// flashes a half-loaded map.
	//
	// Invariants (eng decisions #1, #3, T7):
	//   - Cycles ONLY during unpinned playback. Any manual map-select / pan / zoom
	//     pins (playback.pin()) and suspends cycling until the next Play.
	//   - switch-only-when-ready: commit a target map only when its regions are
	//     CACHED (prefetched off the shared store); else hold the current map and
	//     catch up once the prefetch lands.
	//   - Cycling NEVER touches `lastAppliedEntityId` (the deep-link arbiter's
	//     ownership token) — a cycle is not a deep-link, so the existing one-shot +
	//     external-entityId auto-switch (the T7 regression) behaves exactly as
	//     before. Cycling writes only activeMapId + the regions store.
	// Cached full map CONTEXT per prefetched map. The cycling driver stages a target
	// map's regions AND its projection context (anchors / events / placements /
	// layer-prefs) so commit can apply them ALL atomically — switch-only-when-ready
	// now covers every map-scoped store, not just regions, so an auto-cycle never
	// shows the new map's background+regions combined with the previous map's markers,
	// terrain, causal edges, or layer visibility (Codex PR #72 #505; product decision
	// 2026-06-06 "Option 1: staged prefetch"). `locationId` is the target's anchor
	// Location — needed to prefetch its placements (which load keyed on locationId).
	type CycleBundle = {
		regions: MapRegion[];
		anchors: MapAnchor[];
		events: MapEvent[];
		placements: MapPlacement[];
		layerPrefs: Map<string, boolean>;
		locationId: string | null;
	};
	const cycleDataCache = new Map<string, CycleBundle>();
	const cyclePrefetching = new Set<string>();
	// One-shot signal: after commitCycle applies a target's buffered context and flips
	// activeMapId, the activeMapId load effect would re-fetch anchors/events AND re-run
	// layerPrefs.load (which flashes an empty 'loading' state). This tells that effect
	// to skip the redundant load for the just-committed map exactly once (Codex PR #72
	// #505). Placements/anchors/events load() set-at-end, so a redundant reload there
	// causes no flash — only this effect (via layerPrefs) needs the guard.
	let cyclePreloadedMapId: string | null = null;
	// Maps whose prefetch returned not-found or threw this generation. The cycling
	// effect re-runs every playback boundary while the same target stays active, so
	// without this a 404/error target would be re-requested forever — recurring
	// traffic + console noise. Skipped here and reset whenever the generation rolls
	// (Play-reset / cache invalidation), since a 404 won't resolve itself mid-run
	// and a transient error is worth one retry on the next Play (Codex PR #72).
	const cycleFailed = new Set<string>();
	// Previous map-bearing target Location (resolver hysteresis state). Reset on
	// each Play (above) and when a manual switch pins.
	let cyclePrevTargetLoc: string | null = null;
	// Last playhead position the cycling driver saw, for the look-ahead prefetch's
	// velocity estimate (Codex PR #72 — cycle latency). null when not cycling so the
	// estimate never spans a pause gap.
	let lastCyclePlayheadT: number | null = null;
	// ADR 0007 Fix B — the last playhead at which the view was SETTLED on the
	// active map (resolved target == shown map). At commit time this is the true
	// pre-boundary T: lastPlayhead inside the controller has already advanced past
	// the act boundary (the FX frame runs before this driver in the same flush),
	// and a prefetch-delayed commit lands whole ticks later. Announced to the
	// controller via noteCycleCommit so the ripple baseline projects the new map
	// at a T where boundary-lit edges were still unlit.
	let cycleSettledT: number | null = null;
	// Reactive nonce bumped when a prefetch lands. cycleCache is a plain Map (not
	// reactive), so without this a prefetch that completes BETWEEN playhead ticks
	// wouldn't wake the cycling effect — a Location active for only one scene could
	// be prefetched-then-skipped. Reading it in the effect makes a completed
	// prefetch re-evaluate (and commit) immediately. (review: Codex prefetch-commit.)
	let cyclePrefetchTick = $state(0);
	// Playback-generation token. Bumped on each Play-reset; a prefetch captures it
	// at dispatch and drops its result (and skips clearing the in-flight marker) if
	// the generation moved while it was in flight — so a prefetch started before a
	// pause+edit+Play can't repopulate the cache with pre-edit regions or delete a
	// newer request's marker (Codex PR #72).
	let cycleGeneration = 0;

	// Drop a prefetched regions snapshot when that map's regions are edited in the
	// same playback run (region create/update/delete). Without this, a later A→B→A
	// cycle would re-commit the pre-edit snapshot from cache and make the saved edit
	// disappear from the client (Codex PR #72). Edits can happen while playback
	// continues unpinned, so we also bump the generation + clear the in-flight
	// markers so any prefetch already mid-flight drops its (now stale) result and the
	// cycling effect re-prefetches the fresh regions on its next tick.
	function invalidateCycleCache(mapId: string): void {
		cycleDataCache.delete(mapId);
		cyclePrefetching.clear();
		cycleFailed.clear();
		cycleGeneration++;
	}

	// Like invalidateCycleCache but drops EVERY cached bundle whose anchor Location
	// matches `locationId`. Placements are loaded/prefetched by locationId, so all map
	// VARIANTS of the same Location share a placement set — a placement create/delete
	// must invalidate every cached sibling variant or cycling to one would resurrect a
	// deleted marker / drop a new one (Codex PR #72 #861). The generation bump cancels
	// any in-flight prefetch too (they re-issue with fresh data).
	function invalidateCycleCacheForLocation(locationId: string): void {
		for (const [mid, bundle] of cycleDataCache) {
			if (bundle.locationId === locationId) cycleDataCache.delete(mid);
		}
		cyclePrefetching.clear();
		cycleFailed.clear();
		cycleGeneration++;
	}

	// Drop the active map's staged bundle whenever its PER-MAP cached data changes —
	// events (incl. brush authoring + undo/redo), layer-prefs, or regions. The staged
	// cache holds these, so without this a mutation on cached map A during playback then
	// an A→B→A cycle would re-apply A's PRE-edit bundle and visibly revert the change
	// (Codex PR #72 #952). These stores are static during passive playback (only the
	// playhead moves), so this fires only on a real load/commit/edit — not per frame.
	$effect(() => {
		void $mapEventsStore;
		void $layerPrefs;
		void $mapRegions;
		const id = activeMapId;
		if (!id) return;
		if (cyclePrefetching.has(id)) {
			// The active map is mid-prefetch (e.g. a look-ahead started before a manual
			// switch onto it) and its staged data just changed; the in-flight request
			// would otherwise complete and repopulate the cache with the PRE-edit
			// snapshot. Supersede it via the generation bump (Codex PR #72 #860).
			invalidateCycleCache(id);
		} else {
			// No in-flight request for this map → a plain delete suffices and leaves
			// other maps' look-ahead prefetches undisturbed.
			cycleDataCache.delete(id);
		}
	});

	// Placements are LOCATION-scoped (loaded/prefetched by locationId) and shared across
	// a Location's map variants, so a placement change — including a style edit via the
	// popover, which goes through mapPlacements.update and bypasses the create/delete
	// handlers' invalidation — must drop every cached bundle for that Location, not just
	// the active map's (Codex PR #72 #736; create/delete already do this in their
	// handlers). Plain delete (no generation bump) keeps other maps' look-ahead
	// prefetches undisturbed; #736's race is a COMPLETED stale sibling bundle, which a
	// delete clears.
	$effect(() => {
		void $placementsStore;
		const loc = activeMap?.locationId;
		if (!loc) {
			if (activeMapId) cycleDataCache.delete(activeMapId);
			return;
		}
		// If a prefetch for a map of THIS Location is in flight, a GET started before
		// the edit could complete afterward and repopulate the cache with the stale
		// placement (e.g. a style edit while a sibling variant is mid-prefetch — the
		// popover suspends cycling but the marker tap doesn't pin). Supersede it via the
		// generation bump, exactly as the create/delete handlers do (Codex PR #72 #840).
		// Otherwise a plain location-wide delete suffices (the common #736 case: a
		// completed stale sibling bundle) and leaves other maps' look-aheads undisturbed.
		const siblingInFlight = [...cyclePrefetching].some(
			(mid) => $worldMaps.find((m) => m.id === mid)?.locationId === loc
		);
		if (siblingInFlight) {
			invalidateCycleCacheForLocation(loc);
		} else {
			for (const [mid, bundle] of cycleDataCache) {
				if (bundle.locationId === loc) cycleDataCache.delete(mid);
			}
		}
	});

	// Resolve the map the story occupies at T → the map-bearing target Location
	// and its variant's mapId, or null to hold. PURE w.r.t. the hysteresis cursor:
	// it READS cyclePrevTargetLoc but does NOT write it, so a not-yet-shown target
	// is never recorded as the hysteresis winner (Codex PR #72). The cursor is
	// advanced only on an actual commit (commitCycle). `hasMap` uses strict variant
	// resolution so a Location whose only map is out of the current window doesn't
	// count as map-bearing and pre-empt the ancestor fallback.
	function resolveCycleTarget(t: number): { mapId: string; loc: string } | null {
		const ranked = activeLocationsAtT($relationships, t, hierarchyIndex, takesPlaceAtIndex);
		const hasMap = (locId: string) =>
			resolveActiveVariant($worldMaps, locId, t, { strict: true }) != null;
		const targetLoc = pickCyclingTarget(ranked, hasMap, hierarchyIndex, cyclePrevTargetLoc);
		if (!targetLoc) return null;
		const mapId = resolveActiveVariant($worldMaps, targetLoc, t, { strict: true })?.id ?? null;
		if (!mapId) return null;
		return { mapId, loc: targetLoc };
	}

	// Fetch a target map's FULL context (regions + anchors + events + placements +
	// layer-prefs) into the cache without disturbing the visible map, so commit can
	// apply it all at once (#505). Deduped against in-flight prefetches; failures are
	// non-fatal (the resolver keeps holding the current map). Regions failure (null)
	// counts as not-found; layer-prefs failures degrade to defaults (non-throwing).
	async function prefetchCycle(mapId: string): Promise<void> {
		if (cycleDataCache.has(mapId) || cyclePrefetching.has(mapId) || cycleFailed.has(mapId)) return;
		const gen = cycleGeneration;
		cyclePrefetching.add(mapId);
		try {
			const locationId = $worldMaps.find((m) => m.id === mapId)?.locationId ?? null;
			const [regionsData, anchors, events, placements, layerPrefsMap] = await Promise.all([
				worldMapStore.prefetchMapRegions(mapId),
				mapAnchorsStore.prefetch(mapId),
				mapEventsStore.prefetch(mapId),
				locationId
					? placementsStore.prefetch({ locationId })
					: Promise.resolve([] as MapPlacement[]),
				layerPrefs.prefetch(mapId)
			]);
			// Superseded by a Play-reset / edit while in flight: drop the (now-stale)
			// result rather than caching pre-edit data / waking a commit.
			if (gen !== cycleGeneration) return;
			if (regionsData) {
				cycleDataCache.set(mapId, {
					regions: regionsData.regions,
					anchors,
					events,
					placements,
					layerPrefs: layerPrefsMap,
					locationId
				});
				cyclePrefetchTick++; // wake the cycling effect so it can commit now
			} else {
				cycleFailed.add(mapId); // not-found: don't re-request it this generation
			}
		} catch (err) {
			console.error('Spotlight cycle prefetch failed:', mapId, err);
			if (gen === cycleGeneration) cycleFailed.add(mapId); // back off until next Play
		} finally {
			// Only clear the marker we own; after a reset a newer request may hold it.
			if (gen === cycleGeneration) cyclePrefetching.delete(mapId);
		}
	}

	// Commit a staged map switch: apply the WHOLE buffered context (regions, anchors,
	// events, placements, layer-prefs) atomically, mark every map-scoped readiness
	// gate healthy, then flip activeMapId. Because all stores are populated for the
	// target BEFORE the flip, the render never combines new-map regions with old-map
	// markers/terrain/edges/layers — staged-prefetch closes the #505 flash. The
	// activeMapId load effect is told (cyclePreloadedMapId) to skip its redundant
	// reload (which would re-flash layer-prefs). Advancing the hysteresis cursor HERE
	// anchors it on the map actually shown (Codex PR #72).
	//
	// NOTE: the placements load effect keys on activeMap.locationId (a SEPARATE effect
	// we don't gate), so it re-fetches the just-applied placements once after the flip.
	// That refetch is harmless — `load()` sets-at-end, so the prefetched placements
	// stay visible (no flash) and the overlay is suppressed during cycling — it's only
	// a small wasted round-trip. We still prefetch+apply placements so the NEW map's
	// markers are correct the instant it shows rather than flashing the old map's.
	function commitCycle(mapId: string, loc: string, bundle: CycleBundle): void {
		// `decideCycleAction` only returns 'commit' for a DIFFERENT map, so this never
		// fires for the active map. Guard it anyway: the one-shot cyclePreloadedMapId is
		// consumed by the activeMapId load effect, which only re-runs if activeMapId
		// actually changes — committing the already-active map would set the flag with
		// nothing to consume it, wrongly skipping a later genuine reload of this map.
		if (mapId === activeMapId) return;
		worldMapStore.applyPrefetchedRegions(mapId, bundle.regions);
		mapAnchorsStore.applyPrefetched(mapId, bundle.anchors);
		mapEventsStore.applyPrefetched(mapId, bundle.events);
		placementsStore.applyPrefetched(bundle.placements);
		layerPrefs.applyPrefetched(mapId, bundle.layerPrefs);
		mapRegionsHealthy = true;
		regionsSettled = true;
		projectionCtxHealthy = true;
		anchorsEventsSettled = true;
		placementsLoading = false;
		cyclePreloadedMapId = mapId; // load effect skips the redundant reload once
		cyclePrevTargetLoc = loc;
		// ADR 0007 Fix B: hand the controller the pre-boundary playhead before the
		// flip below triggers the switch frame, so the ripple baseline projects the
		// new map at a T where boundary-lit edges were still unlit.
		playback.noteCycleCommit(cycleSettledT);
		activeMapId = mapId;
	}

	// Bound from PixiRegionLayer: true while its region context-menu or cause modal is
	// open. Feeds the authoringOpen gate so cycling can't switch maps mid-action
	// (Codex PR #72 #953).
	let childAuthoringOpen = $state(false);
	// Bound from PixiPlacementLayer: true while its marker menu / style popover is
	// open. Also feeds the authoringOpen gate (Codex PR #72 #857).
	let placementAuthoringOpen = $state(false);

	// True while ANY authoring form/flow OR canvas interaction is open. Cycling must
	// stay suspended for the whole flow — a playhead advance (or a Play that unpins)
	// flipping activeMapId mid-edit would PATCH/create the captured contents against a
	// different map. This is the systemic backstop for the per-flow pins: even if a
	// flow forgets to pin, or playback restarts while a modal is open, the open
	// form/interaction gates cycling off (Codex PR #72 — repeated pin-gap findings
	// #450/#959/#061/#950). `canvasMode !== 'idle'` covers active brush / place / move
	// / polygon-draw gestures (a cycle mid-brush-stroke would post the stroke's cells
	// to the wrong map on pointer-up); `childAuthoringOpen` covers the region-layer
	// context-menu / cause modal the child owns (#953).
	let authoringOpen = $derived(
		showRegionForm ||
			showVariantForm ||
			renamingMapName !== null ||
			creatingToolbarLocation ||
			createMapOffer !== null ||
			pixiDrawingActive ||
			canvasMode !== 'idle' ||
			childAuthoringOpen ||
			placementAuthoringOpen ||
			deleteConfirm !== null
	);

	// The cycling driver. Re-runs on every playhead advance (and on play/pause):
	// resolve the target, then commit-if-cached / prefetch-and-hold. Suspended
	// while pinned, idle, or any authoring flow is open.
	$effect(() => {
		const playing = $isPlaying;
		const t = $playhead;
		// Touch the stores the resolver reads + the prefetch nonce so the effect
		// re-runs when relationships/maps change or a prefetch lands.
		void $relationships;
		void $worldMaps;
		void cyclePrefetchTick;
		if (!playing || playback.pinned || authoringOpen || t === null) {
			lastCyclePlayheadT = null; // velocity estimate must not span a pause/idle gap
			return;
		}
		const target = resolveCycleTarget(t);
		const action = decideCycleAction(
			target?.mapId ?? null,
			activeMapId,
			target != null && cycleDataCache.has(target.mapId)
		);
		if (action === 'hold') {
			// Seed the hysteresis cursor when the resolved target's map is ALREADY
			// shown (the common "no initial cycle needed" case): without this the
			// cursor stays null and the first brief overlap with a more-specific
			// Location would strobe to its map. A null/pending target is still never
			// recorded — only a resolved target whose map is on screen (Codex PR #72).
			if (target && target.mapId === activeMapId) {
				cyclePrevTargetLoc = target.loc;
				// The view is settled here: the shown map is the resolved target. This
				// is the last pre-boundary T the Fix B ripple baseline can project at.
				cycleSettledT = t;
			}
		} else if (action === 'commit') {
			commitCycle(target!.mapId, target!.loc, cycleDataCache.get(target!.mapId)!);
		} else {
			void prefetchCycle(target!.mapId); // hold current map; commit when ready
		}

		// Look-ahead: warm the cache for the map the story is ABOUT to enter, so the
		// commit is INSTANT when the playhead crosses the boundary instead of stalling
		// a prefetch round-trip into the new act (Codex PR #72 — cycle latency: an
		// auto-cycle was otherwise committing near the act's end). Decision is the pure
		// `cycleLookaheadTarget`; this only prefetches the result (never commits).
		const warmMapId = cycleLookaheadTarget(
			t,
			lastCyclePlayheadT,
			resolveCycleTarget,
			activeMapId,
			(id) => cycleDataCache.has(id)
		);
		if (warmMapId) void prefetchCycle(warmMapId);
		lastCyclePlayheadT = t;
	});

	// ── Diegetic captions (Slice 8) PR3 / T9 ────────────────────────────────
	//
	// Title each Event as it becomes active at T, reusing the SAME selection model
	// as the camera/FX/cycling (activeEventIdsAtT → the resolver, no rework). Diff
	// the active-event set frame to frame; a newly-active Event's name is shown as
	// a lower-third card. The card layer supersedes, so a simultaneous burst just
	// leaves the last one up rather than stacking. Idle resets the baseline (the
	// next play re-titles the opening beats); fires on manual scrub too, like FX.
	// Event id → name, built once per entities snapshot so the caption diff is a
	// keyed lookup rather than a linear scan. Restricted to type === 'Event':
	// takes_place_at endpoints are not type-enforced (the Character relationship
	// editor can author Character→Event/Scene rows), and a caption must title an
	// Event, never a Character/Scene that happens to be a takes_place_at fromId
	// (Codex PR #72). A non-Event id resolves to no name and is skipped.
	const eventNameById = $derived(
		new Map(
			$entities.filter((e) => e.type === 'Event').map((e) => [e.id, e.name] as const)
		)
	);
	// Bumped when the FX layer's caption pipeline becomes ready (Pixi imported).
	// Reading it in the caption effect creates a reactive dependency so an opening
	// beat that fired before Pixi finished importing is retried once it can render,
	// rather than dropped if the playhead doesn't advance again (Codex PR #72).
	let captionReadyTick = $state(0);
	// All loaded entity ids — lets the caption effect tell "this id's entity hasn't
	// loaded yet" (retry) from "loaded and it's a non-Event" (genuinely skip), so an
	// Event active before its entity load finishes isn't marked handled forever
	// (Codex PR #72). Reading it in the effect also makes it re-run when entities land.
	const allEntityIds = $derived(new Set($entities.map((e) => e.id)));
	let lastActiveEventIds = new Set<string>();
	// Last non-null playhead the caption diff saw, for backward-jump detection.
	let lastCaptionT: number | null = null;
	$effect(() => {
		const t = $playhead;
		void $relationships;
		void captionReadyTick;
		if (t === null) {
			lastActiveEventIds = new Set();
			lastCaptionT = null;
			// Idle: no Event is active, so clear any caption still on screen rather
			// than leaving the previous Event's title up for its remaining lifetime
			// (Codex PR #72). FX are left to decay on their own.
			punctuationLayer?.clearCaption();
			return;
		}
		// Replay/reverse: playhead.play() rewinds end→0 WITHOUT passing through idle,
		// so the baseline would retain Events active at the final position and an Event
		// active at both end and start (timeless/full-story) would never re-title on
		// replay. Drop the baseline on any backward jump so opening beats fire again
		// (Codex PR #72).
		if (lastCaptionT !== null && t < lastCaptionT) lastActiveEventIds = new Set();
		lastCaptionT = t;
		// scopedOnly: a caption titles an Event when its scene happens, so only an
		// Event active via a SCOPED takes_place_at counts. A timeless link would
		// otherwise mark every linked Event active at every T (all captioned on frame
		// one, none re-titled at their real scene) — product decision 2026-06-06 / #889.
		const ids = activeEventIdsAtT($relationships, t, takesPlaceAtIndex, { scopedOnly: true });
		// Rebuild the baseline from the currently-active ids, but only record an id
		// as titled if its caption actually rendered. If Pixi/the layer isn't ready
		// yet, spawnCaption returns false and we leave the id OUT, so a still-active
		// opening beat is retried next tick instead of being skipped forever
		// (Codex PR #72).
		const next = new Set<string>();
		// Carry over already-titled ids that are still active.
		for (const id of ids) {
			if (lastActiveEventIds.has(id)) next.add(id);
		}
		// Title each newly-active id; only record it as titled if it rendered.
		for (const id of diffNewlyActiveEvents(lastActiveEventIds, ids)) {
			const name = eventNameById.get(id);
			let handled: boolean;
			if (name) {
				handled = punctuationLayer?.spawnCaption(name) ?? false;
			} else if (allEntityIds.has(id)) {
				handled = true; // entity loaded but not an Event (no caption) → genuinely skip
			} else {
				handled = false; // entity not loaded yet → retry once its name arrives
			}
			if (handled) next.add(id);
		}
		lastActiveEventIds = next;
	});

	// Terrain cells, clamped to the current grid. projectState emits every
	// STORED cell (sparse, bounds-agnostic by design), but a cell outside the
	// grid — e.g. left behind when a map was re-fit to a smaller grid — has no
	// valid square and would draw off-grid. The terrain layers consume this
	// clamped list so out-of-range cells render nowhere (the data survives; it
	// reappears if the grid grows back).
	let boundedTerrainCells = $derived.by(() => {
		const cells = renderedState?.cells ?? [];
		const gx = activeMap?.gridCellsX ?? Infinity;
		const gy = activeMap?.gridCellsY ?? Infinity;
		return cells.filter((c) => c.x >= 0 && c.x < gx && c.y >= 0 && c.y < gy);
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

	// Bug 2 — the saved layer config AND the placements load on their own
	// fetches a beat after the map mounts, so layers flashed/popped in. The
	// layer-vis store hides layers while prefs load; here we cover the canvas
	// with an explicit loading state until BOTH the layer-prefs round-trip and
	// the placements load have settled, so nothing pops in afterward. Both
	// inputs are bounded (layer-prefs leaves 'loading' on success/error;
	// placementsLoading is cleared in .finally()), so the overlay can't stick.
	// `placementsLoading` is declared with the placements loader below.
	let mapLoading = $derived(
		activeMapId != null &&
			($layerPrefs.status === 'loading' ||
				!anchorsEventsSettled ||
				!regionsSettled ||
				!factionsSettled ||
				(activeMap?.locationId != null && placementsLoading))
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
		// Beginning a polygon draw is region authoring: pin so PR2 cycling can't
		// switch maps before the user saves, which would create the new region on
		// the wrong map (the save handler runs against the live activeMapId).
		// (Codex PR #72)
		pinView();
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
		// Slice 4 T7: only the place-armed mode consumes a canvas tap. Gate on
		// the same load condition the drop path uses (handleAssetDrop) — a
		// placement POST landing mid-load can be clobbered when the in-flight
		// placements GET replaces the store with its pre-create rows.
		const placeableId = armedPlaceableId;
		if (canvasMode !== 'place-armed' || mapLoading || placeableId === null) return;
		// Disarm synchronously before the await so a quick second click can't
		// fire createPlacementAt twice while the POST is in flight.
		armedPlaceableId = null;
		void createPlacementAt(placeableId, fx, fy);
	}

	async function createPlacementAt(placeableId: string, x: number, y: number) {
		placementError = '';
		// Capture the target map + Location before the await: placements are keyed by
		// locationId and shared across that Location's map variants, so invalidate ALL
		// cached bundles for this Location — not just the active map, and not whichever
		// map is active when the request resolves (Codex PR #72 #104 + #861).
		const mapId = activeMap?.id ?? null;
		const locationId = activeMap?.locationId ?? null;
		try {
			// Slice 4 PR-A (D1 reference model): a placement references the
			// existing entity directly, so the old `source_asset_id` provenance
			// field was always equal to placeableId and carried no information.
			// Both the click-to-place and drag-drop paths now create a plain
			// placement; per-instance differences live in placement.data.style.
			await placementsStore.create({
				placeableId,
				locationId,
				mapId,
				x,
				y
			});
			if (locationId) invalidateCycleCacheForLocation(locationId);
			else if (mapId) invalidateCycleCache(mapId);
		} catch (err) {
			placementError = err instanceof Error ? err.message : String(err);
		}
	}

	// Slice 3 T8' — drop handler for placeable-palette drags. Pixi canvas
	// lives inside PixiStage's pixi-stage div; we wrap the stage with
	// listeners. dragover must preventDefault so the drop event fires.
	function handleAssetDragOver(e: DragEvent): void {
		if (!e.dataTransfer) return;
		// Accept only our custom MIME type. Files / text / images get
		// the "no drop" cursor — the user can't accidentally place from
		// an OS file drag.
		if (!Array.from(e.dataTransfer.types).includes(ASSET_DRAG_MIME)) return;
		// Block the drop if the active map can't host a placement (no
		// linked Location → no anchor for the placement to bind to), while
		// the map is still loading (codex P2: a placement POST during the
		// placements GET can be clobbered when the in-flight load replaces the
		// store with pre-drop rows), or while a pointer-owning mode is active
		// (Slice 4 T7: brush/draw own the canvas — HTML5 drag is a separate
		// event stream, so the drop must respect the same CanvasMode invariant
		// the click path does). Drops bubble through the loading overlay to
		// this handler, so guard here too.
		if (!activeMap?.locationId || mapLoading || canvasMode === 'brush' || canvasMode === 'draw') {
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
		// Slice 4 T7: the drop path respects the same CanvasMode gate as the
		// click path (handleCanvasClick). brush/draw own the pointer; a drop
		// arriving via the separate HTML5 drag stream must not place a marker
		// mid-brush/draw.
		if (canvasMode === 'brush' || canvasMode === 'draw') return;
		// codex P2: ignore drops while the map is still loading — a placement
		// POST mid-load can be overwritten by the in-flight placements GET.
		if (mapLoading) return;
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
		// Slice 4 T7: a drop completes a placement, so clear any pending
		// click-to-place arm — otherwise dropping chip B while chip A is armed
		// would leave A armed and the next plain canvas tap would place it too.
		armedPlaceableId = null;
		void createPlacementAt(assetId, fx, fy);
	}

	async function deletePlacement(id: string) {
		// Capture the owning Location before the await; placements are shared across the
		// Location's map variants, so invalidate every cached bundle for it even if a
		// cycle moves on mid-request (Codex PR #72 #104 + #861).
		const mapId = activeMap?.id ?? null;
		const locationId = activeMap?.locationId ?? null;
		try {
			await placementsStore.delete(id);
			if (locationId) invalidateCycleCacheForLocation(locationId);
			else if (mapId) invalidateCycleCache(mapId);
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
	// Bug 2 (placeables) — placements load on their own fetch, separate from
	// the layer-prefs round-trip, so the on-canvas markers popped in a beat
	// after the map appeared. `placementsLoading` (declared up top, near the
	// other UI state) tracks the in-flight load so the loading overlay can stay
	// up until they land. Bounded: cleared in .finally() and on the
	// no-location branch, so it never sticks.
	$effect(() => {
		const locId = activeMap?.locationId;
		if (!locId) {
			// No anchor Location → no placements to show. Clear the store locally
			// rather than issuing a request the server would reject as invalid
			// UUID syntax (locationId column is uuid, no sentinel works).
			placementsStore.reset();
			placementsLoading = false;
			return;
		}
		placementsLoading = true;
		let cancelled = false;
		void placementsStore
			.load({ locationId: locId })
			.catch((err) => console.error('Failed to load placements:', err))
			.finally(() => {
				if (!cancelled) placementsLoading = false;
			});
		return () => {
			cancelled = true;
		};
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
				// Window opened for a specific entity → explicit navigation intent. Pin
				// so cycling can't switch away from it (the external deep-link watcher
				// won't fire for this initial resolve — Codex PR #72).
				pinView();
				switchMap(variant.id);
				return;
			}
			const targetRegion = $mapRegions.find((r) => r.locationId === entityId);
			if (targetRegion) {
				pinView();
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
		const targetRegion = variant ? undefined : $mapRegions.find((r) => r.locationId === entityId);
		// An external deep-link is explicit navigation intent and must take precedence
		// over PR2 cycling. Pin as soon as we recognize a valid target — even when its
		// map is ALREADY active — so the driver can't switch away from the requested
		// map on the next playhead tick (Codex PR #72). Only a switch is conditional.
		if (variant || targetRegion) pinView();
		if (variant && variant.id !== activeMapId) {
			switchMap(variant.id);
			return;
		}
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
			// Manual drill (region popup / breadcrumb) is user map-navigation, so it
			// pins the view and suspends PR2 cycling — else the cycling effect would
			// switch the map back to the spotlight target on the next playhead tick.
			// (The toolbar dropdown pins in its own wrapper; this covers the other
			// two manual nav paths. review: drill/breadcrumb clobbered — codex.)
			pinView();
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
		// Opening the edit form is region authoring: pin so cycling can't switch maps
		// before Save sends this map's region id to a different map (Codex PR #72).
		pinView();
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
		// Deleting a region is manual interaction: pin so PR2 cycling can't switch
		// maps across the awaited DELETE + post-delete interval cleanup. The cleanup's
		// `otherRegions` check reads the singleton `$mapRegions`, so a mid-flight cycle
		// would let the switched map's rows make `otherRegions` look empty and wrongly
		// delete the location's scene intervals. Pinning keeps the store on this map;
		// the captured `mapId` additionally guards the DELETE + cache call (Codex PR #72).
		pinView();
		const mapId = activeMapId;
		const region = $mapRegions.find((r) => r.id === regionId);
		try {
			await worldMapStore.deleteRegion(mapId, regionId);
			invalidateCycleCache(mapId);
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

	// Apply a loadMapRegions result to the readiness gate. Only a `loaded` result
	// for the still-active map marks healthy; `not-found` settles the overlay but
	// stays unhealthy; a `superseded` result is a no-op so an A→B→A stale load
	// can't flip the gate (and permit writes) against an old snapshot before the
	// authoritative load lands (Codex PR #72). Also guards activeMapId so a load
	// for a map we've since switched away from never touches the gate.
	function applyRegionLoad(result: LoadRegionsResult, mapId: string): void {
		if (activeMapId !== mapId || result.status === 'superseded') return;
		mapRegionsHealthy = result.status === 'loaded';
		regionsSettled = true;
	}

	async function switchMap(mapId: string) {
		activeMapId = mapId;
		mapRegionsHealthy = false;
		regionsSettled = false;
		try {
			applyRegionLoad(await worldMapStore.loadMapRegions(mapId), mapId);
		} catch (err) {
			console.error('Failed to load regions for map:', mapId, err);
			// Stay unhealthy — dataLoading remains true, blocking writes — but
			// mark settled so the loading overlay doesn't stick on error.
			if (activeMapId === mapId) regionsSettled = true;
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
		// `authoringOpen` (creatingToolbarLocation) gates cycling off for this whole
		// flow, but capture the map id before the await anyway so the link lands on the
		// map authoring began on regardless (Codex PR #72).
		const mapId = activeMapId;
		toolbarNewLocationBusy = true;
		toolbarNewLocationError = '';
		try {
			const created = await entities.createEntity('Location', name);
			await worldMapStore.updateMap(mapId, { locationId: created.id });
			creatingToolbarLocation = false;
			toolbarNewLocationName = '';
		} catch (err) {
			toolbarNewLocationError = err instanceof Error ? err.message : String(err);
		} finally {
			toolbarNewLocationBusy = false;
		}
	}

	async function handleCreateMap() {
		// Creating a map is explicit navigation to a map the user wants to edit — pin
		// so cycling doesn't immediately commit the story target and switch away from
		// the new map before they can touch it (Codex PR #72).
		pinView();
		const map = await worldMapStore.createMap('New Map');
		activeMapId = map.id;
		mapRegionsHealthy = false;
		regionsSettled = false;
		try {
			applyRegionLoad(await worldMapStore.loadMapRegions(map.id), map.id);
		} catch (err) {
			console.error('Failed to load regions for new map:', err);
			if (activeMapId === map.id) regionsSettled = true;
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
		regionsSettled = false;
		if (nextId) {
			try {
				applyRegionLoad(await worldMapStore.loadMapRegions(nextId), nextId);
			} catch (err) {
				console.error('Failed to load regions for switched map:', err);
				if (activeMapId === nextId) regionsSettled = true;
			}
		} else {
			// No map left to show — nothing to wait for.
			regionsSettled = true;
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
			// Capture the map id too: an automatic cycle can flip activeMapId while
			// a write awaits, so reading it again post-await would target/invalidate
			// the wrong map (Codex PR #72). Authoring also pins (suspending cycling),
			// but the captured id is the robust guarantee.
			const saveMapId = activeMapId;
			const saveLocationId = regionFormLocationId;
			const saveSceneIds = new Set(regionFormSceneIds);
			const saveColor = regionFormColor;
			const saveEditingId = editingRegionId;
			const saveOrigLocId = editingOriginalLocationId;
			const savePolygon = pendingPolygon;


		if (editingRegionId) {
			try {
				await worldMapStore.updateRegion(saveMapId, editingRegionId, {
					locationId: regionFormLocationId,
					color: regionFormColor
				});
				invalidateCycleCache(saveMapId);
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
				await worldMapStore.createRegion(saveMapId, {
					locationId: regionFormLocationId,
					polygon: pendingPolygon!,
					color: regionFormColor
				});
				invalidateCycleCache(saveMapId);
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
		// Map-level authoring: pin so a cycle can't flip activeMapId between opening
		// the rename and commitRename(), which would PATCH the name onto another
		// map (Codex PR #72).
		pinView();
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
		// Map-level authoring: pin so a cycle can't flip activeMapId between capturing
		// this map's bounds here and saveVariant()'s PATCH (Codex PR #72).
		pinView();
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
		// Duplicating navigates to the clone for editing — pin so cycling doesn't
		// switch away from it (Codex PR #72).
		pinView();
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

<svelte:window onkeydown={handleMapKeydown} />

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
		onpointerdowncapture={pinOnMapInteraction}
		onfocusincapture={pinOnMapInteraction}
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
			onSwitchMap={(id) => {
				// Manual map select pins the view (suspends camera-follow + PR2
				// cycling) until playback restarts. Programmatic switchMap calls
				// (auto-select / deep-link / drill) bypass this wrapper, so they
				// don't pin.
				pinView();
				void switchMap(id);
			}}
			onCreateMap={handleCreateMap}
			onOpenDeleteConfirm={openDeleteConfirm}
			onImageUpload={handleImageUpload}
			onImagePickerOpen={() => pinView()}
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
		<!-- Slice 3 T8' drop target. Wraps PixiStage so palette chip drags
		     can drop onto the canvas. dragover preventDefault enables drop;
		     ASSET_DRAG_MIME filter rejects accidental file drops. -->
		<div
			class="pixi-drop-target"
			role="region"
			aria-label="Map canvas drop zone"
			ondragover={handleAssetDragOver}
			ondrop={handleAssetDrop}
		>
		{#if mapLoading && !($isPlaying && !viewPinned)}
			<!-- Bug 2: cover the canvas while the saved layer config AND the
			     placements load, so the user sees an intentional loading state
			     instead of layers/markers flashing or popping in.
			     Slice 8 PR2: suppressed only during an AUTOMATIC cycle (playing AND
			     not pinned) — a between-map cycle commits cached regions, then
			     anchors/events load behind the scenes; the overlay would otherwise
			     strobe on every cycle. A manual map switch during playback pins the
			     view, so it is NOT an auto-cycle and DOES show the overlay (its
			     regions aren't prefetched, so the load is a real async wait — Codex
			     PR #72). The mapLoading write-gate (undo/redo/place) still holds. -->
			<div class="map-loading-overlay" role="status" aria-live="polite">
				<span class="map-loading-spinner" aria-hidden="true"></span>
				<span class="map-loading-text">Loading map…</span>
			</div>
		{/if}
		<PixiStage {activeMap} onViewport={(vp) => (pixiViewport = vp)}>
			{#snippet children()}
				<PixiBackgroundLayer {activeMap} />
				<PixiGridLayer {activeMap} />
				<PixiTerrainLayer {activeMap} cells={boundedTerrainCells} />
				<!-- Slice 6 D15: sprite-tile terrain on top of the flat layer. -->
				<PixiTerrainTileLayer {activeMap} cells={boundedTerrainCells} />
				<!-- WM3 Slice A: freeform brush art (paint_stroke) over the grid tiles. -->
				<PixiArtLayer {activeMap} strokes={renderedState?.strokes ?? []} />
				<!-- Slice 6: only water ripples (shimmer applied to water cells alone). -->
				<PixiWaterLayer {activeMap} cells={boundedTerrainCells} />
				<PixiRegionLayer
					regions={scopedRegions}
					{renderedState}
					mapId={activeMapId}
					bind:authoringOpen={childAuthoringOpen}
					{dataLoading}
					{reducedMotion}
					isInScope={$isInScope}
					events={causeEvents}
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
							if (loc) {
								// Drilling into a mapless child is manual map-navigation
								// intent just like the variant path (which pins inside
								// drillIntoLocation). Pin here too so cycling is suspended
								// while the offer is open AND after acceptCreateMapOffer()
								// switches to the freshly-created map — otherwise the next
								// playhead tick would cycle straight off it (Codex PR #72).
								pinView();
								createMapOffer = { childId: locId, childName: loc.name };
							}
						}
					}}
					onOpenLocation={(locId) => windowStore.open('entity-detail', locId)}
				/>
				<!-- Slice 5 PR-C — EventChain causal edges (caused_by), over regions
				     and under markers. Click routes through the shared jumpToCause
				     helper (same jump as both graphs); a timeless edge click is a
				     harmless no-op (D5). -->
				<PixiCausalEdgeLayer
					{activeMap}
					causalEdges={renderedState?.causalEdges ?? []}
					interactive={canvasMode === 'idle'}
					onEdgeClick={(id) => jumpToCause($relationships.find((r) => r.id === id))}
				/>
				<!-- Cinematic Spotlight (Slice 8) — punctuation FX overlay (conquest
				     flash + march trail + causal ripple). Over regions/edges, under
				     markers; non-interactive. WorldMap calls spawn*() via the bound
				     handle. mapWidth/mapHeight convert the march/ripple fractional
				     positions to the viewport's world px. -->
				<PixiPunctuationLayer
					bind:this={punctuationLayer}
					regions={scopedRegions}
					mapId={activeMapId}
					mapWidth={activeMap?.width ?? 0}
					mapHeight={activeMap?.height ?? 0}
					{reducedMotion}
					onReady={() => {
					pixiReady = true;
					captionReadyTick++;
				}}
				/>
				<!-- Within-map camera: eases the viewport toward the changed-this-
				     frame bbox during playback; pins on manual pan/pinch/wheel. -->
				<PixiCameraLayer
					target={cameraTarget}
					active={cameraActive}
					{reducedMotion}
					onUserInteract={() => pinView()}
				/>
				<PixiPlacementLayer
					{activeMap}
					bind:authoringOpen={placementAuthoringOpen}
					onStylePersisted={() => {
						// Post-PATCH: re-invalidate the Location's cycle bundles so a prefetch
						// that raced the PATCH (caching the pre-edit style) can't survive
						// (Codex PR #72 #521). The reactive effect already invalidated on the
						// optimistic write; this covers the authoritative-write window.
						const loc = activeMap?.locationId;
						if (loc) invalidateCycleCacheForLocation(loc);
					}}
					playhead={$playhead}
					placements={$placementsStore}
					entities={$entities}
					{reducedMotion}
					isInScope={$isInScope}
					armedPlaceableId={canvasMode === 'place-armed' ? armedPlaceableId : null}
					brushActive={brushActive}
					artifactOverrides={movePreview}
					moveMode={canvasMode === 'move'}
					moveKeyframes={moveKeyframes}
					onMoveCommit={(id, x, y) => void handleMoveCommit(id, x, y)}
					onMoveSelect={handleMoveSelect}
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
				     only reads `active`; BrushPalette owns brushActive).
				     codex P2 (PR #58): also suspend while dataLoading — a paint
				     POST that lands while mapEventsStore.load is in flight would
				     be clobbered when load() replaces the store with its stale
				     pre-stroke rows. Same guard the snapshot/ownership writes
				     use. -->
				<PixiBrushLayer
					active={canvasMode === 'brush' && brushMode === 'grid' && !dataLoading}
					{activeMap}
					biome={brushBiome}
					size={brushSize}
				/>
				<!-- WM3 Slice A: freeform brush. Same gating as the grid brush, but
				     active only in freeform sub-mode (the two never capture pointer
				     events at once). Emits paint_stroke; PixiArtLayer renders it. -->
				<PixiFreeformBrushLayer
					active={canvasMode === 'brush' && brushMode === 'freeform' && !dataLoading}
					{activeMap}
					mode={strokeMode}
					textureKey={strokeTextureKey}
					brushSize={strokeBrushSize}
					softness={strokeSoftness}
					layerId={strokeLayerId}
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
		<MapSidebar {activeMapId} {activeMap} />
		{#if hasImage}
			<!-- Slice 4 PR-F (DS4) — unified tool bar. Single entry point for
			     Select/Brush/Place/Move; the palettes below are detail panels
			     shown only when their tool is active. Place/Move act on
			     Location-scoped placements so they're disabled without a Location. -->
			<MapToolSelector
				tool={activeTool}
				onSelect={(t) => (activeTool = t)}
				placeEnabled={!!activeMap?.locationId}
				moveEnabled={!!activeMap?.locationId}
				canUndo={canUndo && !mapLoading}
				canRedo={canRedo && !mapLoading}
				onUndo={handleUndo}
				onRedo={handleRedo}
			/>
		{/if}
		<!-- DS4 a11y — announces move-keyframe commits (drag or keyboard nudge) to
		     screen readers. Always present so the live region exists before its
		     text changes. -->
		<div class="map-move-announcer" role="status" aria-live="polite">{moveAnnouncement}</div>
		<!-- Tool-independent error banner. Placement creation AND move-keyframe
		     commits both write placementError; rendering it here (not inside the
		     Place palette) keeps move-commit rejections visible under the Move
		     tool too (codex P2). -->
		{#if placementError}
			<div class="placement-error" role="alert">
				{placementError}
				<button type="button" onclick={() => (placementError = '')}>✕</button>
			</div>
		{/if}
		{#if hasImage && moveActive}
			<!-- DS4 keyboard a11y — status hint for the Move tool. The nudge keys
			     (arrows / Shift+arrows / Enter / Escape) are handled window-scoped
			     in handleMapKeydown when a marker is selected; this panel just
			     surfaces the current selection + key affordances. -->
			<div class="map-move-keyboard" role="status">
				{#if moveKbSelection}
					Nudging <strong>{moveKbSelection.name}</strong> · {(moveKbSelection.x * 100).toFixed(0)}%,
					{(moveKbSelection.y * 100).toFixed(0)}% · arrows to move (Shift = 10×) · Enter commits · Esc cancels
				{:else}
					Drag a marker to move it, or click one to nudge it with the keyboard.
				{/if}
			</div>
		{/if}
		{#if activeTool === 'place' && hasImage && activeMap?.locationId}
			<!-- Slice 4 PR-D — single placeables palette. Each chip is both a
			     click-to-arm target (armed chip → PixiPlacementLayer pointertap →
			     handleCanvasClick → create placement) and a drag source (drop
			     target lives on the pixi-drop-target wrapper above). PR-F: shown
			     only under the Place tool (DS4). -->
			<PlaceablePalette armedId={armedPlaceableId} onArm={(id) => (armedPlaceableId = id)} />
		{/if}
		{#if activeTool === 'brush' && hasImage}
			<!-- WM3 Slice A: Grid | Freeform sub-mode toggle. Grid = the existing
			     cell painting (first-class, amendment §3); Freeform = paint_stroke. -->
			<div class="brush-mode-toggle" role="group" aria-label="Brush type">
				<button
					type="button"
					class:armed={brushMode === 'grid'}
					aria-pressed={brushMode === 'grid'}
					onclick={() => (brushMode = 'grid')}
				>
					Grid
				</button>
				<button
					type="button"
					class:armed={brushMode === 'freeform'}
					aria-pressed={brushMode === 'freeform'}
					onclick={() => (brushMode = 'freeform')}
				>
					Freeform
				</button>
				<!-- Slice D — the terrain-beat affordance: painting is anchored at the
				     CURRENT playhead, so scrubbing then painting authors terrain change
				     over story-time. Surfacing the T is what turns the (existing) data
				     behavior into an intentional authoring tool. -->
				<span class="paint-at-indicator" role="status" data-testid="paint-at-indicator">
					Painting {paintAtLabel}
				</span>
			</div>
			{#if brushMode === 'grid'}
				<!-- Slice 3 T5 brush palette. PR-F (DS4): shown only under the Brush
				     tool — the unified tool bar owns on/off + undo/redo, so this panel
				     carries just the biome picker + size selector. -->
				<BrushPalette
					biome={brushBiome}
					size={brushSize}
					onSetBiome={(b) => (brushBiome = b)}
					onSetSize={(s) => (brushSize = s)}
				/>
			{:else}
				<FreeformBrushPalette
					mode={strokeMode}
					textureKey={strokeTextureKey}
					brushSize={strokeBrushSize}
					softness={strokeSoftness}
					artLayers={activeMap?.artLayersJsonb ?? []}
					layerId={strokeLayerId}
					onSetMode={(m) => (strokeMode = m)}
					onSetTexture={(k) => (strokeTextureKey = k)}
					onSetBrushSize={(n) => (strokeBrushSize = n)}
					onSetSoftness={(n) => (strokeSoftness = n)}
					onSetLayer={(id) => (strokeLayerId = id)}
				/>
			{/if}
		{/if}
		{#if !hasImage}
			<div class="upload-area">
				<p>Import a map image to get started</p>
				<label class="btn-primary upload-btn">
					Import image
					<!-- Pin on picker-open (input click fires as the dialog opens) so a cycle
					     can't flip activeMapId between opening the file dialog and onchange,
					     uploading to the wrong map (Codex PR #72 #954). -->
					<input
						type="file"
						accept=".jpg,.jpeg,.png,.webp"
						onclick={() => pinView()}
						onchange={handleImageUpload}
						hidden
					/>
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
	/* WM3 Slice A — Grid|Freeform brush sub-mode toggle, above the active palette. */
	.brush-mode-toggle {
		display: flex;
		gap: 2px;
		padding: 6px 10px 0;
		background: var(--color-panel, rgba(0, 0, 0, 0.6));
	}
	.brush-mode-toggle button {
		padding: 3px 12px;
		border-radius: 6px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}
	.brush-mode-toggle button.armed {
		border-color: var(--color-accent, #c8942a);
		background: color-mix(in srgb, var(--color-accent, #c8942a) 25%, transparent);
	}
	/* Slice D — paint-time indicator (terrain beats). */
	.paint-at-indicator {
		align-self: center;
		margin-left: 8px;
		font-size: 10px;
		font-style: italic;
		color: var(--color-text-muted, #999);
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
		/* Sit above the MapSidebar (z-index:100) — these error toasts render
		   in the bottom-of-column flow alongside the palettes, so the
		   absolutely-positioned sidebar would otherwise paint over them. */
		position: relative;
		z-index: 150;
	}
	/* DS4 a11y — visually-hidden ARIA live region for move-keyframe commits. */
	.map-move-announcer {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
	/* DS4 — Move-tool status hint, in the bottom-of-column flow with the palettes. */
	.map-move-keyboard {
		padding: 6px 10px;
		font-size: 11px;
		color: var(--color-text-muted, #aaa);
		background: var(--color-panel, rgba(0, 0, 0, 0.6));
		border-top: 1px solid var(--color-border, #333);
		position: relative;
		z-index: 150;
	}
	.map-move-keyboard strong {
		color: var(--color-text, #ddd);
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
		/* Anchor for the absolutely-positioned loading overlay (bug 2). */
		position: relative;
	}
	.map-loading-overlay {
		position: absolute;
		inset: 0;
		z-index: 200;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		background: var(--color-surface, #1a1a1a);
		color: var(--color-text-muted, #888);
		font-size: 13px;
	}
	.map-loading-spinner {
		width: 22px;
		height: 22px;
		border: 2px solid color-mix(in srgb, var(--color-text-muted, #888) 35%, transparent);
		border-top-color: var(--color-accent, #c8942a);
		border-radius: 50%;
		animation: map-loading-spin 0.7s linear infinite;
	}
	@keyframes map-loading-spin {
		to {
			transform: rotate(360deg);
		}
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
