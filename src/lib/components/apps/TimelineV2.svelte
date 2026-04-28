<!--
  TimelineV2 — Phase 1A PR 2 (read-only shell)

  Reads $entities + $intervals and renders the locked v2 layout:
    - 240px palette sidebar (characters + events sections, ungated)
    - main timeline area: acts header → optional scenes row → entity rows of bars

  This commit ships the READ path only. Drag-from-palette to create intervals,
  drag-edge to resize, smart snap, and gap-creation arrive in subsequent commits
  (each gated on a /plan-eng-review pass for the open design decisions).

  Visual reference:
    ~/.gstack/projects/jzeng151-betwixt-and-between/designs/v2-timeline-20260428/v2-timeline-mockup-v2.html
  Spec:
    CONSIDERATIONS.md → "[2026-04-28] /plan-design-review resolutions"
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { entities, type Entity } from '$lib/stores/entities.js';
  import { intervals as intervalsStore, type Interval } from '$lib/stores/intervals.js';
  import IntervalBar from '$lib/components/IntervalBar.svelte';
  import {
    presenceLabel,
    internalActBoundaryFractions
  } from '$lib/timeline-v2-helpers.js';

  interface Props {
    entityId: string | null;
  }
  let { entityId }: Props = $props();

  // ── Data load ────────────────────────────────────────────────────────────
  let loaded = $state(false);
  onMount(async () => {
    try {
      // entities is loaded once at app boot; reload to be safe in dev/HMR.
      await Promise.all([entities.load(), intervalsStore.load()]);
    } catch (err) {
      console.error('[TimelineV2] failed to load:', err);
    } finally {
      loaded = true;
    }
  });

  // ── Derived data ─────────────────────────────────────────────────────────

  // Root-level Acts ordered by position (with createdAt as tiebreaker — matches
  // server-side actIndexOf).
  const acts = $derived(
    $entities
      .filter((e) => e.type === 'Act' && e.parentId == null)
      .sort((a, b) => {
        const ap = a.position ?? Number.MAX_SAFE_INTEGER;
        const bp = b.position ?? Number.MAX_SAFE_INTEGER;
        if (ap !== bp) return ap - bp;
        return Number(a.createdAt) - Number(b.createdAt);
      })
  );

  // Scenes grouped by parent Act id.
  const scenesByActId = $derived(
    (() => {
      const m = new Map<string, Entity[]>();
      for (const e of $entities) {
        if (e.type !== 'Scene') continue;
        if (!e.parentId) continue;
        if (!m.has(e.parentId)) m.set(e.parentId, []);
        m.get(e.parentId)!.push(e);
      }
      // Sort each act's scenes by position then createdAt
      for (const list of m.values()) {
        list.sort((a, b) => {
          const ap = a.position ?? Number.MAX_SAFE_INTEGER;
          const bp = b.position ?? Number.MAX_SAFE_INTEGER;
          if (ap !== bp) return ap - bp;
          return Number(a.createdAt) - Number(b.createdAt);
        });
      }
      return m;
    })()
  );

  const characters = $derived($entities.filter((e) => e.type === 'Character'));
  const events = $derived($entities.filter((e) => e.type === 'Event'));

  // entityId → all its intervals, ordered by start_position
  const intervalsByEntityId = $derived(
    (() => {
      const m = new Map<string, Interval[]>();
      for (const i of $intervalsStore) {
        if (!m.has(i.entityId)) m.set(i.entityId, []);
        m.get(i.entityId)!.push(i);
      }
      for (const list of m.values()) {
        list.sort((a, b) => a.startPosition - b.startPosition);
      }
      return m;
    })()
  );

  // Rows: characters + events that have at least one interval
  const rowEntities = $derived(
    [...characters, ...events].filter((e) => (intervalsByEntityId.get(e.id)?.length ?? 0) > 0)
  );

  // ── Color palette ────────────────────────────────────────────────────────
  const CHARACTER_COLORS = [
    '#c8942a', // amber
    '#2dd4bf', // teal
    '#818cf8', // indigo
    '#86efac', // sage
    '#f472b6', // rose
    '#fbbf24', // gold
    '#34d399', // emerald
    '#60a5fa'  // sky
  ];
  const EVENT_COLOR = '#94a3b8';
  function colorFor(entity: Entity, idx: number): string {
    if (entity.type === 'Event') return EVENT_COLOR;
    return CHARACTER_COLORS[idx % CHARACTER_COLORS.length];
  }

  // ── Track measurement ────────────────────────────────────────────────────
  let trackEl: HTMLDivElement | null = $state(null);
  let trackWidthPx = $state(0);

  $effect(() => {
    if (!trackEl) return;
    const ro = new ResizeObserver(() => {
      trackWidthPx = trackEl?.clientWidth ?? 0;
    });
    ro.observe(trackEl);
    trackWidthPx = trackEl.clientWidth;
    return () => ro.disconnect();
  });

  const N = $derived(acts.length);
  function pxForFractionalSpan(span: number): number {
    if (N === 0 || trackWidthPx === 0) return 0;
    return (span / N) * trackWidthPx;
  }

  // ── Per-bar render state ─────────────────────────────────────────────────
  function dataNoteSnippet(entity: Entity): string | null {
    try {
      const d = JSON.parse(entity.data ?? '{}');
      const notes = typeof d.notes === 'string' ? d.notes : null;
      if (!notes) return null;
      // First non-empty line, truncated to ~30 chars
      const firstLine = notes
        .split(/\r?\n/)
        .map((s: string) => s.trim())
        .filter(Boolean)[0];
      if (!firstLine) return null;
      return firstLine.length > 30 ? firstLine.slice(0, 30).trimEnd() + '…' : firstLine;
    } catch {
      return null;
    }
  }

  function tooltipFor(entity: Entity, interval: Interval): string {
    const range = presenceLabel(interval.startPosition, interval.endPosition);
    return `${entity.name} · ${range}`;
  }
  // Touch entityId so prop is "used" (PR 2 will use it to scroll/highlight).
  $effect(() => {
    void entityId;
  });
