<script lang="ts">
	// Slice 2 D4 prep (T9) — Pixi-native placement marker renderer.
	//
	// Parallel to PlacementLayer.svelte (Leaflet path). Both render the
	// SAME placement set (filtered by playhead); this component owns the
	// Pixi.Graphics representation. Click → ContextMenu surfaces the
	// existing "Open entity" / "Delete placement" actions; tooltip on
	// hover via an HTML overlay (Pixi text would need bitmap font setup
	// for crisp UI labels).
	//
	// Coordinates: placement.x / placement.y are fractional [0,1] against
	// the source-image dimensions. Convert to canvas pixels via
	// activeMap.width / activeMap.height — same convention PixiRegionLayer
	// and MapStage use.

	import { getContext, onDestroy, onMount } from 'svelte';
	import {
		PIXI_STAGE_CONTEXT,
		type PixiStageContext
	} from './pixi-context.js';
	import { placementsAtPlayhead } from '$lib/types/map-placement.js';
	import { getEntityTypeColor } from '$lib/entity-type-colors.js';
	import type { MapPlacement } from '$lib/types/map-placement.js';
	import type { Entity } from '$lib/stores/entities.js';
	import type { WorldMap } from './types.js';
	import ContextMenu from '$lib/os/ContextMenu.svelte';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;
	type FederatedPointerEvent = import('pixi.js').FederatedPointerEvent;

	let {
		activeMap,
		playhead,
		placements,
		entities,
		armedPlaceableId = null,
		onOpenEntity,
		onDeletePlacement,
		onCanvasClick
	}: {
		activeMap: WorldMap | null;
		playhead: number | null;
		placements: MapPlacement[];
		entities: Entity[];
		// When non-null, a left-click on empty stage area fires onCanvasClick
		// with fractional [0,1] coords against the source-image dimensions —
		// matches MapStage.svelte's onCanvasClick contract so WorldMap can
		// reuse handleCanvasClick unchanged.
		armedPlaceableId?: string | null;
		onOpenEntity: (id: string) => void;
		onDeletePlacement: (id: string) => void;
		onCanvasClick?: (fx: number, fy: number) => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;

	type MenuState = {
		x: number;
		y: number;
		placementId: string;
		placeableId: string;
		placeableType: string;
		placeableName: string;
	};
	let menu = $state<MenuState | null>(null);
	let tooltip = $state<{ x: number; y: number; text: string } | null>(null);

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

	function parseHex(input: string): number {
		let s = input.trim().replace(/^#/, '');
		if (s.length === 3 || s.length === 4) {
			s = s.split('').map((c) => c + c).join('');
		}
		if (s.length === 8) s = s.slice(0, 6);
		if (s.length !== 6) return 0x9ca3af;
		const n = parseInt(s, 16);
		return Number.isFinite(n) && !Number.isNaN(n) ? n : 0x9ca3af;
	}

	function clientXY(e: FederatedPointerEvent): { x: number; y: number } {
		const x = (e.client?.x ?? (e.nativeEvent as MouseEvent)?.clientX ?? 0) as number;
		const y = (e.client?.y ?? (e.nativeEvent as MouseEvent)?.clientY ?? 0) as number;
		return { x, y };
	}

	// Materialize the playhead-filtered active set as $derived so the
	// render effect re-runs cleanly when any of (playhead, placements,
	// activeMap) changes. Reading the filter inline inside the $effect
	// worked for the Leaflet path, but in the Pixi path the conditional
	// branch (playhead === null ? … : …) made Svelte 5's dependency
	// tracking miss the playhead re-read on the placementsAtPlayhead
	// branch — placements stayed visible when scrubbing past their
	// endPosition.
	const activePlacements = $derived.by(() => {
		if (!activeMap?.width || !activeMap?.height) return [];
		if (playhead === null) {
			return placements.filter(
				(p) => p.startPosition === null && p.endPosition === null
			);
		}
		return placementsAtPlayhead(placements, playhead);
	});

	$effect(() => {
		const app = stageCtx.app;
		if (!app || !PIXI) return;
		if (!activeMap?.width || !activeMap?.height) return;

		if (!layer) {
			layer = new PIXI.Container();
			app.stage.addChild(layer);
		}

		for (const child of layer.removeChildren()) {
			child.destroy();
		}

		// Cache map dimensions so the loop closure doesn't re-read activeMap
		// (which could be reactive-tracked but we already gated above).
		const mapW = activeMap.width;
		const mapH = activeMap.height;

		for (const placement of activePlacements) {
			const placeable = entities.find((e) => e.id === placement.placeableId);
			if (!placeable) continue;
			const cx = placement.x * mapW;
			const cy = placement.y * mapH;
			const fill = parseHex(getEntityTypeColor(placeable.type));

			const g: PixiGraphics = new PIXI.Graphics();
			g.circle(cx, cy, 8)
				.fill({ color: fill, alpha: 1 })
				.stroke({ color: 0x000000, width: 1.5, alpha: 0.6 });
			g.eventMode = 'static';
			g.cursor = 'pointer';
			g.on('pointerover', (e: FederatedPointerEvent) => {
				const { x, y } = clientXY(e);
				tooltip = {
					x,
					y,
					text: `${placeable.name} (${placeable.type})`
				};
			});
			g.on('pointerout', () => {
				tooltip = null;
			});
			g.on('pointertap', (e: FederatedPointerEvent) => {
				if (e.button !== 0) return;
				e.stopPropagation();
				const { x, y } = clientXY(e);
				tooltip = null;
				menu = {
					x,
					y,
					placementId: placement.id,
					placeableId: placeable.id,
					placeableType: placeable.type,
					placeableName: placeable.name
				};
			});
			layer.addChild(g);
		}
	});

	const menuItems = $derived(
		menu
			? [
					{
						label: `Open ${menu.placeableType}`,
						icon: '↗',
						onSelect: () => {
							onOpenEntity(menu!.placeableId);
						}
					},
					{
						label: 'Delete placement',
						icon: '🗑',
						onSelect: () => {
							onDeletePlacement(menu!.placementId);
						}
					}
				]
			: []
	);

	// Stage-level click capture for the armed "click-to-place" flow.
	// Fires only when armed and the click wasn't consumed by a placement
	// marker (those call e.stopPropagation). Polygon-draw mode owns
	// pointertap separately; the parent gates armedPlaceableId off while
	// drawing is active.
	let stageClickHandler: ((e: FederatedPointerEvent) => void) | null = null;
	$effect(() => {
		const app = stageCtx.app;
		if (!app) return;
		if (!armedPlaceableId || !activeMap?.width || !activeMap?.height) return;
		const w = activeMap.width;
		const h = activeMap.height;

		stageClickHandler = (e: FederatedPointerEvent) => {
			if (e.button !== 0) return;
			if (!onCanvasClick) return;
			const fx = e.global.x / w;
			const fy = e.global.y / h;
			// Clamp to [0,1]. Out-of-bounds clicks (Pixi sometimes fires
			// pointertap with coords just past the canvas edge on subpixel
			// hit-area boundaries) would otherwise persist as
			// off-map placements.
			if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
			onCanvasClick(fx, fy);
		};
		app.stage.eventMode = 'static';
		app.stage.hitArea = app.screen;
		app.stage.on('pointertap', stageClickHandler);

		return () => {
			try {
				if (stageClickHandler) app.stage.off('pointertap', stageClickHandler);
			} catch (_) {
				/* stage destroyed */
			}
			stageClickHandler = null;
		};
	});

	onDestroy(() => {
		if (layer) {
			try {
				layer.destroy({ children: true });
			} catch (_) {
				/* parent app destroyed first */
			}
			layer = null;
		}
	});
</script>

{#if menu}
	<ContextMenu items={menuItems} x={menu.x} y={menu.y} onClose={() => (menu = null)} />
{/if}
{#if tooltip}
	<div
		class="pixi-placement-tooltip"
		style="left: {tooltip.x + 12}px; top: {tooltip.y + 12}px;"
		role="tooltip"
	>
		{tooltip.text}
	</div>
{/if}

<style>
	.pixi-placement-tooltip {
		position: fixed;
		z-index: 1100;
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text, #e8e0d0);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 3px 8px;
		font-size: 11px;
		pointer-events: none;
		white-space: nowrap;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
	}
</style>
