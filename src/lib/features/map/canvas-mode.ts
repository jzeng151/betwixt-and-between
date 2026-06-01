// Slice 4 T7 — the single source of truth for the world-map canvas's active
// interaction mode. Before this, the canvas arbitrated gestures through three
// independent booleans (pixiDrawingActive, brushActive, armedPlaceableId) plus
// ad-hoc cross-exclusion effects, which is where the prior P2 bugs lived
// (marker taps while brushing, paint strokes during polygon vertices). The
// mode is a priority cascade so exactly one mode is ever active.
//
// Priority (highest first): draw > brush > place-armed > move > idle. This
// mirrors the pointer-ownership precedence the per-flag guards encoded by hand:
//   - polygon draw owns the pointer outright (suppresses placement arming)
//   - brush owns the pointer next (the cross-exclusion effect unarms placement)
//   - an armed placeable consumes the next canvas tap
//   - move owns marker drag (PR-F movement authoring)
//   - otherwise the canvas is idle (pan/zoom + marker taps)
//
// PR-F (movement) adds the 'move' mode. With the unified tool selector (DS4)
// brush/place/move are mutually exclusive by construction (one activeTool at a
// time); the cascade order among them only matters if a polygon draw is somehow
// in flight while a tool is selected — draw owns the pointer and wins.

export type CanvasMode = 'idle' | 'draw' | 'brush' | 'place-armed' | 'move';

// DS4 — the user-facing tool the unified map toolbar (MapToolSelector) exposes.
// Exactly one is active at a time, which is what makes brush/place/move mutually
// exclusive by construction. Maps onto CanvasMode: select→idle, brush→brush,
// place→place-armed (once a placeable chip is armed), move→move. 'draw' (polygon)
// is not a toolbar tool — it's seeded from the region flow and owns the pointer
// outright when active.
export type MapTool = 'select' | 'brush' | 'place' | 'move';

export type CanvasModeInputs = {
	/** A polygon is being drawn (PixiPolygonDraw active). */
	drawing: boolean;
	/** Terrain brush is active (BrushPalette). */
	brushing: boolean;
	/** A placeable chip is armed for click-to-place (PlaceablePalette). */
	armed: boolean;
	/** Move tool is active — markers are draggable to author move_entity keyframes. */
	moving: boolean;
};

export function computeCanvasMode(s: CanvasModeInputs): CanvasMode {
	if (s.drawing) return 'draw';
	if (s.brushing) return 'brush';
	if (s.armed) return 'place-armed';
	if (s.moving) return 'move';
	return 'idle';
}
