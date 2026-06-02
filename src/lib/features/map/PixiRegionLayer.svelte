<script lang="ts">
	// Pixi-side region renderer — Slice 1b PR 2 commit 4 (the demo unlock)
	// plus commit 6 right-click → Change owner UX.
	//
	// Parallel to RegionLayer.svelte (Leaflet path). Both render the SAME
	// polygons; this one consumes the projection-engine's RenderedState for
	// per-region color overrides (faction ownership shifts via
	// transfer_region events at scrub time). When renderedState.regions[]
	// doesn't override a region (no event has affected it yet), we fall
	// back to map_regions.color (the geometry-author's baseline).
	//
	// Coordinates: regions store polygon as [[lat, lng], ...] per Leaflet
	// convention. MapStage's click handler treats lng as x-pixel and lat
	// as y-pixel against the source-image dimensions. Pixi wants
	// [x1, y1, x2, y2, ...] flat. flatten by [lng, lat] pairs.
	//
	// pixi.js is dynamic-imported inside onMount (mirrors PixiStage's
	// pattern) so PixiRegionLayer's static module load doesn't pull pixi
	// into the Cloudflare Worker SSR bundle — Δ1b-H worker-pixi-import
	// guard depends on this discipline.

	import { getContext, onDestroy, onMount } from 'svelte';
	import { playhead } from '$lib/features/timeline/playhead-store.js';
	import { get } from 'svelte/store';
	import {
		PIXI_STAGE_CONTEXT,
		type PixiStageContext
	} from './pixi-context.js';
	import { NEUTRAL_REGION_COLOR, type RenderedState } from './projection.js';
	import { factions as factionsStore, type Faction } from './factions-store.js';
	import { mapEventsStore } from './map-events-store.js';
	import { mapAnchorsStore } from './map-anchors-store.js';
	import { layerVisibility } from './layer-prefs-store.js';
	import ContextMenu from '$lib/os/ContextMenu.svelte';
	import type { MapRegion } from './types.js';
	// Type-only import (declaration-only — erased at compile, no server-code leak;
	// same pattern as RelationshipType from schema.ts). Slice 5 PR-E.
	import type { ProvenanceResult } from '$lib/server/world-map-v3-provenance.js';

	// Slice 3 E4 — layer toggle.
	const visible = layerVisibility('regions');

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;
	type FederatedPointerEvent = import('pixi.js').FederatedPointerEvent;

	let {
		regions,
		renderedState,
		mapId,
		dataLoading = false,
		isInScope = null,
		events = [],
		onDrawHere,
		onEditRegion,
		onDeleteRegion,
		onDrillIntoLocation,
		onOpenLocation
	}: {
		regions: MapRegion[];
		renderedState: RenderedState | null;
		mapId: string | null;
		// Slice 5 PR-E — the user's Events, for the "set cause" authoring picker.
		// {id,name} only; WorldMap passes $entities filtered to type='Event'.
		events?: { id: string; name: string }[];
		// Codex P2 on PR #55 (commit d849ea0): true while anchors/events
		// for this map are still loading. snapshotWorldState() reads
		// renderedState ownership; if loads are in flight, that ownership
		// is incomplete and a snapshot persists silently-wrong null
		// faction_ids. Gate menu + function on this signal.
		dataLoading?: boolean;
		// T9 follow-up: out-of-scope regions render dimmed (matches
		// Leaflet's RegionLayer treatment — regions whose locationId is
		// not in the playhead-derived scope go to lower opacity). When
		// null (no scope filter wired) all regions render in-scope.
		isInScope?: ((entityId: string) => boolean) | null;
		// Slice 2 D4 prep (T8): the snapshot menu adds a "Draw region here"
		// entry that calls back into the parent with the right-click's
		// image-pixel coords. The parent flips PixiPolygonDraw into active
		// mode seeded with that point.
		onDrawHere?: (x: number, y: number) => void;
		// T13 parity (Codex iter PR#57): the deleted Leaflet popup wired
		// Edit / Delete / Drill / Create-map for regions. Restore them on
		// the Pixi right-click menu so users still have access to those
		// actions after the renderer flag is gone.
		onEditRegion?: (regionId: string) => void;
		onDeleteRegion?: (regionId: string) => void;
		onDrillIntoLocation?: (locationId: string) => void;
		// codex PR#57 iter3 P2: Leaflet popup made the Location name
		// clickable → opened entity-detail. Restore as a menu item.
		onOpenLocation?: (locationId: string) => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;
	// Codex P2 on PR #55 (commit da20221): keep a handle to the stage-level
	// rightclick listener so onDestroy can detach it. Without this, the
	// PixiStage's app.stage accumulates a listener every time this layer
	// remounts (e.g., scopedRegions changes in a way Svelte considers a
	// remount, or a future gate cycles it). Each accumulated listener
	// opens an additional snapshot menu per click.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let stageRightClickHandler: ((e: FederatedPointerEvent) => void) | null = null;

	// Subscribe to factions for the Change-owner submenu. Plain subscribe
	// (not the $store auto-subscribe) because this is a .svelte component
	// using runes; the $-prefix doesn't apply outside template auto-sub.
	let factionList = $state<Faction[]>([]);
	const unsubFactions = factionsStore.subscribe((f) => (factionList = f));
	onDestroy(unsubFactions);

	// Right-click menu state. `x` / `y` are viewport-local (clientX/clientY
	// from the underlying DOM event); ContextMenu uses position: fixed.
	// `kind: 'region'` → change-owner submenu against a specific region.
	// `kind: 'snapshot'` → "Snapshot world state here" for empty-area
	// right-clicks (Δ1b-E).
	type MenuState =
		| { kind: 'region'; x: number; y: number; regionId: string }
		// Slice 2 D4 prep (T8): snapshot menu also captures stage-local
		// (image-pixel) coords so "Draw region here" can seed the first
		// vertex of the polygon at the right-click location.
		| { kind: 'snapshot'; x: number; y: number; stageX: number; stageY: number };
	let menu = $state<MenuState | null>(null);
	let actionError = $state<string | null>(null);
	let actionInfo = $state<string | null>(null);
	let actionInfoTimer: ReturnType<typeof setTimeout> | null = null;

	function flashInfo(msg: string) {
		actionInfo = msg;
		if (actionInfoTimer) clearTimeout(actionInfoTimer);
		actionInfoTimer = setTimeout(() => {
			actionInfo = null;
			actionInfoTimer = null;
		}, 3500);
	}

	onMount(() => {
		let cancelled = false;
		(async () => {
			const mod = await import('pixi.js');
			if (cancelled) return;
			PIXI = mod;
		})();
		return () => {
			cancelled = true;
		};
	});

	// DEFERRED DESIGN DECISION (Slice 2+): region.color vs faction.color.
	// Current behavior: faction color overrides region.color whenever a
	// transfer_region event applies at the active playhead; otherwise
	// region.color wins. Side effect noticed during commit-6 QA: once any
	// event exists at T=0, scrubbing back to "before any event" is
	// forbidden by scrubTo(t<0), so the baseline region.color is
	// functionally unreachable. Three resolutions tabled (faction-only,
	// region-as-default + faction-as-overlay with reachable baseline,
	// visually layered). Picked: leave as-is for Slice 1b PR 2, revisit
	// in Slice 2 when the renderer flag is deleted.
	let renderedColorById = $derived.by(() => {
		const m = new Map<string, string>();
		if (renderedState) {
			for (const r of renderedState.regions) m.set(r.regionId, r.color);
		}
		return m;
	});

	function parseHex(input: string): number {
		// Pixi v8's .fill({ color }) takes RGB-only as a Number (alpha is a
		// separate channel). We strip alpha from 4/8-digit hex and return
		// just the RGB integer so the polygon's alpha is controlled by the
		// fill's `alpha` option, not silently mangled by the hex parser.
		// Codex P2 on PR #55: prior version treated `#RRGGBBAA` as a plain
		// 8-digit integer, shifting channels and producing wrong colors.
		let s = input.trim().replace(/^#/, '');
		if (s.length === 3 || s.length === 4) {
			// Expand short form: #abc → #aabbcc, #abcd → #aabbccdd
			s = s.split('').map((c) => c + c).join('');
		}
		if (s.length === 8) {
			// #RRGGBBAA — drop the AA alpha byte; Pixi handles alpha separately.
			s = s.slice(0, 6);
		}
		if (s.length !== 6) {
			return 0x9ca3af; // neutral gray fallback for malformed input
		}
		const n = parseInt(s, 16);
		return Number.isFinite(n) && !Number.isNaN(n) ? n : 0x9ca3af;
	}

	function clientXY(e: FederatedPointerEvent): { x: number; y: number } {
		const x = (e.client?.x ?? e.nativeEvent?.clientX ?? 0) as number;
		const y = (e.client?.y ?? e.nativeEvent?.clientY ?? 0) as number;
		return { x, y };
	}

	function openRegionMenu(regionId: string, e: FederatedPointerEvent) {
		const { x, y } = clientXY(e);
		menu = { kind: 'region', x, y, regionId };
	}

	function openSnapshotMenu(e: FederatedPointerEvent) {
		const { x, y } = clientXY(e);
		// T13 parity (codex PR#57 iter3 + pixi-viewport): with the viewport
		// in place between app.stage and our layer, e.global is canvas-
		// pixel screen coords while polygons live in world coords. Convert
		// to world via getLocalPosition(viewport) so "Draw region here"
		// seeds the polygon's first vertex in the correct space — survives
		// pan/zoom.
		const vp = stageCtx.viewport;
		const local = vp ? e.getLocalPosition(vp) : { x: e.global?.x ?? 0, y: e.global?.y ?? 0 };
		menu = { kind: 'snapshot', x, y, stageX: local.x, stageY: local.y };
	}

	async function snapshotWorldState() {
		if (!mapId) {
			actionError = 'No active map';
			return;
		}
		if (dataLoading) {
			// Defense-in-depth — the menu item is already disabled in this
			// state, but a programmatic invocation could still slip through.
			// A snapshot of "ownership not yet loaded" would silently persist
			// faction_id: null where there should be real owners.
			actionError = 'Map data is still loading — try again in a moment.';
			return;
		}
		actionError = null;
		// State at the playhead's current value, baked into a new anchor.
		// Captures faction ownership AS RENDERED right now — same shape
		// as the baseline anchor commit 3a writes for new maps + migration
		// 0012 backfilled for legacy maps.
		// Hoisted out of the try so the catch's friendly UNIQUE-conflict
		// message can reference tPosition.
		const tPosition = get(playhead) ?? 0;
		try {
			const renderedRegionMap = new Map<string, string | null>();
			if (renderedState) {
				for (const r of renderedState.regions) {
					renderedRegionMap.set(r.regionId, r.factionId);
				}
			}
			const ownedRegionCount = Array.from(renderedRegionMap.values()).filter(
				(f) => f !== null
			).length;
			// codex review P1 #1: post-T4 anchor schema carries polygon +
			// locationId. Post-T6 anchor JSON is canonical for region
			// geometry — if a snapshot becomes the earliest anchor (e.g.,
			// snapshotted at a t-position less than any other anchor's),
			// readBaselineRegions returns whatever the snapshot stored.
			// Snapshots that omit polygon would erase every region's
			// geometry. Carry the full anchor entry shape.
			const stateJsonb = {
				regions: regions.map((r) => ({
					region_id: r.id,
					faction_id: renderedRegionMap.get(r.id) ?? null,
					polygon: r.polygon,
					locationId: r.locationId ?? null
				})),
				artifacts: [],
				chains: [],
				// codex P2: an anchor at T is the COMPLETE state at T and shadows
				// events with t_position <= T, so a snapshot that omits cells
				// (normalized server-side to []) would erase all terrain painted
				// at/before this playhead from T forward. Capture the projected
				// terrain as rendered right now.
				cells: renderedState?.cells ?? []
			};
			await mapAnchorsStore.create(mapId, { tPosition, stateJsonb });
			// Snapshot doesn't visually change anything (it just records
			// current state). Toast so the user knows the POST succeeded
			// and what got captured.
			flashInfo(
				`Snapshot saved at T=${tPosition.toFixed(2)} — ${regions.length} region${regions.length === 1 ? '' : 's'}, ${ownedRegionCount} owned`
			);
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			// (world_map_id, t_position) is UNIQUE — two snapshots at the
			// same playhead T collide. Surface a friendlier message so the
			// user knows they need to scrub to a different T first.
			if (/already exists|unique|duplicate key|conflict/i.test(raw)) {
				actionError = `An anchor already exists at T=${tPosition.toFixed(2)} — scrub to a different position before snapshotting again.`;
			} else {
				actionError = raw;
			}
		}
	}

	async function changeOwner(regionId: string, factionId: string, sourceEventId: string | null = null) {
		if (!mapId) {
			actionError = 'No active map';
			return;
		}
		if (dataLoading) {
			// Codex P1 on PR #55 (commit da20221): writes while the initial
			// events load is still in flight can be clobbered when load()
			// arrives with a pre-mutation snapshot. Gate on the same
			// readiness signal snapshotWorldState uses. The menu items also
			// disable the change-owner entries while loading.
			actionError = 'Map data is still loading — try again in a moment.';
			return;
		}
		actionError = null;
		try {
			// Anchor the event at the current playhead. When playhead is null
			// (spotlight off), use T=0 — events apply at any playhead ≥ 0, so
			// the assignment is "from the start of story-time" by default.
			// The playhead is intentionally NOT moved by this action;
			// assigning ownership is a write, not a navigation.
			const tPosition = get(playhead) ?? 0;
			await mapEventsStore.create(mapId, {
				tPosition,
				kind: 'transfer_region',
				payloadJsonb: { region_id: regionId, new_faction_id: factionId },
				// Slice 5 PR-E (D6) — optional recorded cause. The server validates
				// it is an owned Event (assertSourceEventIdIsEvent); null = no cause.
				sourceEventId
			});
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		}
	}

	// ── Slice 5 PR-E (D6) — Causal Cartography ─────────────────────────────
	// Authoring: pick a faction + an optional cause Event for a region's change.
	let causeModal = $state<{ regionId: string; factionId: string; sourceEventId: string } | null>(
		null
	);
	// Read: the traced provenance for a region (the result of /provenance).
	let provenance = $state<
		{ regionId: string; loading: boolean; error: string | null; result: ProvenanceResult | null }
	| null>(null);

	function openCauseModal(regionId: string) {
		const currentFactionId =
			renderedState?.regions.find((r) => r.regionId === regionId)?.factionId ?? '';
		causeModal = { regionId, factionId: currentFactionId || (factionList[0]?.id ?? ''), sourceEventId: '' };
	}

	async function commitCause() {
		const m = causeModal;
		if (!m || !m.factionId) return;
		causeModal = null;
		await changeOwner(m.regionId, m.factionId, m.sourceEventId || null);
	}

	async function traceCause(regionId: string) {
		if (!mapId) return;
		provenance = { regionId, loading: true, error: null, result: null };
		const t = get(playhead) ?? 0;
		try {
			const res = await fetch(
				`/api/maps/${mapId}/provenance?regionId=${encodeURIComponent(regionId)}&t=${t}`
			);
			if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
			const result = (await res.json()) as ProvenanceResult;
			provenance = { regionId, loading: false, error: null, result };
		} catch (err) {
			provenance = {
				regionId,
				loading: false,
				error: err instanceof Error ? err.message : String(err),
				result: null
			};
		}
	}

	// jumpPosition is jumpable only when present AND ≥ 0 (scrubTo ignores t < 0,
	// which would otherwise be a silent dead button — fractional positions can be
	// negative). The button is gated on this same predicate.
	function canJump(r: ProvenanceResult | null): boolean {
		return r?.status === 'found' && r.jumpPosition != null && r.jumpPosition >= 0;
	}

	function jumpToEarliestCause() {
		const r = provenance?.result;
		if (r?.status === 'found' && r.jumpPosition != null && r.jumpPosition >= 0) {
			playhead.scrubTo(r.jumpPosition);
			provenance = null;
		}
	}

	type MenuItem = {
		label: string;
		icon?: string;
		disabled?: boolean;
		onSelect: () => void;
	};
	let menuItems: MenuItem[] = $derived.by<MenuItem[]>(() => {
		if (!menu) return [];
		if (menu.kind === 'snapshot') {
			if (dataLoading) {
				return [
					{
						label: 'Loading map data… try again in a moment',
						icon: '⏳',
						disabled: true,
						onSelect: () => {}
					}
				];
			}
			const stageX = menu.stageX;
			const stageY = menu.stageY;
			return [
				// Slice 2 D4 prep (T8): "Draw region here" appears alongside
				// the snapshot affordance; both share the right-click gesture
				// on the canvas (Variant D — Cartographer's tool).
				{
					label: 'Draw region here',
					icon: '✎',
					disabled: !onDrawHere,
					onSelect: () => {
						onDrawHere?.(stageX, stageY);
					}
				},
				{
					label: 'Snapshot world state here',
					icon: '📌',
					onSelect: () => {
						void snapshotWorldState();
					}
				}
			];
		}
		const regionId = menu.regionId;
		if (dataLoading) {
			return [
				{
					label: 'Loading map data… try again in a moment',
					icon: '⏳',
					disabled: true,
					onSelect: () => {}
				}
			];
		}
		// T13 parity: Edit / Delete / Drill always appear (independent of
		// faction list state). They were the Leaflet popup's bread-and-butter
		// actions; PR#57 review caught that PixiRegionLayer's previous menu
		// only handled ownership. Drill is disabled when the region has no
		// linked Location.
		const region = regions.find((r) => r.id === regionId);
		const linkedLocationId = region?.locationId ?? null;
		const items: MenuItem[] = [];
		if (onEditRegion) {
			items.push({
				label: 'Edit region',
				icon: '✎',
				onSelect: () => onEditRegion!(regionId)
			});
		}
		if (onOpenLocation && linkedLocationId) {
			items.push({
				label: 'Open linked location',
				icon: '↗',
				onSelect: () => onOpenLocation!(linkedLocationId)
			});
		}
		if (onDrillIntoLocation) {
			items.push({
				label: linkedLocationId ? 'Drill into location' : 'Drill into location (no link)',
				icon: '↳',
				disabled: !linkedLocationId,
				onSelect: () => {
					if (linkedLocationId) onDrillIntoLocation!(linkedLocationId);
				}
			});
		}
		if (onDeleteRegion) {
			items.push({
				label: 'Delete region',
				icon: '🗑',
				onSelect: () => onDeleteRegion!(regionId)
			});
		}

		// Slice 5 PR-E (D6) — Causal Cartography. Trace why this region is the way
		// it is at the playhead; jump to the earliest recorded cause.
		items.push({
			label: 'Trace cause',
			icon: '🔎',
			onSelect: () => void traceCause(regionId)
		});

		if (factionList.length === 0) {
			items.push({
				label: 'No factions yet — create one first',
				disabled: true,
				onSelect: () => {}
			});
			return items;
		}
		// Current owner of this region at the active playhead, per the most
		// recent projectState pass. Disable the item that points back to the
		// same faction so users can't double-stamp an existing assignment
		// (which would silently inflate the faction's dependent-event count).
		const currentFactionId = renderedState?.regions.find(
			(r) => r.regionId === regionId
		)?.factionId ?? null;
		for (const f of factionList) {
			items.push({
				label:
					f.id === currentFactionId
						? `${f.name} (current owner)`
						: `Change owner → ${f.name}`,
				icon: '●',
				disabled: f.id === currentFactionId,
				onSelect: () => {
					void changeOwner(regionId, f.id);
				}
			});
		}
		// Slice 5 PR-E (D6) — same ownership change, but attribute it to a cause
		// Event (sets source_event_id) so it shows up in a later "Trace cause".
		items.push({
			label: 'Change owner with cause…',
			icon: '🎬',
			onSelect: () => openCauseModal(regionId)
		});
		return items;
	});

	$effect(() => {
		const app = stageCtx.app;
		const viewport = stageCtx.viewport;
		if (!app || !PIXI || !viewport) return;

		if (!layer) {
			layer = new PIXI.Container();
			viewport.addChild(layer);
			// Viewport-level right-click → "Snapshot world state here" menu.
			// pixi-viewport is itself event-aware so events bubble up from
			// children. Regions' rightclick handlers call stopPropagation so
			// this fires only on EMPTY-area clicks. Listener moved from
			// app.stage to viewport in T13 parity (codex PR#57 iter3) so
			// the snapshot menu's seed coords are viewport-local (world)
			// rather than screen-space — survives pan/zoom correctly.
			viewport.eventMode = 'static';
			stageRightClickHandler = (e: FederatedPointerEvent) => {
				openSnapshotMenu(e);
			};
			viewport.on('rightclick', stageRightClickHandler);
		}

		// Slice 3 E4 — apply user visibility toggle. The right-click
		// snapshot handler stays bound on the viewport (it fires on
		// empty area, not on regions specifically), so toggling the
		// layer hides geometry without disabling authoring gestures.
		layer.visible = $visible;

		// Clear previous draws + listeners. removeChildren returns the
		// removed nodes; destroying them releases their event handlers
		// AND GPU buffers in one pass (per Pixi v8 docs).
		for (const child of layer.removeChildren()) {
			child.destroy();
		}

		for (const region of regions) {
			const colorStr =
				renderedColorById.get(region.id) ?? region.color ?? NEUTRAL_REGION_COLOR;
			const fill = parseHex(colorStr);

			const flat: number[] = [];
			for (const [lat, lng] of region.polygon) {
				flat.push(lng, lat);
			}
			if (flat.length < 6) continue;

			// T9 follow-up: scope-based dimming. In scope when the region's
			// linked location is in the playhead's interval cone (matches
			// Leaflet RegionLayer). Region without a locationId is treated
			// as in-scope (geometry only, not tied to a location).
			const inScope = isInScope && region.locationId
				? isInScope(region.locationId)
				: true;
			const fillAlpha = inScope ? 0.35 : 0.08;
			const strokeWidth = inScope ? 2 : 1;
			const strokeAlpha = inScope ? 1 : 0.3;

			const g: PixiGraphics = new PIXI.Graphics();
			g.poly(flat)
				.fill({ color: fill, alpha: fillAlpha })
				.stroke({ color: fill, width: strokeWidth, alpha: strokeAlpha });
			g.eventMode = 'static';
			g.cursor = 'pointer';
			// 'rightclick' fires on pointerup with right button; matches
			// the spike's documented Pixi v8 API. Close any existing menu
			// before opening a new one so rapid right-clicks don't stack.
			g.on('rightclick', (e: FederatedPointerEvent) => {
				// Stop propagation so the stage-level snapshot menu doesn't
				// also fire — region right-click takes precedence over the
				// empty-area "Snapshot here" affordance.
				e.stopPropagation();
				openRegionMenu(region.id, e);
			});
			layer.addChild(g);
		}
	});

	onDestroy(() => {
		if (actionInfoTimer) {
			clearTimeout(actionInfoTimer);
			actionInfoTimer = null;
		}
		// Detach the stage-level rightclick listener before the layer
		// goes away. PixiStage's app may outlive this component when
		// regionsMatchMap-style gates remount us; without .off() the
		// stage accumulates a fresh listener per remount.
		const app = stageCtx.app;
		if (stageCtx.viewport && stageRightClickHandler) {
			try {
				stageCtx.viewport.off('rightclick', stageRightClickHandler);
			} catch (_) {
				/* viewport may have been destroyed already */
			}
			stageRightClickHandler = null;
		}
		if (layer) {
			try {
				layer.destroy({ children: true });
			} catch (_) {
				/* PixiStage may have destroyed the app first (renderer-flag
				   flip race) — cascade-destroy already released this layer. */
			}
			layer = null;
		}
	});
</script>

{#if menu}
	<ContextMenu items={menuItems} x={menu.x} y={menu.y} onClose={() => (menu = null)} />
{/if}

{#if actionError}
	<div class="action-error" role="alert">
		{actionError}
		<button type="button" onclick={() => (actionError = null)}>✕</button>
	</div>
{/if}

{#if actionInfo}
	<div class="action-info" role="status">
		{actionInfo}
	</div>
{/if}

<!-- Slice 5 PR-E (D6) — authoring: change owner + attribute a cause Event. -->
{#if causeModal}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal-content">
			<h3>Change owner with cause</h3>
			<label class="cause-field">
				New owner
				<select bind:value={causeModal.factionId}>
					{#each factionList as f (f.id)}
						<option value={f.id}>{f.name}</option>
					{/each}
				</select>
			</label>
			<label class="cause-field">
				Caused by (optional)
				<select bind:value={causeModal.sourceEventId}>
					<option value="">— no recorded cause —</option>
					{#each events as ev (ev.id)}
						<option value={ev.id}>{ev.name}</option>
					{/each}
				</select>
			</label>
			<div class="modal-actions">
				<button class="btn-secondary" onclick={() => (causeModal = null)}>Cancel</button>
				<button class="btn-primary" disabled={!causeModal.factionId} onclick={() => void commitCause()}>
					Change owner
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Slice 5 PR-E (D6) — read: the traced causal lineage of a region's state. -->
{#if provenance}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal-content">
			<h3>Why is this region the way it is?</h3>
			{#if provenance.loading}
				<p class="variant-help">Tracing cause…</p>
			{:else if provenance.error}
				<p class="variant-help cause-error">{provenance.error}</p>
			{:else if provenance.result?.status === 'no-change'}
				<p class="variant-help">No ownership change recorded for this region at this point in the story.</p>
			{:else if provenance.result?.status === 'no-cause'}
				<p class="variant-help">This change has no recorded cause. Use “Change owner with cause…” to attribute one.</p>
			{:else if provenance.result?.status === 'found'}
				<ol class="cause-chain">
					{#each provenance.result.chain as step, i (step.eventId)}
						<li class:earliest={i === provenance.result.chain.length - 1}>
							{step.name}
							{#if i === provenance.result.chain.length - 1}<span class="cause-tag">earliest cause</span>{/if}
						</li>
					{/each}
				</ol>
			{/if}
			<div class="modal-actions">
				<button class="btn-secondary" onclick={() => (provenance = null)}>Close</button>
				{#if canJump(provenance.result)}
					<button class="btn-primary" onclick={jumpToEarliestCause}>Jump to earliest cause</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.action-error {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1100;
		background: #7f1d1d;
		color: #fee2e2;
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 12px;
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.action-error button {
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
	}
	.action-info {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1100;
		background: #0f3622;
		color: #d1fae5;
		padding: 6px 14px;
		border-radius: 6px;
		font-size: 12px;
		border: 1px solid #14532d;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	}
	/* Slice 5 PR-E — cause authoring + provenance panel. */
	.cause-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 10px 0;
		font-size: 12px;
		color: var(--color-text-muted, #9ca3af);
	}
	.cause-field select {
		padding: 6px 8px;
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text, #e8e0d0);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		font-size: 13px;
	}
	.cause-chain {
		margin: 8px 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--color-text, #e8e0d0);
	}
	.cause-chain li.earliest {
		font-weight: 600;
	}
	.cause-tag {
		margin-left: 8px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-rel-other, #94a3b8);
	}
	.cause-error {
		color: #fca5a5;
	}
</style>
