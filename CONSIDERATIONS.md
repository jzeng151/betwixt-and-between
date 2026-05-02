# Implementation Considerations

A living log of architectural and implementation decisions for betwixt-and-between. Each entry captures what was decided, what alternatives were considered, and why this path was chosen. For decisions that involve math or non-obvious reasoning, the full explanation lives here so future-you (or a teammate) can reconstruct the context without re-doing the design conversation.

This is the source of truth for "why did we build it this way?" Entries are append-only and dated. Don't rewrite history; if a decision is reversed, add a new entry that supersedes the old one and link them.

---

## Coding Standards

### Formula variable comments

When code implements a mathematical formula, every variable used in the formula must carry a comment indicating what it represents — unless the variable name is already semantically clear.

**Self-explanatory (no comment needed):**

```ts
const snappedPosition = actIndex + snappedFraction;
const sceneCount = scenes.length;
```

**Single-letter or terse (comment required):**

```ts
// k = scene index within the parent act (0-based)
// m = total scene count for the parent act
const sceneStart = actIndex + (k / m);
const sceneEnd = actIndex + ((k + 1) / m);
```

The test: if a reader needs to look up what `m` is, the variable needs a comment.

---

## Decisions

### [2026-04-28] Premise 4: Timeline interval representation — hybrid FK + computed position model

**Decision:** Store both FK references to acts/scenes AND computed `start_position` / `end_position` floats on each interval row.

**Alternatives considered:**

- **A. 6-column FK + fraction model.** `(start_act_id, start_scene_id, start_fraction, end_act_id, end_scene_id, end_fraction)` with scene and fraction mutually exclusive at each endpoint. *Rejected:* encodes a 1D position with too many columns and a CHECK constraint that the storage layer doesn't actually need.
- **B. 2-column position-only model.** `(start_position REAL, end_position REAL)` as global story-fractions. Schema knows nothing about acts/scenes; positions are computed at render. *Rejected:* loses referential integrity. If an act or scene is deleted, intervals don't cascade automatically — app code has to handle every cascade path manually.
- **C. Hybrid: FKs + computed positions.** Both representations live on the row. *Chosen.* Trades dual-write maintenance for referential integrity AND fast range queries (scrubber, time-T lookups, "who's in act X" without joins).

**Trade-offs accepted:**

- Application code maintains the dual-write invariant: on every insert/update, computed positions must equal what the FKs imply. App enforces this; schema cannot. Mitigated below ("Dual-write invariant strategy").
- Two extra REAL columns per row (~16 bytes). Negligible.
- More columns to migrate from existing `appears_in` relationships, but the migration logic is the same shape.

**Concrete schema sketch (final DDL settled at /plan-eng-review time):**

```
intervals (
  id              -- primary key
  entity_id       -- FK → entities(id), the character or event whose presence this is, ON DELETE CASCADE
  start_act_id    -- FK → entities(id), the act this interval starts in, ON DELETE CASCADE
  start_scene_id  -- FK → entities(id), nullable; ON DELETE SET NULL + position recompute
  end_act_id      -- FK → entities(id), the act this interval ends in, ON DELETE CASCADE
  end_scene_id    -- FK → entities(id), nullable; ON DELETE SET NULL + position recompute
  start_position  -- REAL NOT NULL, computed global story-fraction (see math below)
  end_position    -- REAL NOT NULL, computed global story-fraction
  CHECK (start_position < end_position)            -- strict less-than; half-open convention (see below)
)

INDEX idx_intervals_entity      ON intervals(entity_id);
INDEX idx_intervals_position    ON intervals(start_position, end_position);
```

Type safety on `start_scene_id` / `end_scene_id` (must reference an entity of type `Scene`) is enforced in app code, not the schema — SQLite cannot constrain a polymorphic FK by entity type.

---

### Convention: half-open intervals `[start, end)`

All position math in this project uses **half-open intervals**: `start_position` is inclusive, `end_position` is exclusive. This convention is consistent across the schema, queries, snap math, and rendering.

- "Ellie is present for all of Act 1" → `start=1.0, end=2.0`. The `2.0` is exclusive — Ellie is present at any T where `1.0 ≤ T < 2.0`. T=2.0 itself is the start of Act 2, where Ellie may or may not be present.
- This makes adjacent intervals on the same row **non-overlapping by construction**: if Ellie's first interval ends at `1.6` and her second starts at `1.8`, the gap `[1.6, 1.8)` is unambiguous.
- The CHECK constraint is `start_position < end_position` (strict), since equal start/end has zero extent and represents nothing meaningful.

---

### The math, with variable definitions

Variable definitions:

- `i` = act index (0-based integer). Generally, `Act i` occupies `[i, i+1)`.
- `k` = scene index within parent act (0-based integer).
- `m` = total scene count within a parent act (positive integer; or `0` if the act has no scenes broken out).
- `position` = the float coordinate on the global story-time axis, range `[0.0, N]` where `N` is the act count.

**Mapping acts to position ranges:**

```
Act i occupies [i, i + 1)         -- half-open
```

**Mapping scenes to position ranges (for an act with m scenes):**

```
Scene k of Act i occupies [i + k/m, i + (k+1)/m)
```

**Snapping math (smart snap):**

When the user drags an interval edge to a raw cursor position `position`:

1. `actIndex = Math.floor(position)` — the integer act index containing the cursor.
2. `m = sceneCount(actIndex)` — total scenes in that act.
3. If `m > 0` (act has scenes), snap to the nearest scene boundary within that act:
   ```
   fractionInAct  = position - actIndex      // 0.0 to 1.0 within the act
   snappedFraction = Math.round(fractionInAct * m) / m
   snappedPosition = actIndex + snappedFraction
   ```
4. If `m == 0` (no scenes), snap to the nearest act boundary:
   ```
   snappedPosition = Math.round(position)
   ```
5. If the user holds Alt, skip steps 3–4 and use `position` raw (free-fraction).

**Cross-act drag behavior:** when the cursor crosses an act boundary mid-drag, the snap target updates immediately (`actIndex` re-floors, `m` re-looks-up). No special interpolation — the user always snaps to whatever act/scene grid is closest to the *current* cursor position.

**Worked examples (assume Story has Acts 0, 1, 2):**

| Intent | start_position | end_position |
|---|---|---|
| Ellie present for all of Act 1 | 1.0 | 2.0 |
| Ellie in first 25% of Act 1 (no scenes) | 1.0 | 1.25 |
| Ellie in scenes 1, 2, 3 of Act 1 (Act 1 has 5 scenes) | 1.2 | 1.8 |
| Battle spans middle of Act 0 through end of Act 2 | 0.5 | 3.0 |
| Damien only appears in last 10% of the story | 2.9 | 3.0 |
| Battle covers scene 4 of Act 0 (5 scenes) through scene 1 of Act 2 (3 scenes), inclusive of both endpoints | 0.8 | 2.667 |

**Gap representation (discontinuous presence):**

A single interval row represents one **contiguous** range. Discontinuous presence requires multiple rows. The renderer unions all rows for the same entity to draw the timeline track, with empty space between rows as gaps.

