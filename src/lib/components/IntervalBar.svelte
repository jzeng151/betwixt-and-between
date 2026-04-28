<!--
  IntervalBar — atomic visual unit for the V2 Timeline.
  Renders ONE bar with width-breakpoint text logic, hover tooltip via title,
  ARIA label parity for screen readers / keyboard focus, and optional
  vertical hairlines at internal act boundaries (multi-act spans).

  The parent (TimelineV2) positions the bar via inline style left/width and
  passes the rendered widthPx so this component can pick its text class.

  See src/lib/timeline-v2-helpers.ts for the pure helpers used here
  (widthClassForBar, internalActBoundaryFractions).
  See CONSIDERATIONS.md → "/plan-design-review resolutions" for the spec.
-->

<script lang="ts">
  import { widthClassForBar, type WidthClass } from '$lib/timeline-v2-helpers.js';

  interface Props {
    /** Entity name shown on line 1 (Fraunces 13px). */
    name: string;
    /** Optional snippet shown on line 2 when the bar is wide enough. */
    note?: string | null;
    /** Full tooltip text — also goes to aria-label. */
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
  }

  let {
    name,
    note = null,
    tooltipText,
    color,
    widthPx,
    internalBoundaries = [],
    isEvent = false,
  }: Props = $props();

  const widthClass: WidthClass = $derived(widthClassForBar(widthPx));
  const showName = $derived(widthClass !== 'tiny');
  const showNote = $derived(widthClass === 'normal' && note != null && note.trim() !== '');
</script>

<div
  class="interval-bar {widthClass}"
  class:event={isEvent}
  style="--chip-color: {color}"
  title={tooltipText}
  aria-label={tooltipText}
  role="button"
  tabindex="0"
>
  {#if showName}
    <div class="bar-name">{name}</div>
  {/if}
  {#if showNote}
    <div class="bar-note">{note}</div>
  {/if}

  {#each internalBoundaries as fraction (fraction)}
    <div class="hairline" style="left: {fraction * 100}%"></div>
  {/each}
</div>

<style>
  .interval-bar {
    position: absolute;
    top: 10px;
    height: 36px;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 4px 10px;
    cursor: pointer;
    overflow: hidden;
    background: color-mix(in srgb, var(--chip-color) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--chip-color) 50%, transparent);
    color: var(--chip-color);
    transition: filter 0.15s ease, box-shadow 0.15s ease;
    /* width and left set inline by parent */
  }
  .interval-bar:hover {
    filter: brightness(1.15);
  }
  .interval-bar:focus-visible {
    outline: 2px solid var(--color-accent, #c8942a);
    outline-offset: 2px;
  }
  .interval-bar.event {
    color: var(--color-text, #e8e0d0);
  }

  .bar-name {
    font-family: var(--font-display, 'Fraunces', Georgia, serif);
    font-size: 13px;
    font-weight: 500;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bar-note {
    font-family: var(--font-ui, 'Inter', sans-serif);
    font-size: 10px;
    line-height: 1.2;
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  /* Vertical hairline at internal act boundary — multi-act bars only */
  .hairline {
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 1px;
    background: rgba(255, 255, 255, 0.18);
    pointer-events: none;
  }

  /* Width breakpoint classes drive padding so tiny bars don't blow out */
  .interval-bar.tiny {
    padding: 0;
  }
  .interval-bar.narrow {
    padding: 4px 6px;
  }
</style>
