# Changelog

All notable changes to this project will be documented in this file.

## [0.8.6.0] - 2026-06-02

### Fixed

- Creating a new character now opens it ready to rename (the name is immediately editable) instead of in read-only view mode that forced an extra "Edit" click.

### Changed

- The Playwright end-to-end test suite is healthy again and now runs in CI. It had drifted out of sync with the app (an OS window refactor moved entity editors from an in-Timeline side panel to standalone windows, and World Map v3 replaced the old card-based map) and was never gated, so ~38 specs were silently red. The specs are retargeted to the current UI, obsolete tests for removed features were dropped, and `npm run test:e2e` now gates both pull requests and production deploys so the suite can't rot unnoticed again.

## [0.8.5.0] - 2026-06-02

Settings customization (Phase 1) — your colors and theme now save to your account and follow you across devices.

### Added

- Customize the palette: Settings → Appearance now has Entity, Relationship, and Role color sections. Click any chip to pick a color (the chip is the live sample), and the graph, wiki, and palette recolor immediately. A dot marks customized chips; reset one with the ↺ button or a whole group with "Reset … to default".
- Light mode: the Appearance toggle now actually switches the app to a light theme (Midnight Ink dark stays the default).
- Preferences are server-backed: your theme, accent, and color overrides save to your account and load on any device or reload, instead of living only in one browser. Edits apply instantly and sync in the background.
- No-flash first paint: a logged-in user's custom colors and theme render correctly on the very first paint after a reload, instead of flashing the defaults until the app hydrates.

### Changed

- Theme and accent color now persist to your account (previously localStorage-only). Signed-out use still works locally.

### Fixed

- Upgrading no longer wipes your saved settings: the first time you sign in after this release, theme/accent/editor preferences already saved in your browser are migrated up to your account instead of being overwritten by defaults.
- A preference change made while the server is briefly unreachable (network blip, transient 5xx, or an expired session) is now retried in the background until it lands, instead of being silently dropped and surviving only in this browser.
- Editing the "Note of" swatch in Relationship colors no longer recolors Note entities — it shared the Note entity's color and leaked across groups, so it's been removed from the relationship palette (note edges still render in the Note color).
- The Editor → link-preview toggle now sticks across reloads instead of occasionally resetting itself after your colors had been saved to your account.
- On a shared browser, one account's saved theme/colors are no longer imported into a different account on first sign-in. The local preferences cache is now scoped to the signed-in user, so a different user's cached prefs are neither migrated up nor shown.
- Role color overrides now also apply to the character editor's role badges (previously only the detail header picked them up), and a Relationship color edit no longer tints those badges.
- Relationship colors that share one underlying color (e.g. "Located at" and "Part of") are now a single swatch, so you can't set two values where only one would actually render.
- Color customization now reaches the relationship chips in the wiki/relationship lists and the `[[link]]` preview chips shown while editing — previously those surfaces used their own hardcoded colors, so some swatches didn't recolor them and others recolored them incorrectly.

## [0.8.4.0] - 2026-06-02

World Map v3 Slice 5 — EventChains. Causal links (`caused_by`) gain story-time scope and become a navigation tool.

### Added

- Scope a causal link to a scene: when you edit a "caused by" relationship, you can now pin where the link happens to a specific act and scene (start and end). The scene picker only offers scenes from the act you chose, and switching acts clears a now-mismatched scene so you can't save an inconsistent scope.
- Click a causal edge to jump there: in the Story Graph and the focused entity graph, clicking a scoped "caused by" edge scrubs the timeline playhead to where that link happens. A pointer cursor marks the edges that jump; unscoped (timeless) links stay inert.

### Fixed

- Causal-link timing stays correct after a scene shuffle: reordering or inserting scenes within an act now re-derives the story-time of any causal link scoped to those scenes, so click-to-jump always lands at the right moment instead of a stale one.
- Hidden plot links stay hidden: a "mystery" causal edge (one not yet revealed at the current playhead position) is no longer clickable, so jumping to it can't leak the reveal's timing ahead of time.

## [0.8.3.0] - 2026-06-01

World Map v3 Slice 4 (part 2) — movement. Markers can now move over story-time, completing the Slice 4 authoring story begun in 0.8.1.0.

### Added

- Move a map marker over time: pick the Move tool, drag a marker to a new spot, and a keyframe is recorded at the current playhead. Scrubbing the timeline glides the marker along its path between keyframes (eased), and a faint amber line traces the authored route.
- Author movement from the keyboard for accessibility: with the Move tool active, click a marker to select it, nudge with the arrow keys (hold Shift for a larger step), Enter to commit a keyframe, Escape to cancel. A screen-reader announcement confirms each commit.
- A unified map tool bar — Select, Brush, Place, Move — is the single place to switch tools. The active tool highlights, and Undo/Redo now live on the bar so they're reachable from every tool, not just while painting.

### Changed

- The Brush and Placeables panels now appear only when their tool is selected, instead of always sitting below the canvas, so the map area is less cluttered.

## [0.8.2.0] - 2026-05-31

Fixes three World Map optimistic-concurrency races surfaced in review of #59.

### Fixed

- Rapid style edits to one map placement (e.g. pick a color, then drag the scale/opacity slider) are now sent in order — each save waits for the prior in-flight one for the same placement — so the server can't persist an older value and drop the newer style on reload.
- Changing an entity's style and immediately toggling "Show in placeables palette" no longer clobbers one edit with the other; the same per-record ordering now applies to entity `data` writes.
- Placement edits survive a map/location switch: switching to a map with no linked location no longer drops an in-flight save's ordering guard, so returning and re-editing the same placement can't be overtaken by the earlier request and overwritten.
- The timeline stays current after a reordered Act or Scene is quickly renamed — a structural reorder refreshes the timeline even when a later edit to the same entity lands first, instead of leaving stale bars until a full reload.

## [0.8.1.0] - 2026-05-30

World Map v3 Slice 4 (part 1) — marker styling, a unified placeables palette, and hover feedback. Movement playback (the rest of Slice 4) ships separately.

### Added

- Style a map marker's color, icon, scale, and opacity. Edit it once on the entity (every placement of that entity updates) or override a single placement from its marker menu's "Edit style" popover. Cleared fields fall back to the inherited default.
- Hovering a marker now pulses it and adds a soft glow in the marker's own color, so it's clear what you're pointing at.
- A "Show in placeables palette" toggle on placeable entities controls whether they appear in the palette.

### Changed

- The two separate placeables rails (click-to-place and drag-to-place) are now one palette. Each chip both arms for click-to-place and works as a drag source, and the palette shows a clear empty state when there's nothing to place.

### Fixed

- Opting an entity out of the library (`is_asset = false`) now removes it from placement everywhere — previously it still showed in the click-to-place list.
- Placing from the palette now respects the active tool: you can no longer drop a marker while painting terrain or drawing a region, and dropping a chip clears any pending click-to-place selection.
- Dropped the unused `source_asset_id` field from placements (it never carried information under the reference model).

## [0.8.0.0] - 2026-05-29

World Map v3 Slice 3 — terrain authoring, asset library, layers, and faction editing.

