// Slice 3 D6 — layer-key constants for the WM3 Pixi stack.
//
// Per-user-per-map visibility is stored in world_map_layer_prefs
// keyed on these strings. Anything outside this enum is silently
// ignored by the reader (lazy GC) so renaming or removing a layer
// doesn't leave hard errors in users' DB rows.
//
// Order matches the D6 stack from background → chrome. The Pixi
// renderer doesn't actually consume the order; the array is the
// canonical iteration target for the Layers UI in MapSidebar.

export const LAYER_KEYS = [
	'background',
	'grid',
	'terrain',
	'regions',
	'placements'
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

// User-facing labels for the MapSidebar Layers pane. Capitalized,
// matches each layer's role on the canvas.
export const LAYER_LABELS: Record<LayerKey, string> = {
	background: 'Background image',
	grid: 'Grid',
	terrain: 'Terrain',
	regions: 'Regions',
	placements: 'Placements'
};
