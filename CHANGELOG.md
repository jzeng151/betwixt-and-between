# Changelog

All notable changes to this project will be documented in this file.

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
