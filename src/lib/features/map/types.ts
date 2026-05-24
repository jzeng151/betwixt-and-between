export type WorldMap = {
	id: string;
	name: string;
	baseImageUrl: string | null;
	width: number | null;
	height: number | null;
	locationId: string | null;
	locationInactiveAt: string | null;
	// Variant temporal bounds (Step 3, 2026-05-14). All four NULL = default
	// variant for the linked Location. Both positions NULL on write means the
	// row resolves only when no other variant covers the playhead.
	startActId: string | null;
	startSceneId: string | null;
	endActId: string | null;
	endSceneId: string | null;
	startPosition: number | null;
	endPosition: number | null;
	createdAt: string;
	updatedAt: string;
};

export type MapRegion = {
	id: string;
	mapId: string;
	locationId: string | null;
	polygon: number[][];
	color: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CreateRegionPayload = {
	locationId: string | null;
	polygon: number[][];
	color?: string;
};

export type UpdateRegionPayload = {
	locationId?: string | null;
	polygon?: number[][];
	color?: string | null;
};
