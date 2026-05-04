# Debugging Log

Investigation reports for non-obvious bugs. Each entry follows the
`/investigate` skill's debug-report format. New entries at the top.

---

## 2026-05-03 — Alias position snap never fires in StoryGraph / FocusedGraph

**Branch:** feat/spotlight-integration  
**Status:** FIXED (commit a08dad6)

### Symptom

Advancing the playhead past Lord Caldlow's reveal point in the Prestige dataset
produced no visible snap — Caldlow appeared at a random auto-placed position
rather than stacking on top of Robert Angier.

### Root cause

`StoryGraph.svelte` intentionally starts with an empty `initialPositions`
object (no saved positions loaded on mount — the comment reads "fresh hairball
every time"). Auto-placed nodes get grid positions inside `GraphCanvas`'s
private `nodePos` state, but those positions are never reflected back into
`initialPositions` unless the user has manually dragged the node or run
Layout by Type in the current session.

The snap effect did:
```ts
const pos = initialPositions[alias.primaryEntityId];
if (pos) updates[id] = { ...pos };
```

Because `initialPositions[angier.id]` was `undefined`, `pos` was falsy, and
the `if (pos)` guard silently skipped every alias — no `reseed()` call, no
snap, no error.

### Why it was hard to spot

The effect didn't throw; it just evaluated `if (pos)` as `false` and moved on.
The only observable symptom was "nothing happened."

### Fix

Added `getPosition(id: string): NodePosition | undefined` to `GraphCanvas.svelte`
that reads directly from `nodePos`:

```ts
export function getPosition(id: string): NodePosition | undefined {
  return nodePos[id];
}
```

Both graph components now call `canvas?.getPosition()` as the primary lookup,
falling back to their stored mirrors:

```ts
// StoryGraph
const pos = canvas?.getPosition(alias.primaryEntityId) ?? initialPositions[alias.primaryEntityId];

// FocusedGraph
const pos = canvas?.getPosition(alias.primaryEntityId) ?? currentPositions[alias.primaryEntityId] ?? initialPositions[alias.primaryEntityId];
```

This works regardless of whether the user has ever dragged the primary entity.

### Re-seed required

The DB must be re-seeded to get the alias pairs inserted:

```
npm run seed -- prestige
```

### Structural lesson

Any "snap to another node's position" feature must query the **canvas's live
internal position**, not the host component's shadow mirror. Shadow mirrors are
only populated when the user interacts (drag) or the host runs a layout pass.
Auto-placed positions are the default for new nodes and live only inside
`GraphCanvas.nodePos`. The pattern for future host-side position lookups is
`canvas.getPosition(id) ?? fallback`, never `fallback` alone.

---

## 2026-05-02 — FocusedGraph view-mode select dismissed immediately on click

**Symptom:** Clicking the "View" `<select>` dropdown in the Focused Graph
header caused the dropdown to flash open for a split second and then
immediately dismiss, making it impossible to change the view mode. The user
observed it was reliably triggered by adding an entity to the focal set and
then clicking the select before the UI settled.

**Root cause:** The `svelte:window onclick` handler that implements
"click outside to close" for the settings panel (`settingsOpen`):

```svelte
<svelte:window
  onclick={(e) => {
    if (!settingsOpen) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('.fg-settings') || t?.closest('.fg-settings-btn')) return;
    settingsOpen = false;
  }}
/>
```

The exclusion list only covered `.fg-settings` (the panel itself) and
`.fg-settings-btn` (the gear button). The `.fg-mode` `<label>` containing
the `<select>` was not excluded. When the user clicked the `<select>` while
`settingsOpen` was `true`, the window handler fired, set `settingsOpen =
false`, and Svelte synchronously removed the `.fg-settings` panel from the
DOM. That DOM mutation — occurring while the browser was processing the
same click that opened the native `<select>` dropdown — caused the browser
to dismiss the dropdown.

**Why "add entity then click select" triggered it.** The `+` add-to-focal
button uses `e.stopPropagation()`, so clicking it does not close the settings
panel. If the settings panel was already open when the user clicked `+`, it
remained open. The very next click on the `<select>` then hit the handler.
The user perceived adding an entity as the trigger; the actual condition was
the settings panel being open at that moment.

**Fix.** Add `.fg-mode` to the exclusion list:

```svelte
if (t?.closest('.fg-settings') || t?.closest('.fg-settings-btn') || t?.closest('.fg-mode')) return;
```

One line in `src/lib/components/apps/FocusedGraph.svelte`. Clicking the
view-mode select no longer triggers `settingsOpen = false`; the settings
panel remains open until the user clicks inside the canvas or the gear
button. Full E2E suite: 117 passed, 2 intentional skips, no regressions.

**Structural lesson.** Native `<select>` dropdowns are sensitive to DOM
mutations that occur between mousedown and the dropdown opening. Any
`svelte:window onclick` handler that mutates the DOM must exclude every
interactive element in the component — not just the panel being toggled and
its own trigger button. When adding new header controls, audit the exclusion
list.

**Status:** DONE.

### Follow-up — 2026-05-04: EntityDetail Edit/Done button auto-reset

**Symptom:** Clicking "Edit" in an act/scene/event detail window caused the
button to immediately revert to "Edit" (i.e. mode snapped back to `'view'`
before the user could do anything). Only triggered on windows that were not
already the topmost window.

**Root cause:** Same family as above — a reactive notification causing an
unintended state reset — but the mechanism was subtler. `Window.svelte` calls
`windowStore.focus(id)` on every `mousedown` inside the window:

```svelte
<div class="window" onmousedown={() => windowStore.focus(id)}>
```

That store write fires *before* the `click` event (mousedown always precedes
click). It causes the parent's `{#each $windowStore as win}` block to
re-render, which re-evaluates the children snippet and passes
`entityId={win.entityId}` to `EntityDetail`. Even though the string value
is unchanged, Svelte 5's prop signal is set. `EntityDetail`'s mode `$effect`
tracked `entityId` via `void entityId` and ran unconditionally on any signal
notification:

```svelte
$effect(() => {
    void entityId;   // tracked as dependency
    mode = initialMode;  // always reset — even if entityId didn't actually change
});
```

Svelte 5 schedules effects as microtasks. The sequence was:
1. `mousedown` → `windowStore.focus()` → entityId signal notified (same value)
2. `click` → `mode = 'edit'` (sync)
3. Microtask: entityId `$effect` runs → `mode = 'view'` — clobbers step 2

**Fix.** Track the previous entityId in a plain (non-reactive) variable so the
effect only resets mode when the entity actually changes:

```svelte
let mode = $state<'view' | 'edit'>(initialMode);
let _prevEntityId = entityId;  // plain let — not tracked by the effect
$effect(() => {
    if (entityId !== _prevEntityId) {
        _prevEntityId = entityId;
        mode = initialMode;
    }
});
```

**Structural lesson.** `void x` in a `$effect` tracks the signal *value*, not
value *changes*. Any `onmousedown`/`onclick` handler that writes to a store
will notify downstream prop signals even if the resolved value is identical.
Effects that need "run when X changes" semantics must guard with an explicit
previous-value comparison, not a bare `void x` read.

**Status:** DONE.

---

## 2026-05-02 — E2E tests wiping the Neon production database

**Symptom:** After running `npm run test:e2e`, the Neon dev database was
cleared and contained only a single character named "Elara". This happened
repeatedly — every e2e run silently destroyed real data.

**Root cause:** Playwright's execution order is **webServer plugin first,
then globalSetup**. The preview subprocess is spawned (and calls
`server.init()` / Vite's `loadEnv()`) *before* `global-setup.ts` runs.
`loadEnv()` reads `DATABASE_URL` from `.env` (the Neon URL) and passes it
to SvelteKit's `set_private_env()`, locking in the Neon connection for the
lifetime of that preview process.

The `process.env.DATABASE_URL = pgliteUrl` stamp in `global-setup.ts` runs
too late — it lands in the Playwright orchestrator process, not in the
already-running preview subprocess. The documented assumption in
`global-setup.ts` ("stamps process.env.DATABASE_URL before the preview
server spawns") was wrong about the execution order.

With the preview pointing at Neon, every test's `clearEntities()` in
`beforeEach` wiped real data. The last test that ran before the suite failed
left one entity ("Elara") behind, explaining the consistent residue.

Confirmed via `node_modules/playwright/lib/runner/tasks.js`:
```
tasks.push(
    ...createPluginSetupTasks(config),   // webServer runs here
    ...config.globalSetups.map(...)      // globalSetup runs after
);
```

And `node_modules/playwright/lib/plugins/webServerPlugin.js`:
```js
env: {
    ...DEFAULT_ENVIRONMENT_VARIABLES,
    ...process.env,           // process.env at spawn time — before globalSetup
    ...this._options.env      // webServer.env from playwright.config.ts
}
```

**Fix.** Three files:

- `tests/e2e/pglite-config.ts` (new) — single source of truth for
  `PGLITE_PORT = 54329` and `PGLITE_URL`. Fixed port is required because
  `playwright.config.ts` is evaluated before globalSetup runs and cannot
  read a dynamically-assigned port.
- `playwright.config.ts` — adds `webServer.env: { DATABASE_URL: PGLITE_URL,
  BETWIXT_E2E_PGLITE: '1' }`. These are injected into the subprocess's
  `process.env` at spawn time, before `loadEnv()` runs. Vite's `loadEnv`
  iterates `process.env` after env files, so the fixed URL overrides `.env`.
- `tests/e2e/global-setup.ts` — binds PGlite to `PGLITE_PORT` (54329) instead
  of `port: 0`. Keeps `process.env` stamps for Playwright's worker env-diff
  propagation mechanism (workers inherit keys that changed during globalSetup).

**Why the original approach seemed sound.** The `webServer.env` option and
Playwright's plugin-before-globalSetup ordering are not prominently documented.
The `vite preview` → `loadEnv()` → `set_private_env()` chain that makes
`$env/dynamic/private` immune to `process.env` mutations is a SvelteKit
implementation detail. Both facts had to be true simultaneously for the
stamp to fail silently rather than loudly.

**Status:** DONE.

---

## 2026-05-02 — StoryGraph / FocusedGraph cascade overlap after Layout-by-type

**Symptom:** running "Layout by type" against the seeded *Prestige*
dataset produced rows of nodes stacked shoulder-to-shoulder with
labels overlapping each other. Rows themselves nearly touched
vertically. Pressing the reset button repainted the same overlap or
did nothing visible. Files involved:
`src/lib/graph/dagre-layout.ts`,
`src/lib/components/apps/StoryGraph.svelte`,
`src/lib/components/apps/FocusedGraph.svelte`.

**Root cause:** `dagre.setGraph({ rankdir: 'LR', ... })` with no
explicit `ranksep` was the surface symptom — dagre's default
`ranksep: 50` is the horizontal gap between ranks in LR mode, and
50 px is dwarfed by 180–220 px wide nodes. But that was secondary.

The architectural bug: dagre LR per-type frequently puts unrelated
nodes at the **same rank** (same X coordinate) when the intra-type
edge graph is sparse or directionally lopsided. Many Characters in
*The Prestige* shared rank=0 because they had no *incoming* intra-
Character edges in the directed subgraph passed to dagre. dagre
distinguished rank-sharing nodes by stacking them vertically within
their shared rank — and then the post-process `Y = rankYCursor`
clamp in `dagre-layout.ts` wiped that vertical separation out,
leaving multiple nodes at one (X, Y) coordinate. Perfect overlap.
No amount of `ranksep` tuning could fix it because the information
dagre used to spread rank-sharing nodes was being thrown away on
purpose by the type-band post-process.

**Why two patches missed it.** The first round bumped per-node
width estimates from `120 → max(140, name.length * 7 + 40)` and
`nodesep` from 40 → 60, on the assumption that under-allotted width
caused adjacent ranks to overlap. The second round went further:
width `max(180, name.length * 9 + 100)`, `nodesep: 60 → 80`,
between-type-band gap 80 → 140. Both rounds were tuning the wrong
axis. `nodesep` in LR rankdir is the **vertical** spacing between
same-rank nodes, not the horizontal between-column gap. The code
comments next to `nodesep` even read `// horizontal gap within a
rank`, which was simply wrong and had persisted unverified across
prior commits because dense graphs (every node has incoming edges)
hide the bug — every node lands at its own rank, the post-process
clamp loses no information.

**Fix.** Replace per-type dagre with a deterministic left-to-right
pack in `dagre-layout.ts`:

```ts
let xCursor = 0;
for (const n of rankNodes) {
  raw.push({ id: n.id, x: xCursor, y: rankYCursor });
  xCursor += n.width + 60;
}
rankYCursor += rankHeight + 140;
```

Every node lands at a distinct X. No overlap is geometrically
possible. Iteration order = entity store order. The runtime `import('dagre')`
inside the per-type loop is gone; the file kept its name for caller
ergonomics. Tradeoff accepted: lose dagre's edge-crossing
minimization for intra-type edges. For Prestige's density that
didn't help anyway — rank-sharing nodes ended up on top of each
other regardless. Smarter intra-type ordering (BFS from a focal,
alphabetical, manual user reorder) is a future feature, not a
regression.

**Followup — reset button.** After the layout fix, reset (↻) was
briefly wired to re-run `layoutByType` so any stale cascaded
positions still in the DB could be overwritten by the corrected
algorithm. User feedback said reset should instead return to the
unstructured default state — a way to discard the layout and start
fresh visually. Re-bound: a new `resetPositions()` method on
`GraphCanvas` clears `nodePos` and re-arms `seededFromServer`. SG's
reset clears local `initialPositions` and calls it; FG additionally
clears `radialSeeded` so the radial-seed `$effect` re-runs for a
fresh ring layout. Session-scoped — server keeps the user's
last-saved positions for reload.

**Structural lesson.** When you need to layer one constraint on top
of a layout library's output, pick exactly one axis the post-process
controls and configure the layout for the OTHER axis. Don't
post-process Y while configuring `rankdir: LR` (which is
fundamentally an X-rank layout) — the library has no way to know
its own Y output is going to get clobbered, and it'll happily
collapse multiple nodes onto your single Y line. If you need to
clamp both axes, write the layout yourself.

Tactical lesson: when tuning a spacing constant doesn't fix a layout
bug after two rounds, **stop tuning** and trace the data flow.
"Bump it higher next time" was the wrong reaction twice; three
iterations on the same surface is the architectural smell the
investigate skill warns about.

**Status:** DONE.

---

## 2026-04-30 — Act / scene column misalignment under resize

**Symptom:** dragging an act's resize handle caused the act header column
and the scenes row beneath it to drift apart horizontally. At the floor
of the drag, scenes continued shrinking past where the act column
visually stopped. Bars (in `.rows`) tracked the scenes, not the act.

**Root cause:** flex layout's "automatic minimum size" on
`.act-col-header`. The act header has padded inner content — Fraunces
title, drag grip, delete button, "Break into scenes" link — whose
intrinsic min-content sums to ~87 px. Even with `min-width: 0`
explicitly set on the column AND cascaded down to `.act-name-row`,
`.act-meta`, and `.break-btn`, Firefox's flex algorithm refused to
shrink the column below that intrinsic floor in the live layout. The
neighboring `.scenes-act` row has near-zero min-content (just `s0`/`s1`
labels), so for the same flex weight it shrank to its allocated width
correctly. Result: identical `flex: <weight>` on both rows, different
rendered widths under shrink. The bar in `.rows` (no inner content
holding width) tracked the scenes-act, leaving the act header
disconnected.

**Phase 1 evidence — Playwright diagnostic dump.** A short spec drove
the resize handle and read `getBoundingClientRect()` on each element
plus a probe that cloned the column into a width-0 container and read
`scrollWidth`. Pre-fix at the drag floor with weights `[0.184, 1.816]`
and a 686 px track:

```
act0:    width = 87,  scrollW = 89,  naturalMin = 65,  flex = 0.184 1 0%
scenes0: width = 64,  scrollW = 63,  naturalMin = 3,   flex = 0.184 1 0%
bar0:    width = 63,  scrollW = 71,  naturalMin = 63,  flex = 0 1 auto
```

Pure flex math wants `(0.184/2) × 686 ≈ 63 px` per item. `scenes0` and
`bar0` sit at 63–64. `act0` is 24 px wider — held back by an intrinsic
minimum the clone-probe reports as 65 px but Firefox's live layout
treats as 87. Same flex weight, three different widths. That is the
desync the user reported.

**Failed fixes (3 prior commits, kept in history as a record):**

1. `a6ea890` — `scrollbar-gutter: stable` on `.rows` plus matching
   `padding-right: var(--tl-gutter)` on the header rows. Real fix for
   a separate scrollbar-reservation bug; not the cause here.
2. `ec5f493` — `min-width: 60 px` on both `.act-col-header` and
   `.scenes-act` with a parallel JS clamp. Floor mismatched because
   default `box-sizing: content-box` made 60 px mean different total
   widths (89 vs 61) on rows with different padding.
3. `09a9b91` — added `box-sizing: border-box`. Brought the totals
   into alignment AT the floor but the act column still wouldn't reach
   that floor; it stayed pinned at ~87 px from intrinsic min-content.

Three strikes triggered the iron-law pause. Stopping the guess loop and
running the diagnostic surfaced the actual numbers above.

**Fix (`f27310d`):** stop fighting flex auto-min-size with CSS. Compute
pixel widths in JS and pin both rows to identical values:

```svelte
<!-- src/lib/components/apps/Timeline.svelte -->
const actPxWidths = $derived.by(() => {
  if (totalWeight === 0 || trackWidthPx === 0) return [];
  return weights.map((w) => (w / totalWeight) * trackWidthPx);
});

<!-- src/lib/components/ActsHeader.svelte (act and scenes rows) -->
style={actPxWidths?.[i] != null
  ? `flex: 0 0 ${actPxWidths[i]}px;`
  : `flex: ${weights?.[i] ?? 1};`}
```

Both rows now write `flex: 0 0 <px>` from the same array, so flex
auto-min-size becomes irrelevant — flex-grow and flex-shrink are 0,
basis IS the width. Inner content overflowing the column clips via
`overflow: hidden` (already present).

**Verification.** Diagnostic post-fix:

```
act0:    width = 163, right = 500
scenes0: width = 163, right = 500
bar0:    width = 163, right = 500
```

Pixel-equal across all three in every dump (initial AND post-drag).
375 unit + integration tests still pass. The diagnostic spec was
removed after the fix to keep the e2e suite clean; rebuild it locally
if you need to re-verify.

**Why three patches missed it.** Each prior fix addressed a real but
secondary issue and assumed the remaining gap would close. None of the
three was tested against the live computed widths — they were tested
against unit tests that don't exercise flex layout, against type
checks, and against my mental model of CSS flex. The mental model was
wrong about how `min-width: 0` interacts with intrinsic min-content
under live flex sizing in Firefox. The diagnostic was the only way
to see the actual values.

**Structural lesson.** When you need pixel-exact alignment between
sibling flex rows whose children have different inner content, don't
trust flex auto-sizing. Pin widths in JS from a single source of
truth and write them as `flex: 0 0 <px>` on both rows. Use this when:

- Two or more rows must align column-for-column.
- The rows have meaningfully different inner content (padding,
  unbreakable text, fixed-size children).
- The weights are derived from the same data and can be expressed in
  pixels.

Don't use it when items genuinely need to size to content — that's
what flex is for. The recipe applies specifically to "this column
group has an authoritative width that all sibling rows must match."

**Status:** DONE.

---

## Ghost trails never appearing in StoryGraph / FocusedGraph

**Date:** 2026-05-03  
**Branch:** feat/spotlight-integration  
**Status:** FIXED (commit 6e312ee)

### Symptoms

Ghost trails (faint dashed edges for entities near but outside the current playhead window) never appeared in either graph view, regardless of playhead position or which relationship types were visible.

### Root cause 1 — `intervalsStore` never loaded (primary)

`StoryGraph.svelte` and `FocusedGraph.svelte` both import `$intervalsStore` and use it to build `entityIntervalMap`, but neither component called `intervalsStore.load()`. The Timeline component loads intervals in its own `onMount`, so the store only had data if Timeline happened to be mounted first.

With an empty `$intervalsStore`:
- `entityIntervalMap` was empty
- Characters/Events/Locations were never added to `outOfScope` (only Acts and Scenes were, via position math)
- `endpointOutOfScope` was always `false` for character relationships
- The ghost trail trigger `if (!inWindow || endpointOutOfScope)` evaluated to `if (false || false)` for every timeless edge — never entering the ghost trail block

**Fix:** Added `onMount(() => { intervalsStore.load(); })` to both components.

### Root cause 2 — `hideOutOfScope` blocking ghost trail edges (secondary)

When `hideOutOfScope` was ON, out-of-scope entities were stripped from `renderedEntityIds`. Because `visibleRelationships` filters to edges whose both endpoints are in `renderedEntityIds`, those edges were removed before the `graphEdges` ghost trail loop could process them.

**Fix:** `renderedEntityIds` now re-includes "nearby-ghost" entities (those whose intervals are within ±2 scene boundaries of T) when both `showGhostTrails` and `hideOutOfScope` are ON. This keeps their nodes and edges in the pipeline so ghost trail logic can fire.

### Data flow (correct path, post-fix)

```
$intervalsStore (loaded in onMount)
  → entityIntervalMap: entityId → [{startPosition, endPosition}]
  → outOfScope: entities with no active interval at T
  → renderedEntityIds: all entities, or in-scope + nearby-ghost
      (when hideOutOfScope=ON and showGhostTrails=ON)
  → visibleRelationships: edges with both endpoints rendered
  → graphEdges loop:
      endpointOutOfScope = outOfScope.has(fromId) || outOfScope.has(toId)
      if (!inWindow || endpointOutOfScope):
        count scene boundaries between interval edge and T (≤2 → ghost)
        → ghostMode = 'past' | 'future'
      → edge color = out-of-scope endpoint's node color
```

### Key invariant

`showGhostTrails` defaults to `false` — the checkbox in the Settings panel (⚙) must be enabled. The playhead must also be active (`$playhead !== null`).

---
