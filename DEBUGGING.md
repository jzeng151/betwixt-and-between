# Debugging Log

Investigation reports for non-obvious bugs. Each entry follows the
`/investigate` skill's debug-report format. New entries at the top.

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
