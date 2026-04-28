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
  import Palette from '$lib/components/Palette.svelte';
  import ActsHeader from '$lib/components/ActsHeader.svelte';
  import IntervalRow from '$lib/components/IntervalRow.svelte';
  import { presenceLabel, colorFor, dataNoteSnippet } from '$lib/timeline-v2-helpers.js';

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

  // ── Interaction lock (reserved for upcoming drag/resize commits) ─────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let interactionLock = $state(false);

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
  <Palette {characters} {events} {colorFor} />

  <!-- ── Main timeline ──────────────────────────────────────────────── -->
  <div class="timeline">
    <ActsHeader {acts} {scenesByActId} />

    <!-- Rows of intervals -->
    <div class="rows" bind:this={trackEl}>
      {#if !loaded}
        <div class="row-empty">Loading…</div>
      {:else if rowEntities.length === 0 && acts.length > 0}
        <div class="row-empty">No presences yet. Drag a character or event onto the timeline. (Drag UI lands in the next commit.)</div>
      {/if}

      {#each rowEntities as entity, idx (entity.id)}
        <IntervalRow
          {entity}
          intervals={intervalsByEntityId.get(entity.id) ?? []}
          {idx}
          {trackWidthPx}
          actCount={N}
          {colorFor}
          {dataNoteSnippet}
          {tooltipFor}
          {pxForFractionalSpan}
        />
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

  /* ── Main timeline ───────────────────────────────────────────────── */
  .timeline {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .rows {
    flex: 1;
    position: relative;
    overflow-y: auto;
  }
  .row-empty {
    padding: 24px;
    color: var(--color-text-muted, #6b7280);
    font-size: 11px;
    text-align: center;
    font-style: italic;
  }
</style>
