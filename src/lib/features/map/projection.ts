// World Map v3 — Slice 1a projection engine.
//
// Pure function: given a playhead `t`, a list of anchors, a list of events,
// and a user-scoped reference context, return the canonical RenderedState
// for that frame. Both the (future) Pixi renderer and the existing Leaflet
// renderer consume RenderedState identically — projection is the SINGLE
// shared contract per the Slice 1a design.
//
// ┌────────────────────────────────────────────────────────────────────┐
// │ Pipeline                                                           │
// │                                                                    │
// │   anchors  ─┐                                                      │
// │   events   ─┼──> sort (t_position, created_at, id)                 │
// │   t        ─┘                │                                     │
// │                              ▼                                     │
// │                  pick anchor at-or-before t                        │
// │                              │                                     │
// │                              ▼                                     │
// │         fold state events in (anchor.t, t]   ←──  ctx (cross-user  │
// │                              │                       lazy GC)      │
// │                              ▼                                     │
// │                       RenderedState                                │
// │                                                                    │
// │ Same-T rule (CMT-5): events at t_position == anchor.t are          │
// │   EXCLUDED from the fold — anchor at T is "world AT T", events     │
// │   at exactly T are conceptually pre-anchor.                        │
// │                                                                    │
// │ Cross-user defense (outside-voice codex #9): ctx.allowedFactions / │
// │   ctx.allowedRegions are pre-filtered through world_maps.user_id   │
// │   at the DB layer. projection.ts does not reach back into the DB;  │
// │   it just drops refs not present in the allowed sets. A foreign    │
// │   user's faction_id leaks neither color nor presence into the      │
// │   output.                                                          │
// │                                                                    │
// │ Lazy GC (D5): missing-or-cross-user refs are silently omitted.     │
// │   No cascade rewrites of historical anchors. No soft-delete.       │
// └────────────────────────────────────────────────────────────────────┘
//
// Slice 1 shipped state events (transfer_region); Slice 3 added paint_cells;
// Slice 4 added the continuous move_entity fold. The originally-reserved
// windowed `link_chain` map-event kind was ABANDONED in Slice 5 — EventChain
// derives from the `caused_by` relationship instead (ADR 0006). The signature
// carries every event through so kinds extend by adding cases, not reshaping.

export const NEUTRAL_REGION_COLOR = '#9ca3af';

// Slice 3 outside-voice A3 — single source of truth for the paint_cells
// chunking cap. Server-side validator rejects payloads over this;
// client-side PixiBrushLayer chunks gestures at this boundary. Keep them
// in lockstep by importing this constant from both sides.
export const PAINT_CELLS_MAX_PER_EVENT = 256;

// -- Anchor payload (state_jsonb) ---------------------------------------------
// Matches docs/plans/world-map-v3-design.md § "State_jsonb shape (anchor
// content, all slices)". Slice 1 only reads `regions`; `artifacts` is passed
// through to RenderedState. `chains` is an INERT input key as of Slice 5 PR-A
// (no longer folded into RenderedState — EventChain derives from `caused_by`;
// see docs/adr/0006-eventchain-derived-from-caused-by.md).

export type AnchorRegion = {
	region_id: string;
	// Added Slice 2 D2 (anchor becomes canonical for geometry). Optional
	// here because backfill from map_regions lands in a follow-up PR (T4);
	// projection skips regions with missing polygon at render. See design
	// doc § "State_jsonb shape" (revised 2026-05-26 per codex challenge).
	polygon?: number[][];
	// Added Slice 2 D2. Logical link to entities.id of type='Location'.
	// Lazy-GC at render: a deleted Location nulls out the link visually.
	locationId?: string | null;
	faction_id?: string | null;
	// Legacy from Slice 1b. Phased out by Slice 2 D1 (faction-only color
	// model); present in historical anchors backfilled from map_regions,
	// ignored at render once D1 lands.
	color?: string | null;
};

export type AnchorArtifact = {
	entity_id: string;
	position: { x: number; y: number };
};

// INERT as of WM3 Slice 5 PR-A. Retained ONLY to type the harmless residual
// `AnchorState.chains` input key (existing anchor rows still carry it). It is
// no longer folded into RenderedState and nothing renders it. EventChain is
// derived from the `caused_by` relationship — see
// docs/adr/0006-eventchain-derived-from-caused-by.md. Do not build on this type.
export type AnchorChain = {
	chain_id: string;
	active_step_index: number;
};

