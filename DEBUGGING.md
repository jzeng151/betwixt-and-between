# Debugging Log

Investigation reports for non-obvious bugs. Each entry follows the
`/investigate` skill's debug-report format. New entries at the top.

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
