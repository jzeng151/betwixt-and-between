# Plan: Inline Location creation (now) + Places/Trove/Ctrl+K (deferred)

Status: REVISED — scope reduced after adversarial review
Date: 2026-05-18
Branch: feat/world-map-v2-step-4 (proposed branch for implementation: TBD)
Predecessor: `~/.gstack/projects/jzeng151-betwixt-and-between/steve-feat-app-qol-design-20260513-175833.md` (map v2 design, steps 1-7)
Mockups: `~/.gstack/projects/jzeng151-betwixt-and-between/designs/places-trove-palette-20260517/mockups.html` (preserved as reference for the deferred work)

## TL;DR

The original plan proposed two new dock apps (Places, Trove) + a global Ctrl+K palette to solve "no UI creates Locations." Adversarial review (in-session, codex, planning-partner) converged: the plan is overscoped for the current Step-4 settle period, several decisions reference APIs that don't exist, and Trove's premise (embed existing editor bodies for Artifact/Item/Door) is broken — those editor bodies don't exist yet.

**Decision (2026-05-18):** ship the minimum that solves the stated problem now. Defer Places/Trove/Ctrl+K until after map v2 Step 7 ships, when real usage data informs the right shape.

This plan now has two parts:
- **Part 1 — Ship now (~5h, 1 PR).** Three small surfaces that fix the chicken-and-egg.
- **Part 2 — Deferred work.** Full context preserved for future revisit: original design, what was learned, what's broken, what to reconsider.

---

# Part 1 — Ship now (minimum path)

## Problem (still the same)

1. **Locations cannot be created from anywhere in the UI.** Wiki lists them, WorldMap region form links to existing ones, but no surface mints a new Location. Chicken-and-egg blocker for the entire map v2 flow.
2. **PlaceablesPalette silently creates "New Artifact" / "New Item" / "New Door" rows.** Bad UX; user explicitly flagged this.

## Tasks

### T1 — PlaceablesPalette: `+ Artifact / + Item / + Door` opens the editor

Files: `src/lib/components/PlaceablesPalette.svelte`

Current behavior (`PlaceablesPalette.svelte:41-53`): clicking `+ Artifact` calls `entities.createEntity('Artifact', 'New Artifact')` and silently arms. Row appears across the app named `New Artifact` until the user opens it from somewhere and renames.

Change:
```ts
async function createNew(type: 'Artifact' | 'Item' | 'Door') {
  if (busy) return;
  busy = true;
  createError = '';
  try {
    const created = await entities.createEntity(type, `Untitled ${type}`);
    // Open the editor AND arm the chip. User can either type a name and
    // close, or close as-is and place — placement uses the created id either way.
    windowStore.open('entity-detail', created.id);
    onArm(created.id);
  } catch (err) {
    createError = err instanceof Error ? err.message : String(err);
  } finally {
    busy = false;
  }
}
```

`Untitled <Type>` is the placeholder name. Editor mounts focused with text selected so the first keystroke replaces it (covered by EntityDetail's existing `forceEditing` on InlineEdit at `EntityDetail.svelte:238`).

**Caveat surfaced by codex review:** `EntityDetail` falls through to a stub at `EntityDetail.svelte:259-261` for Artifact/Item/Door — no per-type editor body exists. The editor shows InlineEdit name + generic Body field + Notes. **Acceptable for now** because (a) the user's complaint was about silent creation, not about rich Artifact editing, and (b) the generic Body field is functional. A proper per-type editor body is queued under Part 2.

Effort: 1-2h human / ~15min CC.

### T2 — `+ New Location` button in the WorldMap location picker

Files: `src/lib/components/apps/WorldMap.svelte` (around `WorldMap.svelte:1047-1058`)

Current behavior: the map toolbar has a `<select>` that links the active map to an existing Location. There is no inline create.

Change: add a small `+` button next to the picker that opens an inline mini-form (name field + Save / Cancel) or prompts via a simple inline input. On save:
1. `entities.createEntity('Location', name)`
2. `worldMapStore.updateMap(activeMapId, { locationId: created.id })`

This is the primary entry point for "I just imported a map image; tell the app what place it depicts." Solves the chicken-and-egg at the natural moment of need.

Effort: ~2h human / ~20min CC.

### T3 — `+ New Location` button in the region form's Linked Location dropdown

Files: `src/lib/components/apps/WorldMap.svelte` (around `WorldMap.svelte:1117-1124`)

Current behavior: drawing a polygon opens a modal with a `<select>` of existing Locations. If the Location doesn't exist yet, you cannot proceed without closing the modal, going... nowhere (there's no other surface), and coming back. Today's workflow is broken.

