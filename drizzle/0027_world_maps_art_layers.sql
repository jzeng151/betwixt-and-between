-- WM3 Slice B — layered canvas. Ordered freeform-art layer definitions on the
-- world_maps row: array of { id, name, blendMode, opacity }, array order =
-- render order, background bitmap = implicit bottom layer. jsonb (no CHECK) —
-- shape is enforced at the PATCH gate by artLayersValidationError
-- (src/lib/features/map/projection.ts). paint_stroke.layerId references
-- entries by id; per-user visibility rides world_map_layer_prefs with
-- layer_key = 'art:<id>' (free-text keys, reader lazy-GCs unknowns).
ALTER TABLE "world_maps" ADD COLUMN "art_layers_jsonb" jsonb NOT NULL DEFAULT '[]'::jsonb;
