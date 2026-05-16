# World Map v2 — Steps 2 + 3 combined

Branch: `feat/world-map-v2-step-2-3` (off main @ bd60866, post v0.6.0.0)
Design source: `~/.gstack/projects/betwixt-and-between/steve-feat-app-qol-design-20260513-175833.md`
Test plan: `~/.gstack/projects/betwixt-and-between/steve-feat-world-map-v2-groundwork-eng-review-test-plan-20260513-213000.md`

## Decisions (locked 2026-05-14)

1. **Location hierarchy** — new `part_of` relationship kind. From = child Location, to = parent Location (mirrors `note_of` directional convention). Single-parent in v2 (write-time check: a Location may not have two outgoing `part_of` edges). Cycle prevention: write-time walk-up rejects on self-ref or cycle.
2. **Step scope** — Step 2 + Step 3 land in one PR (drill-down navigation already needs variant resolution).
3. **Drill-down gesture** — click a region polygon. If its linked Location has exactly one child Location with a map, drill into that child's active variant. If multiple children with maps, show a small chooser. If exactly one child with no map, show "Create a map for X?" affordance. Breadcrumb bar at top of WorldMap with click-to-pop ancestors.

## Architecture

### Schema (migration 0009)

`drizzle/migrations/0009_world_map_v2_variants_and_part_of.sql`:

- Append `'part_of'` to `RelationshipType` enum in `schema.ts` (Drizzle text-with-enum is a TS-only constraint, so the migration is purely TS).
- Add to `world_maps`:
  - `start_act_id`, `start_scene_id`, `end_act_id`, `end_scene_id` — nullable FKs to `entities(id)` ON DELETE SET NULL.
  - `start_position`, `end_position` — double precision.
- `CREATE EXTENSION IF NOT EXISTS btree_gist;`
- `world_maps_variant_no_overlap` EXCLUDE constraint (per M9).
- `world_maps_variant_position_order` CHECK constraint.
- `world_maps_one_default_per_location` partial unique index.
- DB trigger to SET `location_inactive_at` already exists (migration 0008) — keep as-is.

### Server

`src/lib/server/world-maps.ts` (extend):

- `assertWorldMapVariantBounds(db, userId, bounds)` — validate `start_act_id` / `end_act_id` are Act-typed and `start_scene_id` / `end_scene_id` are Scene-typed (M10).
- `recomputeWorldMapVariantsAll(db, userId)` — recompute `start_position` / `end_position` from FK refs using the existing CONSIDERATIONS Premise-4 math. Mirror `recomputeRelationshipBoundsAll`. Insert into `recomputeAllIntervals` after the relationship recompute (M11).
- `resolveActiveVariant(maps, playheadPosition): WorldMap | null` — pure function. Filter maps by `location_id`, pick the one with `[start_position, end_position)` covering playhead; fall back to default (all-null bounds).

`src/lib/server/relationships.ts` (or wherever relationship writes go) — add `part_of`-specific polymorphic validation: both endpoints must be `type='Location'`, must not create cycle, and the `from` must not already have another `part_of` edge.

### API

- `POST` / `PATCH /api/world-maps` — accept the bounds fields, pipe through `assertWorldMapVariantBounds`.
- New `POST /api/world-maps/[id]/duplicate` — clones the map row + all rows in `map_regions` with the same `map_id`. Returns the new map's id. Variant bounds copied but caller must adjust to avoid EXCLUDE conflict.
- `POST` / `PATCH /api/relationships` — when `type='part_of'`, run the new validation.

### Client

- `src/lib/types/world-map.ts` — add the four bounds FKs + two positions.
- `src/lib/stores/world-map.ts` — variant fields flow through unchanged shape.
- `src/lib/world-map-variants.ts` (new, ~30 lines) — re-export of `resolveActiveVariant` for client use. Pure, no DB.
- `src/lib/location-hierarchy.ts` (new, ~60 lines) — given a list of `part_of` relationships, build adjacency lookups: `getChildren(locationId)`, `getParent(locationId)`, `walkAncestors(locationId)`. Pure.
- `WorldMap.svelte`:
  - Breadcrumb bar at top — walks ancestors from current map's `location_id`. Clicking an ancestor switches map to that ancestor's active variant.
  - Region-click handler — pre-existing select logic stays for the no-children case. With children: see UX rules in Decision #3 above.
  - Settings panel — add scene-range picker (start act + start scene + end act + end scene) for the current map. "Save" calls PATCH with the new bounds.
  - Settings panel — "Duplicate map" button calls the new endpoint.
  - Variant auto-resolution — when the user navigates to a Location (via breadcrumb, drill, or picker), choose the variant covering current playhead.
- `LocationEditor.svelte`:
  - "Part of" picker (sets/clears this Location's parent via `part_of` relationship).
  - "Sublocations" read-only list (incoming `part_of` edges; click → open EntityDetail).
- `relationship-colors.ts` — add `part_of` color + edge style.
- `edge-policy.ts` — `part_of: 'directed'`.

## Commit order

1. `feat(world-map-v2): part_of relationship kind + Location hierarchy schema`
2. `feat(world-map-v2): map variant schema (bounds + EXCLUDE + CHECK + partial-unique)`
3. `feat(world-map-v2): variant recompute on Act reorder (M11)`
4. `feat(world-map-v2): variant bounds API + duplicate-map endpoint`
5. `feat(world-map-v2): part_of UI in LocationEditor + relationship surfaces`
6. `feat(world-map-v2): variant editor in WorldMap settings`
7. `feat(world-map-v2): breadcrumb + drill-down navigation`
8. `test(world-map-v2): integration coverage for variants + part_of + drill-down`
9. `chore: bump version + CHANGELOG for 0.7.0.0`

## Out of scope

- Multi-parent Locations (single-parent only in v2).
- Spatial variant selection (interior/exterior toggle).
- Variant cross-fade transition (Step 7).
- Open-ended variants (one bound NULL, the other set — explicitly rejected by EXCLUDE WHERE clause).