Example: "Ellie is in scenes 1, 2, and 4 of Act 1, but not scene 3."

```
Row A: start_position = 1.2, end_position = 1.6   (scenes 1-2)
Row B: start_position = 1.8, end_position = 2.0   (scene 4)
```

The empty `[1.6, 1.8)` between them is the gap.

---

### Querying patterns enabled by this model

Half-open convention is reflected in every comparison:

- **"Who is present at story time T?"** — `WHERE start_position <= T AND end_position > T` (note strict `>` on end)
- **"Who is present anywhere in Act X?"** — `WHERE start_position < (X+1) AND end_position > X`
- **"Who touches scene S?"** — `WHERE start_scene_id = S OR end_scene_id = S` (FK-direct, no position math)
- **"All intervals for entity E, ordered by story time"** — `WHERE entity_id = E ORDER BY start_position`

The position columns enable scrubber-style time-T queries with a single index. The FK columns enable scene-anchored lookups without computing positions. Both are first-class.

---

### Schema delta: entities table additions

Adding hierarchical scenes requires two new columns on the existing `entities` table:

```
entities
  ...existing columns...
  parent_id  TEXT REFERENCES entities(id) ON DELETE CASCADE  -- nullable; set on Scenes pointing to their parent Act
  position   INTEGER                                          -- nullable; sibling-order within parent (used by Scenes within an Act)
```

This is an additive change (new nullable columns) — existing rows get NULL for both. Premise 1 of the design doc is "core schema mostly stays" rather than "no schema changes at all"; this addition is the only delta to the existing tables.

Migration adds the columns via `ALTER TABLE entities ADD COLUMN ...` in the same Drizzle migration step that creates `intervals`.

---

### Dual-write invariant strategy

The hybrid model's central risk: `start_position` / `end_position` could drift from what the FKs imply. Strategy:

**1. Single chokepoint write function.**

All inserts and updates of `intervals` go through one function:

```
src/lib/server/intervals.ts
  writeInterval(input: WriteIntervalInput): Promise<Interval>
```

Where `WriteIntervalInput` accepts FKs (act/scene ids) PLUS optional explicit positions. Internally:

1. If positions are provided, validate they match the derivation from FKs (within float epsilon). Throw if they don't.
2. If positions are not provided, compute them from FKs.
3. Write the row in a single transaction.

No raw `INSERT INTO intervals` or `UPDATE intervals SET start_position = ...` outside this function. Lint via grep in CI.

**2. Vitest invariant test.**

```
test/db-invariants/intervals.test.ts
  test('every interval row has start_position and end_position consistent with its FKs', () => { ... })
```

Walks every row, recomputes positions from FKs, asserts equality (within epsilon). Runs on every `npm test` cycle.

**Turso/cloud note:** the chokepoint stays valid across the network boundary — `writeInterval` runs server-side (in the API handler), and the transaction is per-request, not per-network-roundtrip. Latency adds to write time but doesn't introduce drift.

