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
//
// Slice 5 PR-C (ADR 0006): the EventChain map render derives from the
// `caused_by` relationship. This module's ONLY import is the pair of pure
// temporal-visibility predicates from playhead-store — reused unchanged (plan
// D3) rather than re-implemented here, so the map and both graphs share one
// visibility rule. The predicates are pure; the store singleton they sit beside
// is a harmless, isomorphic no-op when this module loads server-side.

import { isEdgeVisibleAtT, isMysteryEdgeAtT } from '$lib/features/timeline/playhead-store.js';
import { STAMP_ASSET_KEYS, TERRAIN_ASSET_KEYS } from './terrain-keys.generated.js';

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
	// Open terrain-key vocabulary (Slice 6 D15): legacy BIOMES, manifest
	// categories ('Grass'), water colors ('water_snow'), or 'unset'.
	biome: string;
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
	// WM3 Slice A: freeform brush strokes baked into the anchor. Append-only
	// (painter's order). Optional so historical anchors (pre-Slice-A) read as
	// "no strokes"; new anchors include it (invariant test enforces). Strokes
	// MUST live here — projectState excludes events with t_position <= anchorT,
	// so a stroke painted below an anchor's T is lost unless the anchor carries
	// it (the "scrub playhead, base art persists" criterion; eng-review §1).
	strokes?: StoredStroke[];
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
// boundary). Adding a new BAKED state kind means updating:
//   1. this array
//   2. src/lib/server/world-map-v3.ts validateEventPayload's switch
//   3. foldEventsIntoState's switch (ONE place — shared by the read path
//      projectState and the server-side anchor snapshot in world-map-v3.ts)
// (move_entity is not a baked kind — it folds via foldMovement, not here.)

export const EVENT_KINDS = ['transfer_region', 'paint_cells', 'paint_stroke', 'move_entity'] as const;
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
	cells: Array<{ x: number; y: number; biome: string }>; // open vocab (Slice 6 D15)
	// Optional. Last chunk of a multi-event stroke sets this true so the
	// auto-anchor logic doesn't fire mid-stroke. Single-event strokes
	// either set it true or omit it (defaults to true server-side).
	command_complete?: boolean;
};

// WM3 Slice A — freeform brush. `paint_stroke` generalizes `paint_cells`: a
// grid cell is a quantized stroke. Each event is ONE brush gesture; unlike
// `paint_cells` (last-write-wins on a grid key) strokes are append-only marks
// (painter's order — later strokes draw on top). Vector representation (OQ1):
// `path[]` is normalized fractional [0,1] map coords, same convention as
// placements. Two render modes (spike findings): `fill` masks a tiling terrain
// tile to the stroke shape, `stamp` scatters an Objects/ sprite along the path.
// `textureKey` resolves against TERRAIN_ASSET_KEYS (fill) or STAMP_ASSET_KEYS
// (stamp). Baked into AnchorState.strokes so it survives anchor writes.
export const STROKE_MAX_POINTS = 4096; // path[] cap — DoS/storage bound (parity w/ PAINT_CELLS_MAX_PER_EVENT)
export type StrokePoint = { x: number; y: number };
export type StrokeMode = 'fill' | 'stamp';
export type StrokeStampParams = { spacing: number; jitter: number };

// The stored/painted shape (also the persisted AnchorState.strokes element).
// The event payload IS this shape — strokes carry no merge key (append-only),
// so there is no event-only field to strip (contrast paint_cells/command_complete).
export type PaintStrokePayload = {
	path: StrokePoint[];
	brushSize: number; // normalized (0,1] — fraction of map extent
	softness: number; // [0,1] feathered-edge alpha falloff
	mode: StrokeMode;
	textureKey: string;
	stamp?: StrokeStampParams; // meaningful only when mode === 'stamp'
};
export type StoredStroke = PaintStrokePayload;

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

