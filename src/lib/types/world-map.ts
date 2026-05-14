export type WorldMap = {
	id: string;
	name: string;
	baseImageUrl: string | null;
	width: number | null;
	height: number | null;
	locationId: string | null;
	locationInactiveAt: string | null;
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
