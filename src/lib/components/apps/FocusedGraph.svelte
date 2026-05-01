<script lang="ts">
  import { onMount } from 'svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { intervals as intervalsStore } from '$lib/stores/intervals.js';
  import { playhead, intervalContainsT } from '$lib/stores/playhead.js';
  import { windowStore, type FocusedGraphMode } from '$lib/stores/windows.js';
  import { openEntity } from '$lib/navigation.js';
  import { REL_COLOR } from '$lib/relationship-colors.js';
  import {
    sharedNeighbors,
    oneHopUnion,
    reachable,
    type Edge as TraversalEdge
  } from '$lib/graph/traversal.js';
  import GraphCanvas, {
    type GraphNode,
    type GraphEdge,
    type NodePosition
  } from '$lib/components/GraphCanvas.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';

  interface Props {
    windowId: string;
  }
  let { windowId }: Props = $props();

  // ── Live window state ─────────────────────────────────────────────────────
  const win = $derived($windowStore.find((w) => w.id === windowId));
  const focalSet = $derived(win?.focalSet ?? []);
  const viewMode = $derived<FocusedGraphMode>(win?.viewMode ?? 'their_worlds');

  // ── Traversal inputs ──────────────────────────────────────────────────────
  const focalSetIds = $derived(new Set(focalSet));

  // Edge list for traversal helpers (B2 contract).
  const edgeList = $derived<TraversalEdge[]>(
    $relationships.map((r) => ({ fromId: r.fromId, toId: r.toId, type: r.type }))
  );

  // Structural ids (Act + Scene) so traversal skips through them by default.
  // Per B2 spec: includeStructural defaults to false to avoid huge appears_in
  // / caused_by fan-outs from dominating the result set.
  const structuralIds = $derived(
    new Set(
      $entities.filter((e) => e.type === 'Act' || e.type === 'Scene').map((e) => e.id)
    )
  );

  // ── Visible set (traversal output) ────────────────────────────────────────
  // Per C6 invariant: visibility is determined ONLY by viewMode + focalSet +
  // edges. Scrubber dimming layers ON TOP via dimmedNodes prop; it does NOT
  // alter this set. Layout-by-type (C5) will read this same visibleSet.
  const visibleSet = $derived.by(() => {
    if (focalSetIds.size === 0) return new Set<string>();
    const opts = { includeStructural: false, structuralIds };
    if (viewMode === 'shared') return sharedNeighbors(focalSetIds, edgeList, opts);
    if (viewMode === 'reachable') return reachable(focalSetIds, edgeList, opts);
    return oneHopUnion(focalSetIds, edgeList, opts);
  });

  // Display set: visible neighbors UNION the focal set itself. Focal nodes
  // always render even if no edges connect them (otherwise an empty
  // 'shared' result would hide the focals you just picked, which is hostile).
  const displaySet = $derived(new Set([...visibleSet, ...focalSetIds]));

  // Notes don't render in graph apps (matches StoryGraph behavior).
  const displayEntities = $derived(
    $entities.filter((e) => displaySet.has(e.id) && e.type !== 'Note')
  );

  // ── Out-of-scope at playhead (same shape as StoryGraph) ───────────────────
  const outOfScope = $derived.by(() => {
    const set = new Set<string>();
    if ($playhead == null) return set;
    const t = $playhead;
    const byEntity = new Map<string, typeof $intervalsStore>();
    for (const iv of $intervalsStore) {
      const list = byEntity.get(iv.entityId) ?? [];
      list.push(iv);
      byEntity.set(iv.entityId, list);
    }
    for (const [entityId, ivs] of byEntity) {
      const active = ivs.some((iv) => intervalContainsT(iv.startPosition, iv.endPosition, t));
      if (!active) set.add(entityId);
    }
    return set;
  });

  // ── GraphCanvas inputs ────────────────────────────────────────────────────
  const graphNodes = $derived<GraphNode[]>(
    displayEntities.map((e) => ({ id: e.id, type: e.type, name: e.name }))
  );

  const graphEdges = $derived<GraphEdge[]>(
    $relationships
      .filter((r) => displaySet.has(r.fromId) && displaySet.has(r.toId))
      .map((r) => ({
        id: r.id,
        fromId: r.fromId,
        toId: r.toId,
        color: REL_COLOR[r.type] ?? 'var(--color-rel-other)',
        label: r.label ?? r.type.replace(/_/g, ' '),
        dimmed: outOfScope.has(r.fromId) || outOfScope.has(r.toId)
      }))
  );

  // ── Position seed (per-window first, per-entity fallback) ─────────────────
  let initialPositions = $state<Record<string, NodePosition>>({});

  onMount(() => {
    void (async () => {
      // Per-window state (Lane A endpoint) wins for any entity it knows.
      const winRes = await fetch(`/api/canvas-positions/window/${windowId}`).catch(() => null);
      type WinRow = {
        entityId: string;
        x: number;
        y: number;
        width: number;
        height: number;
        pinned: number;
      };
      const winRows: WinRow[] = winRes?.ok ? await winRes.json() : [];
      const winMap = Object.fromEntries(
        winRows.map((r) => [r.entityId, { x: r.x, y: r.y, w: r.width, h: r.height }])
      );
      // Per-entity fallback (the seed layer that StoryGraph also reads).
      const entRes = await fetch('/api/canvas-positions').catch(() => null);
      type EntRow = {
        entityId: string;
        x: number;
        y: number;
        width: number;
        height: number;
      };
      const entRows: EntRow[] = entRes?.ok ? await entRes.json() : [];
      const entMap = Object.fromEntries(
        entRows.map((r) => [r.entityId, { x: r.x, y: r.y, w: r.width, h: r.height }])
      );
      // Merge: per-window wins for any node it knows.
      initialPositions = { ...entMap, ...winMap };
    })();
  });

  // ── Position persistence (per-node debounce; per-window endpoint) ─────────
  // Greptile P2 on PR #12: see StoryGraph for the same fix rationale. Per-node
  // map preserves rapid-re-drag coalescing of the same node without canceling
  // a different node's pending PUT.
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function onNodePositionChange(id: string, p: NodePosition) {
    const existing = saveTimers.get(id);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      id,
      setTimeout(() => {
        saveTimers.delete(id);
        fetch(`/api/canvas-positions/window/${windowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityId: id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            width: Math.round(p.w),
            height: Math.round(p.h),
            pinned: 0
          })
        });
      }, 500)
    );
  }

  // ── Focal-set mutation (RULE: reassign, never push) ───────────────────────
  function removeFromFocalSet(id: string) {
    const next = focalSet.filter((x) => x !== id);
    windowStore.setFocalSet(windowId, next);
  }

  function setMode(mode: FocusedGraphMode) {
    windowStore.setViewMode(windowId, mode);
  }

  // Look up an entity's display name for chips / tooltips.
  function nameOf(id: string): string {
    return $entities.find((e) => e.id === id)?.name ?? '(deleted)';
  }

  // ── Right-click context menu ───────────────────────────────────────────────
  // FG variant per Phase 1B C3: focal nodes get "Remove from focal set"
  // instead of "Open Focused Graph"; non-focal nodes get an "Add to focal
  // set" affordance so the user can grow the focal selection without going
  // back to StoryGraph.
  let contextMenu = $state<{ entityId: string; x: number; y: number } | null>(null);

  function addToFocalSet(id: string) {
    if (focalSetIds.has(id)) return;
    windowStore.setFocalSet(windowId, [...focalSet, id]);
  }

  const contextMenuItems = $derived.by(() => {
    if (!contextMenu) return [];
    const id = contextMenu.entityId;
    const isFocal = focalSetIds.has(id);
    const items: Array<{ label: string; onSelect: () => void }> = [
      {
        label: 'Open in window',
        onSelect: () => openEntity(id)
      }
    ];
    if (isFocal) {
      items.push({
        label: 'Remove from focal set',
        onSelect: () => removeFromFocalSet(id)
      });
    } else {
      items.push({
        label: 'Add to focal set',
        onSelect: () => addToFocalSet(id)
      });
    }
    return items;
  });
</script>

<div class="fg">
  <header class="fg-header">
    <label class="fg-mode">
      <span class="fg-mode-label">View</span>
      <select
        value={viewMode}
        onchange={(e) => setMode((e.currentTarget as HTMLSelectElement).value as FocusedGraphMode)}
      >
        <option value="their_worlds">Their worlds (1-hop)</option>
        <option value="shared">Shared (intersection)</option>
        <option value="reachable">Reachable (full graph)</option>
      </select>
    </label>
    <div class="fg-chips">
      {#each focalSet as id (id)}
        <span class="chip">
          {nameOf(id)}
          <button
            class="chip-x"
            title="Remove from focal set"
            aria-label="Remove {nameOf(id)} from focal set"
            onclick={() => removeFromFocalSet(id)}
          >×</button>
        </span>
      {/each}
      {#if focalSet.length === 0}
        <span class="chip-empty">No focal entities yet — right-click an entity in Story Graph and choose "Open Focused Graph".</span>
      {/if}
    </div>
  </header>

  <div class="fg-canvas">
    <GraphCanvas
      nodes={graphNodes}
      edges={graphEdges}
      dimmedNodes={outOfScope}
      {initialPositions}
      onNodeOpen={openEntity}
      {onNodePositionChange}
      onContextMenu={(id, x, y) => (contextMenu = { entityId: id, x, y })}
    >
      {#snippet emptyState()}
        <div class="fg-empty">
          <p>Pick a focal entity to start.</p>
        </div>
      {/snippet}
    </GraphCanvas>
  </div>
</div>

{#if contextMenu}
  <ContextMenu
    items={contextMenuItems}
    x={contextMenu.x}
    y={contextMenu.y}
    onClose={() => (contextMenu = null)}
  />
{/if}

<style>
  .fg {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
  }

  .fg-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
    flex-wrap: wrap;
  }

  .fg-mode {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .fg-mode-label {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .fg-mode select {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 4px 8px;
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 12px;
  }

  .fg-chips {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    flex-wrap: wrap;
    min-width: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 4px 3px 10px;
    background: var(--color-accent);
    color: white;
    border-radius: 12px;
    font-family: var(--font-ui);
    font-size: 12px;
    line-height: 1.2;
  }

  .chip-x {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.2);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }

  .chip-x:hover {
    background: rgba(255, 255, 255, 0.4);
  }

  .chip-empty {
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 12px;
    font-style: italic;
  }

  .fg-canvas {
    flex: 1;
    position: relative;
    min-height: 0;
  }

  .fg-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 13px;
    pointer-events: none;
  }
</style>
