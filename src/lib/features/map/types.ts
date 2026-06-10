// Slice 3 grid type — mirrors schema.ts GridType const array. Inlined
// here (not imported) because schema.ts instantiates pgTable at module
// load; pulling it into client bundles is forbidden by CLAUDE.md.
export type GridType = 'square' | 'hex';

import type { MapArtLayer } from './projection.js';

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
	// Slice 3 T1' grid columns (drizzle/0018). Defaults: 'square', 32, 24,
	// 'm', 5.0, true for new rows; false for pre-Slice-3 rows.
	gridType: GridType;
	gridCellsX: number;
	gridCellsY: number;
	gridScaleUnit: string;
	gridScaleValue: number;
	gridVisible: boolean;
	// WM3 Slice B — ordered art-layer defs (drizzle/0027). Array order is
	// render order; background bitmap is the implicit bottom layer.
	artLayersJsonb: MapArtLayer[];
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

// Causal-cartography provenance result (Slice 5 PR-E). Defined here — a
// declaration-only module — so client components (PixiRegionLayer) never
// type-import from the runtime server module world-map-v3-provenance.ts,
// which re-exports these for its own callers.
//
// One node in the traced lineage. `viaRelationshipId` / `startPosition`
// describe the caused_by edge that led INTO this node from its child in the
// chain; both are null for the source node (the change's recorded cause —
// nothing led to it within the chain).
export type CauseStep = {
	eventId: string;
	name: string;
	viaRelationshipId: string | null;
	startPosition: number | null;
};

export type ProvenanceResult =
	// No transfer_region change for this region at/before T — nothing to trace.
	| { status: 'no-change' }
	// The change exists but carries no recorded cause (source_event_id null, or
	// its Event was deleted — the FK is ON DELETE SET NULL).
	| { status: 'no-cause' }
	// A recorded cause was found. `chain` is ordered source → … → earliest;
	// `earliest` is the root of the causal lineage; `jumpPosition` is the
	// startPosition of the caused_by edge entering the earliest cause (null when
	// the source itself is the root, or that edge is timeless — a no-op jump, D5).
	| {
			status: 'found';
			chain: CauseStep[];
			earliest: CauseStep;
			jumpPosition: number | null;
	  };
