<!--
  IntervalBar — atomic visual unit for the V2 Timeline.
  Renders ONE bar as an <svg> so multi-act spans render as a single
  continuous element with vector hairlines at internal act boundaries.

  Public Props API is stable — TimelineV2 / IntervalRow / Palette callers
  are unaffected. The parent positions the bar via inline style left/width.

  See src/lib/timeline-v2-helpers.ts for the pure helpers used here
  (widthClassForBar, internalActBoundaryFractions).
-->

<script lang="ts" module>
  // Module-scoped counter — shared across all IntervalBar instances so that
  // server- and client-rendered clipPath ids stay aligned across hydration.
  // Math.random / crypto.randomUUID would produce different ids on each side.
  let clipCounter = 0;
  function nextClipId(): string {
    clipCounter += 1;
    return `ib-clip-${clipCounter}`;
  }
</script>

<script lang="ts">
  import { widthClassForBar, type WidthClass } from '$lib/timeline-v2-helpers.js';

  interface Props {
    /** Entity name shown on line 1 (Fraunces 13px). */
    name: string;
    /** Optional snippet shown on line 2 when the bar is wide enough. */
    note?: string | null;
    /** Full tooltip text — also goes to aria-label and SVG <title>. */
    tooltipText: string;
    /** Per-character or event color, e.g., "#c8942a". */
    color: string;
    /** The rendered width in pixels — drives the breakpoint class. */
    widthPx: number;
    /**
     * Fractions in (0, 1) within the bar where vertical hairlines should
     * render — the act boundaries this bar crosses. Empty for single-act bars.
     */
    internalBoundaries?: number[];
    /** Used by event bars to pick the neutral-gray treatment. */
    isEvent?: boolean;
    /** Click on an internal hairline → split the interval at that fraction. */
    onSplit?: (fraction: number) => void;
  }

  let {
    name,
    note = null,
    tooltipText,
    color,
    widthPx,
    internalBoundaries = [],
    isEvent = false,
    onSplit,
  }: Props = $props();

  const widthClass: WidthClass = $derived(widthClassForBar(widthPx));
  const showName = $derived(widthClass !== 'tiny');
  const showNote = $derived(widthClass === 'normal' && note != null && note.trim() !== '');

  // Bar geometry — body sits inside the 56px row at y=10, height 36.
  const BODY_Y = 10;
  const BODY_H = 36;
  const PAD_X = $derived(widthClass === 'tiny' ? 0 : widthClass === 'narrow' ? 6 : 10);

  // Unique clipPath id so multiple instances don't collide.
  const clipId = nextClipId();

  const textColor = $derived(isEvent ? 'var(--color-text, #e8e0d0)' : color);
  const nameY = $derived(showNote ? BODY_Y + 12 : BODY_Y + BODY_H / 2);
  const nameBaseline = $derived(showNote ? 'hanging' : 'middle');

  let focused = $state(false);
</script>

<svg
  class="interval-bar"
  class:event={isEvent}
  width={widthPx}
  height="56"
  style="position: absolute; top: 0; left: 0; overflow: visible;"
  aria-label={tooltipText}
  role="button"
  tabindex="0"
  onfocus={() => (focused = true)}
  onblur={() => (focused = false)}
>
  <!--
    No <title> child — the visible tooltip is rendered by IntervalRow's
    .bar-wrapper::before/::after pseudo-elements (matching the locked v2
    mockup). aria-label on the <svg> provides the accessible name for
    screen readers and keyboard focus.
  -->

  <defs>
    <clipPath id={clipId}>
      <rect
        x={PAD_X}
        y={BODY_Y}
        width={Math.max(0, widthPx - PAD_X * 2)}
        height={BODY_H}
      />
    </clipPath>
  </defs>

  <!-- Body -->
  <rect
    x="0"
    y={BODY_Y}
    width={widthPx}
    height={BODY_H}
    rx="4"
    ry="4"
    fill={color}
    fill-opacity="0.18"
    stroke={color}
    stroke-opacity="0.5"
    stroke-width="1"
  />

  <!-- Internal act boundaries — clickable to split the interval (D7/5b A) -->
  {#each internalBoundaries as fraction (fraction)}
    <line
      x1={fraction * widthPx}
      x2={fraction * widthPx}
      y1={BODY_Y + 4}
      y2={BODY_Y + BODY_H - 4}
      stroke="rgba(255, 255, 255, 0.18)"
      stroke-width="1"
      pointer-events="none"
    />
    {#if onSplit}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        class="hairline-hit"
        role="button"
        aria-label="Split interval at this act boundary"
        x={fraction * widthPx - 4}
        y={BODY_Y}
        width="8"
        height={BODY_H}
        fill="transparent"
        onclick={(e) => {
          e.stopPropagation();
          onSplit?.(fraction);
        }}
      >
        <title>Click to split here</title>
      </rect>
    {/if}
  {/each}

  <!-- Name -->
  {#if showName}
    <text
      class="bar-name"
      x={PAD_X}
      y={nameY}
      fill={textColor}
      dominant-baseline={nameBaseline}
      clip-path="url(#{clipId})"
    >
      {name}
    </text>
  {/if}

  <!-- Note -->
  {#if showNote}
    <text
      class="bar-note"
      x={PAD_X}
      y={BODY_Y + 24}
      fill={textColor}
      fill-opacity="0.75"
      dominant-baseline="hanging"
      clip-path="url(#{clipId})"
    >
      {note}
    </text>
  {/if}

  <!-- Focus ring -->
  {#if focused}
    <rect
      class="focus-ring"
      x="-2"
      y={BODY_Y - 2}
      width={widthPx + 4}
      height={BODY_H + 4}
      rx="6"
      ry="6"
      fill="none"
      stroke="var(--color-accent, #c8942a)"
      stroke-width="2"
    />
  {/if}
</svg>

<style>
  .interval-bar {
    cursor: pointer;
    transition: filter 0.15s ease;
  }
  .interval-bar:hover {
    filter: brightness(1.15);
  }
  .interval-bar:focus {
    outline: none;
  }
  .bar-name {
    font-family: var(--font-display, 'Fraunces', Georgia, serif);
    font-size: 13px;
    font-weight: 500;
    pointer-events: none;
  }
  .hairline-hit {
    cursor: col-resize;
  }
  .hairline-hit:hover {
    fill: rgba(200, 148, 42, 0.15);
  }
  .bar-note {
    font-family: var(--font-ui, 'Inter', sans-serif);
    font-size: 10px;
    pointer-events: none;
  }
</style>
