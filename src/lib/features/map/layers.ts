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
	'art',
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
	art: 'Freeform art (base)',
	regions: 'Regions',
	placements: 'Placements'
};

// WM3 Slice B — per-art-layer visibility rides world_map_layer_prefs with a
// namespaced free-text key (the reader lazy-GCs unknown keys by design, so no
// schema change). Strokes on a deleted layer fall back to the BASE art layer,
// whose own toggle is the static 'art' key above.
export function artLayerPrefKey(layerId: string): string {
	return `art:${layerId}`;
}
