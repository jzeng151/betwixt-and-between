<!--
  IntervalRow — one entity's row of IntervalBars for TimelineV2.

  Renders all intervals for one entity as positioned bars across the track.
  No drag behavior yet (placeholder); subsequent commits add drop targets and
  edge-resize.
-->

<script lang="ts">
  import IntervalBar from '$lib/components/IntervalBar.svelte';
  import { internalActBoundaryFractions } from '$lib/timeline-v2-helpers.js';
  import type { Entity } from '$lib/stores/entities.js';
  import type { Interval } from '$lib/stores/intervals.js';

  interface Props {
    entity: Entity;
    intervals: Interval[];
    idx: number;
    trackWidthPx: number;
    actCount: number;
    colorFor: (entity: Entity, idx: number) => string;
    dataNoteSnippet: (entity: Entity) => string | null;
    tooltipFor: (entity: Entity, interval: Interval) => string;
    pxForFractionalSpan: (span: number) => number;
  }
  let {
    entity,
    intervals,
    idx,
    trackWidthPx,
    actCount,
    colorFor,
    dataNoteSnippet,
    tooltipFor,
    pxForFractionalSpan
  }: Props = $props();

  // Touch trackWidthPx so the row re-renders when the track resizes
  // (pxForFractionalSpan closes over it in the parent).
  $effect(() => {
    void trackWidthPx;
  });
</script>

<div class="row" data-entity-id={entity.id}>
  {#each intervals as iv (iv.id)}
    {@const span = iv.endPosition - iv.startPosition}
    {@const leftPct = (iv.startPosition / Math.max(actCount, 1)) * 100}
    {@const widthPct = (span / Math.max(actCount, 1)) * 100}
    {@const widthPx = pxForFractionalSpan(span)}
    <div class="bar-wrapper" style="left: {leftPct}%; width: {widthPct}%;">
      <IntervalBar
        name={entity.name}
        note={dataNoteSnippet(entity)}
        tooltipText={tooltipFor(entity, iv)}
        color={colorFor(entity, idx)}
        widthPx={widthPx}
        internalBoundaries={internalActBoundaryFractions(iv.startPosition, iv.endPosition)}
        isEvent={entity.type === 'Event'}
      />
    </div>
  {/each}
</div>

<style>
  .row {
    height: 56px;
    border-bottom: 1px solid var(--color-border, #2a2d35);
    position: relative;
  }
  .row:last-child {
    border-bottom: none;
  }
  .bar-wrapper {
    position: absolute;
    top: 0;
    bottom: 0;
  }
</style>
