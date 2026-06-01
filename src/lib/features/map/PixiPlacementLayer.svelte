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
	import type { ArtifactPosition } from '$lib/features/map/projection.js';
	import { resolveStyle } from '$lib/features/map/style-cascade.js';
	import { easeToward } from '$lib/features/map/ease.js';
	import { layerVisibility } from '$lib/features/map/layer-prefs-store.js';

	// Slice 3 E4 — layer toggle.
	const visible = layerVisibility('placements');
	import type { MapPlacement } from '$lib/types/map-placement.js';
	import type { Entity } from '$lib/stores/entities.js';
	import type { WorldMap } from './types.js';
	import ContextMenu from '$lib/os/ContextMenu.svelte';
	import PlacementStylePopover from '$lib/features/map/PlacementStylePopover.svelte';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;
	type PixiSprite = import('pixi.js').Sprite;
	type PixiTexture = import('pixi.js').Texture;
	type FederatedPointerEvent = import('pixi.js').FederatedPointerEvent;

	let {
		activeMap,
		playhead,
		placements,
		entities,
		isInScope = null,
		armedPlaceableId = null,
		brushActive = false,
		artifactOverrides = new Map(),
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
		// codex P2: when brush mode is active, suppress marker pointer
		// interaction so painting over a placement doesn't also open/delete it.
		brushActive?: boolean;
		// Slice 4 PR-F (D-PRF-3/4) — movement engine position overrides, keyed by
		// placement_id. Movers-only: a placement with ≥1 move_entity keyframe that
		// is active at the playhead appears here with its interpolated (x,y); we
		// draw it there instead of its static x,y. Everyone else is absent → static
		// position. projection.ts owns the fold; this layer keeps owning identity/
		// style/window/interaction. Empty map when nothing moves.
		artifactOverrides?: Map<string, ArtifactPosition>;
		onOpenEntity: (id: string) => void;
		onDeletePlacement: (id: string) => void;
		onCanvasClick?: (fx: number, fy: number) => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;

	// Slice 4 PR-E (DS3) — per-type hover: a size pulse (scale → 1.15) plus a
	// glow halo in the marker's RESOLVED color (not the amber accent, which is
	// reserved for active/armed/selected). No pixi-filters dependency: the glow
	// is a low-alpha halo circle drawn behind the marker; both ease toward their
	// hover targets via the ticker. Eased frame-rate-independently with a ~55ms
	// time constant so the pulse settles in ~160ms.
	const HOVER_SCALE = 1.15;
	const GLOW_PAD = 8; // px halo radius beyond the marker, at base scale
	const GLOW_ALPHA = 0.45;
	const HOVER_TAU_MS = 55;
	type HoverAnim = { halo: PixiGraphics; scaleTarget: number; haloTarget: number };
	const hoverAnim = new WeakMap<PixiContainer, HoverAnim>();

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
	// Slice 4 PR-C — per-placement style popover, opened from the marker menu's
	// "Edit style" item. Holds the anchor coords + the ids to look up; the
	// placement/placeable objects are derived so the popover tracks live edits.
	let styleTarget = $state<{ x: number; y: number; placementId: string; placeableId: string } | null>(
		null
	);

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

	// /review adversarial — entities.find() inside the per-placement loop
	// is O(P*E) per $effect tick. Memoize as a Map once per entities
	// snapshot.
	let entityById = $derived.by<Map<string, Entity>>(() => {
		const m = new Map<string, Entity>();
		for (const e of entities) m.set(e.id, e);
		return m;
	});

	// Slice 4 PR-C — resolve the style-popover target objects (declared after
	// entityById so the lookup has it in scope). Derived so the popover tracks
	// live edits to the placement / entity while open.
	const styleTargetPlacement = $derived(
		styleTarget ? (placements.find((p) => p.id === styleTarget!.placementId) ?? null) : null
	);
	const styleTargetPlaceable = $derived(
		styleTarget ? (entityById.get(styleTarget!.placeableId) ?? null) : null
	);

	// codex P2 (PR #58): monotonic render token. Icon textures load
	// asynchronously; if this effect re-runs (and destroys the current markers)
	// while a load is in flight, the resolved sprite must NOT be added to a
	// torn-down marker. Each effect run bumps this; in-flight loads capture the
	// value at dispatch and abort on resolution if it has advanced.
	let renderGeneration = 0;

	$effect(() => {
		const app = stageCtx.app;
		const viewport = stageCtx.viewport;
		if (!app || !PIXI || !viewport) return;
		if (!activeMap?.width || !activeMap?.height) return;

		const generation = ++renderGeneration;

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
			const placeable = entityById.get(placement.placeableId);
			if (!placeable) continue;
			// Slice 4 PR-F (D-PRF-4) — movement override wins over the static x,y.
			// Reading artifactOverrides here (it changes identity each playhead
			// tick) keeps this rebuild effect re-running on scrub so the marker
			// glides along the interpolated path.
			const override = artifactOverrides.get(placement.id);
			const cx = (override ? override.x : placement.x) * mapW;
			const cy = (override ? override.y : placement.y) * mapH;

			// Slice 3 T9 + B6 — style cascade resolved per-placement at
			// render. GLOBAL ⊕ STYLE_DEFAULTS[type] ⊕ entity.data.style ⊕
			// placement.data.style (codex P2, PR #58: the per-placement
			// override is the top layer so an instance customization wins).
			// resolved.color is authoritative — resolveStyle already supplies
			// the per-type default when no override is set, so we trust it
			// directly. The old sentinel branch re-applied the type color when
			// resolved.color happened to equal the neutral global default,
			// which clobbered an explicitly-chosen neutral swatch (codex P2).
			const resolved = resolveStyle(placeable, placement.data?.style);
			const fillColor = parseHex(resolved.color);

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

			// Marker is a Container that owns the hit area + interaction, so the
			// visual (circle fallback OR icon sprite) can swap without losing
			// pointer handlers. codex P2 (PR #58): resolved.icon is now honored.
			const marker: PixiContainer = new PIXI.Container();
			// codex P2: while brushing, markers are non-interactive so a paint
			// stroke over a placement doesn't also fire its open/delete tap.
			// Reading brushActive here makes this effect rebuild markers when the
			// brush toggles.
			marker.eventMode = brushActive ? 'none' : 'static';
			marker.cursor = brushActive ? 'default' : 'pointer';
			// Stable hit area on the container — independent of which child
			// visual is shown (the circle may be hidden once an icon loads).
			marker.hitArea = new PIXI.Circle(cx, cy, radius);
			// PR-E: pivot+position at the marker centre so the hover pulse scales
			// about the centre while children stay drawn at their (cx, cy) coords.
			marker.pivot.set(cx, cy);
			marker.position.set(cx, cy);

			// PR-E: glow halo (behind the marker), resolved-color, hidden until
			// hover. Added first so it paints under the circle / icon.
			const halo: PixiGraphics = new PIXI.Graphics();
			halo.circle(cx, cy, radius + GLOW_PAD).fill({ color: fillColor, alpha: 1 });
			halo.alpha = 0;
			marker.addChild(halo);
			hoverAnim.set(marker, { halo, scaleTarget: 1, haloTarget: 0 });

			marker.on('pointerover', (e: FederatedPointerEvent) => {
				const { x, y } = clientXY(e);
				tooltip = {
					x,
					y,
					text: `${placeable.name} (${placeable.type})`
				};
				const st = hoverAnim.get(marker);
				if (st) {
					st.scaleTarget = HOVER_SCALE;
					// Compose the glow with the same scope-dim × opacity as the
					// marker fill, so a faded out-of-scope marker doesn't flash a
					// full-strength glow on hover.
					st.haloTarget = GLOW_ALPHA * fillAlpha;
				}
			});
			marker.on('pointerout', () => {
				tooltip = null;
				const st = hoverAnim.get(marker);
				if (st) {
					st.scaleTarget = 1;
					st.haloTarget = 0;
				}
			});
			marker.on('pointertap', (e: FederatedPointerEvent) => {
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

			const g: PixiGraphics = new PIXI.Graphics();
			g.circle(cx, cy, radius)
				.fill({ color: fillColor, alpha: fillAlpha })
				.stroke({ color: 0x000000, width: 1.5, alpha: strokeAlpha });
			marker.addChild(g);
			layer.addChild(marker);

			// codex P2 (PR #58): an accepted per-placement/entity icon override
			// now renders. The circle stays as the visual while the texture
			// loads and as the fallback if the load fails; on success the icon
			// sprite overlays it and the circle is hidden.
			if (resolved.icon) {
				void loadIconSprite(resolved.icon, cx, cy, radius, fillAlpha, marker, g, generation);
			}
		}
	});

	// codex P2 (PR #58): load a placement's icon-override texture and overlay it
	// as a sprite, sized to the marker diameter and dimmed to the resolved
	// alpha. Generation-guarded (see renderGeneration) so a load resolving after
	// the render effect re-ran doesn't attach to a destroyed marker. On a load
	// failure (bad URL, CORS/CSP, decode error) the circle fallback simply
	// stays — the override is best-effort, never blocking.
	async function loadIconSprite(
		url: string,
		cx: number,
		cy: number,
		radius: number,
		alpha: number,
		marker: PixiContainer,
		circle: PixiGraphics,
		generation: number
	): Promise<void> {
		if (!PIXI) return;
		let texture: PixiTexture;
		try {
			texture = await PIXI.Assets.load(url);
		} catch {
			return; // keep the circle fallback
		}
		// Effect re-ran (markers destroyed) or layer torn down while loading.
		if (generation !== renderGeneration || !layer) return;
		const sprite: PixiSprite = new PIXI.Sprite(texture);
		sprite.anchor.set(0.5);
		sprite.position.set(cx, cy);
		// Fit the icon to the marker diameter; cascade.scale is already in radius.
		sprite.width = radius * 2;
		sprite.height = radius * 2;
		sprite.alpha = alpha;
		// The marker Container owns hit-testing via hitArea; the sprite must not
		// intercept events or it would shadow the container's handlers.
		sprite.eventMode = 'none';
		circle.visible = false;
		marker.addChild(sprite);
	}

	// PR-E hover animation loop. One ticker for the layer eases every marker
	// toward its hover target (scale + halo alpha). Frame-rate-independent ease
	// (k = 1 − e^(−Δt/τ)) so it settles in ~160ms regardless of refresh rate.
	$effect(() => {
		const app = stageCtx.app;
		if (!app || !PIXI) return;
		const tick = () => {
			if (!layer) return;
			const dt = app.ticker.deltaMS;
			for (const child of layer.children) {
				const st = hoverAnim.get(child as PixiContainer);
				if (!st) continue;
				const m = child as PixiContainer;
				m.scale.set(easeToward(m.scale.x, st.scaleTarget, dt, HOVER_TAU_MS));
				st.halo.alpha = easeToward(st.halo.alpha, st.haloTarget, dt, HOVER_TAU_MS);
			}
		};
		app.ticker.add(tick);
		return () => {
			try {
				app.ticker.remove(tick);
			} catch (_) {
				/* app destroyed first */
			}
		};
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
						label: 'Edit style',
						icon: '🎨',
						onSelect: () => {
							styleTarget = {
								x: menu!.x,
								y: menu!.y,
								placementId: menu!.placementId,
								placeableId: menu!.placeableId
							};
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
{#if styleTarget && styleTargetPlacement && styleTargetPlaceable}
	<PlacementStylePopover
		placement={styleTargetPlacement}
		placeable={styleTargetPlaceable}
		x={styleTarget.x}
		y={styleTarget.y}
		onClose={() => (styleTarget = null)}
	/>
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