**Concurrent-write risk:** `writeInterval` and `recomputeIntervalsForAct` can theoretically interleave (request A reorders scenes while request B inserts an interval that anchors to a scene that's about to move). Under SQLite (better-sqlite3) all writes are serialized at the connection level, so this is not a practical concern in v0.x. Under Turso, transactions remain per-request and Turso uses an embedded SQLite under the hood with its own write serialization, but with cross-replica consistency lag. For v1.x: if drift is observed in production, the mitigation is wrapping scene mutations and interval writes in a higher-level lock keyed on `parent_act_id`. Defer until evidence shows it's needed.

---

### ON DELETE behavior (per FK)

Specified in the schema sketch above; rationale below.

| FK | Behavior | Rationale |
|---|---|---|
| `entity_id` | CASCADE | Delete a character → delete their presence intervals. |
| `start_act_id`, `end_act_id` | CASCADE | Delete an act → intervals starting/ending in it lose meaning. UI must confirm before deleting an act. |
| `start_scene_id`, `end_scene_id` | SET NULL + recompute | Delete a scene → interval stays at its act-level position but loses scene anchoring. Position is recomputed in the same transaction (see "Position recomputation rules" below). |

The CASCADE on acts is destructive. The Timeline UI must show a confirmation dialog ("This will delete N intervals across M characters/events") before deleting an act, listing what will be lost.

---

### Position recomputation rules

Whenever a Scene entity is created, deleted, reordered, or has its `position` integer changed, **all intervals within the affected act** must have their `start_position` and `end_position` recomputed in the same transaction as the scene mutation.

**Operation:**

```
recomputeIntervalsForAct(actId)
  -- Find every interval where start_act_id = actId OR end_act_id = actId
  -- For each interval, branch on FK presence:
  --   If start_scene_id IS NOT NULL: re-derive start_position from (start_act_id, start_scene_id).
  --   If start_scene_id IS NULL:     leave start_position UNCHANGED (fraction-positioned, frozen).
  --   Same logic for end side.
  -- Write only the rows whose positions actually changed (skip no-ops).
```

The branch on scene-FK presence is the **locked semantic**: fraction-positioned intervals (no scene FK) stay frozen at their original float across scene mutations. Only scene-anchored intervals follow their scenes around. This is what distinguishes the two modes for users.

**Invariant after the transaction:** for every interval, position floats reflect the *current* layout of acts and scenes.

**Semantic choice locked here:** intervals follow the *scene they were anchored to*. If you reorder scenes 1 and 2, an interval that previously started at scene 2 (position `1.4` when scenes were `[1.0, 1.2, 1.4, 1.6, 1.8]`) now starts at the new position of scene 2 — which moved. The position float updates accordingly. This is the "FK is source of truth" semantic; positions are derived, not authoritative.

If the user wants to *anchor* an interval to a fraction (e.g., "Ellie always shows up at 30% of Act 1, regardless of how I reorder scenes"), they should use a fraction-positioned interval (no scene FK). The system distinguishes the two modes by whether the scene FK is set.

---

### Migration: rollback and recovery

The migration is one-way and irreversible *at the schema level* (you can't auto-undo a Drizzle migration that has run against your data). Rollback strategy is therefore snapshot-based.

**Pre-migration snapshot (manual):**

Before running `drizzle-kit migrate` for the intervals migration, the migration script writes a JSON dump of the affected tables:

```
scripts/migrations/snapshot-pre-intervals.ts
  // Reads entities, relationships, canvas_positions
  // Writes to local.db.backup-pre-intervals-{timestamp}.json
```

Documented in `DEVELOPMENT.md` as a step the developer runs before the migration.

**If the migration fails midway:**

1. Stop the migration (it should be transactional within Drizzle).
2. Restore from the JSON snapshot via a paired script `scripts/migrations/restore-pre-intervals.ts`.
3. Investigate the failure, fix the script, retry.

**If the migration succeeds but the new model proves wrong (post-launch):**

Manual reverse-migration via a one-off script that reads `intervals`, recreates `appears_in` relationships from the act-level info, and drops the new table + columns. Acknowledged as expensive; preferable to design-time correctness.

---

### [2026-04-28] Schema readability at scale: keep single-table inheritance; address in code/UI

**Concern raised (peer/mentor feedback):** "The existing schema with just entities seems ambiguous and not best practice because it's not very readable, and if a user ends up amassing hundreds or thousands of entries it'd become a mess."

**Decision:** Keep the existing single-table-inheritance pattern (one `entities` table with `type` discriminator + `data TEXT` JSON for type-specific fields). Do not split into per-type tables (`characters`, `events`, `locations`...) at this time.

**Reasoning — why this is a code/UI problem, not a DB problem:**

1. **Notion holds tens of millions of rows in single-table-inheritance.** Database scale is not what makes a single-table model "messy." What gets messy is application-layer code that doesn't know what's in `data TEXT`, and UI that doesn't help users navigate large lists.

2. **The graph + relationships nature of this app argues *for* keeping a single entities table.** `relationships(from_id, to_id)` connects any two entities trivially today. Per-type tables would force polymorphic foreign keys (which SQLite doesn't natively support cleanly), so we'd end up either keeping a generic `entities` table anyway (now with two sources of truth) or hand-rolling polymorphic FK logic in `relationships`. The connected-OS feature gets cheaper, not more expensive, with one entities table.

3. **The actual sources of friction users feel at scale are addressable without schema changes:**
   - Querying inside `data` JSON when you don't know what's in there → solvable with TypeScript discriminated-union types over `data` (`type EntityData = CharacterData | EventData | LocationData | ...`) + Zod-validated insert/update at the API layer. The DB stays generic; writes get strict.
   - Querying *into* `data` for filtering/search → SQLite has `json_extract` and JSON1 indexes when needed.
   - The Wiki / Story Graph / entity-listing UI getting overwhelming at 800+ entities → solvable with search, type-faceted filters, folders/tags, and pagination. Pure UI work. No tables move.
   - Trusting that `data` for a Character actually has the fields a Character should have → solvable with Zod schemas at write time. Validation, not schema.

**Alternatives considered (and rejected):**

- **A. Class-table inheritance.** Base `entities` table for shared fields, separate tables (`characters`, `events`, `locations`, ...) for type-specific fields, joined by FK. *Rejected:* cross-type queries (which the graph and timeline need constantly) require UNION ALL across N tables, schema changes touch multiple places, every new entity type adds a table + migration.

- **B. Per-type tables, no shared base.** `characters`, `events`, `locations` each fully independent. *Rejected:* relationships table needs polymorphic FKs (SQLite limitation), cross-type entity listings require UNION, no clean way to express "all entities created this week" without a UNION query across every table.

- **C. Hybrid: keep entities, add per-type read-only "view" tables for fast type-specific queries.** *Rejected as premature.* Adds maintenance burden (view sync) without evidence the existing query patterns are slow.

**Mitigations to implement (when each becomes load-bearing):**

- TypeScript discriminated-union types over `data` with Zod validation at the API layer. Land this in PR 1 of any future "type-safety hardening" branch.
- Search + faceted filters in entity listings (Wiki sidebar, Story Graph search box). Land per-window as those windows grow user-hostile.
- Pagination on entity API endpoints (`GET /api/entities?type=Character&limit=50&offset=0`) when listings get slow. Defer until measurable performance issue.

**Reversal cost if proven wrong:** Schema-level. Migrating from single-table to class-table inheritance later is doable but expensive — every relationship FK needs revisiting, every API endpoint touches multiple tables. The bet is that code/UI mitigations land sooner and address the real pain. If we hit a query pattern that genuinely cannot be served from `entities` + `data` JSON (e.g., a feature requiring frequent indexed queries on a deep field inside `data` for a single entity type), reconsider then.

---

### [2026-04-28] /plan-eng-review resolutions — Phase 1A PR 1 lock-in

Six findings surfaced and locked during plan-eng-review on 2026-04-28. Capturing here so they don't drift between the design doc and implementation.

**1. Issue 1.1 — Hijack `appears_in` writes during PR 1 transition window.**

The existing UIs (CharacterEditor's "Linked Entities" panel, StoryGraph's edge-creation flow) write `appears_in` rows to `relationships`. After migration, `appears_in` rows are gone and the V1 timeline reads from intervals via the compat layer. Without action, new `appears_in` writes become orphan rows that never render. Fix: `POST /api/relationships` with `type='appears_in'` internally calls `writeInterval()` instead. Returns the same response shape so existing UI doesn't break. ~20 lines of glue, deleted in PR 2 when V2 timeline ships its own creation UI.

**2. Issue 1.2 — Polymorphic FK type-safety = `writeInterval` validation + Vitest invariant test.**

`start_act_id` / `end_act_id` must reference entities of `type='Act'`; `start_scene_id` / `end_scene_id` must be `type='Scene'`. SQLite cannot enforce. Fix: `writeInterval` validates types at write time and throws on mismatch. The existing position-FK invariant test in `test/db-invariants/intervals.test.ts` extends to also walk every row asserting type alignment. One extra join per row in the test, runs on every test cycle, fails loudly on drift.

**3. Issue 1.3 — Pre-migration snapshot via SQLite native `.backup`, not JSON export.**

Replace the proposed JSON export script with a single shell wrap of `sqlite3 local.db ".backup local.db.backup-pre-intervals-{timestamp}"`. Restore is `cp file.backup local.db`. Schema-drift-safe by design (the binary is the schema-of-the-time). If human-readable inspection is needed: `sqlite3 backup.db ".dump"` produces SQL on demand.

**4. Issue 2.1 — Extract `computeIntervalPositions()` to a pure shared function.**

The math (`Act i` occupies `[i, i+1)`, `Scene k of m within Act i` occupies `[i + k/m, i + (k+1)/m)`) lives in ONE place: `src/lib/server/intervals.ts`, exported as a pure function. Both `writeInterval` and the Vitest invariant test call it. Add unit tests at `test/intervals-math.test.ts` covering all six worked-example cases. Single source of truth on the formula; drift impossible across the call sites.

**5. Cross-model tension 1 — Acts use `entities.position` + global recompute on Act mutations.**

The math `act_index = Math.floor(position)` assumes a stable, dense, integer-indexed Act sequence. The schema delta added `position` to entities for sibling order within parent. **Acts at the root level (no `parent_id`) also use this column for their own ordering.** Act index = rank in `SELECT id FROM entities WHERE type='Act' AND parent_id IS NULL ORDER BY position`.

Add `recomputeAllIntervals()` that runs in the SAME transaction as any Act-level mutation (insert, reorder, delete). Walks every interval row and recomputes positions from FKs. Acts are typically ≤30 in any story, so the row-count touched is bounded; performance is fine. Without this, inserting an Act between two existing acts shifts every downstream interval's position by +1 silently.

The Vitest invariant test scope tightens accordingly: it only checks scene-anchored rows for FK→position consistency (fraction-positioned rows have frozen positions by design and aren't FK-derivable). For ALL rows it also asserts `floor(start_position) == act_index_of(start_act_id)` and the same for end — this catches Act-ordering drift.

**6. Cross-model tension 2 — Compat layer covers BOTH V1 timeline and StoryGraph read paths.**

PR 1 hijack writes `appears_in` to intervals. StoryGraph reads `appears_in` from `relationships` to draw edges. After migration, those rows are gone — StoryGraph stops showing the edges. Fix: extend `src/lib/server/timeline-compat.ts` with `getAppearsInRelationships()` that synthesizes `appears_in`-shaped rows from `intervals` on read. StoryGraph's data loader calls through it. Symmetric with the hijack on writes. Same rule: throwaway code, deleted in PR 2 when V2 timeline ships its own affordance and StoryGraph reads cleanly from a unified source.

**7. Cross-model tension 3 — Strategic sequencing held: PR 1 schema → PR 2 V2 timeline UI → Phase 1.5 scrubber.**

Outside voice argued for scrubber-first (ship the magical demo in 2-3 weekends, defer V2 timeline UI). User reviewed the trade-off and held the current plan: timeline UX is load-bearing, the rewrite ships before the scrubber. No change to the phase plan.

---

### [2026-04-28] /plan-design-review resolutions — V2 Timeline UI lock-ins

Visual mockup locked at `~/.gstack/projects/jzeng151-betwixt-and-between/designs/v2-timeline-20260428/v2-timeline-mockup-v2.html` after one iteration. Decisions made during the design review pass that affect implementation:

**1. Row label column dropped.**

V1 timeline put each character's name in a 140px column at the start of every row. The palette sidebar already shows the same names. Dropping the row labels saves ~140px of horizontal real estate per row and eliminates the duplication. Bars are now first-class objects on the timeline grid, not "things inside a labeled row."

**2. Bars carry their own identifier — entity name + optional note snippet.**

Each interval bar shows up to two lines of text (when width allows):

- Line 1: `entity.name` rendered in `var(--font-display)` (Fraunces) at 13px, `font-weight: 500`. Truncates with ellipsis when constrained.
- Line 2 (optional): a snippet drawn from the entity's notes data, in `var(--font-ui)` (Inter) 10px, `opacity: 0.75`. Default source: first non-empty line of `entity.data.notes` truncated to ~30 characters.

User configuration: a new optional field `data.timelineLabel` on each entity overrides the default snippet source. UI affordance for setting this lives on the entity editor (CharacterEditor / event editor / etc.) under a "Show on timeline" control with three options: **name only** / **name + note snippet** (default) / **custom field**. Plumbing needs to ship in PR 2 alongside the timeline UI itself.

**3. Width breakpoints decide what fits.**

Bars dynamically adjust text rendering based on rendered width:

- `width >= 100px` (`.normal`) — name + note both shown
- `40px <= width < 100px` (`.narrow`) — name only, note hidden
- `width < 40px` (`.tiny`) — both lines hidden, bar is a colored sliver, identification via tooltip only

Implementation: compute on render or via `ResizeObserver` on the bar element. CSS classes drive the visibility.

**4. Hover tooltip on every bar (with keyboard + screen-reader parity).**

Format: `{entity.name} · {presence range}`. Examples:
- `Ellie · Act 1, scenes 0–2`
- `Damien · last 50% of Act 1 → end of Act 2`
- `Battle of Three Rivers · end of Act 2 → start of Act 3`

The presence range is computed at render time from `(start_position, end_position)` mapped back to act/scene/fraction labels using the math in CONSIDERATIONS.md → "The math, with variable definitions."

Accessibility: same content goes to the bar's `aria-label` attribute for screen readers. Tooltip shows on keyboard focus (`tab`-navigation), not just mouse hover. The CSS `.interval::before` pattern in the mockup is the reference; production should use a real tooltip library or accessible custom component (probably a focus-visible-aware Svelte action) to handle keyboard, screen reader, and viewport-edge clipping properly.

**5. Events render on the timeline alongside characters.**

Event entities are first-class on the timeline. Same drag-from-palette → create interval flow. Visual differentiation: events use a neutral gray (`--color-event: #94a3b8`) instead of a per-character color. The shared shape (rounded rectangle bars on the same grid) keeps the timeline pattern coherent; the color signals "different kind."

The Events palette section in the sidebar lists draggable event chips. Same color-dot + name pattern as character chips.

**6. Color strategy for stories with many characters — flagged but not solved.**

Per-character colors are visually distinct for ~5 characters today (amber, teal, indigo, sage + neutral). Stories with 8+ characters need a strategy: auto-cycle from a curated palette? user-pick from a set? color-blind-mode alternative? Captured as an open question for PR 2's own /plan-design-review when the V2 timeline is being built.

**Files affected by these decisions in PR 2:**

- New `src/lib/components/apps/TimelineV2.svelte` (and child components for palette, acts header, scenes row, character/event row, interval bar)
- New `src/lib/components/IntervalBar.svelte` — the per-bar component implementing width breakpoints, tooltip, focus handling, drag-edge resize
- Schema delta on `entities`: optional `data.timelineLabel` config field (no migration needed; nullable JSON path)
- Entity editor UI updates: CharacterEditor and any other entity-edit window gets the "Show on timeline" control under data fields

---

### [2026-04-30] Cloud deployment lock-in — Neon Postgres + Auth.js (supersedes prior Turso direction)

Two research passes during /plan-eng-review on `refactor/intervals-sync-t1` reframed the cloud migration. The prior 2026-04-22 design memo (memory: `project_cloud_migration.md`) had locked Turso + Auth.js with a per-user-DB registry pattern. That direction is **superseded** by this entry.

**Why the pivot:**

1. **Auth.js + async libSQL is broken in 2026.** [next-auth#9276](https://github.com/nextauthjs/next-auth/issues/9276) confirms `@auth/drizzle-adapter` doesn't compose cleanly with async libSQL clients. The Turso + Auth.js stack the prior memo assumed has a real compatibility blocker. Choosing Turso would force either a workaround in Auth.js, a self-rolled session layer, or staying on the (sync) better-sqlite3 driver locally and switching only at the cloud edge — none of which were costed in the original design.
2. **T1 (sync conversion of `intervals.ts`) is rendered unnecessary by a Postgres port.** Drizzle's pg adapter (`drizzle-orm/postgres-js` or `node-postgres`) supports `db.transaction(async (tx) => ...)` natively. The polymorphic-tx work D17 deferred to T1 falls out of the port for free; the helper chain stays async. T1 was ~1 day; the Postgres port is ~3-4 days but absorbs T1's intent.
3. **Test-infra cost evaporates with PGlite.** Postgres compiled to WebAssembly, runs in-process. `tests/helpers/test-db.ts` swaps `better-sqlite3 :memory:` for `@electric-sql/pglite` + `drizzle-orm/pglite` with identical zero-overhead semantics. The 215 integration tests stay <5s, no Docker, no Testcontainers, no Neon-API-in-CI. This was the largest concrete cost in the "skip Postgres" case from the first research pass; it disappears.
4. **Stack modernization.** `entity.data` moves from `text` (JSON-stringified) to `jsonb` (queryable, indexable) — useful for future Wiki filter/search features. CHECK constraints, FK cascades, indexes carry over identically.

**What we're locking:**

- **Database:** Neon Postgres. Free tier (0.5 GB / 100 CU-h / scale-to-zero) covers single-user comfortably; ~$5/mo if cold-start latency on free tier becomes annoying. Storage cost is essentially zero at this app's scale (~1-3 MB per user with 1000 entities). Acquired by Databricks May 2025; brand stable but verify pricing before any multi-year commitment.
- **Auth:** Auth.js v5 + `@auth/drizzle-adapter` against Postgres. Standard 4-table schema (users / accounts / sessions / verificationTokens). Single-user-now-but-multi-user-ready: gate writes by `session.user.id` in handlers without adding `userId` columns to existing tables yet.
- **ORM:** stay on Drizzle 0.45+. Schema migrates `sqliteTable` → `pgTable` (mechanical rewrite, ~150 LOC). Two existing migration files (`0000_amusing_argent.sql`, `0001_mature_stepford_cuckoos.sql`) regenerated from scratch in PG dialect via `drizzle-kit generate` — cleaner than dialect-aware preservation given the short history.
- **Test runtime:** PGlite in-process. Same SQL/types/planner/transaction semantics as full Postgres; differences (no concurrency, subset of extensions, no replication) are irrelevant to this app's tests.
- **Local dev:** Neon dev branch via `.env.local` as primary path. Fallback: 6-line `docker-compose.yml` running `postgres:17-alpine` for offline dev.
- **Hosting (SvelteKit Node app):** Fly.io with `adapter-node` is the assumed deploy target (matches existing tooling, supports Auth.js cleanly). Vercel works equally well; Cloudflare Workers/Pages would force a separate re-architect and is not on the table.

**Self-host alternative (retained, not chosen):**

If the app's destiny is "single-user forever, run on a Pi in the closet," the better answer is **stay on better-sqlite3, skip Auth.js, expose via Tailscale**. Total cost ~$1-3/month (electricity + B2 backups). Better-sqlite3 is faster than Postgres for single-process single-writer; the entire migration burden is wasted in that scenario. Decision to lock in Neon + Auth.js commits to a multi-user-capable foundation; if the app stays single-user, the cost is ~3-4 days of porting work for benefits never realized. Accepted as the right bet given the cloud-deploy intent in the original design memo.

**What this means for `intervals.ts` / T1 / D17:**

- **T1 (sync-mode refactor)** in TODOS line 356 is **superseded** — not deferred, not blocked, replaced. The branch `refactor/intervals-sync-t1` should be repurposed (or closed) in favor of a `refactor/sqlite-to-postgres` branch.
- **D17 / Issue 11A**'s "TODO T1 is now blocking for Turso migration" assertion is **outdated**. The Postgres port closes the same read-modify-write window without the sync conversion. Polymorphic `Db` type alias added in Phase 1.6 carries over (just changes what types it unions over: `PgDatabase | PgTransaction` instead of `BetterSQLite3Database | SQLiteTransaction`).
- The raw `client.exec('BEGIN')`/`'COMMIT')` workaround in `splitInterval` (added 2026-04-30 as Greptile P1 fix) is **dropped during the port** — replaced by a proper `db.transaction(async (tx) => ...)` wrap. The defensive shape is correct for the current sqlite world; the port retires the whole pattern.
- All async/await in `intervals.ts` **stays async**. The polymorphic-tx work D17 deferred is done as part of the port, not as a separate refactor.

**Time estimate (with Claude Code):**

- ~1 day: schema port + migration regen + PGlite swap in tests + intervals.ts cleanup. Skip Auth.js. (Ships local dev only.)
- **~3-4 days (target):** above + Auth.js scaffold + Neon signup + deploy config + smoke tests against real Neon. This is the lock-in scope.
- ~1.5-2 weeks: above + `userId` columns on existing tables + RLS + production hardening + dev-data migration script.

**Migration sketch (concrete, for the next plan-eng-review):**

| Concern | Change |
|---|---|
| `sqliteTable` → `pgTable` | Mechanical, ~150 LOC schema rewrite |
| `integer({mode:'timestamp'}).default(sql\`(unixepoch())\`)` | → `timestamp({withTimezone:true}).notNull().defaultNow()` |
| `text('data').notNull().default('{}')` (JSON-stringified) | → `jsonb('data').notNull().default(sql\`'{}'::jsonb\`).$type<EntityData>()`. Drop `JSON.parse`/`JSON.stringify` calls at boundaries |
| Migrations | `rm -rf drizzle/` → flip `dialect: 'postgresql'` → `drizzle-kit generate` for clean PG baseline |
| Tests | `tests/helpers/test-db.ts` swaps better-sqlite3 → `@electric-sql/pglite` + `drizzle-orm/pglite` |
| `intervals.ts` | Drop `$client` cast + raw BEGIN/COMMIT in `splitInterval`. Wrap callers in `db.transaction(async tx => ...)`. Thread `Db | Tx` (already typed). Helpers stay async |
| Auth.js | Standard 4 tables added via `auth-schema.ts`. `SvelteKitAuth` wired in `src/hooks.server.ts` with `DrizzleAdapter(db, { usersTable, ... })`. `AUTH_SECRET` + provider OAuth env vars |
| Local dev | Neon dev branch via `.env.local`; docker-compose fallback for offline |

**What this entry does NOT lock:**

- OAuth provider list (GitHub vs Google vs both) — defer to deploy time; trivial to add either.
- Whether to add `userId` columns to existing tables in v1, or gate by session in handler code only — defer until the multi-user UX is actually being designed. Same-process pragma: don't migrate data we don't need to migrate.
- Account deletion / GDPR machinery — flagged in prior memo as v1 scope; carry forward but don't block initial deploy on it.
- Per-user DB registry pattern from prior Turso memo — **abandoned**. Single Postgres database, multi-tenant via `userId` rows, is the simpler default and matches Auth.js conventions.

---

### [2026-05-01] T8 split — port now, deploy after Phase 1B (refines [2026-04-30])

/plan-eng-review on T8 produced a scope split + auth-provider change. The locked direction from [2026-04-30] is preserved at the strategic level (Neon + Postgres + multi-user-capable foundation); the implementation is sequenced into two PRs with Phase 1B between them. Auth provider changes from Auth.js to **Better-Auth** based on the user's flexibility and Better-Auth's cleaner DX for the Drizzle pg + magic-link path.

**T8a — sqlite→Postgres port (pre-Phase-1B):**

- Driver swap: `drizzle-orm/better-sqlite3` → `drizzle-orm/postgres-js` against Neon dev branch (local) and Neon free tier (eventual prod). `postgres-js` chosen over `node-postgres` (faster, modern API) and over `@neondatabase/serverless` (provider-agnostic preserves option to swap providers later).
- Schema port: `sqliteTable` → `pgTable`. Native `uuid('id').defaultRandom()` for PKs (4 tables) + matching FKs (~12 columns). `text('data')` JSON-stringified → `jsonb('data').$type<EntityData>()` on entities (drops `JSON.parse`/`JSON.stringify` boundary calls in stores + handlers). `integer({mode:'timestamp'}).default(sql\`(unixepoch())\`)` → `timestamp({withTimezone:true}).notNull().defaultNow()` for createdAt/updatedAt.
- BEFORE UPDATE trigger per table sets `NEW.updated_at = now()`. Drops 17 manual `updatedAt: sql\`(unixepoch())\`` lines across handlers and intervals.ts. DB-side automation beats application-side discipline here (systems-over-heroes principle).
- CHECK constraints, FK cascades, unique indexes carry over identically.
- Migrations: `rm -rf drizzle/` → flip `drizzle.config.ts` to `dialect: 'postgresql'` → `drizzle-kit generate` produces clean PG baseline. The two existing sqlite migrations are not preserved (short history; regen is cleaner than dialect-aware preservation).
- `intervals.ts` cleanup: drop `client.exec('BEGIN')` raw cast in `splitInterval`; replace with `db.transaction(async (tx) => ...)`. Thread `Db | Tx` polymorphism through helper chain (rolls in the deferred D17 polymorphic-tx work). Helpers stay async — no sync conversion. The `Db` type alias just re-unions over `PgDatabase | PgTransaction`.
- Tests: `tests/helpers/test-db.ts` swaps `better-sqlite3 :memory:` for `@electric-sql/pglite` + `drizzle-orm/pglite`. Postgres compiled to WASM, in-process, same SQL/types/planner/transaction semantics as full pg. 215 existing integration tests pass against pg unchanged. PGlite version pinned to match Neon's Postgres major version (PG 17).
- New tests added in T8a:
  - `intervals-split-atomicity.test.ts` — **CRITICAL REGRESSION** — verifies that `db.transaction(async tx => { await splitInterval(tx, ...); throw })` rolls back both UPDATE and INSERT halves. Replaces the deferred-T1 raw-BEGIN/COMMIT workaround we're removing.
  - `jsonb-roundtrip.test.ts` — entity.data deep-equal across insert/read cycle.
  - `updated-at-trigger.test.ts` — trigger fires on every UPDATE.
  - `check-constraint.test.ts` — `intervals_position_order` CHECK still rejects start ≥ end.
  - `uuid-pk.test.ts` — auto-generated v4 uuid on insert.
- Local dev: Neon dev branch via `.env.local` (primary). 6-line `docker-compose.yml` with `postgres:17-alpine` as offline fallback.
- CI: minimal `.github/workflows/test.yml` runs `npm test` on PR. Reusable in T8b for the deploy workflow.
- T8a does NOT add userId columns or Auth.js wiring. Schema is pg-ready but app code is single-tenant. The ENTIRE multi-user concern lands in T8b after Phase 1B.

**Phase 1B — graph features (between T8a and T8b):**

- Lands on the new pg foundation. Phase 1B Lane A's "Migration 0002" becomes the next migration after T8a's regenerated PG baseline.
- New endpoints (canvas-positions/window/[windowId]/batch etc.) are written in pg patterns from the start (async tx, no sync workarounds).
- No auth gating yet — Phase 1B inherits T8a's single-tenant assumption.

**T8b — auth + deploy + multi-user (post-Phase-1B):**

- **Auth provider: Better-Auth** (Drizzle-compatible, magic-link + Google OAuth). Reasoning: cleaner DX than Auth.js v5 for the Drizzle pg path; first-class plugins for magic-link and Google OAuth; framework-agnostic so a future SvelteKit version bump is less likely to break. Risk acknowledged: smaller community than Auth.js, 2024-launched project; the magic-link path is simple enough that a swap to Auth.js later is bounded if Better-Auth ever falters.
- Auth methods at v0: magic-link (primary, works for any email user) + Google OAuth (one-click for users with Google accounts). Better-Auth's test mode returns the magic code in the response, enabling Playwright E2E without a real mailbox; mock OAuth provider runs in CI test setup for the Google flow.
- userId columns added to entities, relationships, intervals, canvas_positions in T8b's migration. Per-endpoint isolation tests verify cross-user access fails — ~18 explicit tests (per-endpoint × attack-vector), not a parametric harness, so CI failures point at the exact guarantee that broke.
- Deploy: SvelteKit on Fly.io with `adapter-node` against Neon free tier (or Launch $5/mo for warm compute if cold-start latency annoys). `fly.toml` + `.env.example` + DEPLOY.md.
- CI/CD: `.github/workflows/deploy.yml` auto-deploys on main merge. Fly token in GH Actions secrets.
- Backups: `.github/workflows/backup.yml` runs weekly, `pg_dump | gpg | rclone copy` to a Backblaze B2 bucket. Restore script tested as part of T8b acceptance criteria. ~$1-2/mo storage. Neon's 24h-free / 7d-paid PITR alone is insufficient for a writer's app where data IS the product.

**Estimated time (with Claude Code):**
- T8a: ~1-1.5 days. Lean port, no auth complexity.
- Phase 1B: separate plan-eng-review; not estimated here.
- T8b: ~2 days. Auth + deploy + CI/CD + backups + multi-user gating + isolation tests.

**What this entry locks (not in [2026-04-30]):**
- Better-Auth (replaces Auth.js).
- Magic-link + Google OAuth auth methods.
- T8 sequencing: T8a → Phase 1B → T8b.
- BEFORE UPDATE trigger pattern for updated_at.
- Native `uuid()` PKs.
- Postgres-js driver.
- Per-endpoint explicit isolation tests (no parametric harness).

---

## Open Decisions (not yet locked)

- Drag-and-drop palette behavior: always show all entities vs filter to "unplaced only." *Defer; ship simplest version first.*
- Scrubber feature (global currentT store, Story Graph / World Map / Wiki react to time T): *flagged as Phase 1.5 stretch; falls out of the interval schema for free.*
- Color strategy for stories with 8+ characters. *Defer to PR 2's /plan-design-review.*
- Drop-target rules (palette → empty area vs palette → existing row vs palette → conflict-color row). *Defer to PR 2's /plan-design-review.*
- "Break into scenes" interaction (modal / inline / popover). *Defer to PR 2's /plan-design-review.*
- Events vs characters visual differentiation beyond color (different shape? dashed border?). *Defer.*

---

# [2026-04-29] /plan-design-review + /plan-eng-review resolutions — Act/Event/Scene editor + reorder + structural moves

Branch: `feat/timeline-redesign`. Phase 1.6 in `TODOS.md` Section 13. Design plan source: `~/.gstack/projects/jzeng151-betwixt-and-between/designs/act-event-editor-20260429/plan.md`. Approved mockup: `variant-A-sidepanel.html` in same directory.

**Goal:** Acts, Events, and Scenes get edit / insert-between / drag-reorder / delete affordances. Editor metadata follows story-craft conventions (synopsis, goal, stakes, turning point, POV, outcome). Scenes get full editing in this PR (was deferred under 8C, pulled in per user direction). Sets the unified `EntityDetail` abstraction so the future Wiki rework is additive.

## Locked decisions

### Editor surface

- **D1 / Issue 1A — Extend existing entities API endpoints (not new routes).** `POST /api/entities` for Act type bumps siblings on insert-between. `PATCH /api/entities/[id]` accepts `position` and `parentId`; for Acts/Scenes, position changes cascade siblings server-side (same algorithm as POST insert-between, applied to existing rows). `DELETE /api/entities/[id]` accepts optional `?moveScenesTo=<actId>` query param. All three handler bodies wrapped in `db.transaction(async (tx) => {...})`. Cleans up the standing `intervals-cascade.test.ts:135` "preserved (recompute would clear them; that's a follow-up)" gap as a free side effect.

- **D2 / Issue 2B-i — Single editor surface per entity at a time, with inline confirmation before swap.** When a window already hosts a given entity (matched by entityId across any appId), clicking that entity focuses the existing window. The "↗ Move to window" button shows an inline confirmation row matching `ActsHeader`'s delete-confirm pattern: button transforms to "Move to standalone window? [Cancel] [Move]". On confirm: side panel closes, pop-out window opens. Mutex check is `findOpenEditorFor(entityId)` matching by entityId regardless of appId — covers windows whose appId is in transition (e.g., legacy `'timeline'` windows during the Wiki migration).

- **D3 / Issue 3A-i — Pop-outs are pinned, multiple allowed.** Each pop-out window stays bound to the entity it was opened for. Clicking a different entity in the timeline opens the side panel for that one (pop-out unaffected). Multiple pop-out windows for different entities can coexist; `windowStore`'s `${appId}-${entityId}` keying already supports this. Closing the pop-out doesn't auto-reopen the side panel.

### Field set + storage

- **D4 / Issue 4C — POV stored as `relationships` row with new type `'pov_of'` (not soft pointer in `entity.data`).** Direction: `fromId = event/scene id, toId = character id, type = 'pov_of'`. Reads "Event is from the POV of Character" — matches existing `mentor_of` / `allied_with` directional convention. Story Graph automatically renders POV edges (existing edge-rendering already iterates relationship rows). Schema FK CASCADE handles deleted-character dangling references.

- **D4-extension / Issue 18-revised B — Multi-POV allowed; uniqueness enforced at `(from_id, to_id, type)`.** Real story-craft use case: ensemble events, head-hopping fiction, POV-rotation novels. The constraint prevents *literal duplicates* (same character listed twice as POV for the same event) without preventing *multi-POV semantics*. EventEditor and SceneEditor's POV field is a multi-select chip picker. New `EditableField` `kind` value: `'multi-entity-picker'` for "select 0-to-N entities of a given type for a given relationship type." Migration deduplicates any existing duplicate relationship rows before applying the index.

- **D5 / Field hierarchy + storage** — All editor fields persist under `entity.data` JSON (no schema migration for fields). Acts: Title (header), Synopsis, Goal, Stakes, Turning point, Color. Events: Title, Description, POV (multi via D4-extension), Outcome (Dwight Swain 5-value: yes / yes-but / no / no-and / mixed), Mood, Color. Scenes (added per T3-now): Title, Description, POV (multi), Goal, Outcome, Sensory anchor, Word-count target, Color. Cuts from research: per-field helper text, Status field, Mood for Scenes (covered by Description tone), Conflict for Scenes (subsumed by Goal+Outcome).

### Affordances

- **D6 / Issue 5A — Insert-between act stretches crossing intervals through the new act.** Existing `recomputeAllIntervals` already implements this. An interval that crossed an act boundary at `[0.7, 1.5)` becomes `[0.7, 2.5)` after insert. **Note:** intervals ending exactly at an act boundary (e.g., `[1, 2)` covering all of Act 1) ALSO stretch — the half-open `oldFraction === 0` branch at `intervals.ts:566-568` pushes them to start-of-next-act, which becomes the new act after insertion. To remove an entity from the new act, writer uses the bar-hairline split affordance (D7).

- **D7 / Issue 5b A — Click hairline on multi-act bar to split into adjacent intervals.** Multi-act bar's existing internal hairlines become clickable (cursor changes on hover). Click splits the bar at that act boundary into two adjacent intervals. New helper `splitInterval(db, intervalId, atPosition)` — wraps update + insert in a transaction. Each half is independently editable / resizeable / deletable. Single-act bars don't get a split affordance (no internal hairlines to click).

- **D8 / Issue 6A — Playhead stays at absolute T during act/scene reorder.** Playhead is a story-time value, not "wherever this act is." Reorder shifts acts under the playhead; subscribers (Story Graph, World Map) re-filter naturally based on which intervals overlap the absolute T. No code change — the existing `playhead.scrubTo(t)` semantic is preserved.

- **D9 / Issue 7B — Move-or-delete dialog on act delete with scenes.** Inline confirmation grows a "Move scenes to: [picker]" radio option. Server reparents scenes (UPDATE `parent_id`, `position`) before cascade-deleting the act, all in one `db.transaction`. **P2-3 fix: reparent step also UPDATEs `intervals.start_act_id` / `intervals.end_act_id` for any interval anchored to a reparented scene** (otherwise scene's parent changed but interval still references the soon-to-be-deleted source act).

### Routing + groundwork for Wiki

- **D10 / Issue 9A — `EntityDetail` abstraction; `'entity-detail'` app id; `openEntityDetail()` helper.** Component name is host-agnostic. Side panel and pop-out window both render `<EntityDetail entityId={...} />` inside their own chrome. New `'entity-detail'` app id is the single dispatch path for entity editor windows (current PR: Act+Event+Scene; future Wiki PR: Character+Location+Note). `openEntityDetail(entityId)` helper added to `navigation.js` for explicit "always open entity-detail surface" calls.

- **D10-extension / Issue 19A — Migrate `ENTITY_APP[Act]` and `ENTITY_APP[Event]` from `'timeline'` → `'entity-detail'`.** Plus `ENTITY_APP[Scene] = 'entity-detail'` (collapses the original T8 TODO into this PR since SceneEditor ships here per T3). Existing code that called `windowStore.openForEntity(actId, 'Act')` now opens the entity-detail editor. Story Graph EntityLink clicks on Acts/Events/Scenes go to the editor (intentional behavior change — the Story Graph rework will further refine this surface). `ENTITY_APP[Character/Location/Note]` stay as today; migrate when Wiki rework lands.

- **D11 / Forward-compat note** — Storage format for synopses/descriptions: plain text in `entity.data`. No `[[wiki-link]]` markup, no structured ProseMirror nodes. Future entity-mention parsing or autocomplete can be added as a richer rendering layer over the same plain text without storage migration.

- **D12 / EntityDetail "fall-through" rule (this PR)** — EntityDetail routes Act → ActEditor, Event → EventEditor, Scene → SceneEditor. All other types use existing app routing (Character → CharacterEditor, Location → WorldMap, Note → Wiki). Future Wiki PR fills in those branches.

### Component pattern

- **D13 / Issue 10A — Extract `<EditableField>` atom shared by all editors.** Single component encapsulates the edit/draft/commit cycle. Props: `entityId`, `field`, `label`, `kind` ('single-line' | 'textarea' | 'picklist' | 'swatches' | 'multi-entity-picker' from D4-ext), `placeholder?`, `rows?`, `picklistOptions?`, `swatchOptions?`. Reads current value from `$entities.find(id).data[field]`. Commits via `entities.updateEntity(id, { data: { ...existing, [field]: draft } })`. **Commit timing (P2-5):** textarea/single-line commit on blur; picklist/swatches commit on change. Esc cancels. Forward-compat: future Wiki entry can compose the same atoms with richer chrome (e.g., relationship sidebar) without refactoring this layer.

### Save behavior + state coverage

- **D14 / Autosave on blur per field (textarea/single-line); on change (picklist/swatches/multi-entity-picker).** Footer shows `Saving…` → `Saved · Xs ago` (live-updating timestamp every 30s).

- **D15 / State coverage** — Side panel hidden when no selection. Selected-empty entity: placeholders only, no "Not set yet." labels. Save error: inline red message below the failing field + Retry button. Writer's text preserved client-side, no rollback of the typed value. Optimistic update applies immediately to `$entities`; rollback via `load()` if PATCH fails.

- **D16 / Issue 14A — Toast with last-typed preview + Copy button on entity-deleted-while-editing.** When entity disappears from store while EntityDetail is mounted (and a successful PATCH/DELETE confirmed the disappearance per P2-1, not just optimistic remove), capture all `EditableField` drafts. Toast renders truncated preview (~80 chars + ellipsis) with full draft text on clipboard via Copy button. 8s dismiss timer (longer than standard 4s for read-time). EntityDetail watches `$entities.find(id)` plus a "confirmed deletion" flag to avoid firing on optimistic-then-rolled-back deletes.

### Server-side correctness

- **D17 / Issue 11A + 17A — REVISED 2026-04-29 during implementation.** During the polymorphic-tx refactor, hit a hard constraint: better-sqlite3's `db.transaction()` requires a *synchronous* callback. Passing an async function throws `TypeError: Transaction function cannot return a promise`. Drizzle's better-sqlite3 adapter inherits this. Our entire helper chain (`actIndexOf`, `sceneIndexOf`, `assertEntityType`, `assertNoOverlap`, `validateFKTypes`, `computeIntervalPositions`, `recomputeIntervalsForAct`, `recomputeAllIntervals`) is async/await for Drizzle TS compatibility, so wrapping their bodies in `db.transaction(async (tx) => ...)` is impossible without first converting the chain to sync. The polymorphic `Db` type alias is added in this PR (forward-compat for when T1 lands) but the actual `db.transaction(...)` wrapping is **deferred to T1**. Until T1 ships, the connection-level serialization in better-sqlite3 keeps each individual `.insert()` / `.update()` atomic; the read-modify-write window between FK validation and the final write is open only to concurrent writers in another process — better-sqlite3's single-connection-per-process model makes that impossible today. Future-Turso replica lag is the genuine risk that T1 will close. **TODO T1 is now blocking for Turso migration**, not optional polish.

- **D18 / Issue 12A — PATCH cascades sibling positions server-side.** PATCH on `/api/entities/[id]` with `position` field for an Act/Scene cascades sibling positions inside the same transaction. Algorithm: read old position P, if N < P bump siblings in [N, P) by +1, if N > P bump siblings in (P, N] by -1, set target's position = N, recompute. Drag-reorder UI sends one PATCH per drag; no N-parallel-PATCH race. Same algorithm parameterized by sibling-set predicate ("Closing observation" refinement): `(parent_id IS NULL AND type='Act')` for Acts, `(parent_id = X AND type='Scene')` for Scenes. Reusable single helper instead of duplicate cascade logic.

- **D19 / Issue 13A — Extend `entities.createEntity` and `entities.updateEntity` signatures.** `createEntity(type, name, options?)` where options accepts `{ data, parentId, position }`. `updateEntity(id, patch)` patch type accepts `parentId` and `position`. Migrates 3 existing raw-fetch sites in `ActsHeader` to use the helpers. Optimistic update + rollback works for new mutation paths.

- **D20 / Issue 16A — Cache act-index map in `recomputeAllIntervals` and `recomputeIntervalsForAct`.** Build the map once at the start of recompute, reuse for every interval row. Reduces queries from O(intervals × acts) to O(intervals + acts). **P2-4 caveat:** cache is per-call only, never shared across calls. Each recompute invocation rebuilds from current state. Avoids stale-cache issues when nested-recompute happens (e.g., split during reorder).

- **D21 / Issue 20A — `POST /api/entities/batch` endpoint for atomic multi-entity creation.** Body: `{ entities: [...] }`. Validates and inserts all rows in one transaction; calls `recomputeIntervalsForAct` once per affected parent (deduped). Migrates `ActsHeader`'s break-into-scenes from N sequential POSTs to one batch call. Reusable for future bulk-paste / import flows.

### Test strategy

- **D22 / Issue 15A — Full coverage test suite.** 22 spec files: 5 integration (server), 3 unit (stores / atoms / nav), 14 e2e (user flows). Includes a regression test that tightens the existing `intervals-cascade.test.ts:135` "preserved (recompute would clear them)" comment to actively verify recompute happens after act delete (iron-rule regression case per the skill). E2E specs covering scene editor (T3-pulled-in adds 4 specs).

## Worktree parallelization

| Lane | Modules | Depends on |
|---|---|---|
| **A — Server** | `src/lib/server/intervals.ts` (polymorphic-tx refactor, splitInterval, moveSceneToAct, N+1 fix, generalized cascade primitive), `src/routes/api/entities/+server.ts`, `src/routes/api/entities/[id]/+server.ts`, `src/routes/api/entities/batch/+server.ts` (new), migration `000X_relationships_dedup.sql` | — |
| **B — Editor components** | `src/lib/components/EditableField.svelte`, `ActEditor.svelte`, `EventEditor.svelte`, `SceneEditor.svelte`, `EntityDetail.svelte` (all new); `src/lib/stores/entities.ts` (signature changes), `src/lib/navigation.js` (`openEntityDetail`) | — |
| **C — Timeline integration** | `src/lib/components/apps/Timeline.svelte` (side panel, click-to-edit, mutex), `ActsHeader.svelte` (insert-between, drag-reorder, delete-with-reparent, scene drag-reorder, scene cross-act move), `IntervalRow.svelte` (click-to-select), `IntervalBar.svelte` (hairline-split), `WindowManager.svelte` (entity-detail branch), `windows.ts` store (ENTITY_APP migration) | A + B |

**Execution order:** Lane A and Lane B parallel; merge into Lane C. E2E specs alongside features in their respective lanes; full suite at Phase 2 merge.

## NOT in scope (deferred to TODOs)

- **T1** — Drizzle sync-mode refactor (deeper PR 1 cleanup; complementary to D17)
- **T2** — Window snapping (drag-to-edge zones in `Window.svelte`)
- **T4** — Status field for Acts/Events/Scenes (Drafted / In progress / Done / Needs revision)
- **T5** — Bar translation (drag whole bar to shift temporally)
- **T6** — Wiki rework: alphabetical entity browser, fill EntityDetail branches for Character/Location/Note, migrate `ENTITY_APP[Character/Location/Note]` to `'entity-detail'`
- **T7** — Bulk paste / import UI (uses already-shipped `/api/entities/batch`)
