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
	import { resolveStyle, GLOBAL_STYLE_DEFAULT } from '$lib/features/map/style-cascade.js';
	import { layerVisibility } from '$lib/features/map/layer-prefs-store.js';

	// Visual fallback gate: when the cascade returns GLOBAL_STYLE_DEFAULT's
	// color (i.e. neither STYLE_DEFAULTS nor entity.data.style set one),
	// fall through to the legacy getEntityTypeColor so existing entities
	// without an explicit style still render in their per-type palette.
	const GLOBAL_DEFAULT_COLOR = GLOBAL_STYLE_DEFAULT.color;

	// Slice 3 E4 — layer toggle.
	const visible = layerVisibility('placements');
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
		isInScope = null,
		armedPlaceableId = null,
		onOpenEntity,
		onDeletePlacement,
		onCanvasClick
	}: {
		activeMap: WorldMap | null;
		playhead: number | null;
		placements: MapPlacement[];
		entities: Entity[];
		// T9 follow-up: out-of-scope placements (the placeable entity has
		// intervals that don't cover the current playhead) render dimmed.
		// Mirrors the scope treatment Leaflet's RegionLayer applies to
		// regions — extended to placements for consistency under Pixi.
		// When null, no scope filter is applied.
		isInScope?: ((entityId: string) => boolean) | null;
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
		const viewport = stageCtx.viewport;
		if (!app || !PIXI || !viewport) return;
		if (!activeMap?.width || !activeMap?.height) return;

		if (!layer) {
			layer = new PIXI.Container();
			viewport.addChild(layer);
		}
		// Slice 3 E4 — apply user visibility toggle.
		layer.visible = $visible;

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

			// Slice 3 T9 + B6 — style cascade resolved per-placement at
			// render. GLOBAL ⊕ STYLE_DEFAULTS[type] ⊕ entity.data.style.
			// Color falls through getEntityTypeColor as a baseline if
			// neither STYLE_DEFAULTS nor an instance override set one
			// — getEntityTypeColor returns the legacy per-type palette
			// so visuals don't regress for entities without explicit
			// styles. resolveStyle's color is preferred; the legacy is
			// the fallback for type defaults the new const doesn't list.
			const resolved = resolveStyle(placeable);
			const fillColor =
				resolved.color === GLOBAL_DEFAULT_COLOR
					? parseHex(getEntityTypeColor(placeable.type))
					: parseHex(resolved.color);

			// T9 follow-up: scope-based dim. The placeable entity is in
			// scope when its intervals contain the playhead (or playhead is
			// null = idle, which deriveScope reports as "everything in
			// scope"). Out-of-scope placements stay visible but fade so
			// the canvas isn't visually noisy with off-scene markers.
			const inScope = isInScope ? isInScope(placeable.id) : true;
			// Compose scope dim with per-instance opacity. resolved.opacity
			// is the cascade's full chain; scope is the temporal dim.
			const fillAlpha = (inScope ? 1 : 0.3) * resolved.opacity;
			const strokeAlpha = (inScope ? 0.6 : 0.2) * resolved.opacity;

			// Sprite radius scales with cascade.scale. Base radius 8.
			const radius = 8 * resolved.scale;

			const g: PixiGraphics = new PIXI.Graphics();
			g.circle(cx, cy, radius)
				.fill({ color: fillColor, alpha: fillAlpha })
				.stroke({ color: 0x000000, width: 1.5, alpha: strokeAlpha });
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
		const viewport = stageCtx.viewport;
		if (!app || !viewport) return;
		if (!armedPlaceableId || !activeMap?.width || !activeMap?.height) return;
		const w = activeMap.width;
		const h = activeMap.height;

		stageClickHandler = (e: FederatedPointerEvent) => {
			if (e.button !== 0) return;
			if (!onCanvasClick) return;
			// Empty-viewport clicks only. PixiRegionLayer's region polygons
			// are interactive; clicking one fires pointertap on the viewport
			// too, so an armed placeable would drop a marker UNDER the
			// polygon. Bail when the tap target is anything but the
			// viewport root itself (descendant Graphics → don't fire).
			if (e.target !== e.currentTarget) return;
			// T13 parity (codex PR#57 iter3 + pixi-viewport): translate
			// screen-pixel e.global to viewport-local (world) coords. World
			// coords align 1:1 with image pixels at zoom=1; under zoom they
			// diverge, so dividing by activeMap.width gives the correct
			// fractional position regardless of pan/zoom state.
			const local = e.getLocalPosition(viewport);
			const fx = local.x / w;
			const fy = local.y / h;
			// Clamp to [0,1]. Out-of-bounds clicks (e.g., panned past
			// edge) shouldn't persist as off-map placements.
			if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
			onCanvasClick(fx, fy);
		};
		viewport.eventMode = 'static';
		viewport.on('pointertap', stageClickHandler);

		return () => {
			try {
				if (stageClickHandler) viewport.off('pointertap', stageClickHandler);
			} catch (_) {
				/* viewport destroyed */
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
