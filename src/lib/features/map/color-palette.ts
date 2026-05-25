// Shared color palette for map-related UI (regions, factions). Promoted
// out of RegionFormModal so MapSidebar's faction-create modal renders the
// same swatches, keeping visual vocabulary consistent across "ownership"
// (faction) and "geography" (region) authoring surfaces.
//
// Order matters — UI renders swatches left-to-right in this sequence,
// and tests pin the first entry as the default for new entities.

export const MAP_PALETTE = [
	'#e8a838',
	'#3b82f6',
	'#ef4444',
	'#22c55e',
	'#a855f7',
	'#ec4899',
	'#f97316',
	'#06b6d4'
] as const;

export const DEFAULT_REGION_COLOR = MAP_PALETTE[0];
export const DEFAULT_FACTION_COLOR = MAP_PALETTE[1];
