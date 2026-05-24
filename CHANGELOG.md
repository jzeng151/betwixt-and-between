# Changelog

All notable changes to this project will be documented in this file.

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
