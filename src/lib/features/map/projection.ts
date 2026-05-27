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
// Slice 1 ships ONLY state events (transfer_region). Continuous (move_entity)
// and windowed (link_chain) events are Slice 2+. The signature carries every
// event through so Slice 2 can extend by adding cases, not by changing the
// shape.

export const NEUTRAL_REGION_COLOR = '#9ca3af';

// -- Anchor payload (state_jsonb) ---------------------------------------------
// Matches docs/plans/world-map-v3-design.md § "State_jsonb shape (anchor
// content, all slices)". Slice 1 only reads `regions`; `artifacts` and
// `chains` are passed through to RenderedState so Slice 4/5 can light them
// up without changing projectState's signature.

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
// boundary). Adding `move_entity`/`link_chain` in Slice 2 means updating:
//   1. this array
//   2. src/lib/server/world-map-v3.ts validateEventPayload's switch
//   3. projection.ts's applyTransferRegion fold (or its successor)

export const EVENT_KINDS = ['transfer_region', 'paint_cells'] as const;
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

export type RenderedState = {
	tPosition: number;
	regions: RenderedRegion[];
	artifacts: AnchorArtifact[];
	chains: AnchorChain[];
	cells: RenderedCell[];
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

/**
 * Pure projection. Given the inputs, return the RenderedState at time `t`.
 *
 * Inputs are not required to be sorted; projectState sorts internally so
 * callers can pass raw DB result rows.
 */
export function projectState(
	t: number,
	anchors: ProjectionAnchor[],
	events: ProjectionEvent[],
	ctx: ProjectionContext
): RenderedState {
	const anchor = pickActiveAnchor(t, anchors);

	const regions = new Map<string, AnchorRegion>();
	const artifacts: AnchorArtifact[] = [];
	const chains: AnchorChain[] = [];
	// Slice 3: cells keyed by "x,y" for last-write-wins folding.
	const cells = new Map<string, AnchorCell>();

	if (anchor) {
		for (const r of anchor.stateJsonb.regions ?? []) {
			regions.set(r.region_id, r);
		}
		for (const a of anchor.stateJsonb.artifacts ?? []) {
			artifacts.push(a);
		}
		for (const c of anchor.stateJsonb.chains ?? []) {
			chains.push(c);
		}
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
		// Unknown kinds (move_entity, link_chain, spawn_artifact,
		// despawn_artifact — Slice 2+/5) flow through unchanged. The fold
		// is forward-compatible: adding cases doesn't break existing ones.
	}

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
		chains,
		cells: renderedCells
	};
}
