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
	import {
		resolveStyle,
		needsContrastRing,
		CONTRAST_RING_COLOR
	} from '$lib/features/map/style-cascade.js';
	import { resolvePaletteHex } from '$lib/entity-type-colors.js';
	import { buildCharacterIndexById } from '$lib/features/graph/view-builders.js';
	import { preferences } from '$lib/os/preferences-store.js';
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
		reducedMotion = false,
		isInScope = null,
		armedPlaceableId = null,
		brushActive = false,
		artifactOverrides = new Map(),
		moveMode = false,
		moveKeyframes = new Map(),
		onMoveCommit,
		onMoveSelect,
		onOpenEntity,
		onDeletePlacement,
		onCanvasClick
	}: {
		activeMap: WorldMap | null;
		playhead: number | null;
		placements: MapPlacement[];
		entities: Entity[];
		// Cinematic Spotlight PR1 — prefers-reduced-motion: snap marker position to
		// target (τ→0) instead of gliding (jump-cut).
		reducedMotion?: boolean;
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
		// Slice 4 PR-F (DS4) — Move tool active. Markers become draggable (cursor
		// grab); a drag authors a move_entity keyframe at the playhead via
		// onMoveCommit. The marker-tap context menu is suppressed in this mode.
		moveMode?: boolean;
		// Slice 4 PR-F (DS4) — committed move_entity keyframe positions per
		// placement_id, sorted by t_position. In Move mode the layer draws a faint
		// amber path from each placement's baseline through its keyframes so the
		// authored motion is visible. Empty/absent → no path.
		moveKeyframes?: Map<string, ArtifactPosition[]>;
		// Fired on drag release with the dropped fractional [0,1] position. The
		// parent POSTs the move_entity event; the projection override then repaints
		// the marker at the committed/interpolated position on the next tick.
		onMoveCommit?: (placementId: string, x: number, y: number) => void;
		// Fired when a marker is clicked (not dragged) in Move mode — selects it for
		// keyboard nudging (DS4 a11y). The parent owns the keyboard interaction.
		onMoveSelect?: (placementId: string) => void;
		onOpenEntity: (id: string) => void;
		onDeletePlacement: (id: string) => void;
		onCanvasClick?: (fx: number, fy: number) => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;

	// Slice 4 PR-F (DS4) — Move-tool drag state. Set on a marker pointerdown while
	// moveMode is on; the dragged marker follows the cursor and a dashed ghost
	// line runs from its baseline to the cursor until release. baseline is the
	// marker's canvas-pixel origin at grab time (the ghost anchor); the live Pixi
	// position is mutated directly during the drag (not via reactive state, so the
	// marker-rebuild effect doesn't fire mid-gesture). ghost is a persistent
	// Graphics added to the layer at grab time and destroyed on release.
	type DragState = {
		placementId: string;
		marker: PixiContainer;
		baselineCx: number;
		baselineCy: number;
	};
	let drag: DragState | null = null;
	let ghost: PixiGraphics | null = null;

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
	// Cinematic Spotlight (Slice 8) PR0 — marker position glide. As the playhead
	// steps scene-to-scene the projected (interpolated) position jumps; ease the
	// marker toward it instead of snapping, written imperatively to the display
	// object in the layer's existing ticker (the Fix-4 pattern, already proven
	// here by the hover ease + the drag handler). τ≈150ms per the design.
	const POS_TAU_MS = 150;
	type Pt = { x: number; y: number };
	type HoverAnim = {
		halo: PixiGraphics;
		scaleTarget: number;
		haloTarget: number;
		// Position ease state. posTarget is the projected target (px); posCurrent
		// is the eased live value, written to marker.position each frame.
		posTarget: Pt;
		posCurrent: Pt;
		placementId: string;
	};
	const hoverAnim = new WeakMap<PixiContainer, HoverAnim>();
	// posCurrent must SURVIVE the per-boundary marker rebuild (markers are
	// destroyed + recreated each scene boundary), so the glide isn't reset every
	// boundary. Keyed by placement id; a marker re-entering after leaving scope is
	// pruned (below) so it snaps fresh rather than gliding from a stale position.
	const posCurrentById = new Map<string, Pt>();

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
		// Capture moveMode for the closures below; reading it here also makes this
		// effect rebuild markers (grab cursor + drag handler) when the tool toggles.
		const inMoveMode = moveMode;

		// A reactive change (playhead, placements, override map, style, tool) rebuilds
		// every marker below — which would destroy the marker + ghost out from under
		// an in-flight drag while the viewport pointer listeners + paused pan plugin
		// stayed live until the next pointer event (codex P1). Cancel the drag here
		// first so cleanup is synchronous with the teardown, not deferred.
		if (drag) cleanupDrag();

		if (!layer) {
			layer = new PIXI.Container();
			viewport.addChild(layer);
		}
		// Slice 3 E4 — apply user visibility toggle.
		layer.visible = $visible;

		for (const child of layer.removeChildren()) {
			// Destroy children too: each marker Container owns Graphics (halo, fill
			// circle, contrast ring) whose GPU buffers leak if only the Container is
			// destroyed. This rebuild now also fires on palette changes (not just
			// playhead scrub), so the per-rebuild leak compounds without this.
			child.destroy({ children: true });
		}

		// Cache map dimensions so the loop closure doesn't re-read activeMap
		// (which could be reactive-tracked but we already gated above).
		const mapW = activeMap.width;
		const mapH = activeMap.height;

		// Settings customization Phase 2, Item 1 — the type-default color layer.
		// Read $preferences INSIDE the effect so a palette recolor re-runs this
		// rebuild and restyles every sprite (Svelte 5 tracks reads in scope).
		const resolvedTypeHex = resolvePaletteHex($preferences.appearance);
		// Character cycle index — computed from the SAME global entities list the
		// graph uses (WorldMap passes entities={$entities}), via the SAME helper,
		// so an uncustomized character reads the same color on both surfaces (F3a).
		const characterIndexById = buildCharacterIndexById(entities);

		// Cinematic Spotlight PR0 — track which placements drew this pass so stale
		// position-ease state (left behind by a placement that has left scope) can
		// be pruned; otherwise it would glide from a stale spot on re-entry.
		const activeIds = new Set<string>();

		for (const placement of activePlacements) {
			const placeable = entityById.get(placement.placeableId);
			if (!placeable) continue;
			activeIds.add(placement.id);
			// Slice 4 PR-F (D-PRF-4) — movement override wins over the static x,y.
			// Reading artifactOverrides here (it changes identity each playhead
			// tick) keeps this rebuild effect re-running on scrub so the marker
			// glides along the interpolated path.
			const override = artifactOverrides.get(placement.id);
			const cx = (override ? override.x : placement.x) * mapW;
			const cy = (override ? override.y : placement.y) * mapH;

			// Slice 3 T9 + B6 / Settings Phase 2 Item 1 — style cascade resolved
			// per-placement at render. Color layers (top wins): placement.data.style
			// ▸ entity.data.style ▸ data.color/char-cycle ▸ resolvedTypeHex[type]
			// (the customizable palette) ▸ GLOBAL. resolved.color is authoritative —
			// resolveStyle already supplies the palette default when no override is
			// set, so we trust it directly. The old sentinel branch re-applied the
			// type color when resolved.color happened to equal the neutral global
			// default, which clobbered an explicitly-chosen neutral swatch (codex P2).
			const resolved = resolveStyle(
				placeable,
				resolvedTypeHex,
				placement.data?.style,
				characterIndexById.get(placeable.id)
			);
			const fillColor = parseHex(resolved.color);
			// Contrast guard (Item 1 / D4): a low-luminance resolved fill vanishes
			// against the dark canvas. ADD a fixed light ring — never substitute the
			// fill — so an intentionally dark/neutral color still renders as chosen.
			const ringColor = needsContrastRing(resolved.color) ? parseHex(CONTRAST_RING_COLOR) : null;

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

			// Slice 4 PR-F (DS4) — in Move mode, draw a faint amber path from the
			// placement's static baseline through its committed keyframes so the
			// authored motion is visible. Drawn before the marker so it paints
			// underneath. Baseline (static x,y) is the position before the first
			// keyframe, matching the projection's clamp-before-first behavior.
			if (inMoveMode) {
				const kfs = moveKeyframes.get(placement.id);
				if (kfs && kfs.length > 0) {
					const path = new PIXI.Graphics();
					path.moveTo(placement.x * mapW, placement.y * mapH);
					for (const kf of kfs) path.lineTo(kf.x * mapW, kf.y * mapH);
					path.stroke({ color: GHOST_COLOR, width: 1.5, alpha: 0.4 });
					path.eventMode = 'none';
					layer.addChild(path);
				}
			}

			// Marker is a Container that owns the hit area + interaction, so the
			// visual (circle fallback OR icon sprite) can swap without losing
			// pointer handlers. codex P2 (PR #58): resolved.icon is now honored.
			const marker: PixiContainer = new PIXI.Container();
			// codex P2: while brushing, markers are non-interactive so a paint
			// stroke over a placement doesn't also fire its open/delete tap.
			// Reading brushActive here makes this effect rebuild markers when the
			// brush toggles.
			marker.eventMode = brushActive ? 'none' : 'static';
			marker.cursor = brushActive ? 'default' : inMoveMode ? 'grab' : 'pointer';
			// Stable hit area on the container — independent of which child
			// visual is shown (the circle may be hidden once an icon loads).
			marker.hitArea = new PIXI.Circle(cx, cy, radius);
			// PR-E: pivot at the marker centre so the hover pulse scales about the
			// centre while children stay drawn at their (cx, cy) coords. The drag
			// handler relies on pivot == children origin to move the marker 1:1.
			marker.pivot.set(cx, cy);
			// Cinematic Spotlight PR0 — ease position toward the projected target
			// (cx,cy) rather than snapping. posCurrent persists across the rebuild
			// (keyed by placement id) so the glide continues through marker
			// re-creation; a NEW marker snaps to its spawn position.
			const posTarget: Pt = { x: cx, y: cy };
			const posCurrent: Pt = posCurrentById.get(placement.id) ?? { x: cx, y: cy };
			posCurrentById.set(placement.id, posCurrent);
			marker.position.set(posCurrent.x, posCurrent.y);

			// PR-E: glow halo (behind the marker), resolved-color, hidden until
			// hover. Added first so it paints under the circle / icon.
			const halo: PixiGraphics = new PIXI.Graphics();
			halo.circle(cx, cy, radius + GLOW_PAD).fill({ color: fillColor, alpha: 1 });
			halo.alpha = 0;
			marker.addChild(halo);
			hoverAnim.set(marker, {
				halo,
				scaleTarget: 1,
				haloTarget: 0,
				posTarget,
				posCurrent,
				placementId: placement.id
			});

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
				// In Move mode a click is the start of a drag, not a menu open.
				if (inMoveMode) return;
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

			// Slice 4 PR-F (DS4) — Move tool: grab a marker to drag it. The drag
			// itself is tracked on the viewport (pointermove/up) so it keeps
			// following the cursor outside the marker's hit area; see startDrag.
			if (inMoveMode) {
				marker.on('pointerdown', (e: FederatedPointerEvent) => {
					if (e.button !== 0) return;
					e.stopPropagation();
					startDrag(placement.id, marker, cx, cy);
				});
			}

			const g: PixiGraphics = new PIXI.Graphics();
			g.circle(cx, cy, radius)
				.fill({ color: fillColor, alpha: fillAlpha })
				.stroke({ color: 0x000000, width: 1.5, alpha: strokeAlpha });
			marker.addChild(g);
			// Contrast-guard ring: a light ring just outside the marker so a dark
			// fill stays visible. Composed with the same scope-dim × opacity as the
			// fill so an out-of-scope marker's ring fades too. The black stroke above
			// stays (it's the marker outline); this ADDS a light ring on top of it.
			// The ring guards the FILL CIRCLE, so it's hidden alongside the circle
			// when an icon sprite successfully overlays it (the icon, not the dark
			// fill, becomes the visual). On icon-load failure the circle + ring both
			// remain so a dark fallback stays legible.
			let ring: PixiGraphics | null = null;
			if (ringColor !== null) {
				ring = new PIXI.Graphics();
				ring.circle(cx, cy, radius + 1.5).stroke({ color: ringColor, width: 2, alpha: fillAlpha });
				ring.eventMode = 'none';
				marker.addChild(ring);
			}
			layer.addChild(marker);

			// codex P2 (PR #58): an accepted per-placement/entity icon override
			// now renders. The circle stays as the visual while the texture
			// loads and as the fallback if the load fails; on success the icon
			// sprite overlays it and the circle is hidden.
			if (resolved.icon) {
				void loadIconSprite(resolved.icon, cx, cy, radius, fillAlpha, marker, g, ring, generation);
			}
		}

		// Prune position-ease state for placements no longer drawn, so a
		// re-entering marker snaps fresh instead of gliding from a stale spot.
		for (const id of posCurrentById.keys()) {
			if (!activeIds.has(id)) posCurrentById.delete(id);
		}
	});

	// Slice 4 PR-F (DS4) — Move-tool drag. Grab handles pointerdown on a marker;
	// the move/release are tracked on the viewport so the marker keeps following
	// the cursor even when it leaves the marker's small hit area. The viewport's
	// pan-on-drag plugin is paused for the duration so panning doesn't fight the
	// drag (same approach as PixiBrushLayer). Direct Pixi mutation (no reactive
	// state) keeps the marker-rebuild effect from firing mid-gesture.
	const GHOST_COLOR = 0xc8942a; // amber accent
	const DRAG_THRESHOLD_PX = 4; // a sub-threshold drag is a click, not a move

	function startDrag(placementId: string, marker: PixiContainer, cx: number, cy: number): void {
		const viewport = stageCtx.viewport;
		if (!viewport || !PIXI || drag) return;
		drag = { placementId, marker, baselineCx: cx, baselineCy: cy };
		marker.cursor = 'grabbing';
		ghost = new PIXI.Graphics();
		if (layer) layer.addChild(ghost);
		pauseViewportDrag(viewport, true);
		viewport.on('pointermove', onDragMove);
		viewport.on('pointerup', endDrag);
		viewport.on('pointerupoutside', endDrag);
	}

	function onDragMove(e: FederatedPointerEvent): void {
		const viewport = stageCtx.viewport;
		if (!drag || !viewport) return;
		if (drag.marker.destroyed) {
			cleanupDrag();
			return;
		}
		const local = e.getLocalPosition(viewport);
		// Pivot stays at the baseline, so setting position moves the children to
		// the cursor's world position 1:1.
		drag.marker.position.set(local.x, local.y);
		if (ghost && !ghost.destroyed) {
			ghost.clear();
			drawDashedLine(ghost, drag.baselineCx, drag.baselineCy, local.x, local.y);
		}
	}

	function endDrag(e: FederatedPointerEvent): void {
		const viewport = stageCtx.viewport;
		const captured = drag;
		if (!captured) return;
		let committed: { x: number; y: number } | null = null;
		if (viewport && activeMap?.width && activeMap?.height && !captured.marker.destroyed) {
			const local = e.getLocalPosition(viewport);
			const moved = Math.hypot(local.x - captured.baselineCx, local.y - captured.baselineCy);
			if (moved >= DRAG_THRESHOLD_PX) {
				const fx = Math.min(1, Math.max(0, local.x / activeMap.width));
				const fy = Math.min(1, Math.max(0, local.y / activeMap.height));
				committed = { x: fx, y: fy };
				// PR0 — anchor the ease state at the drop point so the post-commit
				// rebuild restores from here (and eases to the committed target,
				// which is the same spot) rather than snapping back to the pre-drag
				// position for a frame.
				anchorEaseAt(captured, local.x, local.y);
			} else {
				// Treat as a click — snap the marker back and select it for keyboard
				// nudging instead of authoring a near-zero-distance keyframe.
				captured.marker.position.set(captured.baselineCx, captured.baselineCy);
				anchorEaseAt(captured, captured.baselineCx, captured.baselineCy);
				onMoveSelect?.(captured.placementId);
			}
		}
		cleanupDrag();
		if (committed) onMoveCommit?.(captured.placementId, committed.x, committed.y);
	}

	// Cinematic Spotlight PR0 — pin a marker's position-ease state to (x,y) px so
	// the ticker holds it there (no glide-back) in the window between drag release
	// and the rebuild the commit triggers. Mutates in place: posCurrent and the
	// posCurrentById entry share one object ref, so this keeps them consistent.
	function anchorEaseAt(captured: DragState, x: number, y: number): void {
		const st = hoverAnim.get(captured.marker);
		if (st) {
			st.posCurrent.x = st.posTarget.x = x;
			st.posCurrent.y = st.posTarget.y = y;
		}
		// Mutate the entry in place (it shares the object ref with st.posCurrent)
		// rather than replacing it, so the shared-ref invariant holds.
		const entry = posCurrentById.get(captured.placementId);
		if (entry) {
			entry.x = x;
			entry.y = y;
		} else {
			posCurrentById.set(captured.placementId, { x, y });
		}
	}

	function cleanupDrag(): void {
		const viewport = stageCtx.viewport;
		if (drag && !drag.marker.destroyed) drag.marker.cursor = moveMode ? 'grab' : 'pointer';
		if (ghost) {
			try {
				if (!ghost.destroyed) ghost.destroy();
			} catch (_) {
				/* layer torn down first */
			}
			ghost = null;
		}
		if (viewport) {
			try {
				viewport.off('pointermove', onDragMove);
				viewport.off('pointerup', endDrag);
				viewport.off('pointerupoutside', endDrag);
			} catch (_) {
				/* viewport torn down */
			}
			pauseViewportDrag(viewport, false);
		}
		drag = null;
	}

	// Optional-chained so a mocked viewport without a plugin manager is a no-op
	// in tests (mirrors PixiBrushLayer's drag-plugin pause/resume).
	function pauseViewportDrag(viewport: unknown, pause: boolean): void {
		const vp = viewport as { plugins?: { pause(n: string): void; resume(n: string): void } };
		if (pause) vp.plugins?.pause('drag');
		else vp.plugins?.resume('drag');
	}

	function drawDashedLine(g: PixiGraphics, x0: number, y0: number, x1: number, y1: number): void {
		const dash = 6;
		const gap = 4;
		const dist = Math.hypot(x1 - x0, y1 - y0);
		if (dist < 1) return;
		const ux = (x1 - x0) / dist;
		const uy = (y1 - y0) / dist;
		for (let d = 0; d < dist; d += dash + gap) {
			const s = d;
			const e = Math.min(d + dash, dist);
			g.moveTo(x0 + ux * s, y0 + uy * s);
			g.lineTo(x0 + ux * e, y0 + uy * e);
		}
		g.stroke({ color: GHOST_COLOR, width: 1.5, alpha: 0.85 });
	}

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
		ring: PixiGraphics | null,
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
		// The contrast ring guards the now-hidden fill circle; hide it too so it
		// doesn't float around the icon (which is its own visual).
		if (ring) ring.visible = false;
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
				// Cinematic Spotlight PR0 — ease marker position toward its projected
				// target, written straight to the display object (no $state, no
				// rebuild). The dragged marker is owned by the drag handler this
				// frame, so leave its position alone.
				if (!(drag && drag.marker === m)) {
					const tau = reducedMotion ? 0 : POS_TAU_MS; // jump-cut under reduced motion
					st.posCurrent.x = easeToward(st.posCurrent.x, st.posTarget.x, dt, tau);
					st.posCurrent.y = easeToward(st.posCurrent.y, st.posTarget.y, dt, tau);
					m.position.set(st.posCurrent.x, st.posCurrent.y);
				}
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
		// Detach any in-flight move-drag handlers + resume viewport pan before the
		// layer (and its ghost) is torn down.
		cleanupDrag();
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