// Slice 6 D15 — terrain is an asset-folder-driven vocabulary (manifest
// categories like 'Grass', their specific tile keys like 'grass_01_tile_256_05',
// and water colors like 'water_snow'), plus the legacy BIOMES enum and 'unset'.
// A biome is valid iff it's a KNOWN, renderable key — not just any well-formed
// string (/review #3): accepting unrenderable junk would store invisible cells
// that still block grid resize and mis-route arbitrary 'water_*' keys to water.
// TERRAIN_ASSET_KEYS is generated from the pack manifest. This ONE predicate
// guards every biome gate (projection fold + server paint_cells/anchor writes)
// so they can never disagree on what's storable.
const KNOWN_TERRAIN_KEYS: ReadonlySet<string> = new Set([
	...TERRAIN_ASSET_KEYS,
	...BIOMES // legacy enum + 'unset' (BIOMES includes 'unset')
]);
export function isKnownTerrainKey(s: unknown): s is string {
	return typeof s === 'string' && KNOWN_TERRAIN_KEYS.has(s);
}

// Stamp-mode (paint_stroke) textureKeys reference Objects/ sprites, a separate
// generated set from terrain tiles. Same gate role as isKnownTerrainKey: the
// server validator + the fold reject unknown stamp keys so a junk key can't be
// stored as an unrenderable stroke.
const KNOWN_STAMP_KEYS: ReadonlySet<string> = new Set(STAMP_ASSET_KEYS);
export function isKnownStampKey(s: unknown): s is string {
	return typeof s === 'string' && KNOWN_STAMP_KEYS.has(s);
}

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
	biome: string; // open terrain-key vocabulary (Slice 6 D15)
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
	// WM3 Slice A — freeform brush strokes to render, in painter's order
	// (anchor-baked strokes first, then post-anchor stroke events). The render
	// layer (PixiArtLayer) rasterizes these into a RenderTexture over the
	// background. Empty when the map has no freeform art.
	strokes: StoredStroke[];
	// Slice 4 PR-F (D5, D-PRF-3/4) — per-placement position OVERRIDES from the
	// movement engine, keyed by placement_id. Present only for placements that
	// are active at T AND carry ≥1 move_entity keyframe. The render layer
	// (PixiPlacementLayer) keeps owning identity/style/window/interaction and
	// reads the placement's static (x,y) for everyone NOT in this map; for
	// placements that ARE here it draws at the interpolated position instead.
	// Movers-only: a static placement is absent from this map (no double-draw,
	// nothing to dedup). Empty map when no placements move.
	artifactOverrides: Map<string, ArtifactPosition>;
	// Slice 5 PR-C (D2/D5, ADR 0006) — causal edges (`caused_by` relationships)
	// drawn on the map at T. Each is one Bezier from the effect endpoint's region
	// centroid to the cause endpoint's. Present only for edges whose BOTH
	// endpoints resolve to an allowed region on THIS map, that are visible at T
	// (isEdgeVisibleAtT) and not still-hidden (mystery), and that are not
	// degenerate self-edges (both endpoints in one region — S1 gate). Empty when
	// no caused_by edges co-locate on the map (the common case — "causality is
	// local"; see plan Spike S1 gate decision).
	causalEdges: RenderedCausalEdge[];
};

// Slice 5 PR-C — render output for one on-map causal edge. `fromPos` is the
// effect endpoint's centroid (arrow tail), `toPos` the cause endpoint's (arrow
// head), matching the graph's `caused_by` arrow convention (effect ← cause,
// arrowhead at the `to`/cause end — edge-policy.ts:15, GraphCanvas arrow at
// `to`). `causeEndpointId` is the cause Event id (= the relationship's toId).
export type RenderedCausalEdge = {
	relationshipId: string;
	fromPos: ArtifactPosition;
	toPos: ArtifactPosition;
	causeEndpointId: string;
};

// Slice 5 PR-C — minimal `caused_by` relationship shape the causal fold needs.
// `Relationship` (src/lib/stores/relationships.ts) is structurally assignable,
// so WorldMap passes its caused_by rows directly. fromId = effect, toId = cause
// (edge-policy.ts:15). The position/reveal fields feed isEdgeVisibleAtT +
// isMysteryEdgeAtT unchanged (plan D3).
export type ProjectionCausalEdge = {
	id: string;
	fromId: string;
	toId: string;
	startPosition: number | null;
	endPosition: number | null;
	revealedAtPosition: number | null;
};

