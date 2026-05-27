// Slice 3 T8' — shared constant for the HTML5 drag-drop MIME type used
// by AssetLibrary (drag source) and WorldMap (drop target). One source
// of truth so the strings can't drift.
//
// The custom MIME type means accidental file drops or text drags don't
// trigger a placement create — the drop handler only acts when
// `application/x-betwixt-asset` is present on the dataTransfer.

export const ASSET_DRAG_MIME = 'application/x-betwixt-asset';