// Slice 3 D2 — per-cell biome state in anchor JSON. Cells are sparse:
// only painted cells appear; missing cells render transparent. Same-T
// ordering: last paint_cells event at a given (x,y) wins (CMT-5).
export type AnchorCell = {
	x: number;
	y: number;
	biome: BiomeKind;
};

export type AnchorState = {
	regions?: AnchorRegion[];
	artifacts?: AnchorArtifact[];
	// INERT as of WM3 Slice 5 PR-A — kept as a tolerated input key (existing
	// rows carry it; new writers may still emit `[]` harmlessly) but no longer
	// folded into RenderedState. See AnchorChain note + ADR 0006.
	chains?: AnchorChain[];
	// Slice 3: terrain cells. Backfilled to [] by drizzle/0022; new
	// anchors must include this key (PR A invariant test enforces).
	cells?: AnchorCell[];
};

export type ProjectionAnchor = {
	id: string;
	tPosition: number;
	createdAt: Date | string;
	stateJsonb: AnchorState;
};

// -- Events -------------------------------------------------------------------
// Slice 1 event-kind union is just `transfer_region`. Unknown kinds are
// preserved through the sort but ignored by the fold — forward-compatible
// with Slice 2's continuous/windowed kinds.
//
// `EVENT_KINDS` and `EventKind` live here (not in src/lib/server/) so the
// client store and the server validator share one source of truth without
// the client crossing the server-only-import barrier (CLAUDE.md trust
// boundary). Adding a new event kind means updating:
//   1. this array
//   2. src/lib/server/world-map-v3.ts validateEventPayload's switch
//   3. projection.ts's fold (applyTransferRegion / applyPaintCells / the
//      Slice 4 movement fold)