// Slice 5 PR-C — one `takes_place_at` edge for an Event, with its temporal
// bounds. FU1/#66: an Event's location can be temporally scoped (the relationship
// editor allows bounds on any type), so the active Location is resolved AT the
// playhead, not picked timelessly. `Relationship` is structurally assignable.
export type ProjectionTakesPlaceAt = {
	locationId: string; // the `to` endpoint (Event AT Location — edge-policy.ts:14)
	startPosition: number | null;
	endPosition: number | null;
	// Mystery reveal gate (isMysteryEdgeAtT): a takes_place_at hidden until
	// revealedAtPosition must not resolve a Location before its reveal, or a causal
	// edge would spatially leak the hidden endpoint. Optional so callers/fixtures
	// that predate the gate still type-check; absent/null = no gate. (Codex PR #72)
	revealedAtPosition?: number | null;
};

// Slice 5 PR-C — pre-resolved causal-render input, supplied by the (client)
// caller that holds the relationships + region geometry. `edges` are the
// caused_by rows; `takesPlaceAt` maps an Event id → its `takes_place_at` edges
// (with bounds), from which foldCausalEdges resolves the Location ACTIVE at T;
// `centroidByLocation` maps a Location id → its on-map region centroid.
//
// `centroidByLocation` is sourced by the caller from the SAME live region
// geometry the map renders (the mapRegions store), NOT from anchor state_jsonb —
// region create/edit updates mapRegions optimistically but does not reload the
// anchor, so anchor-sourced centroids would be stale/missing for a just-edited
// region. The caller is responsible for user + scope filtering (mapRegions loads
// from a user-scoped endpoint and the caller passes its scoped view), so
// projection trusts this set as "owned, on-map regions." An endpoint whose
// T-active Location is absent from it (off-map, cross-user, a Scene endpoint, or
// no takes_place_at active at T) drops the edge (lazy-GC). Server callers default.
export type CausalProjectionInput = {
	edges: ProjectionCausalEdge[];
	takesPlaceAt: ReadonlyMap<string, ProjectionTakesPlaceAt[]>;
	centroidByLocation: ReadonlyMap<string, ArtifactPosition>;
};

const EMPTY_CAUSAL: CausalProjectionInput = {
	edges: [],
	takesPlaceAt: new Map(),
	centroidByLocation: new Map()
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
			!isKnownTerrainKey(biome)
		) {
			// Lazy GC: malformed entries silently dropped at render
			// (matches the cross-user ref policy in resolveRegionColor).
			continue;
		}
		// Last-write-wins on (x, y). Caller has already sorted events
		// by (t_position, created_at, id); the final write at each cell
		// is the projected biome.
		cells.set(`${x},${y}`, { x, y, biome });
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

// WM3 Slice A — append one freeform stroke from a paint_stroke payload.
// Defensive lazy-GC (same posture as applyPaintCells): a malformed stroke is
// dropped rather than throwing — the server validator is the real write gate;
// this guards the fold against legacy/forged rows. Shares the isKnown*Key
// predicates + STROKE_MAX_POINTS with the server validator so the two cannot
// disagree on what is storable. A bad point drops the WHOLE stroke (a corrupt
// path has no safe partial render), unlike a single bad cell. Exported so the
// server-side anchor-snapshot builder seeds baked strokes through the SAME gate
// the read path uses (snapshot stays byte-equal to projectState).
export function applyPaintStroke(strokes: StoredStroke[], payload: unknown): void {
	if (!payload || typeof payload !== 'object') return;
	const p = payload as Partial<PaintStrokePayload>;
	if (p.mode !== 'fill' && p.mode !== 'stamp') return;
	if (typeof p.textureKey !== 'string') return;
	const keyOk = p.mode === 'stamp' ? isKnownStampKey(p.textureKey) : isKnownTerrainKey(p.textureKey);
	if (!keyOk) return;
	if (typeof p.brushSize !== 'number' || !Number.isFinite(p.brushSize) || p.brushSize <= 0 || p.brushSize > 1)
		return;
	if (typeof p.softness !== 'number' || !Number.isFinite(p.softness) || p.softness < 0 || p.softness > 1)
		return;
	if (!Array.isArray(p.path) || p.path.length === 0 || p.path.length > STROKE_MAX_POINTS) return;
	const path: StrokePoint[] = [];
	for (const pt of p.path) {
		if (!pt || typeof pt !== 'object') return;
		const x = (pt as StrokePoint).x;
		const y = (pt as StrokePoint).y;
		if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y))
			return;
		path.push({ x, y });
	}
	let stamp: StrokeStampParams | undefined;
	if (p.mode === 'stamp' && p.stamp && typeof p.stamp === 'object') {
		const { spacing, jitter } = p.stamp as StrokeStampParams;
		if (
			typeof spacing === 'number' &&
			Number.isFinite(spacing) &&
			spacing > 0 &&
			typeof jitter === 'number' &&
			Number.isFinite(jitter) &&
			jitter >= 0
		) {
			stamp = { spacing, jitter };
		}
	}
	strokes.push({
		path,
		brushSize: p.brushSize,
		softness: p.softness,
		mode: p.mode,
		textureKey: p.textureKey,
		...(stamp ? { stamp } : {})
	});
}

