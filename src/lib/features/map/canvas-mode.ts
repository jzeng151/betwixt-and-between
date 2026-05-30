// Slice 4 T7 — the single source of truth for the world-map canvas's active
// interaction mode. Before this, the canvas arbitrated gestures through three
// independent booleans (pixiDrawingActive, brushActive, armedPlaceableId) plus
// ad-hoc cross-exclusion effects, which is where the prior P2 bugs lived
// (marker taps while brushing, paint strokes during polygon vertices). The
// mode is a priority cascade so exactly one mode is ever active.
//
// Priority (highest first): draw > brush > place-armed > idle. This mirrors the
// pointer-ownership precedence the per-flag guards encoded by hand:
//   - polygon draw owns the pointer outright (suppresses placement arming)
//   - brush owns the pointer next (the cross-exclusion effect unarms placement)
//   - an armed placeable consumes the next canvas tap
//   - otherwise the canvas is idle (pan/zoom + marker taps)
//
// PR-F (movement) adds a 'move' input to this cascade; keep new modes ordered
// by which one should win when more than one is somehow set at once.

export type CanvasMode = 'idle' | 'draw' | 'brush' | 'place-armed';

export type CanvasModeInputs = {
	/** A polygon is being drawn (PixiPolygonDraw active). */
	drawing: boolean;
	/** Terrain brush is active (BrushPalette). */
	brushing: boolean;
	/** A placeable chip is armed for click-to-place (PlaceablesPalette). */
	armed: boolean;
};

export function computeCanvasMode(s: CanvasModeInputs): CanvasMode {
	if (s.drawing) return 'draw';
	if (s.brushing) return 'brush';
	if (s.armed) return 'place-armed';
	return 'idle';
}