export const EVENT_KINDS = ['transfer_region', 'paint_cells', 'move_entity'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type TransferRegionPayload = {
	region_id: string;
	new_faction_id: string;
};

// Slice 3 D2 — terrain brush event. Each event carries a batched cells array
// (one event = one brush gesture; PixiBrushLayer chunks at 256 cells per
// outside-voice A3). Events sharing a command_id are one logical command
// (chunked stroke); undo soft-deletes the whole group atomically. The
// command_complete flag on the last chunk lets the server-side auto-anchor
// fire only at stroke boundary (outside-voice B7).
export type PaintCellsPayload = {
	cells: Array<{ x: number; y: number; biome: BiomeKind }>;
	// Optional. Last chunk of a multi-event stroke sets this true so the
	// auto-anchor logic doesn't fire mid-stroke. Single-event strokes
	// either set it true or omit it (defaults to true server-side).
	command_complete?: boolean;
};

// Slice 4 PR-F (D5) — continuous-movement event. Each event is ONE keyframe:
// the moving unit's position at this event's t_position. The moving unit is a
// `map_placements` row (the instance), NOT the entity — an entity placed twice
// yields two placements and two independent movers, so the payload keys on
// `placement_id`, deliberately diverging from design-doc:246's `target_entity_id`.
//
// Projection interpolates between adjacent keyframes for the same placement_id
// (prev ≤ T, next > T) using `tween`. Keyframes never enter anchor state_jsonb
// (PR-F D-PRF-1): movement is sourced from placements + the live event log only.
// `position` is normalized fractional [0,1] coords, same convention as
// map_placements.x/y (design-doc § Coordinate system).
export type EaseKind = 'linear' | 'ease_in_out';

export type MoveEntityPayload = {
	placement_id: string;
	position: { x: number; y: number };
	tween: EaseKind;
};

// Slice 3 D3 — biome enum, hardcoded for the MVP. User-defined biomes
// deferred to Slice 4 (needs asset upload pipeline). 'unset' IS a valid
// stored value per outside-voice A6: eraser strokes write biome='unset'
// to anchor state, projection treats stored 'unset' and missing cells
// identically (transparent at render). Sparseness is a backfill-time
// optimization only.
export const BIOMES = [
	'plains',
	'forest',
	'water',
	'desert',
	'mountain',
	'swamp',
	'snow',
	'urban',
	'unset'
] as const;
export type BiomeKind = (typeof BIOMES)[number];

export type ProjectionEvent = {
	id: string;
	tPosition: number;
	kind: string;
	createdAt: Date | string;
	payloadJsonb: unknown;
};

// -- Context ------------------------------------------------------------------
// Pre-fetched and pre-scoped by the caller (server-side DB query joining
// through world_maps.user_id). projection.ts treats these sets as the
// authoritative answer to "is this id visible to the current viewer?"

export type AllowedFaction = {
	id: string;
	color: string;
};

export type ProjectionContext = {
	allowedFactions: ReadonlyMap<string, AllowedFaction>;
	allowedRegions: ReadonlySet<string>;
};

// -- Output -------------------------------------------------------------------

export type RenderedRegion = {
	regionId: string;
	factionId: string | null;
	color: string;
};

// Slice 3 — output of the cells projection. Same shape as AnchorCell;
// distinct type so future fields (resolved color, layer overrides) can
// land without touching anchor state.
export type RenderedCell = {
	x: number;
	y: number;
	biome: BiomeKind;
};

// Slice 4 PR-F (D5) — normalized fractional position, same convention as
// map_placements.x/y and the move_entity payload.
export type ArtifactPosition = { x: number; y: number };

export type RenderedState = {
	tPosition: number;
	regions: RenderedRegion[];
	artifacts: AnchorArtifact[];
	// NOTE: `chains` was removed from RenderedState in WM3 Slice 5 PR-A. The
	// link_chain map-event scaffolding was never built and nothing rendered it;
	// EventChain is now derived from the `caused_by` relationship instead (see
	// docs/adr/0006-eventchain-derived-from-caused-by.md). The inert
	// `AnchorState.chains` INPUT key is kept (harmless residue) but is no longer
	// folded into the rendered output.
	cells: RenderedCell[];
	// Slice 4 PR-F (D5, D-PRF-3/4) — per-placement position OVERRIDES from the
	// movement engine, keyed by placement_id. Present only for placements that
	// are active at T AND carry ≥1 move_entity keyframe. The render layer
	// (PixiPlacementLayer) keeps owning identity/style/window/interaction and
	// reads the placement's static (x,y) for everyone NOT in this map; for
	// placements that ARE here it draws at the interpolated position instead.
	// Movers-only: a static placement is absent from this map (no double-draw,
	// nothing to dedup). Empty map when no placements move.
	artifactOverrides: Map<string, ArtifactPosition>;
};

// Slice 4 PR-F (D5) — minimal placement shape the movement fold needs.
// projection.ts decouples from DB rows (same pattern as ProjectionAnchor /
// ProjectionEvent); MapPlacement is structurally assignable to this. `x,y` is
// the baseline position; startPosition/endPosition is the active window
// (both-null = always active), half-open [start, end) per placementsAtPlayhead.
export type ProjectionPlacement = {
	id: string;
	x: number;
	y: number;
	startPosition: number | null;
	endPosition: number | null;
};

// -- Implementation -----------------------------------------------------------

function toMillis(value: Date | string): number {
	return typeof value === 'string' ? Date.parse(value) : value.getTime();
}

function compareCreatedAt(
	a: { createdAt: Date | string; id: string },
	b: { createdAt: Date | string; id: string }
): number {
	const am = toMillis(a.createdAt);
	const bm = toMillis(b.createdAt);
	if (am !== bm) return am - bm;
	// Final tiebreak: id. UUID string compare is fine — we just need
	// determinism, not semantic order.
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pick the latest anchor with t_position <= t. Returns null if none.
 *
 * Same-T rule: anchor at t == playhead is the active anchor (anchor at T
 * represents "world state AT T"). When multiple anchors share a t_position,
 * the one with the latest (created_at, id) wins — last-write-wins under the
 * UNIQUE (world_map_id, t_position) index that should make this case rare
 * but not impossible across migration backfills.
 */
function pickActiveAnchor(t: number, anchors: ProjectionAnchor[]): ProjectionAnchor | null {
	let best: ProjectionAnchor | null = null;
	for (const a of anchors) {
		if (a.tPosition > t) continue;
		if (
			best === null ||
			a.tPosition > best.tPosition ||
			(a.tPosition === best.tPosition && compareCreatedAt(a, best) > 0)
		) {
			best = a;
		}
	}
	return best;
}

function applyPaintCells(
	cells: Map<string, AnchorCell>,
	payload: unknown
): void {
	if (!payload || typeof payload !== 'object') return;
	const p = payload as Partial<PaintCellsPayload>;
	if (!Array.isArray(p.cells)) return;
	for (const cell of p.cells) {
		if (!cell || typeof cell !== 'object') continue;
		const x = (cell as AnchorCell).x;
		const y = (cell as AnchorCell).y;
		const biome = (cell as AnchorCell).biome;
		if (
			typeof x !== 'number' ||
			!Number.isInteger(x) ||
			typeof y !== 'number' ||
			!Number.isInteger(y) ||
			typeof biome !== 'string' ||
			!(BIOMES as readonly string[]).includes(biome)
		) {
			// Lazy GC: malformed entries silently dropped at render
			// (matches the cross-user ref policy in resolveRegionColor).
			continue;
		}
		// Last-write-wins on (x, y). Caller has already sorted events
		// by (t_position, created_at, id); the final write at each cell
		// is the projected biome.
		cells.set(`${x},${y}`, { x, y, biome: biome as BiomeKind });
	}
}

function applyTransferRegion(
	regions: Map<string, AnchorRegion>,
	payload: unknown
): void {
	if (!payload || typeof payload !== 'object') return;
	const p = payload as Partial<TransferRegionPayload>;
	if (typeof p.region_id !== 'string' || typeof p.new_faction_id !== 'string') return;
	const existing = regions.get(p.region_id);
	if (existing) {
		regions.set(p.region_id, { ...existing, faction_id: p.new_faction_id });
		return;
	}
	// Transferring a region the anchor never declared. We still record the
	// ownership intent; the lazy-GC pass downstream will drop it if the
	// region_id isn't in the viewer's allowedRegions set.
	regions.set(p.region_id, { region_id: p.region_id, faction_id: p.new_faction_id });
}

function resolveRegionColor(
	region: AnchorRegion,
	ctx: ProjectionContext
): RenderedRegion | null {
	if (!ctx.allowedRegions.has(region.region_id)) return null;
	if (region.faction_id != null) {
		const faction = ctx.allowedFactions.get(region.faction_id);
		if (faction) {
			return {
				regionId: region.region_id,
				factionId: region.faction_id,
				color: faction.color
			};
		}
		// Faction missing OR owned by another user → fall through to
		// Neutral. The viewer sees "ownership unknown" in grey.
	}
	// Slice 2 D1: faction-only color model. The legacy region.color
	// middle step is gone; every region resolves through faction.color
	// (Neutral is the per-user fallback faction). Anchors backfilled
	// pre-D1 with explicit color in their jsonb keep the field on disk
	// for round-tripping but the projection ignores it.
	return {
		regionId: region.region_id,
		factionId: null,
		color: NEUTRAL_REGION_COLOR
	};
}

// Slice 4 PR-F (D5) — easing curves for keyframe interpolation. This is
// KEYFRAME interpolation (lerp over u∈[0,1] between two authored points), NOT
// the frame-rate exponential smoothing in ease.ts (`easeToward`). `linear`
// returns u unchanged; `ease_in_out` is the standard quad in/out.
//
// NOTE: every SYMMETRIC ease (including ease_in_out) passes through 0.5 at
// u=0.5 — identical to linear at the midpoint. The curves diverge at the
// QUARTER points (u=0.25: linear=0.25, ease_in_out=0.125). Tests must assert
// the difference off-midpoint; a midpoint assertion can't tell them apart.
function applyEase(tween: EaseKind, u: number): number {
	if (tween === 'ease_in_out') {
		return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
	}
	return u; // linear
}

type Keyframe = {
	tPosition: number;
	x: number;
	y: number;
	tween: EaseKind;
	createdAt: Date | string;
	id: string;
};

/**
 * Slice 4 PR-F (D5) — interpolate a placement's position at `t` between two
 * adjacent keyframes. The segment prev→next uses `next.tween` (a keyframe
 * declares how the marker eases INTO it). Guards `nextT === prevT` (returns
 * next's position) so a degenerate zero-length span can never divide-by-zero
 * into NaN — though the fold's same-T last-write-wins collapse should make that
 * unreachable. `u` is clamped to [0,1] defensively (t is between by construction).
 */
export function interpolatePosition(
	prev: { tPosition: number; x: number; y: number },
	next: { tPosition: number; x: number; y: number; tween: EaseKind },
	t: number
): ArtifactPosition {
	const span = next.tPosition - prev.tPosition;
	if (span <= 0) return { x: next.x, y: next.y };
	let u = (t - prev.tPosition) / span;
	if (u < 0) u = 0;
	else if (u > 1) u = 1;
	const e = applyEase(next.tween, u);
	return {
		x: prev.x + (next.x - prev.x) * e,
		y: prev.y + (next.y - prev.y) * e
	};
}

// Parse a move_entity payload into a keyframe, or null if malformed (lazy-GC
// posture: a bad payload is silently skipped at render, matching the cross-user
// ref policy elsewhere in this file).
function parseMoveKeyframe(e: ProjectionEvent): { placementId: string; kf: Keyframe } | null {
	const p = e.payloadJsonb as Partial<MoveEntityPayload> | null;
	if (!p || typeof p !== 'object') return null;
	if (typeof p.placement_id !== 'string') return null;
	const pos = p.position as { x?: unknown; y?: unknown } | undefined;
	if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
	if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
	const tween: EaseKind = p.tween === 'ease_in_out' ? 'ease_in_out' : 'linear';
	return {
		placementId: p.placement_id,
		kf: { tPosition: e.tPosition, x: pos.x, y: pos.y, tween, createdAt: e.createdAt, id: e.id }
	};
}

/**
 * Slice 4 PR-F (D5, D-PRF-1/10) — fold move_entity events into per-placement
 * position overrides at time `t`.
 *
 * Window: movement is NEVER baked into anchor state (D-PRF-1), so the anchor
 * snapshot holds no movement. The fold therefore considers the FULL keyframe
 * history per placement (prev = last keyframe ≤ t, next = first keyframe > t),
 * NOT the (anchorT, t] window state events use. This is the correct
 * generalization of "include keyframes at the anchor's T" (D-PRF-10b): movement
 * simply ignores the anchor boundary because the anchor summarizes none of it.
 *
 * Same-T (D-PRF-10a): keyframes for one placement at the same t_position
 * collapse last-write-wins by (created_at, id) — so prev/next never share a
 * t_position and `interpolatePosition` can't hit a zero-length span.
 *
 * Only placements active at `t` (window-aware, mirrors placementsAtPlayhead)
 * with ≥1 keyframe get an override.
 */
function foldMovement(
	t: number,
	events: ProjectionEvent[],
	placements: ProjectionPlacement[]
): Map<string, ArtifactPosition> {
	const overrides = new Map<string, ArtifactPosition>();
	if (placements.length === 0) return overrides;

	// Group keyframes by placement_id.
	const byPlacement = new Map<string, Keyframe[]>();
	for (const e of events) {
		if (e.kind !== 'move_entity') continue;
		const parsed = parseMoveKeyframe(e);
		if (!parsed) continue;
		const list = byPlacement.get(parsed.placementId);
		if (list) list.push(parsed.kf);
		else byPlacement.set(parsed.placementId, [parsed.kf]);
	}
	if (byPlacement.size === 0) return overrides;

	for (const pl of placements) {
		// Window-aware (D-PRF-9 mirror): both-null = always active; else half-open.
		if (pl.startPosition !== null && pl.endPosition !== null) {
			if (t < pl.startPosition || t >= pl.endPosition) continue;
		}
		const raw = byPlacement.get(pl.id);
		if (!raw || raw.length === 0) continue;

		// Sort by (tPosition, createdAt, id), then collapse same-T runs
		// last-write-wins so adjacent keyframes never share a tPosition.
		const sorted = [...raw].sort((a, b) => {
			if (a.tPosition !== b.tPosition) return a.tPosition - b.tPosition;
			return compareCreatedAt(a, b);
		});
		const kfs: Keyframe[] = [];
		for (const kf of sorted) {
			const last = kfs[kfs.length - 1];
			if (last && last.tPosition === kf.tPosition) kfs[kfs.length - 1] = kf;
			else kfs.push(kf);
		}

		// prev = last keyframe ≤ t; next = first keyframe > t.
		let prev: Keyframe | null = null;
		let next: Keyframe | null = null;
		for (const kf of kfs) {
			if (kf.tPosition <= t) prev = kf;
			else {
				next = kf;
				break;
			}
		}

		if (!prev) {
			// Before the first keyframe → baseline (static placement position).
			overrides.set(pl.id, { x: pl.x, y: pl.y });
		} else if (!next) {
			// At/after the last keyframe → clamp to it (no extrapolation).
			overrides.set(pl.id, { x: prev.x, y: prev.y });
		} else {
			overrides.set(pl.id, interpolatePosition(prev, next, t));
		}
	}
	return overrides;
}

/**
 * Pure projection. Given the inputs, return the RenderedState at time `t`.
 *
 * Inputs are not required to be sorted; projectState sorts internally so
 * callers can pass raw DB result rows. `placements` (Slice 4 PR-F) feeds the
 * movement fold; callers with no placements pass [] (or omit) and get an empty
 * `artifactOverrides` map — behavior unchanged from pre-PR-F.
 */
export function projectState(
	t: number,
	anchors: ProjectionAnchor[],
	events: ProjectionEvent[],
	ctx: ProjectionContext,
	placements: ProjectionPlacement[] = []
): RenderedState {
	const anchor = pickActiveAnchor(t, anchors);

	const regions = new Map<string, AnchorRegion>();
	const artifacts: AnchorArtifact[] = [];
	// Slice 3: cells keyed by "x,y" for last-write-wins folding.
	const cells = new Map<string, AnchorCell>();

	if (anchor) {
		for (const r of anchor.stateJsonb.regions ?? []) {
			regions.set(r.region_id, r);
		}
		for (const a of anchor.stateJsonb.artifacts ?? []) {
			artifacts.push(a);
		}
		// `anchor.stateJsonb.chains` is intentionally NOT folded — see the
		// RenderedState type note (Slice 5 PR-A). The key is kept as inert input
		// residue; EventChain derives from `caused_by`, not anchor chains.
		for (const cell of anchor.stateJsonb.cells ?? []) {
			if (
				cell &&
				Number.isInteger(cell.x) &&
				Number.isInteger(cell.y) &&
				(BIOMES as readonly string[]).includes(cell.biome)
			) {
				cells.set(`${cell.x},${cell.y}`, cell);
			}
		}
	}

	// Events strictly after the anchor's t_position, up to and including t.
	// Same-T rule (CMT-5): anchor.tPosition itself is excluded.
	const anchorT = anchor?.tPosition ?? Number.NEGATIVE_INFINITY;
	const applicable = events
		.filter((e) => e.tPosition > anchorT && e.tPosition <= t)
		.sort((a, b) => {
			if (a.tPosition !== b.tPosition) return a.tPosition - b.tPosition;
			return compareCreatedAt(a, b);
		});

	for (const e of applicable) {
		if (e.kind === 'transfer_region') {
			applyTransferRegion(regions, e.payloadJsonb);
		} else if (e.kind === 'paint_cells') {
			applyPaintCells(cells, e.payloadJsonb);
		}
		// move_entity is NOT folded here — it uses a separate window (full
		// keyframe history, not (anchorT, t]) because movement is never baked
		// into anchors (D-PRF-1). See foldMovement below. Other unknown kinds
		// (link_chain, spawn_artifact, despawn_artifact — Slice 5) flow through
		// unchanged; the fold stays forward-compatible.
	}

	// Slice 4 PR-F (D5) — per-placement movement overrides. Uses the full event
	// list (not `applicable`) on purpose: keyframes below the active anchor's T
	// still matter since movement isn't in the anchor snapshot.
	const artifactOverrides = foldMovement(t, events, placements);

	const renderedRegions: RenderedRegion[] = [];
	for (const r of regions.values()) {
		const resolved = resolveRegionColor(r, ctx);
		if (resolved) renderedRegions.push(resolved);
	}

	// Sparse output: 'unset' cells are stored but treated as transparent
	// at render time. Whether to emit them is a renderer concern, not a
	// projection one. projectState emits everything that was stored so the
	// renderer can choose: skip 'unset' for sparser draw calls, or render
	// it as a marker for "explicitly erased here." Same shape either way.
	const renderedCells: RenderedCell[] = Array.from(cells.values());

	return {
		tPosition: t,
		regions: renderedRegions,
		artifacts,
		cells: renderedCells,
		artifactOverrides
	};
}