</script>

<div class="tl2">
  <!-- ── Sidebar palette ────────────────────────────────────────────── -->
  <aside class="palette" aria-label="Timeline palette">
    <section class="palette-section">
      <header class="palette-label">Characters</header>
      {#each characters as char (char.id)}
        <div class="palette-item" data-entity-id={char.id}>
          <span
            class="palette-dot"
            style="background: {colorFor(char, characters.indexOf(char))}"
            aria-hidden="true"
          ></span>
          <span class="palette-name">{char.name}</span>
        </div>
      {/each}
      {#if characters.length === 0}
        <div class="palette-empty">No characters yet.</div>
      {/if}
    </section>

    <section class="palette-section">
      <header class="palette-label">Events</header>
      {#each events as ev (ev.id)}
        <div class="palette-item" data-entity-id={ev.id}>
          <span class="palette-dot" style="background: {EVENT_COLOR}" aria-hidden="true"></span>
          <span class="palette-name">{ev.name}</span>
        </div>
      {/each}
      {#if events.length === 0}
        <div class="palette-empty">No events yet.</div>
      {/if}
    </section>
  </aside>

  <!-- ── Main timeline ──────────────────────────────────────────────── -->
  <div class="timeline">
    <!-- Acts header -->
    <div class="acts-header">
      {#each acts as act, i (act.id)}
        <div class="act-col-header" style="flex: 1;">
          <div class="act-name">{act.name}</div>
          <div class="act-meta">
            {#if (scenesByActId.get(act.id)?.length ?? 0) > 0}
              {scenesByActId.get(act.id)!.length} scenes
            {:else}
              act-level only
            {/if}
          </div>
        </div>
      {/each}
      {#if acts.length === 0}
        <div class="acts-empty">No acts yet. Add an Act to begin your story.</div>
      {/if}
    </div>

    <!-- Scenes row -->
    {#if acts.length > 0}
      <div class="scenes-row">
        {#each acts as act (act.id)}
          <div class="scenes-act">
            {#if (scenesByActId.get(act.id)?.length ?? 0) > 0}
              {#each scenesByActId.get(act.id)! as scene, k (scene.id)}
                <div class="scene-cell" title={scene.name}>s{k}</div>
              {/each}
            {:else}
              <div class="scenes-act-empty">· · · · ·</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Rows of intervals -->
    <div class="rows" bind:this={trackEl}>
      {#if !loaded}
        <div class="row-empty">Loading…</div>
      {:else if rowEntities.length === 0 && acts.length > 0}
        <div class="row-empty">No presences yet. Drag a character or event onto the timeline. (Drag UI lands in the next commit.)</div>
      {/if}

      {#each rowEntities as entity, idx (entity.id)}
        <div class="row" data-entity-id={entity.id}>
          {#each intervalsByEntityId.get(entity.id) ?? [] as iv (iv.id)}
            {@const span = iv.endPosition - iv.startPosition}
            {@const leftPct = (iv.startPosition / Math.max(N, 1)) * 100}
            {@const widthPct = (span / Math.max(N, 1)) * 100}
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
      {/each}
    </div>
  </div>
</div>

<style>
  .tl2 {
    display: flex;
    height: 100%;
    background: var(--color-surface, #161920);
    color: var(--color-text, #e8e0d0);
    font-family: var(--font-ui, 'Inter', sans-serif);
    overflow: hidden;
  }

  /* ── Palette ─────────────────────────────────────────────────────── */
  .palette {
    width: 240px;
    flex-shrink: 0;
    background: var(--color-surface-2, #1c1f28);
    border-right: 1px solid var(--color-border, #2a2d35);
    overflow-y: auto;
  }
  .palette-section {
    padding: 18px 16px 12px;
    border-bottom: 1px solid var(--color-border, #2a2d35);
  }
  .palette-section:last-child {
    border-bottom: none;
  }
  .palette-label {
    font-size: 9px;
    font-weight: 600;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 10px;
  }
  .palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 6px;
    margin-bottom: 4px;
    cursor: grab;
    transition: background 0.15s ease;
  }
  .palette-item:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .palette-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .palette-name {
    font-family: var(--font-display, 'Fraunces', Georgia, serif);
    font-size: 14px;
    font-weight: 400;
  }
  .palette-empty {
    font-size: 11px;
    color: var(--color-text-muted, #6b7280);
    font-style: italic;
    padding: 4px 10px;
  }

  /* ── Main timeline ───────────────────────────────────────────────── */
  .timeline {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .acts-header {
    display: flex;
    height: 56px;
    background: var(--color-surface-2, #1c1f28);
    border-bottom: 1px solid var(--color-border, #2a2d35);
  }
  .act-col-header {
    border-right: 1px solid var(--color-border, #2a2d35);
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }
  .act-col-header:last-child {
    border-right: none;
  }
  .act-name {
    font-family: var(--font-display, 'Fraunces', Georgia, serif);
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text, #e8e0d0);
  }
  .act-meta {
    font-size: 10px;
    color: var(--color-text-muted, #6b7280);
  }
  .acts-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--color-text-muted, #6b7280);
    font-style: italic;
  }

  .scenes-row {
    display: flex;
    height: 24px;
    background: var(--color-desktop, #0d0f14);
    border-bottom: 1px solid var(--color-border, #2a2d35);
  }
  .scenes-act {
    flex: 1;
    border-right: 1px solid var(--color-border, #2a2d35);
    display: flex;
  }
  .scenes-act:last-child {
    border-right: none;
  }
  .scene-cell {
    flex: 1;
    border-right: 1px dashed rgba(42, 45, 53, 0.6);
    font-size: 9px;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scene-cell:last-child {
    border-right: none;
  }
  .scenes-act-empty {
    flex: 1;
    font-size: 9px;
    color: var(--color-text-muted, #6b7280);
    font-style: italic;
    opacity: 0.5;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rows {
    flex: 1;
    position: relative;
    overflow-y: auto;
  }
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
  .row-empty {
    padding: 24px;
    color: var(--color-text-muted, #6b7280);
    font-size: 11px;
    text-align: center;
    font-style: italic;
  }
</style>
