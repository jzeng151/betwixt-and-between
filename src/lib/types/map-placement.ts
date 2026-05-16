/**
 * Client-side type for `map_placements` rows. Mirrors the schema; serialized
 * via JSON over the /api/map-placements endpoints.
 */
export interface MapPlacement {
	id: string;
	userId: string | null;
	placeableId: string;
	locationId: string | null;
	mapId: string | null;
	x: number;
	y: number;
	startActId: string | null;
	startSceneId: string | null;
	endActId: string | null;
	endSceneId: string | null;
	startPosition: number | null;
	endPosition: number | null;
	data: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CreatePlacementPayload {
	placeableId: string;
	locationId?: string | null;
	mapId?: string | null;
	x: number;
	y: number;
	startActId?: string | null;
	startSceneId?: string | null;
	endActId?: string | null;
	endSceneId?: string | null;
	data?: Record<string, unknown>;
}

export interface UpdatePlacementPayload {
	placeableId?: string;
	locationId?: string | null;
	mapId?: string | null;
	x?: number;
	y?: number;
	startActId?: string | null;
	startSceneId?: string | null;
	endActId?: string | null;
	endSceneId?: string | null;
	data?: Record<string, unknown>;
}

/**
 * Pure resolver: given a set of placements and a playhead position, return
 * those active at that position. A placement with all-null bounds is always
 * active (default-window). Otherwise both bounds are set and the window is
 * half-open [start, end). Open-ended (one-sided) bounds are NOT supported
 * in v2 — enforced by the API layer (POST/PATCH both reject), the DB CHECK
 * (`map_placements_position_order`), and the schema.ts mirror.
 *
 * Mirrors resolveActiveVariant's filter shape so client M3 projection code
 * has a single mental model for "what does the playhead currently cover."
 */
export function placementsAtPlayhead(placements: MapPlacement[], playhead: number): MapPlacement[] {
	return placements.filter((p) => {
		// Strict invariant (DB CHECK + API): bounds are both-null or both-set.
		if (p.startPosition === null || p.endPosition === null) return true;
		return playhead >= p.startPosition && playhead < p.endPosition;
	});
}