Change: add a `+ New` option at the top of the dropdown OR a small `+` next to the select. Selecting it reveals an inline name input. On save:
1. `entities.createEntity('Location', name)`
2. Set `regionFormLocationId = created.id`
3. User continues with color picker + scene scoping as normal.

Effort: ~1h human / ~10min CC.

## What about Ctrl+K?

Not in Part 1. The original plan tied Ctrl+K to first-run UX ("Press Ctrl+K to begin"). Without Places/Trove, Ctrl+K's create actions wouldn't have anywhere coherent to land. Defer fully to Part 2. The existing no-op handler at `WindowManager.svelte:47-49` stays as-is.

## Tests for Part 1

| File | Layer | Covers |
|---|---|---|
| `tests/integration/inline-location-create.test.ts` | Integration | T2 + T3: creating a Location from the WorldMap toolbar picker links it to the active map; creating from the region form sets `regionFormLocationId` correctly. Uses the existing PGlite test harness. |
| `tests/e2e/placeables-palette-create.spec.ts` | E2E | **CRITICAL REGRESSION** for T1: WorldMap → "+ Artifact" → entity-detail opens with `Untitled Artifact` name selected AND chip armed; close editor without typing → chip still armed; click map → placement created. |

Two test files instead of the original eight. Sufficient for the reduced scope.

## Success criteria for Part 1

- A user with a fresh DB can: open WorldMap → create a map → upload an image → `+ New Location` in the toolbar → place is now linked. No dead ends.
- Drawing a polygon for a new sublocation that doesn't exist yet works inline — no need to leave the form.
- PlaceablesPalette no longer creates `New Artifact` rows. Editor opens. Placeholder name is `Untitled Artifact`, text selected.

## Build order

T1 (independent) → T2 (independent) → T3 (depends on no prior work). Can ship in any order; T1 is the fastest. All three together fit one PR comfortably.

---

# Part 2 — Deferred work (Places + Trove + Ctrl+K command palette)

**Status: DEFERRED until after map v2 Step 7 ships.**

**Why deferred:** adversarial review (codex + planning-partner + in-session) converged on three independent reasons:
1. Plan was overscoped for the Step-4 settle period (25h, 8 files, 8 test specs to fix a 5h problem).
2. Multiple decisions referenced APIs and editor surfaces that don't exist (B1-B6 below).
3. Trying to build authoring surfaces for Artifact/Item/Door before Step 6 (EventChains) lands means re-doing them once chain authoring forces the shape.

**Re-decision date:** when map v2 Step 7 (spotlight cycling) ships, revisit this plan with real usage data from Steps 5 and 6.

## Original proposal (preserved for context)

Three surfaces:
1. **Places app** — new dock entry (🏰). Hierarchy tree (from `part_of`) sidebar + connections-first editor pane + "Open map →" deep-link into WorldMap.
2. **Trove app** — new dock entry (🏺). List with type tabs (All / Artifacts / Items / Doors) + entity editor pane + Placements section.
3. **Ctrl+K command palette** — global keystroke; fuzzy "New {Type}: {name}" creates + "Open {entity}" jumps.

Mockups remain at `~/.gstack/projects/jzeng151-betwixt-and-between/designs/places-trove-palette-20260517/mockups.html`.

## Verified breakages in the original plan (must be fixed before any future revival)

**B1. The success-path E2E is impossible.** The plan's success criterion "<90s empty DB → placed Artifact" cannot run because `WorldMap.svelte:1085` only renders `PlaceablesPalette` when `hasImage && activeMap?.locationId`. Creating a Location does not create a map or upload an image. The E2E would fail at the placement step.