### Added
- **Paint terrain onto the map with a brush.** New brush palette under the canvas: pick a biome, pick a size (1/3/5), drag to paint cells. One drag is one undo-able stroke — every cell you touch in a gesture commits together. An eraser (biome `unset`) clears cells back to transparent. Strokes touching more than 256 cells chunk automatically.
- **Square and hex grids.** Maps carry a configurable grid (`grid_type` square/hex, `grid_cells_x/y` 4–128, scale unit/value). The grid renders as its own toggleable layer; terrain cells snap to it.
- **Asset library with drag-drop placement.** A sidebar palette lists your Characters / Artifacts / Items; drag a chip onto the map to drop a placement at that spot. Drops create `map_placements` rows (not new entities) and record `data.source_asset_id` for Slice 4's sync-from-template. Opt an entity out with `data.is_asset = false`.
- **Per-placement style cascade.** A pure `resolveStyle` resolver merges per-instance `entity.data.style` over type defaults over a global default (color/icon/scale/opacity), emitted on every placement in the projection.
- **Per-user-per-map layer visibility.** New `world_map_layer_prefs` table + `GET`/`PATCH /api/world-map-layer-prefs`. The MapSidebar Layers pane toggles background/grid/terrain/regions/placements; toggles persist across reloads. The projection still emits every layer regardless of visibility (purity preserved).
- **Inline faction rename.** Click a faction name in the sidebar to rename it; Enter commits via `PATCH /api/factions/[id]`.
- **Polygon snap-to-grid.** Hold Shift while placing region vertices to snap each to the nearest grid intersection (square corners or hex vertices); release for free-form placement.
- **Automatic snapshots while painting.** After 20 paint events since the last anchor, the server writes a synthetic anchor in the same transaction (`map_anchors.is_synthetic`) so projection stays fast on long histories. Undoing the stroke that crossed the threshold invalidates the synthetic anchor.
- **Grouped chunked-undo.** `map_events.command_id` ties a stroke's chunks together; a single `POST /events/undo` soft-deletes the whole group atomically.
- **Style whitelist validation.** `style` jsonb on entities and placements is validated server-side (allowed keys only, hex colors, clamped scale/opacity, 4 KB cap; 422 on violation).
- Migrations `0018`–`0023`: grid columns, `is_synthetic`, `command_id` + partial index, `world_map_layer_prefs`, anchor `cells[]` backfill, auto-anchor index.
- **Undo / redo for map edits.** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (scoped to the focused World Map window, ignored while typing) plus Undo/Redo buttons in the brush palette now drive the event undo/redo that previously had no UI. Paint, undo, and redo are optimistic — the canvas updates before the server round-trip and reconciles on the response.
- **Loading state while a map loads.** The canvas shows a "Loading map…" overlay until the saved layer config, terrain/region data, and placements have all settled (each tracked by a bounded flag that can't get stuck on a failed load), so layers no longer flash on then snap to the saved config and placement markers no longer pop in afterward.
- **Faction recolor UI.** An edit (pencil) button on each faction (including the system faction) opens an inline form with a name field and always-visible color swatches; Save commits name + color together.

### Fixed
- **Same-playhead repaint no longer drops cells (codex P1).** Painting more terrain at the same playhead T after a synthetic anchor was already written there hit the `(world_map_id, t_position)` unique constraint; swallowing the conflict left the stale snapshot shadowing the new same-T events, so the just-painted cells vanished. The auto-anchor now rebuilds the snapshot to equal `projectState(maxT)` — folding the full live event log from the anchor strictly before maxT and replacing the synthetic anchor with a fresh row — so same-T repaints bake in correctly, late retroactive paints stay shadowed, and undo/delete still invalidates the anchor.
- **Drawing a region no longer paints terrain (codex P2).** While a polygon is being drawn, the brush layer is suspended, so the left-clicks that place vertices don't also fire `paint_cells` strokes.
- **Editing an anchor refreshes downstream terrain (codex P2).** Authoring, editing, or deleting a map anchor now invalidates later auto-generated (synthetic) anchors, so their cached snapshots can't keep shadowing the change.
- **Snapshots capture painted terrain (codex P2).** "Snapshot world state here" now records the terrain rendered at the playhead instead of writing an empty cell set — taking a snapshot after painting no longer wipes that terrain from the snapshot point forward.
- **Snapshotting over a server cache anchor works (codex P2).** Authoring a snapshot at a playhead that already holds an auto-generated (synthetic) anchor replaces the cache row instead of returning a 409.
- **Authored snapshots are validated (codex P2).** Anchor create/update now reject cells with out-of-bounds coordinates or unknown biomes (same checks as paint events), so a hand-crafted snapshot can't persist off-grid terrain.
- **The brush can't get stuck (codex P2).** A permanently failed paint-stroke commit now aborts the gesture instead of leaving it mid-stroke (which previously swallowed new clicks while button-up moves kept appending cells). Already-committed chunks remain undoable as a group.
- **Deleting a painted event clears stale terrain (codex P2).** `DELETE /api/maps/:id/events/:eventId` soft-deleted the event but left any synthetic anchor that folded it intact, so the deleted terrain kept rendering. The DELETE path now runs the same synthetic-anchor invalidation as undo.
- **Grid shrink can't orphan timeline-visible terrain (codex P2; tightened in PR #58).** `PATCH /api/maps/:id` rejects (409) reducing `grid_cells_x/y` below a cell that is painted out of bounds at **any** playhead. Because map events are temporal, the guard no longer collapses each cell to its latest biome — a cell painted out of bounds then erased at a later T is still projected (non-erased) at intermediate playhead positions, so it blocks the shrink too. Eraser rows (`unset`) don't count; growth is always allowed.
- **Retroactive edits aren't hidden by cache anchors (codex P2).** Inserting an event (a retroactive/same-T paint or a `transfer_region`) at or before an existing auto-generated (synthetic) anchor's playhead now invalidates that anchor, so the new edit can't be shadowed by a stale snapshot.
- **Asset drops respect pan/zoom (codex P2).** Dragging a library asset onto the canvas after panning or zooming now converts the drop point through the pixi-viewport transform (matching click-to-place), so the placement lands at the dropped MAP location instead of the on-screen position.
- **Faction recolor works inline (codex P2).** Clicking the color stripe in the inline faction editor no longer blurs the name input (which committed+exited edit before the swatch picker could open); the picker opens and the recolor commits.
- **Painting no longer 500s in production.** The auto-anchor counter, its event-window read, and the grouped-undo synthetic-anchor cleanup bound a raw JavaScript `Date` into a timestamp comparison. The production `neon-serverless` driver (and the `postgres-js` E2E driver) mis-serialize that — the same hazard the cursor queries already defend against — so any stroke that hit the auto-anchor path errored, even though the in-process PGlite unit tests tolerated it. The three comparisons now read `created_at` back from the row by id via a scalar subquery (no JS `Date` round-trip, full microsecond precision).
- **Per-placement style overrides now render (codex P2, PR #58).** The placement endpoints accept and validate a per-instance `placement.data.style`, but the renderer only resolved the entity-level style and ignored it — so a customized single placement's color/scale/opacity persisted yet still drew with the entity style. `resolveStyle` now takes the placement override as the top cascade layer and the renderer threads it through.
- **Brush strokes no longer pan the map (codex P2, PR #58).** While brush mode is active the pixi-viewport drag plugin is suspended, so a click-and-drag paint gesture paints cleanly instead of panning the viewport under the cursor and recording drifted/unintended cells. Pinch and wheel zoom stay live.
- **Terrain brush works on unlinked maps (codex P2, PR #58).** The brush palette was gated behind the same linked-Location check as the placement controls, so duplicated maps (intentionally left with `location_id: null`) had no way to paint. The palette is now gated on having a map image only; placement controls stay Location-gated.
- **Grid type can't be changed out from under painted terrain (codex P2, PR #58).** `PATCH /api/maps/:id` rejects (409) switching `grid_type` (square↔hex) once any non-erased terrain exists — the stored `(x,y)` cell keys would reinterpret under the new geometry and the terrain would visibly distort. Erase terrain first, or keep the grid type.
- **Retroactive edits sync the client cache (codex P2, PR #58).** When an event write drops a synthetic (auto-generated) anchor at or after its playhead, the `POST /events` response now returns the invalidated anchor ids; the client evicts them from its anchor store so the just-authored retroactive/same-T paint isn't hidden behind the stale snapshot until a full reload.
- **Undo re-syncs cached anchors (codex P2, PR #58).** Undo also invalidates synthetic anchors server-side, but `/events/undo` returns only event rows (a stable array contract), so the client now refetches the anchor set after an undo — otherwise the local store kept the stale synthetic snapshot and `projectState` could keep showing the undone terrain/ownership until a reload.
- **Grid respects saved visibility on first paint (codex P2, PR #58).** When the Pixi grid layer was created after its visibility effect had already run (the normal async-import order), it kept Pixi's default `visible=true` and flashed the grid even on maps migrated with `grid_visible=false` (or a saved pref of false). The layer now initializes its visibility from `(map.gridVisible ?? false) && <user pref>` at creation.
- **Brush is inactive while a map is still loading (codex P2, PR #58).** Painting is now suspended while map data (anchors/events/regions/factions) is in flight — same `dataLoading` guard the snapshot/ownership writes use. Previously a paint that committed mid-load could be clobbered when the in-flight `GET /events` resolved and replaced the store with its stale pre-stroke rows.
- **Terrain respects saved visibility on first paint (codex P2, PR #58).** Same first-load fix as the grid layer, applied to the terrain layer: a layer created after its visibility effect already ran kept Pixi's default `visible=true` and showed terrain even when the saved pref was false. It now seeds `layer.visible` from the user pref at creation.
- **Authored-anchor writes re-sync the client cache (codex P2, PR #58).** Creating, editing, or deleting a historical map anchor invalidates later synthetic anchors server-side, but the mutation responses only carry the written row. The anchor store now refetches the canonical set after these writes, so a stale local synthetic snapshot can't keep being projected until a reload.
- **Event deletes re-sync cached anchors (codex P2, PR #58).** `DELETE /api/maps/:id/events/:eventId` soft-deletes the event and invalidates synthetic anchors that folded it, but returns 204; the client now refetches anchors after a delete (mirroring undo), so the deleted terrain/ownership stops projecting from the stale snapshot.
- **Brush gesture aborts when the layer deactivates (codex P2, PR #58).** If the brush deactivates mid-stroke (a map switch flips `dataLoading`, or drawing mode takes over) the in-flight gesture is now cleared, instead of leaving `painting`/`strokeId`/`touched` set — which previously swallowed the next pointerdown and could commit stale cells against the new map/playhead on a later pointerup.
- **Duplicating a map preserves its grid (codex P2, PR #58).** Map duplication now copies the source's `grid_type`, cell counts, scale unit/value, and `grid_visible` to the clone (terrain cells are still intentionally not cloned), so a duplicated hex/custom-calibrated map no longer reverts to the square 32×24 defaults and lose alignment with the shared image.
- **Grid edits serialize with terrain writes (codex P2, PR #58).** The grid-settings PATCH read terrain (the shrink/type guards) then wrote the grid columns without a lock, so a concurrent `paint_cells` POST could insert a cell against the old grid between the guard and the write. The guard + update now run in one transaction holding the same `world_maps ... FOR UPDATE` row lock paint writes take, so grid edits and terrain writes serialize.
- **Authored-anchor writes serialize with auto-anchor writes (codex P2, PR #58).** `createMapAnchor`/`updateMapAnchor`/`deleteMapAnchor` invalidated synthetic anchors and wrote outside the paint row lock, so an in-flight paint could re-materialize a synthetic anchor from the old base between the invalidation and the authored write, shadowing the user's anchor. Each now runs the invalidation + write under the same `world_maps ... FOR UPDATE` lock (and rolls the invalidation back if the write 409s on a duplicate T).
- **Per-placement/entity icon styles now render (codex P2, PR #58).** The style cascade resolved `icon` but `PixiPlacementLayer` ignored it (always drew the circular marker), so a saved icon override was a silent no-op. The renderer now async-loads the icon texture and overlays it as a sprite (sized to the marker, dimmed to the resolved opacity), keeping the circle as the visual while loading and as the fallback on any load failure. Markers are now Containers with a stable hit area so click/tooltip interaction survives the circle→sprite swap; an internal render generation aborts texture loads that resolve after a re-render so a sprite can't attach to a torn-down marker.

- **Grid renders on pre-existing maps (QA).** Grid visibility now follows the per-user layer toggle alone. It was AND-gated behind a per-map `grid_visible` column that has no UI and was backfilled `false` on existing maps, so the grid never drew even though the Layers checkbox read checked. The stroke is also lightened for legibility.
- **Grid / terrain layer toggles reach the canvas (QA).** Their visibility `$effect` read the pref inside an `if (layer)` guard, so on the async-Pixi-import first run (layer still null) it never subscribed to the pref store and toggling did nothing afterward. It now reads the pref unconditionally (matching the region/placement layers).
- **The World Map window is resizable (QA).** Map chrome (toolbar at `z-index:1000`, sidebar, bottom palettes) leaked high z-indexes into the window's stacking context and painted over the resize handles, killing the bottom edge + corners. `.win-content` is now `isolation: isolate` so the handles stay on top — fixes resize for every windowed app.
- **Sidebar no longer covers the bottom palettes (QA).** Dropped the sidebar z-index and gave it `overflow-y: auto` scrolling; raised the placeables/asset/brush palettes and error toasts above it; reserved palette space so the brush size selector isn't occluded.
- **Two quick brush clicks no longer paint a line (QA).** `commitStroke` kept `painting=true` until the POST resolved, so button-up pointermoves between two clicks recorded the cells between them and the second click's pointerup committed the line. The gesture now resets synchronously on pointerup; the POST fires with a captured snapshot.
- **Undo/redo are race-free (QA).** `create()`, `undo()`, and `redo()` run on one serialization chain. Spamming undo previously fired concurrent requests whose out-of-order responses re-added strokes and corrupted the redo stack (and 422-stormed past the start of history); undoing right after a paint, before its POST committed, undid the previous event instead of the new one. Both are fixed; the empty-log guard also stops the 422 spam.
- **Paint / undo / redo latency (QA).** The events store mutates locally before the POST and reconciles on the response (rolling back on failure), removing the visible lag on painting, undoing, and redoing.

### Tests
- ~10 Playwright E2E specs covering the new flows end-to-end: brush stroke + grouped undo (the production-500 regression guard), asset drag-drop placement, layer-toggle persistence across reload, faction rename + recolor, polygon snap (Shift-on vs free-form), the loading overlay (waits for layer-prefs / placements / terrain data), window resize (bottom edge under the palettes), and the brush QA bugs (size selector reachable, wide-drag paints a line, undo/redo, spam-undo, two-clicks-not-a-line, paint-then-undo race). Several are verified to fail without their fix.
- Unit + integration coverage for paint_cells validation, auto-anchor (K=20, concurrent, stroke-boundary), layer-prefs CRUD + cross-user isolation, style cascade + validation, hex-grid and grid-snap math, and the asset/placement `source_asset_id` invariant. 1201 vitest passing.

## [0.7.9.0] - 2026-05-27

### Removed
- **Leaflet entirely.** The strangler-fig renderer toggle from Slice 1b retires here. Pixi is the only renderer; `?renderer=` query param is now ignored. Deleted: `MapStage.svelte`, `RegionLayer.svelte` (Leaflet), `PlacementLayer.svelte` (Leaflet — Pixi version lives on as `PixiPlacementLayer.svelte`), `RendererToggle.svelte`, `renderer-flag.ts`, `leaflet-controller.ts`, `region-popup.ts`. 7 files, 651 lines removed. `leaflet`, `leaflet-draw`, `@types/leaflet`, `@types/leaflet-draw` dropped from package.json.
- **`tests/e2e/renderer-toggle.spec.ts`** — there's no toggle to test.

### Changed
- **`WorldMap.svelte`** simplified by ~180 lines: Leaflet branch deleted, `accentColor` / `borderColor` / `resolveCssColors` removed (only Leaflet's `RegionLayer` consumed them), `popupCallbacks` removed (only Leaflet's `MapStage` consumed it), `leafletMap` / `L` / `drawnItems` state removed, `renderer === 'leaflet'` conditional rendering removed.
- **Pre-deletion checkpoint tag** `pre-renderer-flag-deletion` placed on `c65be06` (v0.7.8.0) for fast revert. Rollback is `git revert <PR-merge-commit>` + redeploy + canary check; no code-level escape hatch.

### Tests
- 1062 vitest still passing (the leaflet codepath had no dedicated unit tests beyond the deleted renderer-toggle E2E).
- `snapshot-anchor.spec.ts` updated to drop `?renderer=pixi` from the URL since Pixi is now the default.

## [0.7.8.0] - 2026-05-27

### Added
- **Undo any map edit on the timeline.** New `POST /api/maps/[id]/events/undo` pops the latest live event in commit order (created_at DESC, id DESC — your last action, not the latest timeline position). Soft-delete via a new `undone_at` column keeps the row on disk for audit. Client-side redo stack in `mapEventsStore` replays the popped event via the existing `POST /events` endpoint, so a new row lands with a fresh id + created_at but the original t_position and payload. Authoring a new event clears the redo stack.
- **Pixi-native polygon-draw tool (`PixiPolygonDraw.svelte`).** Right-click an empty canvas area under `?renderer=pixi` → "Draw region here" enters drawing mode with the click point as the first vertex. Left-click adds a vertex, double-click commits, snap-close within 8px of the first vertex (≥3 vertices) also commits. Backspace pops the last vertex, Esc cancels, Enter commits. Self-intersecting segments render in rust-red and block commit until the polygon is simple. Status overlay top-left ("DRAWING · ESC TO EXIT · DBL-CLICK OR SNAP TO CLOSE"). Replaces leaflet-draw for the Pixi path.
- **Pixi-native placement marker layer (`PixiPlacementLayer.svelte`).** Pins render as colored circles (entity-type color, 8px). Hover for tooltip with entity name + type. Click → context menu with "Open <Type>" / "Delete placement". Stage-level click capture wires the click-to-place flow when a `PlaceablesPalette` chip is armed. Out-of-scope pins (placeable's intervals don't cover the playhead) fade to 30% alpha.
- **Scope-dim treatment extended to Pixi regions.** Regions linked to Locations whose intervals don't cover the playhead render at lower opacity (0.08 fill, 0.3 stroke alpha), matching the existing Leaflet behavior.
- **Locations join the timeline Palette.** New section alongside Characters and Events with the same chip + `+ Add` button affordance. Dragging a Location chip onto an Act creates an interval, just like Characters and Events. Useful for "Location X is active during these acts" annotations.
- **Per-user "Neutral" faction is the fallback for un-faction-ed regions.** D1 (T3) drops `map_regions.color` and replaces the color-per-region model with a faction-per-region model. Every user has exactly one `factions.is_system=true` row (enforced by a partial unique index); regions without explicit faction ownership resolve through Neutral. The schema-level guarantee is the design doc § Slice 2 D1 prescription. PATCH/DELETE handlers reject mutations on system rows with 422.
- **Cursor pagination on factions/anchors/events** (D5). `GET /api/maps/[id]/events?after=<cursor>&limit=N` returns `{rows, next_cursor}`. Cursor is a base64-JSON keyset on `(t_position, created_at, id)` for anchors/events and `(created_at, id)` for factions. Default page size 500, max 1000.

### Changed
- **Anchor JSON is now canonical for region geometry** (D2 PR-C, T6). The `map_regions` table is dropped (migration 0016). Region identity, polygon, faction overlay, and location-link all live in `map_anchors.state_jsonb.regions[]`. The baseline anchor (t_position = -Infinity) is the authoritative store; the per-map fan-out helpers in `anchor-region-write-through.ts` are the only authorized writers.
- **Anchor schema gains polygon + locationId** (D2 PR-A, T4). Migration 0015 backfills both fields from `map_regions` into every anchor's regions[] array; T5a rewrote every read site (location-hierarchy, projection-context, world-map-v3, duplicate, regions GET/PATCH/DELETE, maps GET) to consume anchor JSON instead of `map_regions`.
- **Baseline anchor is now protected from accidental corruption** (codex review hardening). `PATCH /api/maps/[id]/anchors/[anchorId]` and `DELETE` reject the baseline (t_position = -Infinity) with 422 — the baseline is canonical, and user-facing edits would erase or poison the only copy of region geometry. Non-baseline anchors still PATCH/DELETE normally.
- **Deleting a Location now scrubs locationId from anchor JSON.** Pre-T6 the DB-level `map_regions.location_id ON DELETE SET NULL` cascade handled it; post-T6 the cascade lives in `DELETE /api/entities/[id]` as a `jsonb_set` UPDATE scoped via `world_maps.user_id`. No more stale UUIDs in canonical state.
- **`DELETE /api/maps/[id]/events/[eventId]` is now a soft-delete.** Sets `undone_at = now()` instead of hard-deleting; T7's audit trail invariant stays intact regardless of which endpoint removes the event.
- **Undo + Neutral creation hardened against concurrent writes.** `undoLatestMapEvent` wraps SELECT+UPDATE in a bounded retry loop so a double-click pops two events rather than the second call getting a misleading 422. `ensureNeutralFaction` catches 23505 unique-violation and re-SELECTs, so two concurrent first-writes for a new user both return the Neutral row instead of one 500-ing.
- **Pixi snapshot writes the full anchor entry shape.** `snapshotWorldState` previously wrote only `{region_id, faction_id, color}`; now includes `polygon` + `locationId` so snapshots can't erase geometry when they become the earliest anchor.

### Fixed
- **Anchor pagination cursors round-trip `-Infinity`.** Previously `JSON.stringify({t: -Infinity})` serialized as `{"t": null}`, which the decoder rejected — `/anchors?limit=1` on any map with baseline + another anchor returned a `next_cursor` the server itself refused. Encoder now maps non-finite tPosition values to sentinel strings (`__neg_inf__` / `__pos_inf__`); decoder reverses.
- **Malformed cursor date strings return clean 400.** Decoders only typechecked `c` as string; SQL builders then called `new Date(cursor.c)`. A valid base64 cursor with `"c":"not-a-date"` produced Invalid Date → driver/DB 500. Both decoders now validate via `Date.parse` + `Number.isFinite`.
- **Pixi polygon-draw double-vertex bug fixed.** Initial implementation registered the click handler on both `pointerdown` AND `pointertap`, doubling every click. Backspace correctly clears a single seed vertex now.
- **Pixi placement scope-filter re-runs on playhead changes.** Inline filtering inside the render `$effect` lost the playhead dependency on the `placementsAtPlayhead` branch; now materialized via `$derived.by` for explicit dependency tracking.

### Removed
- **`map_regions` table** (migration 0016). Anchor JSON is the only source of truth for region identity, geometry, faction overlay, and location-link.
- **`svelte-pixi` dependency** and its WebGL-context-leak patch. `PixiStage.svelte` owns the `PIXI.Application` lifecycle imperatively (Slice 1b PR 2 already abandoned the `<Application>` wrapper).

### Infrastructure
- **5 migrations:** 0013 (factions.is_system column + partial unique index), 0014 (drop map_regions.color + backfill Neutral factions), 0015 (anchor regions[] gain polygon + locationId), 0016 (drop map_regions table), 0017 (map_events.undone_at column).
- **Projection determinism fixture** (`tests/integration/projection-fixture.test.ts` + `tests/fixtures/world-map-v3-projection-golden.json`). 20 playhead values × hand-built fixture (4 regions, 3 factions, 2 anchors, 9 events covering same-T commit order, cross-user defense, foreign-faction lazy-GC, unknown event kind) deep-equal against a golden JSON. Regenerate with `UPDATE_GOLDEN=1`.
- **Playwright E2E for renderer toggle + snapshot anchor.** `tests/e2e/renderer-toggle.spec.ts` (toggles 20×, asserts no WebGL context-exhaustion warnings). `tests/e2e/snapshot-anchor.spec.ts` (right-click → "Snapshot world state here" creates a map_anchors row at t=0).

### Tests
- **Slice 2 D1 (T3)** — Neutral faction backfill: signup race, idempotency, anchor regions[] entries point at user's Neutral, two users get distinct Neutrals, duplicate-map clones use Neutral.
- **Slice 2 D1 (T2)** — factions.is_system guards: DELETE/PATCH reject system row with 422, partial unique index rejects second system row per user, CREATE never produces a system row.
- **Slice 2 D2 PR-A (T4)** — anchor schema gains polygon + locationId: POST writes polygon to every anchor, PATCH polygon preserves faction_id overlay, PATCH locationId propagates, duplicate clone carries polygon + locationId.
- **Slice 2 D3 (T7)** — undo endpoint: pops by (created_at DESC, id DESC), soft-delete sets undone_at, list endpoint excludes undone, 422 on empty stack, 404 cross-user, countFactionDependents excludes undone events, redo via re-POST creates new row with same t_position + payload.
- **Slice 2 D2 PR-C hardening (codex review)** — baseline anchor PATCH/DELETE return 422, non-baseline edits still work, Location DELETE scrubs locationId from anchor JSON, ensureNeutralFaction recovers from concurrent insert race, -Infinity tPosition cursor round-trips, malformed cursor date returns 400, DELETE event endpoint soft-deletes.
- **D5 cursor pagination** — 1500 events paginate through 3 pages, anchor pagination, faction pagination by createdAt, malformed cursor rejected, cross-user cursor isolation.
- **Polygon-validation parity** (9 cases) — client `isSelfIntersecting` and server `isSelfIntersecting` agree on triangle, square, bowtie, degenerate, concave-pentagon, vertex-3 cross. `firstSelfIntersection` locates the offending edge pair.

## [0.7.7.0] - 2026-05-24

### Added
- **World Map v3 Slice 1b — Pixi renderer + faction tide demo (PR 2 of 2).** `?renderer=pixi` URL query param swaps the canvas from Leaflet to a Pixi-based renderer. The Pixi path consumes `RenderedState` from `projectState()`, so faction-ownership events composed in commit 6 fold through the projection engine and recolor regions when the playhead crosses the event's T. Iron-rule parity preserved: `?renderer=leaflet` (default) renders identically to v0.7.6.0.
- **In-app `RendererToggle.svelte`** (top-right pill) flips between renderers via SvelteKit `goto()` — client-side navigation, no SPA reload, no open-window loss. Polishes the strangler-fig flag's discoverability and gives Δ1b-C a Playwright target.
- **Imperative `PixiStage.svelte`** owns the `PIXI.Application` lifecycle directly (new + await init + canvas append + destroy). Original svelte-pixi `<Application>` wrapper hit a destroy-during-init race under rapid renderer-toggle, leaking 1-2 WebGL contexts per cycle; the imperative pattern (spike findings' prescribed approach for orchestrator-level ownership) eliminates the leak. svelte-pixi 8.0.1 still in the dep tree for potential leaf-layer use later.
- **`PixiRegionLayer.svelte`** renders polygons via `PIXI.Graphics` with per-region colors layered from the projection engine's `RenderedState` (faction override) → `region.color` (geometry-author baseline) → neutral gray. Right-click a region → custom `ContextMenu` lists `Change owner → <faction>` per available faction; the current owner is shown disabled as `<faction> (current owner)` to prevent accidental double-stamping. Right-click an empty area → "Snapshot world state here" creates a `map_anchors` row at the current playhead capturing the rendered ownership state.
- **`MapSidebar.svelte`** — floating right-side panel for faction CRUD. Create form with shared color palette (see Infrastructure). Delete with dependents warning: fetches `GET /api/factions/[id]/dependents` count first, dialog enumerates affected events and warns about resulting ownership-unknown rendering.
- **`GET /api/maps/[id]/projection-context`** (NEW endpoint) returns `{allowedFactions, allowedRegions}` from server-side `fetchProjectionContext`. Cross-user scoping baked into the SQL — defense-in-depth `404` on missing/cross-user map. Client `use-projection.ts` helper converts the array payload into Map/Set form for `projectState()`.
- **Baseline anchor invariant (A1).** `POST /api/maps` and `POST /api/maps/[id]/duplicate` now insert/clone a baseline `map_anchors` row at `t_position = -Infinity` inside the same transaction as the worldMaps insert. New maps no longer render empty under `?renderer=pixi`. Anchor `t_position` uses Drizzle `sql` template tag with the literal `'-Infinity'::float8` cast because postgres-js (Neon serverless) doesn't reliably serialize JS `Number.NEGATIVE_INFINITY`; PGlite in tests does.
- **Region write-through to anchor state (A3).** Region POST / PATCH / DELETE handlers fan out the change to every `map_anchors.state_jsonb.regions[]` for the same map (`src/lib/server/anchor-region-write-through.ts`). Geometry stays parity-consistent between Pixi (which reads anchor state) and Leaflet (which reads `map_regions` directly). `faction_id` overlays survive color edits; deletes drop the entire entry.

### Changed
- **Empty-map hint moved to bottom-center** so it no longer collides with the `.map-toolbar` when both are visible on a new map.
- **MapStage.svelte** gains a cancellation flag on its leaflet dynamic-import, `leafletMap.stop()` before `.remove()` in cleanup (cancels in-flight zoom animations whose `transitionend` would otherwise hit a destroyed `_mapPane`), and `{ animate: false }` on the initial `fitBounds`. Latent bugs exposed by the renderer toggle; fixed proactively.
- **RegionLayer / PlacementLayer** wrap `removeLayer` calls in their effect cleanup with `try/catch` — sibling-unmount-order races during renderer flip can destroy the Leaflet map before these layers clean up their references.
- **`color-palette.ts` extracted** from `RegionFormModal.svelte` so faction CRUD reuses the same swatch set (region authoring and faction authoring share the same visual vocabulary).

### Infrastructure
- **Vite HMR fallback in `PixiStage.svelte`.** `import.meta.hot.accept(() => window.location.reload())` forces a full page reload on edits to this module — `import.meta.hot.invalidate()` didn't cascade in this app's HMR graph and was leaking WebGL contexts on save. Dev-only (stripped from prod bundles); only affects edits to PixiStage itself, other map files HMR normally.

### Tests
- **G1 + G2** (5 cases): baseline anchor inserted on `POST /api/maps`, atomicity under duplicate-default-location failure, duplicate-map anchor cloning carries the CLONE's new region ids (not source's stale refs), region-less duplicate still produces a baseline anchor, source anchors untouched after duplicate.
- **G3** (4 cases): `GET /api/maps/[id]/projection-context` cross-user scoping. User B's request for User A's map returns 404; User A sees only their own factions + regions; cross-user faction and region ids excluded from the payload.
- **G6** (5 cases): region write-through CRUD. POST adds entry to baseline anchor with `faction_id=null`. PATCH updates color. PATCH preserves `faction_id` (faction overlay survives baseline edits). DELETE removes entry. Multi-anchor maps see write-through on every anchor.
- **G9** (8 cases): `use-projection.ts` unit tests. `toProjectionContext` shape conversion, deduplication semantics, last-write-wins on duplicate faction ids. `fetchProjectionContextForMap` GET URL shape, 404 surfacing, 500 surfacing.

### Test scope deferred
- **Δ1b-A / Δ1b-B** (svelte-pixi patch teardown tests) — defunct since `PixiStage.svelte` went imperative and no longer mounts svelte-pixi's `<Application>` wrapper at the orchestrator level. patch-package patches are still applied via postinstall, but the test path through this codebase is gone. To revisit if a leaf layer (e.g., a Slice 2 `PixiMarkerLayer`) re-introduces svelte-pixi components.
- **Δ1b-C / Δ1b-E** (Playwright E2E: renderer-flag toggle and right-click snapshot anchor) deferred to a separate test-harness PR. The Pixi canvas + right-click + scrub interactions need a real headless-Chrome harness; G6 covers the write-through behavior at the integration layer.
- **G7** (`?renderer=foo` fallback) — one-line ternary in `currentRenderer()`, trivially correct.

## [0.7.6.0] - 2026-05-23

### Added
- **World Map v3 Slice 1b backend foundation.** Server endpoints for the projection engine's authoring surface: `GET/POST /api/factions`, `PATCH/DELETE /api/factions/[id]`, `GET /api/factions/[id]/dependents`, `GET/POST /api/maps/[id]/anchors`, `PATCH/DELETE /api/maps/[id]/anchors/[anchorId]`, `GET/POST /api/maps/[id]/events`, `DELETE /api/maps/[id]/events/[eventId]`. All writes route through `src/lib/server/world-map-v3.ts` chokepoints. UI lands in Slice 1b PR 2.
- **Cross-user write-time defenses.** `validateEventPayload` rejects `transfer_region` payloads whose `region_id` belongs to a different map or whose `new_faction_id` belongs to another user. `validateAnchorStateOwnership` enforces the same invariant on anchor `state_jsonb.regions[]` — every region must live on the current map, every faction must be owned by the caller. Cross-user references no longer reach the DB; the renderer's lazy GC remains as a second line of defense.
- **Faction delete UX.** `DELETE /api/factions/[id]` returns 204 (consistent with anchor + event DELETEs). New `GET /api/factions/[id]/dependents` exposes the count of `transfer_region` events referencing the faction, so the UI can render "deleting will leave N events with ownership-unknown" before posting DELETE.
- **Anchor write-time conflict handling.** `createMapAnchor` + `updateMapAnchor` catch `(world_map_id, t_position)` UNIQUE violations and surface 409 (was opaque 500). PGlite/Drizzle wrap Postgres errors in `.cause`; the shared `isUniqueViolation` helper checks both levels.
- **`assertSourceEventIdIsEvent` enforcement at every event write.** `createMapEvent` runs the polymorphic-FK check before insert when `source_event_id` is supplied. Rejects non-Event entities and cross-user Event references. Pairs with the Vitest invariant shipped in v0.7.5.0.
- **3 reactive client stores** at `src/lib/features/map/{factions,map-anchors,map-events}-store.ts` consume the new endpoints with the same write-through pattern as the existing world-map store.
- **Hard list bounds.** GET endpoints for factions / anchors / events return `{rows, truncated}` with a 500-row cap. The truncated flag flips when a user has authored more than the cap; client stores log a console warn so the truncation isn't silent. Cursor pagination is a Slice 5+ replacement.
- **Malformed-JSON shim** (`src/lib/server/read-json.ts`). Every API handler that takes a JSON body routes through `readJson(event)`, which converts SyntaxError → 400 instead of bubbling to a 500.

### Infrastructure
- **Client bundle size budget** (1.2 MB gzipped). `size-limit` config covers `_app/immutable/**/*.js` and runs in CI after `npm run build`. Baseline today: 180 kB gzipped — well under cap. Slice 1b PR 2 lifts the bundle to ~600-700 kB once Pixi mounts.
- **Worker-side import guard test** at `tests/integration/worker-pixi-import-guard.test.ts`. Static-grep asserts `pixi.js` / `svelte-pixi` / `paper` are never imported from `src/lib/server/**`, any `+server.ts`, `+layout.server.ts`, or `hooks.server.ts`. Catches the accidental top-level import that would push the Workers bundle past Cloudflare's 1 MB compressed limit.

### Tests
- **22 PGlite-backed auth-isolation cases** (`tests/integration/auth-isolation-world-map-v3.test.ts`) pin the CLAUDE.md cross-user invariant on every new endpoint: User B cannot list / read / write / delete User A's factions, anchors, events. Cross-user payload defense, polymorphic-FK enforcement, anchor 409 collision paths (POST and PATCH), malformed-JSON 400, and the new anchor state ownership defense are all covered.

## [0.7.5.0] - 2026-05-23

### Added
- **Pure `projectState()` projection engine** at `src/lib/features/map/projection.ts`. Given a playhead `t`, a list of anchors, a list of events, and a user-scoped reference context, returns the canonical `RenderedState` for that frame. Same contract both renderers consume — Leaflet today, Pixi in Slice 1b. Slice 1 only interprets `transfer_region` events; other event kinds pass through inert so Slice 2 extends by adding cases, not by changing the signature.
- **Cross-user JSONB lazy-GC defense (Δ1a-C).** `src/lib/server/projection-context.ts` pre-fetches the user's allowed factions and regions, scoped through `world_maps.user_id` at the SQL layer. A malicious anchor payload referencing another user's `faction_id` cannot leak the foreign color into the rendered output — `projectState` drops any ref not present in the scoped allowed-sets and falls back to neutral. Two PGlite-backed integration tests pin the invariant.
- **Same-T ordering rule (Δ1a-D, CMT-5).** Anchor at T is "world state AT T"; events at exactly `anchor.tPosition` are excluded from the fold. Formula: `apply(events WHERE t_position > anchor.t AND t_position <= t)`. Tiebreak: `(t_position, created_at, id)`. Nine unit tests cover the rule (anchor exclusion, event tiebreak, anchor tiebreak, id tiebreak, neutral fallback).
- **Projection-engine parity fixtures (Δ1a-F).** Twelve `{inputs, expected RenderedState}` pairs covering empty / single region / many regions / variants / drill-down isolation / spotlight scope-agnostic / deleted faction / deleted region / cross-user GC / anchor+event-at-T / event sequence / foreign region_id. The Pixi-side parity check in Slice 1b lifts this list verbatim.
- **Recompute transaction atomicity test (Δ1a-E).** Wraps `recomputeAllIntervals` in `db.transaction` that throws after the cascade completes; asserts intervals + map_anchors + map_events all roll back together. Mirror image confirms they commit together on success.
- **`assertSourceEventIdIsEvent` invariant test (Δ1a-A).** Polymorphic FK `map_events.source_event_id → entities(type='Event')` enforcement: accepts Event entity, rejects non-Event (Location), rejects missing id, rejects cross-user Event via the scoped `WHERE userId=...` predicate.
- **`bump_updated_at` trigger coverage for `map_anchors` (Δ1a-B).** Extends `tests/integration/updated-at-trigger.test.ts` so UPDATE on a map_anchor row stamps `updated_at` without app-side intervention.

### Changed
- **`src/lib/components/apps/WorldMap.svelte` (1990 LOC) decomposed into `src/lib/features/map/` (16 files).** Zero behavior change — iron rule. New layout: `WorldMap.svelte` orchestrator + `MapStage.svelte` (Leaflet lifecycle) + `RegionLayer.svelte` + `PlacementLayer.svelte` + `MapToolbar.svelte` + `MapBreadcrumb.svelte` + 3 modals (Region/Variant/CreateMapOffer) + pure helpers (`projection.ts`, `region-popup.ts`, `scene-ranges.ts`, `variants.ts`, `leaflet-controller.ts`) + colocated `store.ts` and `types.ts`. Modal-shared CSS uses `:global()` so parent rules reach into children without duplication.
- **`src/lib/types/world-map.ts` and `src/lib/stores/world-map.ts` moved into `src/lib/features/map/`.** Renames preserve git history. Five consumer files (`LocationEditor`, `FocusedGraph`, `StoryGraph`, `routes/app/+page.svelte`, `tests/unit/world-map-variants.test.ts`) updated to the new import paths.
- **`accentColor` / `borderColor` promoted from plain `let` to `$state` in the orchestrator** so the post-mount `resolveCssColors` callback propagates resolved values into `RegionLayer` through the prop boundary. The original closure-captured pattern only worked when everything lived in the same component.

### Infrastructure
- **`pixi.js@8.18.1` and `svelte-pixi@8.0.1` adopted** as the Slice 1b Pixi+Svelte 5 substrate, per the Pre-Slice 0 spike findings.
- **`patch-package@^8.0.1` (devDep) + `postinstall: "patch-package"`** keep `patches/svelte-pixi+8.0.1.patch` applied locally. The patch fixes two upstream defects: `Application.svelte` never destroys the Pixi `Application` on unmount (leaks a WebGL context per cycle, browsers cap at ~16) and `Ticker.svelte` teardown crashes if the Pixi `Ticker` was destroyed externally (null linked-list pointer). Both spots wrap the destroy call in `try/catch`.
- **`scripts/verify-patches.ts` + CI hash check.** SHA-256 + sentinel-string check on both patched files. Wired into `.github/workflows/test.yml` and `.github/workflows/deploy.yml` after `npm ci` so a missing postinstall, a dropped patches entry, or a `svelte-pixi` version bump fails the build instead of silently regressing the leak.

## [0.7.4.0] - 2026-05-22

### Added
- **World Map v3 Slice 1a foundation.** Three new tables back the projection engine that lands in Slice 1b: `map_anchors` (author-placed keyframes, `(world_map_id, t_position)` unique, mutable with bump_updated_at trigger), `map_events` (typed delta operations between anchors, append-only, indexed on `(world_map_id, t_position)`), and `factions` (region-ownership grouping with direct `user_id`). `t_position` is `doublePrecision` so the `'-Infinity'::float8` sentinel works at the lower bound. Migration `drizzle/0012_world_map_v3_foundation.sql` seeds one initial anchor per existing `world_maps` row at `-Infinity` with `state_jsonb.regions[]` snapshotted from current `map_regions`. `world_maps.grid_*` and `audio_url` columns are deferred to Slices 3 and 7 respectively, when their features ship.
- **Cascade transaction wrappers.** `entities/[id]/+server.ts` PATCH and DELETE, and `entities/batch/+server.ts` POST, now wrap the full cascade in `db.transaction` so intervals, relationships, world-map variants, map-placements, and the new map_anchors / map_events end up either all in pre-state or all in post-state. Mid-cascade failures no longer leave intervals recomputed without the surrounding bookkeeping.
- **Act-relative anchor reprojection (CMT-7 option A).** Act reorders and Act deletes now reproject every map_anchor and map_event `t_position` by preserving the fractional offset within the Act. `snapshotActOrdering` captures the pre-reorder Act indices inside the same transaction so `floor(t_position)` maps back to the original Act and forward to its new index. `-Infinity` is invariant; anchors pointing into a deleted Act are left at their old `t_position` (accepted semantic drift, revisited at Slice 2 design).
- **`assertSourceEventIdIsEvent`** in `intervals/polymorphic-fk.ts` enforces the `map_events.source_event_id → entities(type='Event')` polymorphic FK invariant at the application layer. Wired through the `$lib/server/intervals.js` barrel for Slice 1b writers; the matching Vitest invariant test ships with U8.
- **Cross-user JOIN regression test** at `tests/integration/world-map-v3-recompute-cross-user.test.ts`. Two users with identical 3-Act stories, User A reorders an Act, the test asserts User B's anchors and events are untouched. Pulled forward from U8 because the CLAUDE.md invariant ("a missing JOIN is a cross-user data leak") is load-bearing.

### Security
- **Defense-in-depth scoping on the new recompute paths.** `recomputeMapAnchors` and `recomputeMapEvents` pre-collect the user's `worldMapId` set once and gate both the SELECT and the per-row UPDATE with `inArray(worldMapId, userMapIds)`. The previous shape JOINed on `worldMaps.userId` for the SELECT but relied on caller-side transaction wrapping to keep the UPDATE safe; the new shape makes scoping self-enforcing — a future caller that forgets the transaction or drops the JOIN still cannot touch another user's rows.

## [0.7.3.0] - 2026-05-22

### Security
- **Hardcoded auth fallback secret deleted.** `buildAuth` in `src/lib/server/auth.ts` no longer ships a fallback string when `BETTER_AUTH_SECRET` is missing in test mode. The previous fallback was publicly visible in the repo and was a session-forgery primitive on any prod where `BETWIXT_E2E_PGLITE=1` got misapplied as a runtime secret. `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are now required unconditionally; the E2E paths (Playwright, `dev:pglite`, unit tests) supply their own secrets.
- **`x-test-user-id` E2E bypass tree-shaken from production bundles.** Wrapped in `if (__E2E_BYPASS__) { ... }` where `__E2E_BYPASS__` is a Vite `define` evaluated at build time from `process.env.BETWIXT_E2E_PGLITE`. Rollup eliminates the branch from the production worker bundle entirely. A misapplied runtime secret cannot resurrect deleted code.
- **Session id/token randomized.** The bypass path now uses `crypto.randomUUID()` instead of fixed `'test-session'` / `'test-token'` strings — eliminates cross-user collision on downstream code that uses `session.token` as a cache key or audit log value.

### Changed
- **Deploy target documented as Cloudflare Workers (Static Assets).** DEPLOY.md rewritten to describe the Workers deploy path explicitly (Cloudflare Pages framing removed). New `.github/workflows/deploy.yml` runs `wrangler deploy` on push to `main` after CI gates pass; `BETWIXT_E2E_PGLITE: ''` is scoped at the job level for defense-in-depth.
- **Store `load()` functions fail loud on non-OK fetch.** `entities`, `intervals`, and `relationships` stores now throw with the response status + body when the API returns a non-OK status instead of silently parsing the error page as JSON. Three new Vitest regression tests cover the failure path.
- **Playwright upgraded** from 1.59.1 to 1.60.0 — fixes a hang in `npx playwright install` on Linux.

### Restructure (pre-Slice 1 burst)
- **Character feature carved into `src/lib/features/character/`.** Detail-pane Character editor surface (CharacterEditor, CharacterEditorBody, supporting modules) now lives under one feature folder. Renames preserve git history.
- **OS shell carved into `src/lib/os/`.** Window-manager surface (Taskbar, Dock, Palette, window-state stores, app catalog) consolidated under one folder. Companion refactors: `APP_CATALOG` table replaces dock metadata duplication, `patchWindow()` helper replaces 6 pure-patch mutators, `WINDOW_DEFAULTS` table replaces per-app size ternaries, taskbar height single-sourced, bare-app disjunction collapsed to a `Set` lookup, Palette filtered-list derivation consolidated, `deriveScope` exported for direct test use, shared `entityById` map in Taskbar picker.
- **Server intervals split into responsibility-keyed modules.** `src/lib/server/intervals.ts` carved into 5 sub-modules (writes, reads, recompute, validation, scene helpers); `validateFKTypes` + `assertNoOverlap` kept module-internal to enforce the polymorphic-FK invariants from the application layer.
- **Shared `errorMessage(res: Response)` helper extracted.** `src/lib/util/api-error-message.ts` now provides the SvelteKit `{ message: string }` JSON-or-text fallback used by three client stores (`intervals-store`, `map-placements`, `world-map`). Removes ~50 LOC of duplication; behavior unchanged.

### Data model
- **2026-05-20 audit cleanup migration (`drizzle/0011_data_model_cleanup.sql`).** Trims unused enum values from the `RelationshipType` and `EntityType` unions and pins them at the DB layer with `CHECK` constraints so a rolling-deploy stale Worker carrying old TS enum values cannot silently re-introduce them. Constraints use `DROP IF EXISTS` + `ADD CONSTRAINT` for idempotent re-runs. New invariant test suite covers the trimmed enum + CHECK constraint behavior.

### Fixed
- **Story Player anchor width drift corrected.** Anchor element width no longer accumulates layout drift when the window resizes during playback.
- **Intervals integration test no longer swallows real recompute failures.** The `recomputeAllIntervals` rollback-cascade test (`tests/integration/intervals-relationship-recompute.test.ts:108`) now asserts on the `forced rollback` message specifically via `await expect(...).rejects.toThrow('forced rollback')`. A bare `catch {}` previously could mask a real `recomputeAllIntervals` failure and let the post-rollback assertions green for the wrong reason.

### Tests
- **Phantom-Act bug guard** added at the PATCH-handler shape level — covers the bug class where a moved Scene resolves to a stale Act FK.
- **Cross-act Scene move** test asserts act-count remains correct after the move.
- **Defense-in-depth CHECK constraints** verified by the new data-model-cleanup invariant suite.

## [0.7.2.0] - 2026-05-21

### Changed
- **Graph feature carved into `src/lib/features/graph/`.** Step 2 of the pre-Slice-1 restructure burst (per `docs/plans/codebase-restructure-2026-05-20.md`). StoryGraph, FocusedGraph, GraphCanvas, Legend, plus seven graph helper modules now live under one feature folder. Renames preserved git history.
- **Timeline feature carved into `src/lib/features/timeline/`.** Step 3 of the burst. Timeline, ActsHeader, IntervalRow, IntervalBar, PlayheadOverlay, plus `timeline-helpers.ts` and the three timeline-axis stores (`intervals-store.ts`, `playhead-store.ts`, `filter-store.ts`) all colocated.
- **Pure helpers extracted from the graph monoliths.** New `scope.ts` (8 helpers: time/scope/ghost-mode projection) and `view-builders.ts` (4 helpers: node/edge view-model construction). ~200 LOC of byte-identical duplication between StoryGraph and FocusedGraph collapsed into shared helpers with 36 new pinning tests.
- **Pure helpers extracted from the timeline feature.** New `loaders.ts` (`refreshTimelineStores()`) and `auto-dismiss.ts` (`createAutoDismiss()`). Five sites in Timeline + ActsHeader now share the dual-store reload contract; both components share the auto-dismiss toast pattern.

### Fixed
- **Ghost trails no longer render on partial-bounds relationships.** Previously, a relationship with only `startPosition` OR only `endPosition` (but not both) would render with the misleading "past" ghost style when an endpoint was offstage — even when the relationship was still temporally active. Now skips ghost mode entirely for partial-bounds rels; fully-bounded and timeless rels are unchanged.
- **Scene creation now refreshes the intervals store.** Adding scenes to an act triggers a server-side `recomputeIntervalsForAct` cascade (because scene count `m` changes interval positions), but the client previously only reloaded entities. Interval bars showed stale positions until the next user action.
- **Auto-dismiss error toast no longer leaks setTimeout refs on component unmount.** Both Timeline and ActsHeader now cancel pending dismiss timers in `onDestroy`.
- **`reorderError` timer is cleared when a new error fires within the 4s dismiss window.** Previously, a stale timer from an older error could blank a newer message early.

### Removed
- **Dead helper `internalActBoundaryFractions`** from `timeline-helpers.ts` (the real boundary-fraction logic lives inline in `IntervalRow.svelte` because it needs scene boundaries + non-uniform `posToFrac` mapping). Four corresponding unit tests removed.

### Tests
- 30 new pinning tests (graph scope projection + view builders + auto-dismiss + refreshTimelineStores + computeOutOfScope orphan-Act + 2 classifyGhostMode boundary cases). Net: 886 passing (was 836 at baseline pre-burst, +50 across the burst).

### Documentation
- New TODOS entries under "Restructure follow-ups" capturing two latent risks the burst surfaced but didn't introduce: a server→features import boundary lint rule, and Act position-tie ordering divergence between server (`position, createdAt`) and client implementations.
- Doc comments on `getActs` (story-structure.ts) and `buildActIndexById` (scope.ts) explain why their Act-ordering logic intentionally diverges (null-position handling + tiebreak).

## [0.7.1.0] - 2026-05-20

### Added
- **World Map v2 — Step 4 (map placements).** Drop `Character`/`Artifact`/`Item`/`Door` entities onto a map at fractional coordinates. New `map_placements` table, `/api/map-placements` + `/api/map-placements/[id]` routes, `map-placements` store, and a `PlaceablesPalette` chip rail on the WorldMap. Click a chip to arm, then click the map to place. Markers render with entity-type color + tooltip showing name/type.
- **Three new placeable entity types: `Artifact`, `Item`, `Door`.** Added to the entity schema with their own colors and wired into the wiki, graph defaults, and relationship-color tables.
- **Inline Location creation from the WorldMap toolbar.** "+ New Location" input creates a Location and links it to the active map without leaving the canvas.
- **Inline placeable creation from PlaceablesPalette.** "+ Artifact" / "+ Item" / "+ Door" buttons mint a new entity with an `Untitled <Type>` placeholder and open the EntityDetail editor in edit mode with the name field selected.
- **Edit-mode-on-open signaling via `pendingEditMode` set.** Timeline's `+ Act` / `+ Event` and PlaceablesPalette's `+ <Type>` paths now open the new entity's editor directly in edit mode instead of read mode.
- **`scripts/dev-pglite.ts` local dev server.** Boots PGlite over a TCP socket, applies migrations, seeds the E2E user, then execs `vite dev` against it — mirrors the Playwright global-setup environment for parity. Run via `npm run dev:pglite`.

### Fixed
- **Draw-tool hint no longer covers PlaceablesPalette.** The "Use the draw tool to create regions…" hint moved from `bottom: 12px` to `top: 12px` on the map canvas so it stops sitting on top of the placeable chip rail.

### Tests
- 4 E2E specs for Timeline `+ Act` / `+ Event` edit-on-open and inline Location creation.
- Integration tests for the `map_placements` REST surface (auth, validation, cross-user isolation, polygon-FK invariants).

## [0.7.0.0] - 2026-05-14

### Added
- **World Map v2 — Step 2 (drill-down navigation).** Click a region whose linked Location has exactly one `part_of` child Location with a map → drill into that child's active variant. If the child has no map, a "Create a map for X?" affordance offers to create one inline. A breadcrumb bar above the toolbar shows the ancestor chain via `part_of`, each ancestor clickable to pop back up.
- **World Map v2 — Step 3 (map variants).** A single Location can now be depicted by multiple maps each scoped to a story-time range. The variant chip in the toolbar opens a modal with a Default-variant checkbox + four FK dropdowns (start act / start scene / end act / end scene). Variant resolution at render-time picks the variant whose `[start_position, end_position)` covers the playhead; default variant (all-NULL bounds) wins as fallback. Auto-select effects route deep-links through `resolveActiveVariant`.
- **`part_of` relationship kind** (Location → Location, child → parent). Wired through `relationship-colors`, `edge-policy`, and the StoryGraph create-form list. Single-parent invariant in v2; cycles rejected at write time.
- **LocationEditor "Part of" picker + Sublocations list.** Select the parent Location from a dropdown (filtered to non-descendants). Incoming children render as clickable chips that open the child's EntityDetail.
- **Duplicate-map endpoint** (`POST /api/maps/[id]/duplicate`) clones a map row + all its regions. Variant bounds are intentionally NOT carried over so the clone starts as a default variant; the UI prompts for a new range. Toolbar "⧉" button invokes it and switches to the clone.
- **DB-level integrity for variants (M9).** Migration `0009_world_map_v2_variants_and_part_of.sql` adds:
  - `btree_gist` extension (PGlite ships it as a contrib bundle; test harness now loads it).
  - `world_maps_variant_no_overlap` EXCLUDE constraint (DEFERRABLE INITIALLY DEFERRED so M11 reorder cascades can transiently overlap inside a transaction).
  - `world_maps_variant_position_order` CHECK (`start_position < end_position` when both set).
  - `world_maps_one_default_per_location` partial-unique index.
- **M11 reorder cascade extension.** `recomputeAllIntervals` now propagates into `recomputeWorldMapVariantsAll` (lazy-imported to break the world-maps → intervals cycle) so Act-position changes atomically refresh derived variant positions.
- **18 integration tests** covering EXCLUDE / partial-unique / CHECK violations, polymorphic-FK invariants (M10), M11 reorder cascade, `part_of` validation (type / cycle / single-parent), and duplicate-map clone semantics.

### Changed
- `WorldMap.svelte` auto-select effects (initial + deep-link reactive) now resolve via `resolveActiveVariant` rather than first-match — when a Location has multiple variants, the one covering the current playhead wins.
- POST/PATCH `/api/maps` accept the four variant FKs; constraint-code translation now unwraps Drizzle's `cause` field so EXCLUDE/CHECK/partial-unique violations return 4xx with helpful messages instead of raw 500s.

## [0.6.0.0] - 2026-05-14

### Added
- **World Map v2 groundwork.** Maps can now be anchored to a Location entity. The `world_maps` table gains `location_id` (FK to entities, `ON DELETE SET NULL`, indexed) and `location_inactive_at` (records when the anchor was cleared, either by the user unlinking or by the linked Location being deleted). Polymorphic-FK contract — `location_id` must reference an entity with `type='Location'` — is enforced at the write layer (`assertLocationIdIsLocation`) and by a Vitest invariant test.
- **Linked-location picker on the WorldMap toolbar.** Pick which Location a map depicts; pick `(no linked location)` to unlink. Persists per-map. Lays the foundation for v2 drill-down, variants, and spotlight cycling.
- **"Maps" section in the Location editor.** When a Location has no anchored map, a "+ Create a map for this Location" button creates one and opens it. When at least one map is anchored, an "Open map(s)" button jumps straight to it in the WorldMap window.
- **"Open map" context-menu action** in Story Graph and Focused Graph for Location nodes that have an anchored map — right-click → Open map → WorldMap window opens pre-switched to that location's map.

### Changed
- The WorldMap deep-link `entityId` effect now prefers `worldMaps.location_id === entityId` over the legacy region-link match, making the explicit Location anchor the primary deep-link target while keeping the region fallback alive for maps that haven't been linked yet.
- Leaflet edit toolbar removed from `WorldMap.svelte`. Region editing moves into v2's dedicated editor surface; the always-on toolbar was dead UI on the v2 path.

## [0.5.0.2] - 2026-05-13

### Added
- **Shared delete confirmation dialog** (`DeleteConfirmDialog`) used by both Story Graph and World Map. One backdrop, one modal, one keyboard handler, one styling pass.
- **Per-entity-type colors** in the Wiki sidebar dividers and Palette section headers — Character (amber), Location (forest green), Event (magenta), Scene (sky blue), Act (deep violet), Note (warm grey). Reuses the existing `--color-type-*` tokens already in use by Story Graph nodes, so the palette now agrees across all three surfaces.
- **`src/lib/entity-type-colors.ts`** — single source of truth for "what color represents this entity type" across the app. Groundwork for a future Settings-app PR that will let users customize the palette per preferences.

### Changed
- World Map rename pencil now uses the same inline SVG as `InlineEdit`, removing the visual inconsistency with the rest of the app.
- World Map toolbar drops the duplicate map-name label — the dropdown already shows the active name, so the second label was redundant.
- Story Graph migrated from its inline delete modal to the shared `DeleteConfirmDialog`, removing ~116 lines of dead CSS.

### Fixed
- Map images now render reliably on first upload — Leaflet `imageOverlay` and region layers are now `$state`-tracked so Svelte 5 reactivity drives lifecycle. Draw and zoom controls reactively gate on `hasImage` and tear down together when the image is removed.
- Switching maps after deleting one no longer leaves a blank background — the `{:else if activeMap}` gate now matches the actual lifecycle.
- Delete confirmation dialog now floats above the map image — bumped z-index above Leaflet panes (which reach ~700) and the World Map toolbar (1000).
- R2 image reads return correct `Content-Type` and `Cache-Control` — switched from `writeHttpMetadata()` to direct `httpMetadata` POJO access on Cloudflare's R2 binding.
- Graph edge dimming uses `opacity` rather than `stroke-opacity` so it composes correctly with arrow markers.

### Removed
- Leaflet-Draw edit/delete toolbar buttons (pencil + trash) — they were perpetually greyed out because saved regions were added directly to the map rather than the working `FeatureGroup` the toolbar watches. Polygon-draw button stays; region edit/delete still works via the popup. Reshape-polygon will return cleanly in the World Map v2 design (see `~/.gstack/projects/betwixt-and-between/steve-feat-app-qol-design-20260513-175833.md`).

## [0.5.0.1] - 2026-05-13

### Changed
- Extract shared story-structure derivations (`getActs`, `getScenesByActId`, `getSceneBoundaries`, `getSpotlightLabel`, `stepForwardScene`, `stepBackScene`) into `src/lib/story-structure.ts` so `Timeline` and `PlayerDock` no longer carry byte-identical copies of the same logic.

### Added
- Unit tests for `story-structure.ts` covering act sort/tiebreaker, scene grouping, boundary math, spotlight-label edge cases, and forward/back scene stepping.

## [0.5.0.0] - 2026-05-12

### Added
- **Story Player ("Spotlight")** — a standalone floating window that plays the timeline scene-by-scene. Compact transport bar with play/pause, step back/forward, and a scrub slider; an active act/scene label sits above the controls with a tooltip for truncated text.
- **Pin-to-top toggle** on the Story Player window so it can stay above other windows during playback.
- **Taskbar grouping** — the Spotlight entry is attached to the Timeline dock group with hover-focus behavior.
- **Window infrastructure** — `compact` mode, `alwaysOnTop` + `PIN_Z_BASE` z-ordering, and a `togglePin` store action; a new `story-player` AppId with a default 280×72 spawn centered above the taskbar.
- **E2E coverage** — four Playwright specs in `tests/e2e/v2-story-player.spec.ts` for toggle, play, step, and scrub-while-playing.

### Changed
- Timeline's Spotlight button now toggles the standalone Story Player window instead of embedding an inline dock inside Timeline.
- `playhead` store: speed and step semantics refactored to support the standalone window.

## [0.4.0.0] - 2026-05-08

### Added
- **Multi-user authentication** — Better-Auth wired with magic-link and Google OAuth. New `/auth/login` page, `/api/auth/*` catch-all, `/app/*` redirect guard. Sessions cookie-cached for 5 min.
- **Per-request auth factory** (`src/lib/server/auth.ts`) — `buildAuth(db, env)` builds a request-scoped Better-Auth instance from the explicit env object passed by the hook. Throws on missing `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` outside test mode (no silent dev-secret fallback). `trustedOrigins` derived from `BETTER_AUTH_URL`.
- **userId scoping across the entire API** — every handler reads `getUserId(event)` and filters/stamps userId on every SELECT/UPDATE/DELETE/INSERT. Wrong-owner returns 404 (no existence leak), unauthenticated returns 401. Cascade queries (insert-between Act bumps, Act-delete rescoping, position-bump, moveSceneToAct) all scope by userId so one user's reorder can't shift another's data.
- **`intervals.ts` userId threading** — `writeInterval`, `updateInterval`, `recomputeAllIntervals`, `recomputeIntervalsForAct`, `moveSceneToAct`, `splitInterval`, `assertNoOverlap`, `validateFKTypes`, `assertEntityType`, `actIndexOf`, `sceneIndexOf`, `computeIntervalPositions`, `buildRecomputeCache`, `intervalsForEntity`, `intervalsForEntities`, `entitiesPresentAt`, `entitiesPresentInActIndex`, `intervalsTouchingScene`, `resolveRelationshipBounds`, `recomputeRelationshipBoundsAll` all take userId and scope every internal query.
- **36 multi-tenant isolation integration tests** across 5 files: entities (incl. cascade-scoping + user FK cascade), relationships, intervals (incl. moveSceneToAct), maps + regions (scoped via JOIN on `worldMaps.userId`), and unauthenticated 401 coverage.
- **Production magic-link email** path — `sendMagicLink` calls Resend when `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set; falls back to `console.log` in dev/test.
- **E2E auth bypass** for the existing 27 specs — when `BETWIXT_E2E_PGLITE=1`, the hook honors an `x-test-user-id` header and skips Better-Auth's session lookup. New `tests/e2e/helpers/auth.ts` plus `E2E_USER_ID`/`E2E_USER_HEADERS` constants in `pglite-config.ts`. Default test user seeded once in global-setup.
- **DEPLOY.md** — Cloudflare Workers deploy guide: Neon prod branch setup, secret list (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, Google OAuth, Resend), GitHub integration, magic-link email gate, rollback procedure.
- **Weekly database backup workflow** (`.github/workflows/backup.yml`) — Sunday 06:00 UTC: `pg_dump` → `gpg` encrypt → `rclone` to Backblaze B2.
- Migration `0004_auth_tables.sql` — Better-Auth `user`, `session`, `account`, `verification` tables.
- Migration `0005_multi_user_columns.sql` — nullable `userId` on `entities`, `relationships`, `intervals`, `canvasPositions`, `windowCanvasState`, `worldMaps`, with btree indexes.

### Changed
- **Hook owns the db lifecycle** — `hooks.server.ts` opens a single `getDb(env)` per request, attaches `db`/`auth`/`user`/`session` to `event.locals`, closes the Neon Pool in `finally`. Routes drop their `withDb(platform?.env, ...)` wrapper and read `event.locals.db` directly. Reverts PR #36's per-route wrapping in favor of a single Pool per request.
- `App.Locals` gains `db: RuntimeDb` and `auth: Auth` fields for hook-attached resources.
- `closeDb` exported from `src/lib/server/db/index.ts` so the hook can drive lifecycle.
- Hook resolves env in priority order: `process.env` → `$env/dynamic/private` → `event.platform?.env`. Platform bindings win when present; the fallback chain handles vite preview / E2E test mode where `$env/dynamic/private` doesn't always surface webServer-injected vars.
- `tests/helpers/authed-request.ts` — `setupAuth(db)` now injects `locals.db` automatically. `mkUnauthedEvent(db, ...)` accepts the db so handlers reach `getUserId` before any DB call.
- `tests/helpers/test-db.ts` — `seedActs(db, userId?)` accepts an optional userId. Existing `seedTestUser(db, overrides?)` exposed for direct use in tests.
- Vitest `hookTimeout` bumped to 30s in unit + integration projects — PGlite WASM boot + 5 migrations under parallel worker load exceeds the 10s default.
- `playwright.config.ts.webServer.env` adds `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` so the preview boots cleanly under the new secret guards.

### Fixed
- Cross-user `relationships` POST now verifies both `fromId` and `toId` belong to the caller via scoped entity lookup. Cross-user FKs surface as 400 "fromId entity not found".
- `entity-aliases` and `mapRegions` (which lack a direct `userId` column) are scoped via JOIN on the parent's userId — `worldMaps.userId` for regions, `entities.userId` for aliases.
- `userId` propagated through `intervals.ts` header docstring so the documented signatures match the post-S5' code.

### Resolved during PR review
- **Codex P1: hardcoded `localhost:5173` fallback in `auth-client.ts`** — would silently route prod browser auth to a non-existent local endpoint when `VITE_BETTER_AUTH_URL` is unset. Replaced with `window.location.origin` runtime resolution.
- **Codex P2: Google button visibility checked `VITE_GOOGLE_CLIENT_ID`** while server-side `buildAuth` reads `GOOGLE_CLIENT_ID`. Two different env vars meant setting only the documented `GOOGLE_CLIENT_ID` enabled the backend but hid the button. Replaced with a server-driven `googleEnabled` flag passed via `+page.server.ts` load — the page mirrors the server's actual config.
- **Codex P1: missing userId backfill** — added `drizzle/backfill-multi-user.sql.example` template + DEPLOY.md section covering migrating environments with existing single-tenant data. v0.4.0.0 itself ships pre-launch (no production data) so no backfill is needed for the launch deploy.
- **Resolved E2E "relation 'user' does not exist" issue** flagged in the original PR. Root cause: `adapter-cloudflare`'s vite-preview polyfill populates `event.platform.env` from `.env` / `.dev.vars`, which shadowed Playwright's `webServer.env` PGlite URL injection. Hook now skips the platform polyfill when `BETWIXT_E2E_PGLITE=1`. Full E2E suite now runs against the test PGlite as intended.

## [0.3.0.0] - 2026-05-06

### Added
- **Scroll Theatre landing page** — new `/` route with hero section, 4 alternating scroll-theatre sections, and CTA. MiniDesktop visualization stays centered (sticky) while copy scrolls past on desktop; linear stack on mobile.
- **Route migration** — desktop app moved from `/` to `/app`. All existing e2e tests updated.
- Pure CSS presentation components: MiniWindow, MiniGraph, MiniTimeline, MiniMap, MiniDesktop — no real data or API calls.
- SEO metadata (title, meta description), skip-to-content link, reduced-motion media query support.

### Changed
- `overflow: hidden` scoped from `html, body` to `.app-shell` so the landing page can scroll.

## [0.2.0] - 2026-05-06

### Added
- CharacterEditorBody extracted from CharacterEditor as a standalone component for use inside EntityDetail, enabling character feature parity without duplicating the full editor.
- Pending-commit registry (`src/lib/util/pending-commit.ts`) drains in-flight EditableField drafts before navigation, preventing PATCH-against-wrong-entity races when clicking [[Name]] chips mid-edit.
- EditableField exposes a `commitNow` handle registered with the pending-commit system so navigation waits for unsaved drafts.
- Universal Body field in EntityDetail — every non-Note entity type (Character, Act, Event, Scene, Location) now has an editable synopsis/description body field.
- NoteWikiEditor deleted; its responsibilities moved to the unified EntityDetail body field.
- In-window chip navigation via `wiki-nav` Svelte context. Clicking an EntityLink chip inside the Wiki window swaps the content pane instead of spawning a new window (Wikipedia-style navigation).
- Edit-mode preview pane renders resolved `[[Name]]` markers as colored chips below the textarea, showing exactly which links will resolve.
- `linkPreviewEnabled` preference in Settings (Editor section) lets users toggle the preview pane globally.
- Editor section added to the Settings popover with the link preview toggle.
- LocationEditor now shows read-only linked-entity chips (characters, events, scenes referencing this location).
- Wiki window dimensions doubled to 1280x960 (width doubled twice: 320 → 640 → 1280).
- E2E test suite for slice 7 features: body field editing, in-window navigation, preview pane rendering, Settings toggle.
- **World Map app** — full rewrite from flat card-list to Leaflet-based interactive bitmap map. Pan, zoom, and draw polygon regions over an imported map image.
- Schema: `world_maps` and `map_regions` tables with migration (`drizzle/0003_world_maps.sql`), indexes, and `bump_updated_at` triggers.
- API routes for map CRUD (`/api/maps`, `/api/maps/[id]`), region CRUD (`/api/maps/[id]/regions`, `/api/maps/[id]/regions/[rid]`), and bitmap upload (`/api/maps/[id]/upload-image`).
- Bitmap import: upload JPG/PNG/WebP (max 5 MB), header-only dimension parsing, deterministic filenames, static file serving.
- Polygon drawing via `leaflet-draw` with validation: minimum 3 vertices, max 500, vertex type/finiteness checks, self-intersection rejection (`isSelfIntersecting` utility in `src/lib/server/validation.ts`).
- Region-to-Location linking: each region optionally links to a Location entity with a color picker.
- Scope-driven glow/dim: regions linked to in-scope locations render with accent stroke and higher opacity; out-of-scope regions dim. Driven by the existing `$isInScope` store.
- Multi-map switcher dropdown to create and switch between maps within the World Map window.
- `world-map` store (`src/lib/stores/world-map.ts`) with optimistic delete and rollback pattern.
- World Map window opens at 1024×720 in bare mode (no padding) for full-bleed Leaflet rendering.
- 35 integration tests covering map CRUD, region CRUD, cascade delete, polygon validation, upload-image validation, and region PATCH edge cases.
- 7 unit tests for `isSelfIntersecting` covering degenerate, triangle, rectangle, pentagon, bowtie, crossing, and L-shape polygons.

### Fixed
- CharacterEditorBody scrolls internally instead of scrolling the entire Wiki sidebar.
- Character "Notes" textarea renamed to "Timeline snippet" to avoid confusion with the Notes section.
- "Click Edit to modify" hint, redundant "Body" label, and view-mode rename pencil removed from notes.
- `commitNow` closure captures draft at call time to close the race where draft changes between dirty check and PATCH execution.
- ENTITY_APP routing for Character and Location flipped from popout editors to unified EntityDetail.
- Upload endpoint: deterministic filenames instead of user-supplied names (path traversal prevention), file extension validation, MIME type allowlist.
- Polygon validation: added 500-vertex cap and per-vertex `[number, number]` type/finiteness checks in both create and update endpoints.

### Changed
- EntityDetail now renders Character, Location, Act, Event, and Scene entities with full editor shells.

## [0.1.5] - 2026-05-05

### Added
- Wiki app rebuilt as an alphabetical entity browser — sidebar groups every entity (except Notes) by type with faint dividers, search input, and toggle pills to filter visible types. Picking a sidebar entry mounts the unified entity editor inline in the Wiki window.
- Cross-entity hyperlinks resolve in body fields — type `[[Aragorn]]` in any synopsis/description/note body and the resolver renders a clickable chip that navigates to that entity. Unknown names render with a subtle grey strikethrough so writers can spot orphaned references.
- Right-click a Wiki sidebar entry for "Open focused graph" (loads that entity in a Focused Graph window) and "Open focused timeline" (focuses the Timeline app on that entity, dimming non-matching rows). Driven by a new `timelineFilter` store other surfaces can write to.
- Wiki sidebar dims out-of-scope entries when the playhead moves — entries whose intervals (or whose linked entities' intervals) don't contain the current playhead position fade to 0.4 opacity. Hovering a dimmed entry lifts it to full opacity for readability.
- Notes-as-sections — every non-Note entity gets a NOTES section in its detail view with collapsible disclosures per attached note and a "+ Add note" chip. Notes are attached via the new `note_of` relationship type so a single note can be threaded through any other entity.
- EntityDetail now renders Character and Note entities (basic editor shells with description/role/color and body, respectively). The full CharacterEditor parity (icon picker, relationship sections) follows in the next branch before window routing flips.

### Changed
- Note entities now open in the unified EntityDetail surface (`ENTITY_APP[Note]: 'wiki' → 'entity-detail'`). Previously, opening a Note reused the Wiki app's editor; that role moved to NoteWikiEditor inside EntityDetail so the Wiki window can become the entity browser.

## [0.1.4] - 2026-05-05

### Added
- Location editor mounts inside EntityDetail — opening a Location entity from a panel/window that uses EntityDetail now shows a real Synopsis + Color editor instead of the "lives in its dedicated app" stub. Phase 1 wiki-location-branch slice; relationship sections (located_at, takes_place_at) follow in the upcoming wiki-rework branch.

## [0.1.3] - 2026-05-05

### Added
- Preferences store foundation (`src/lib/stores/preferences.ts`) — the per-user persistent root that future Settings, hotkeys, and entity-default features will subscribe to. Pre-deploy: localStorage-backed; post-deploy: will sync to a server-side `users.preferences jsonb` column on login.
- Schema-version migration machinery with downgrade protection — opening an old build of the app on a localStorage payload from a newer build now refuses to load (clear "Update the app" message) instead of silently overwriting your data.
- Defensive load path against malformed JSON, prototype-pollution attempts (`__proto__` / `constructor` / `prototype` injection in localStorage), throwing storage adapters, throwing migrations, and migrations that return non-objects — every failure mode falls back to defaults rather than crashing the app.
- Types organized under a new `src/lib/types/` submodule directory (per-domain files re-exported from `index.ts`) so future parallel feature branches can add their own type files without colliding on a single shared file.
- Planning artifacts under `docs/plans/`: feature-roadmap design doc covering Wiki rework / World Map / Notes app / T8b deploy with parallel-branch sequencing, the eng-review test plan, and design specs for six upcoming UI surfaces (Settings, Notes, Wiki rework, World Map, Cmd-K, Story Player).
- Phase 6 of `TODOS.md` (T9–T16) capturing deferred enhancements surfaced during the office-hours / eng-review / design-review pipeline (UUID link fallback, hex-size immutability trigger, pgcrypto encryption option, Cmd-K body indexing, etc.).

## [0.1.2] - 2026-05-04

### Added
- E2E tests for v0.1.1 QoL features: palette search, palette collapse toggle, characters section collapse, entity detail cancel button, and spotlight position label
- Sentry error tracking integration (client + server)

### Fixed
- Build failure caused by Sentry `instrumentation.server.ts` incompatibility with `adapter-auto` — switched to `adapter-node`

## [0.1.1] - 2026-05-04

### Added
- **Palette search**: filter characters and events by name from the timeline sidebar
- **Collapsible palette**: hide the entire palette to give the timeline tracks full width; collapse just the Characters section to focus on events
- **Spotlight position label**: shows the current Act / Scene name instead of a raw decimal value while scrubbing
- **Cancel button** in Act/Event/Scene editors: discards in-flight field edits without committing
- **Bar tooltip portal**: hover tooltips on interval bars now escape the timeline's overflow clipping and include the entity's note snippet

### Changed
- `firstLineSnippet` no longer truncates at 30 chars — bar tooltips now show the full first line with proper wrapping
- Timeline no longer renders an inline side panel for selected entities; clicks always open a popout window (simpler architecture)

### Fixed
- Edit / Done button in entity editors no longer auto-resets to view mode when other windows are clicked (Window.svelte focus update was triggering a spurious `$effect` re-run; explicit prev-value guard added)

## [0.1.0] - 2026-04-25

### Added
- **Timeline redesign**: horizontal layout with acts as column headers — drag-and-drop event assignment to plot/world tracks, per-character rows with color-coded bars, resizable act columns and track rows
- **Wiki redesign**: two-panel Notes app — sidebar with note list, search, and new note button; inline title editing; Markdown edit/preview toggle with auto-save
- **InlineEdit component**: pencil-icon-reveal inline text editing used across CharacterEditor, Wiki, and WorldMap
- **Window maximize**: green maximize button gives full-viewport overlay; drag and resize disabled while maximized
- WorldMap location names now editable via InlineEdit
- StoryGraph windows now open independent instances (each open call creates a new window)
- Timeline and StoryGraph windows open at wider default width (640px)
- Window spawn position uses continuous offset with wraparound instead of fixed step

### Fixed
- Timeline events with no relationship label now correctly appear in the plot track
- Window focus now triggers on `mousedown` so drag starts with the window already focused

### Changed
- CharacterEditor: character name input is always visible (removed show/hide toggle)
- Window default sizes tuned per app type (timeline/story-graph: 640×500, others: 320×480)
- E2E test suite updated for new UI patterns (Wiki sidebar, Timeline horizontal layout, CharacterEditor always-visible input)
- CLAUDE.md: added development guidelines and skill routing rules

## [0.0.2] - 2026-04-22

### Added
- API test suite (`e2e/api.spec.ts`): 28 HTTP-level tests covering the full Entities, Relationships, and Canvas Positions APIs — CRUD, validation, error cases, ordering, and ghost-ID rejection
- Feature window E2E tests (`e2e/features.spec.ts`): 13 browser-level tests covering Wiki (create/edit/preview/search/navigate), Timeline (create/expand/linked chips/event bullets), and World Map (create/linked chips/multi-card) feature windows

### Changed
- Playwright config now runs tests with `workers: 1` to serialize execution and prevent SQLite write races between test files