// Combined fold order: (t_position, created_at, id). Same rule on both fold
// sites (read path + server snapshot) so last-write-wins is identical.
function compareFoldOrder(a: ProjectionEvent, b: ProjectionEvent): number {
	if (a.tPosition !== b.tPosition) return a.tPosition - b.tPosition;
	return compareCreatedAt(a, b);
}

/**
 * Shared baked-state fold — the SINGLE source of truth for how state event
 * kinds (transfer_region, paint_cells, …) mutate {regions, cells}. Used by
 * BOTH `projectState` (read path) and the server-side auto-anchor snapshot
 * builder in `world-map-v3.ts` (`maybeWriteAutoAnchor`). One implementation
 * means a new baked kind can never be folded in one path and silently
 * forgotten in the other — the exact drift that buried strokes when the two
 * loops were hand-maintained copies.
 *
 * Mutates `regions` and `cells` in place and APPENDS to `strokes` (painter's
 * order — strokes are append-only marks, not last-write-wins like cells).
 * Sorts `events` by (t_position, created_at, id) internally; callers pass their
 * own window-filtered slice (read path: the (anchorT, t] window; server: the
 * post-cutoff fold window) and their own seeded accumulators. `move_entity` is
 * intentionally NOT folded here — movement uses a separate full-keyframe window
 * and never enters anchor state_jsonb (see `foldMovement` / D-PRF-1). New baked
 * kinds extend the switch below with exactly one `case`.
 */