**B2. `windowStore.open` does not accept the API shape the plan assumed.** Multiple decisions wrote `windowStore.open('world-map', { entityId: location.id })`. Actual signature at `windows.ts:84` is `open(appId: AppId, entityId: string | null = null)`. The object form does not exist. Either every deep-link decision needs rewriting or `windowStore` needs API extension.

**B3. D8 "embed existing editor bodies" assumes editors that don't exist.** Verified at `EntityDetail.svelte:245-266`: dispatch covers Act, Event, Scene, Location, Character, Note, then falls through to a stub for Artifact/Item/Door. **The Trove mockup's per-type sections ("Carried by", "Active during", "Used in chains", "Placements") have no backing editor body code.** Reviving Places/Trove requires building these editor bodies first (~15h of additional scope).

**B4. Two-window guard misses Wiki's duplicate-editor case.** `findOpenEditorFor()` only inspects `windowStore` windows (`windows.ts:304`). Wiki embeds `EntityDetail` with local `selectedId` (`Wiki.svelte:236`), not via windowStore. The proposed guard solves a narrower case than the duplicate-editor problem the app already has.

**B5. D10's ad-hoc fetch in Trove has new bugs.** No abort-controller (stale responses from previous selections), no `encodeURIComponent`, no invalidation when WorldMap mutates placements. Either key `mapPlacements` by filter properly, or accept "snapshot, refresh button" UX.

**B6. Trove's "+ Add placement" has no target.** An Artifact can have 0, 1, or N placements across maps. There's no single `locationId` to hand off. D5 has no answer.

## Other findings worth carrying forward

**A11Y for Ctrl+K:** plan never specified focus trap, restored focus on close, `role="dialog"`, `aria-modal`, `aria-activedescendant`, scroll-into-view on selection. Non-trivial work.

**i18n:** D4's ranking heuristic baked English keywords ("new") and English type names into the parser. If i18n is ever in scope, command parsing should be action-first UI, not text heuristics.

**Empty-state "Press Ctrl+K" hint:** `Desktop.svelte` uses `pointer-events: none` and the first-run tutorial overlays the hint. Pointer/touch/AT users would miss the affordance entirely. A real button is required, not styled text.

**Dock scaling:** `Taskbar.svelte:13-21` hardcodes `DOCK_APPS`. Adding 2 more here is fine, but the plan would have been the third edit to that array. Worth a config-driven registration pattern before it becomes 12 entries.

**Module-level Sets are wrong shape:** the `pendingArmedPlaceables: Set<string>` pattern I proposed mirrors `pendingEditMode` but lacks per-id addressing — WorldMap doesn't know which arm is "for it." A single nullable writable (or proper `windowStore` extension) is the right primitive when only one consumer can exist.

**Premature DRY:** the proposed `EntityListRow` extraction had only one existing call site; Places' tree row and Trove's row were designed-not-built. Build first, extract when divergence is real.

**Cmd+K browser collision:** Chrome/Edge on macOS use `Cmd+K` for "search the web from address bar." `preventDefault()` works but the user habit is contested. Consider `Ctrl+Shift+P` if reviving.

## Alternative shapes raised by planning-partner (worth considering on revival)

- **Alt A — Extend Wiki instead.** Wiki already lists all types. Add `+ New {Type}` per section, a tree-view toggle for Locations. ~2 files. Smallest delta.
- **Alt B — Right-click desktop context menu.** Matches the OS-metaphor brand. `New Location… / New Character… / etc.` Eliminates Ctrl+K entirely.
- **Alt C — Absorb Places into WorldMap as a left tree pane.** Locations are spatial; same-component handoff eliminates the module-level Set and the two-window guard.
- **Alt D — Slideover/inspector panel, not windows.** One inspector ever. Two-window problem becomes structurally impossible. Architectural shift.
- **Alt E — Creation-as-verb.** Single `createEntityFlow(type, context)` route used by every entry point. Dock stays static.

Codex's strategic call (#10) and planning-partner's recommended combination (Alt B + Alt C + Ctrl+K as jump-only) point the same direction: **smaller, contextual creation surfaces; not new apps.**

