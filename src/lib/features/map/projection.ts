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

export type AnchorState = {
	regions?: AnchorRegion[];
	artifacts?: AnchorArtifact[];
	chains?: AnchorChain[];
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

export const EVENT_KINDS = ['transfer_region'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type TransferRegionPayload = {
	region_id: string;
	new_faction_id: string;
};

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

export type RenderedState = {
	tPosition: number;
	regions: RenderedRegion[];
	artifacts: AnchorArtifact[];
	chains: AnchorChain[];
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
		// Slice 1: only transfer_region. Other kinds (move_entity, link_chain,
		// spawn_artifact, despawn_artifact) are Slice 2+; ignoring them here
		// is the correct forward-compatible behavior.
		if (e.kind === 'transfer_region') {
			applyTransferRegion(regions, e.payloadJsonb);
		}
	}

	const renderedRegions: RenderedRegion[] = [];
	for (const r of regions.values()) {
		const resolved = resolveRegionColor(r, ctx);
		if (resolved) renderedRegions.push(resolved);
	}

	return {
		tPosition: t,
		regions: renderedRegions,
		artifacts,
		chains
	};
}