export function foldEventsIntoState(
	regions: Map<string, AnchorRegion>,
	cells: Map<string, AnchorCell>,
	strokes: StoredStroke[],
	events: readonly ProjectionEvent[]
): void {
	const sorted = [...events].sort(compareFoldOrder);
	for (const e of sorted) {
		if (e.kind === 'transfer_region') {
			applyTransferRegion(regions, e.payloadJsonb);
		} else if (e.kind === 'paint_cells') {
			applyPaintCells(cells, e.payloadJsonb);
		} else if (e.kind === 'paint_stroke') {
			applyPaintStroke(strokes, e.payloadJsonb);
		}
		// Other kinds (move_entity → foldMovement; unknown future kinds) pass
		// through. A new baked state kind adds one `case` HERE and nowhere else.
	}
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
 * Slice 5 PR-C — area-weighted centroid of a closed polygon (the standard
 * shoelace centroid), used as the on-map anchor point for a region. Falls back
 * to the vertex average for a degenerate (zero-area / collinear) polygon so a
 * thin or self-intersecting region still yields a finite point. Returns null
 * only for fewer than 3 vertices (not a polygon). `polygon` is [[x,y], …] in
 * the same normalized fractional coords as region geometry elsewhere. Exported
 * so the caller can build `CausalProjectionInput.centroidByLocation` from the
 * live region geometry (mapRegions) it already renders from.
 */
export function polygonCentroid(polygon: number[][]): ArtifactPosition | null {
	if (!Array.isArray(polygon) || polygon.length < 3) return null;
	let twiceArea = 0;
	let cx = 0;
	let cy = 0;
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < polygon.length; i++) {
		const p = polygon[i];
		const q = polygon[(i + 1) % polygon.length];
		if (
			!Array.isArray(p) ||
			!Array.isArray(q) ||
			typeof p[0] !== 'number' ||
			typeof p[1] !== 'number' ||
			typeof q[0] !== 'number' ||
			typeof q[1] !== 'number'
		) {
			return null; // malformed vertex → not drawable
		}
		const cross = p[0] * q[1] - q[0] * p[1];
		twiceArea += cross;
		cx += (p[0] + q[0]) * cross;
		cy += (p[1] + q[1]) * cross;
		sx += p[0];
		sy += p[1];
	}
	if (twiceArea === 0) {
		// Degenerate (zero area) → vertex average.
		return { x: sx / polygon.length, y: sy / polygon.length };
	}
	return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

/**
 * Slice 5 PR-C (D2/D5, ADR 0006) — fold `caused_by` relationships into the
 * on-map causal edges visible at time `t`. Mirrors foldMovement's posture:
 * pure, lazy-GC (unresolved endpoints are silently dropped, never drawn to
 * nowhere). Geometry (`causal.centroidByLocation`) is precomputed by the caller
 * from the live region store; this fn does only the per-tick, t-dependent
 * visibility eval + lookup. The caller computes centroidByLocation in a $derived
 * (refreshes on region edit, not per playhead tick), which is where the T7
 * per-frame-cost concern is now handled.
 *
 * An edge is emitted iff ALL hold:
 *   - it is visible at T (isEdgeVisibleAtT — the same predicate both graphs use,
 *     covering timeless = always, span [start,end), and scene-equality windows);
 *   - it is NOT still hidden from the reader (isMysteryEdgeAtT) — drawing a
 *     not-yet-revealed causal link would leak hidden causality spatially. NOTE
 *     the map is STRICTER than the graph here by design: the graph SHOWS mystery
 *     edges (dimmed, non-clickable), but a drawn spatial arrow between regions is
 *     a stronger spoiler than a dimmed line, so the map HIDES a reveal-gated edge
 *     until the playhead reaches its revealedAtPosition. (Whole-map idle is
 *     handled by the CALLER, not here: a map carries a baseline anchor at
 *     t_position = -Infinity, so this fold would otherwise run at idle and render
 *     timeless edges; WorldMap passes empty `causal.edges` when the playhead is
 *     null so the idle map shows no causal edges — Codex review #66.)
 *     The temporal window half (isEdgeVisibleAtT) IS the same rule both graphs use;
 *   - BOTH endpoints resolve to a Location ACTIVE at T (via takesPlaceAt +
 *     isEdgeVisibleAtT — a scoped takes_place_at outside its window is skipped)
 *     whose region is in centroidByLocation (the caller's owned, on-map,
 *     scope-filtered region set — off-map / cross-user / no-active-location
 *     endpoints are simply absent);
 *   - the endpoints are in DIFFERENT regions — a same-region (self-loop) edge
 *     has no spatial arrow to draw and is dropped (Spike S1 gate decision).
 */
function foldCausalEdges(t: number, causal: CausalProjectionInput): RenderedCausalEdge[] {
	const { centroidByLocation, takesPlaceAt } = causal;
	if (causal.edges.length === 0 || centroidByLocation.size === 0) return [];

	// Resolve the Location an Event is AT during time T. An Event's takes_place_at
	// can be temporally scoped (FU1/#66), so only edges visible at T AND not still
	// reveal-gated (isMysteryEdgeAtT) count; among those, prefer a scoped (bounded)
	// one over a timeless default, then lowest locationId for determinism. null = no
	// active location → endpoint omitted. (mystery gate: Codex PR #72)
	function locationAtT(eventId: string): string | null {
		const edges = takesPlaceAt.get(eventId);
		if (!edges || edges.length === 0) return null;
		let best: ProjectionTakesPlaceAt | null = null;
		for (const tp of edges) {
			if (!isEdgeVisibleAtT(tp, t)) continue;
			if (isMysteryEdgeAtT(tp, t)) continue; // reveal-gated: hidden until revealedAtPosition
			if (best === null) {
				best = tp;
				continue;
			}
			const tpScoped = tp.startPosition != null || tp.endPosition != null;
			const bestScoped = best.startPosition != null || best.endPosition != null;
			if (tpScoped !== bestScoped) {
				if (tpScoped) best = tp; // scoped beats timeless (more specific)
			} else if (tp.locationId < best.locationId) {
				best = tp; // deterministic tie-break
			}
		}
		return best?.locationId ?? null;
	}

	const out: RenderedCausalEdge[] = [];
	for (const e of causal.edges) {
		if (isMysteryEdgeAtT(e, t)) continue;
		if (!isEdgeVisibleAtT(e, t)) continue;
		const fromLoc = locationAtT(e.fromId);
		const toLoc = locationAtT(e.toId);
		if (!fromLoc || !toLoc) continue; // Scene endpoint / no active location → omit
		if (fromLoc === toLoc) continue; // same place → degenerate self-edge → drop
		const fromPos = centroidByLocation.get(fromLoc);
		const toPos = centroidByLocation.get(toLoc);
		if (!fromPos || !toPos) continue; // off-map / cross-user endpoint → omit
		out.push({ relationshipId: e.id, fromPos, toPos, causeEndpointId: e.toId });
	}
	return out;
}

/**
 * Pure projection. Given the inputs, return the RenderedState at time `t`.
 *
 * Inputs are not required to be sorted; projectState sorts internally so
 * callers can pass raw DB result rows. `placements` (Slice 4 PR-F) feeds the
 * movement fold; callers with no placements pass [] (or omit) and get an empty
 * `artifactOverrides` map — behavior unchanged from pre-PR-F. `causal` (Slice 5
 * PR-C) feeds the caused_by causal-edge fold; callers with no caused_by edges
 * (every server-side caller) omit it and get an empty `causalEdges`.
 */
export function projectState(
	t: number,
	anchors: ProjectionAnchor[],
	events: ProjectionEvent[],
	ctx: ProjectionContext,
	placements: ProjectionPlacement[] = [],
	causal: CausalProjectionInput = EMPTY_CAUSAL
): RenderedState {
	const anchor = pickActiveAnchor(t, anchors);

	const regions = new Map<string, AnchorRegion>();
	const artifacts: AnchorArtifact[] = [];
	// Slice 3: cells keyed by "x,y" for last-write-wins folding.
	const cells = new Map<string, AnchorCell>();
	// WM3 Slice A: freeform strokes, append-only in painter's order. Anchor-baked
	// strokes seed the list (drawn first); post-anchor stroke events append on top.
	const strokes: StoredStroke[] = [];

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
				isKnownTerrainKey(cell.biome)
			) {
				cells.set(`${cell.x},${cell.y}`, cell);
			}
		}
		// Seed baked strokes through applyPaintStroke so the SAME validation
		// gates anchor residue and live events (a forged/legacy stroke in the
		// snapshot is dropped identically to a forged event).
		for (const s of anchor.stateJsonb.strokes ?? []) {
			applyPaintStroke(strokes, s);
		}
	}

	// Events strictly after the anchor's t_position, up to and including t.
	// Same-T rule (CMT-5): anchor.tPosition itself is excluded.
	const anchorT = anchor?.tPosition ?? Number.NEGATIVE_INFINITY;
	const applicable = events.filter((e) => e.tPosition > anchorT && e.tPosition <= t);

	// Shared fold (single source of truth across read + server-snapshot paths).
	// move_entity is NOT folded here — it uses a separate window (full keyframe
	// history, not (anchorT, t]) because movement is never baked into anchors
	// (D-PRF-1). See foldMovement below.
	foldEventsIntoState(regions, cells, strokes, applicable);

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

	// Slice 5 PR-C — derive on-map causal edges from caused_by. Geometry comes
	// from causal.centroidByLocation (caller-supplied, from the live region
	// store); the fold does the t-dependent visibility eval. Gated on an active
	// anchor so the map draws nothing before the first anchor (idle convention),
	// consistent with regions/placements.
	const causalEdges = anchor ? foldCausalEdges(t, causal) : [];

	return {
		tPosition: t,
		regions: renderedRegions,
		artifacts,
		cells: renderedCells,
		// Not anchor-gated (like cells, unlike regions/causalEdges): a strokes-only
		// map with no anchor still paints at the -∞ baseline.
		strokes,
		artifactOverrides,
		causalEdges
	};
}
