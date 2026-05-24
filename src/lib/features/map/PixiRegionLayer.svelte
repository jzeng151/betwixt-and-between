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
	import ContextMenu from '$lib/os/ContextMenu.svelte';
	import type { MapRegion } from './types.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;
	type FederatedPointerEvent = import('pixi.js').FederatedPointerEvent;

	let {
		regions,
		renderedState,
		mapId
	}: {
		regions: MapRegion[];
		renderedState: RenderedState | null;
		mapId: string | null;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;

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
		| { kind: 'snapshot'; x: number; y: number };
	let menu = $state<MenuState | null>(null);
	let actionError = $state<string | null>(null);

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
		const s = input.trim().replace(/^#/, '');
		if (s.length === 3) {
			return parseInt(s.split('').map((c) => c + c).join(''), 16);
		}
		const n = parseInt(s, 16);
		return Number.isFinite(n) ? n : 0x9ca3af;
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
		menu = { kind: 'snapshot', x, y };
	}

	async function snapshotWorldState() {
		if (!mapId) {
			actionError = 'No active map';
			return;
		}
		actionError = null;
		try {
			// State at the playhead's current value, baked into a new anchor.
			// Captures faction ownership AS RENDERED right now — same shape
			// as the baseline anchor commit 3a writes for new maps + migration
			// 0012 backfilled for legacy maps.
			const tPosition = get(playhead) ?? 0;
			const renderedRegionMap = new Map<string, string | null>();
			if (renderedState) {
				for (const r of renderedState.regions) {
					renderedRegionMap.set(r.regionId, r.factionId);
				}
			}
			const stateJsonb = {
				regions: regions.map((r) => ({
					region_id: r.id,
					faction_id: renderedRegionMap.get(r.id) ?? null,
					color: r.color
				})),
				artifacts: [],
				chains: []
			};
			await mapAnchorsStore.create(mapId, { tPosition, stateJsonb });
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		}
	}

	async function changeOwner(regionId: string, factionId: string) {
		if (!mapId) {
			actionError = 'No active map';
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
				payloadJsonb: { region_id: regionId, new_faction_id: factionId }
			});
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
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
			return [
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
		if (factionList.length === 0) {
			return [
				{
					label: 'No factions yet — create one first',
					disabled: true,
					onSelect: () => {}
				}
			];
		}
		// Current owner of this region at the active playhead, per the most
		// recent projectState pass. Disable the item that points back to the
		// same faction so users can't double-stamp an existing assignment
		// (which would silently inflate the faction's dependent-event count).
		const currentFactionId = renderedState?.regions.find(
			(r) => r.regionId === regionId
		)?.factionId ?? null;
		return factionList.map(
			(f): MenuItem => ({
				label:
					f.id === currentFactionId
						? `${f.name} (current owner)`
						: `Change owner → ${f.name}`,
				icon: '●',
				disabled: f.id === currentFactionId,
				onSelect: () => {
					void changeOwner(regionId, f.id);
				}
			})
		);
	});

	$effect(() => {
		const app = stageCtx.app;
		if (!app || !PIXI) return;

		if (!layer) {
			layer = new PIXI.Container();
			app.stage.addChild(layer);
			// Stage-level right-click → "Snapshot world state here" menu.
			// Stage must be event-aware ('static') so events bubble from
			// children up to it. Regions' rightclick handlers call
			// stopPropagation so this fires only on EMPTY-area clicks.
			app.stage.eventMode = 'static';
			app.stage.hitArea = app.screen;
			app.stage.on('rightclick', (e: FederatedPointerEvent) => {
				openSnapshotMenu(e);
			});
		}

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

			const g: PixiGraphics = new PIXI.Graphics();
			g.poly(flat)
				.fill({ color: fill, alpha: 0.35 })
				.stroke({ color: fill, width: 2 });
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
</style>
