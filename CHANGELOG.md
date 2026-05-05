# Changelog

All notable changes to this project will be documented in this file.

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
