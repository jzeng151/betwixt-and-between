// Slice 1b A3 — region write-through to map_anchors.state_jsonb.regions[].
//
// Iron-rule parity: under ?renderer=leaflet, regions are read directly from
// the map_regions table. Under ?renderer=pixi, they come from projectState
// which reads the active anchor's state_jsonb.regions[]. For the two
// renderers to show the same geometry baseline, every map_regions write
// (INSERT/UPDATE/DELETE) must also fan out to every anchor on the map.
//
// Eng-review A3 decision: write to ALL anchors on the map (not just "latest"
// per the original test-plan wording). Geometry is atemporal — a region
// either exists or it doesn't, regardless of which T's snapshot you load.
//
// transfer_region overrides (faction_id !== null in an anchor entry) are
// preserved on UPDATE: only the baseline color/geometry fields rewrite.
// On DELETE the entire entry is removed (region no longer exists, so its
// faction ownership history is moot).
//
// Read-modify-write pattern: SELECT all anchors, mutate state_jsonb in JS,
// UPDATE each. N+1 round-trips per write per anchor — acceptable at demo
// scale (≤5 anchors per map). Flagged in eng-review § Performance for a
// future jsonb_set batch query when anchor counts climb.

import { and, eq } from 'drizzle-orm';
import { mapAnchors, worldMaps } from './db/schema.js';
import type { AnchorRegion, AnchorState } from '$lib/features/map/projection.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

async function loadAnchors(tx: Tx, mapId: string, userId: string) {
	// Cross-user scoping (CLAUDE.md): map_anchors has no user_id column.
	// JOIN through worldMaps.userId so a future stray call from an
	// unscoped handler can't touch another user's anchors.
	return tx
		.select({ id: mapAnchors.id, stateJsonb: mapAnchors.stateJsonb })
		.from(mapAnchors)
		.innerJoin(worldMaps, eq(mapAnchors.worldMapId, worldMaps.id))
		.where(and(eq(mapAnchors.worldMapId, mapId), eq(worldMaps.userId, userId)));
}

export async function fanOutRegionAdd(
	tx: Tx,
	mapId: string,
	userId: string,
	region: { id: string; color: string | null }
): Promise<void> {
	const anchors: Array<{ id: string; stateJsonb: AnchorState }> = await loadAnchors(
		tx,
		mapId,
		userId
	);
	const newEntry: AnchorRegion = {
		region_id: region.id,
		faction_id: null,
		color: region.color
	};
	for (const a of anchors) {
		const state: AnchorState = a.stateJsonb ?? {};
		// Defensive: if (somehow) this region_id is already present, replace
		// rather than duplicate. POST shouldn't hit this branch since IDs
		// are newly minted, but make the helper idempotent for retry safety.
		const existing = state.regions?.find((r) => r.region_id === region.id);
		const next = existing
			? (state.regions ?? []).map((r) => (r.region_id === region.id ? newEntry : r))
			: [...(state.regions ?? []), newEntry];
		await tx
			.update(mapAnchors)
			.set({ stateJsonb: { ...state, regions: next } })
			.where(eq(mapAnchors.id, a.id));
	}
}

export async function fanOutRegionColorUpdate(
	tx: Tx,
	mapId: string,
	userId: string,
	regionId: string,
	color: string | null
): Promise<void> {
	const anchors: Array<{ id: string; stateJsonb: AnchorState }> = await loadAnchors(
		tx,
		mapId,
		userId
	);
	for (const a of anchors) {
		const state: AnchorState = a.stateJsonb ?? {};
		if (!state.regions || state.regions.length === 0) continue;
		let touched = false;
		const next = state.regions.map((r) => {
			if (r.region_id !== regionId) return r;
			touched = true;
			// Preserve faction_id (faction ownership is a separate concern
			// layered by transfer_region events). Only the baseline color
			// updates here.
			return { ...r, color };
		});
		if (!touched) continue;
		await tx
			.update(mapAnchors)
			.set({ stateJsonb: { ...state, regions: next } })
			.where(eq(mapAnchors.id, a.id));
	}
}

export async function fanOutRegionDelete(
	tx: Tx,
	mapId: string,
	userId: string,
	regionId: string
): Promise<void> {
	const anchors: Array<{ id: string; stateJsonb: AnchorState }> = await loadAnchors(
		tx,
		mapId,
		userId
	);
	for (const a of anchors) {
		const state: AnchorState = a.stateJsonb ?? {};
		if (!state.regions || state.regions.length === 0) continue;
		const next = state.regions.filter((r) => r.region_id !== regionId);
		if (next.length === state.regions.length) continue; // no change
		await tx
			.update(mapAnchors)
			.set({ stateJsonb: { ...state, regions: next } })
			.where(eq(mapAnchors.id, a.id));
	}
}