## Re-decision checklist (when reviving)

Before this plan can ship in any form:

- [ ] Build Artifact/Item/Door editor bodies in `EntityDetail` (B3). Add to dispatch at `EntityDetail.svelte:245-266`. Define what each type's structured fields are.
- [ ] Decide on placement target UX for Trove's `+ Add placement` (B6) — map picker? Or only arm the currently-open WorldMap?
- [ ] Audit `windowStore.open` signature (B2). Either extend it to take an options object or rewrite all deep-link sites.
- [ ] Audit `findOpenEditorFor` (B4) to detect Wiki's embedded `selectedId`, or accept the limitation.
- [ ] Resolve `map-placements` store shape — single global with last-writer-wins, or keyed by filter (B5)?
- [ ] Specify A11Y contract for Ctrl+K.
- [ ] Decide on i18n posture for command palette parsing.
- [ ] Pick from Alt A/B/C/D/E if the dock-app shape isn't validated by usage.

## Adversarial review trail (preserved for traceability)

Three independent voices challenged the plan:
- **In-session adversarial pass:** findings A1-A8. Self-attack of the eng review decisions.
- **Codex (gpt model, fresh context, read-only):** 10 findings, several P0. The killer was #3 (no editor bodies for Artifact/Item/Door).
- **planning-partner (claude subagent, fresh context):** 5 alternative shapes Alt A-E.

All three converged on "this is too much, ship smaller." That convergence is the strongest signal in the session.

## What already exists (reuse, don't rebuild — applies whenever this revives)

- `entities.createEntity(type, name)` — used by `CharacterEditor.svelte:56`, `PlaceablesPalette.svelte:46`, Palette (event creation).
- `windowStore` patterns — `open`, `openForEntity`, `findOpenEditorFor`, `openFocusedGraph`.
- DESIGN.md tokens (Midnight Ink, Fraunces/Inter, window chrome).
- `buildHierarchyIndex` + `walkAncestors` from `src/lib/location-hierarchy.js`.
- `getEntityTypeColor()` from `src/lib/entity-type-colors.js`.
- `EntityDetail.svelte` as the universal per-entity editor (2026-04-29 lock in `windows.ts:65-75`).
- `pendingEditMode` Set pattern at `CharacterEditor.svelte:4`.
- `placementsStore` from `src/lib/stores/map-placements.ts` (already supports `placeableId` filter).

---

## References

- Map v2 design doc: `~/.gstack/projects/jzeng151-betwixt-and-between/steve-feat-app-qol-design-20260513-175833.md` (steps 1-7, M1-M15)
- DESIGN.md (project root)
- Mockups: `~/.gstack/projects/jzeng151-betwixt-and-between/designs/places-trove-palette-20260517/mockups.html`
- Verified breakage sites: `EntityDetail.svelte:245-266`, `WorldMap.svelte:1085`, `windows.ts:84`, `Wiki.svelte:236`
- Codex challenge transcript: this session
- Planning-partner alternatives: this session

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex` (challenge mode) | Cross-model adversarial | 1 | ISSUES_FOUND | 10 findings, 3 verified P0 (B1, B2, B3) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | SUPERSEDED | 8 issues; plan scope-reduced after adversarial pass invalidated load-bearing decisions |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 (informal mockup pass) | — | Mockups produced; deferred to revival |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |
| Planning Partner | Agent (fresh context) | Alternative implementations | 1 | ALTERNATIVES_FOUND | 5 distinct shapes (Alt A-E); converged with codex on smaller scope |

- **CROSS-MODEL:** Codex, planning-partner, and in-session adversarial pass all converged: original plan overscoped for Step-4 settle. Codex caught the load-bearing fact (B3 — no Artifact/Item/Door editor bodies) both Claude passes missed.
- **UNRESOLVED:** 0 — user decided Option C: ship minimum now, defer Places/Trove/Ctrl+K with full documentation.
- **VERDICT:** PART 1 CLEARED — ready to implement T1, T2, T3 (~5h). PART 2 DEFERRED until after map v2 Step 7 ships; revisit with checklist above.
