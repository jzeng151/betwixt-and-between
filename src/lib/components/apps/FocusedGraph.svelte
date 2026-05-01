<script lang="ts">
  import { onMount } from 'svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { intervals as intervalsStore } from '$lib/stores/intervals.js';
  import { playhead, intervalContainsT } from '$lib/stores/playhead.js';
  import { windowStore, type FocusedGraphMode } from '$lib/stores/windows.js';
  import { openEntity } from '$lib/navigation.js';
  import { REL_COLOR, REL_TYPES } from '$lib/relationship-colors.js';
  import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
  import { DEFAULT_TYPE_ORDER } from '$lib/graph/defaults.js';
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
  import TypeOrderPanel from '$lib/components/TypeOrderPanel.svelte';
  import Legend from '$lib/components/Legend.svelte';

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

  // Set of ids that ACTUALLY render as nodes (post-Note exclusion). Edges
  // filter against this rather than displaySet so we don't enqueue edges
  // pointing at a Note that won't exist as a node — GraphCanvas safely
  // drops those today, but matching the node-filter shape keeps the two
  // derivations consistent (Greptile P2 follow-up from PR #12).
  const displayEntityIds = $derived(new Set(displayEntities.map((e) => e.id)));

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

  // ── Legend state (C4) ──────────────────────────────────────────────────────
  // Hard filter: toggling a type off hides those edges entirely (vs. scrubber
  // dimming which is a soft visual filter). In-memory per-window for v1; if
  // persistence becomes a need, move to windowStore as a per-window field.
  let enabledRelTypes = $state<Set<RelationshipType>>(new Set(REL_TYPES));

  function toggleRelType(t: RelationshipType) {
    const next = new Set(enabledRelTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    enabledRelTypes = next;
  }

  // ── GraphCanvas inputs ────────────────────────────────────────────────────
  const graphNodes = $derived<GraphNode[]>(
    displayEntities.map((e) => ({ id: e.id, type: e.type, name: e.name }))
  );

  const graphEdges = $derived<GraphEdge[]>(
    $relationships
      .filter(
        (r) =>
          displayEntityIds.has(r.fromId) &&
          displayEntityIds.has(r.toId) &&
          enabledRelTypes.has(r.type)
      )
      .filter((r) => displayEntityIds.has(r.fromId) && displayEntityIds.has(r.toId))
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
  // Pinned set: ids whose pinned column is 1 in this window's
  // window_canvas_state. Drives both the pin/unpin menu state and C5
  // layout-by-type (pinned nodes don't move during dagre).
  let pinnedSet = $state<Set<string>>(new Set());
  // Live mirror of current node positions. The canvas owns nodePos
  // internally, but C5 needs to read centroid-of-pinned to compute the
  // shift step. Mirrors via onNodePositionChange + the initial seed.
  let currentPositions = $state<Record<string, NodePosition>>({});

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
      // Pinned column → pinnedSet.
      pinnedSet = new Set(winRows.filter((r) => r.pinned === 1).map((r) => r.entityId));
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
      currentPositions = { ...initialPositions };
    })();
  });

  // ── Position persistence (per-node debounce; per-window endpoint) ─────────
  // Greptile P2 on PR #12: see StoryGraph for the same fix rationale. Per-node
  // map preserves rapid-re-drag coalescing of the same node without canceling
  // a different node's pending PUT.
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function onNodePositionChange(id: string, p: NodePosition) {
    // Mirror so C5 can compute centroid(pinnedSet) without re-fetching.
    currentPositions = { ...currentPositions, [id]: p };
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
            // Preserve pin state when persisting a drag — dragging a pinned
            // node updates its position but should NOT unpin it.
            pinned: pinnedSet.has(id) ? 1 : 0
          })
        });
      }, 500)
    );
  }

  // ── Pin / Unpin (C3 menu item; C5 reads pinnedSet) ────────────────────────
  function togglePin(id: string) {
    const wasPinned = pinnedSet.has(id);
    const next = new Set(pinnedSet);
    if (wasPinned) next.delete(id);
    else next.add(id);
    pinnedSet = next;

    // Position-fallback chain so the persist always fires (Greptile P2 on
    // PR #13: silent pin-drop when currentPositions[id] is undefined). A
    // right-clickable node has been rendered, but the host's currentPositions
    // mirror only updates on drag — auto-placed nodes fall through to the
    // initialPositions seed, then to a sane (0,0) default for the very rare
    // race where a brand-new node is right-clicked before its position
    // surfaces. Lazy-population spec (Lane A) accepts arbitrary x/y on
    // first write.
    const p =
      currentPositions[id] ?? initialPositions[id] ?? { x: 0, y: 0, w: 120, h: 32 };
    const newPinned = !wasPinned;

    void (async () => {
      try {
        const res = await fetch(`/api/canvas-positions/window/${windowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityId: id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            width: Math.round(p.w),
            height: Math.round(p.h),
            pinned: newPinned ? 1 : 0
          })
        });
        if (!res.ok) throw new Error(`pin toggle failed: ${res.status}`);
      } catch (err) {
        // Roll back the local pin state so the UI matches the server.
        const rollback = new Set(pinnedSet);
        if (newPinned) rollback.delete(id);
        else rollback.add(id);
        pinnedSet = rollback;
        console.warn('FocusedGraph: pin toggle failed, rolling back', err);
      }
    })();
  }

  // ── C5: Layout by type ────────────────────────────────────────────────────
  // Window-local async lock per the locked plan: two simultaneous "Layout by
  // type" clicks within ONE window queue, but cross-window concurrent layout
  // is independent (per-window canvas means no cross-talk). The lock is just
  // a Promise chain — the next layout awaits the current one.
  let layoutLock: Promise<void> = Promise.resolve();
  // Queue depth instead of a boolean: incremented synchronously on click
  // (before the .then() callback fires) and decremented when the work
  // finishes. This avoids two UX bugs the boolean had:
  //   1. Click #2 queued behind click #1 had no indicator until click #1
  //      finished and click #2's body started — counterintuitive when
  //      the user sees their click "do nothing".
  //   2. Between click #1's finally (sets false) and click #2's body
  //      (sets true), the indicator flickered off for a microtask.
  let layoutQueueDepth = $state(0);
  const isLayingOut = $derived(layoutQueueDepth > 0);

  async function layoutByType() {
    layoutQueueDepth++;
    layoutLock = layoutLock.then(async () => {
      // Hoist snapshots so the catch can roll back. Hoist applied-flag so we
      // don't restore on early-return paths (newPositions.length === 0).
      const positionsBefore = currentPositions;
      const initialBefore = initialPositions;
      let optimisticApplied = false;

      try {
        const { layoutByType: runLayout } = await import('$lib/graph/dagre-layout.js');
        const typeOrder = win?.typeOrder ?? DEFAULT_TYPE_ORDER;

        // Build inputs from the current visible set. Notes excluded as in
        // graphNodes; edges already filtered by displayEntityIds + Legend.
        const layoutNodes = displayEntities.map((e) => ({
          id: e.id,
          type: e.type,
          width: 120,
          height: 32
        }));
        const layoutEdges = $relationships
          .filter(
            (r) =>
              displayEntityIds.has(r.fromId) &&
              displayEntityIds.has(r.toId) &&
              enabledRelTypes.has(r.type)
          )
          .map((r) => ({ fromId: r.fromId, toId: r.toId }));
        const positionsForCentroid = Object.entries(currentPositions).map(([id, p]) => ({
          id,
          x: p.x,
          y: p.y
        }));

        const newPositions = await runLayout({
          nodes: layoutNodes,
          edges: layoutEdges,
          pinnedIds: pinnedSet,
          currentPositions: positionsForCentroid,
          typeOrder
        });

        if (newPositions.length === 0) return;

        // Apply to local mirror so the UI updates immediately.
        const updates: Record<string, NodePosition> = {};
        for (const np of newPositions) {
          const existing = currentPositions[np.id];
          updates[np.id] = {
            x: np.x,
            y: np.y,
            w: existing?.w ?? 120,
            h: existing?.h ?? 32
          };
        }
        currentPositions = { ...currentPositions, ...updates };
        // Re-seed initialPositions so GraphCanvas's seededFromServer guard
        // re-applies. (Workaround: GraphCanvas seeds once; for layout-by-type
        // we'd need to push positions through. Pragmatic: just update the
        // backing store and rely on the post-merge fitView; user can reload
        // the window to see the new layout. Long-term fix tracked as a
        // follow-up — see PR description.)
        initialPositions = { ...initialPositions, ...updates };
        optimisticApplied = true;

        // Atomic batch write via A3.
        const res = await fetch(`/api/canvas-positions/window/${windowId}/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            newPositions.map((np) => ({
              entityId: np.id,
              x: Math.round(np.x),
              y: Math.round(np.y),
              width: 120,
              height: 32,
              pinned: pinnedSet.has(np.id) ? 1 : 0
            }))
          )
        });
        if (!res.ok) {
          // Roll back the optimistic update so the UI matches the server.
          currentPositions = positionsBefore;
          initialPositions = initialBefore;
          console.warn(
            `FocusedGraph: layout-by-type batch write failed (${res.status}), rolled back`
          );
        }
      } catch (err) {
        // CRITICAL (Greptile P1 on PR #13): swallow errors so the lock
        // chain stays alive. Without this catch, a network error / CORS
        // abort / offline state would leave layoutLock as a rejected
        // promise; every future layoutByType() click would chain
        // .then(callback) on it and silently no-op for the lifetime of
        // the window. Always roll back the optimistic update if it landed.
        if (optimisticApplied) {
          currentPositions = positionsBefore;
          initialPositions = initialBefore;
        }
        console.warn('FocusedGraph: layout-by-type failed, rolled back', err);
      } finally {
        layoutQueueDepth--;
      }
    });
    return layoutLock;
  }

  function setTypeOrder(next: EntityType[]) {
    windowStore.setTypeOrder(windowId, next);
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
    const isPinned = pinnedSet.has(id);
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
    items.push({
      label: isPinned ? 'Unpin from canvas' : 'Pin to canvas',
      onSelect: () => togglePin(id)
    });
    items.push({
      label: 'Layout by type',
      onSelect: () => void layoutByType()
    });
    return items;
  });

  // Settings panel toggle (C7 panel anchored to the header).
  let settingsOpen = $state(false);
  const currentTypeOrder = $derived<EntityType[]>(win?.typeOrder ?? DEFAULT_TYPE_ORDER);
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
    <button
      class="fg-settings-btn"
      class:open={settingsOpen}
      title="Layout settings"
      aria-label="Toggle layout settings"
      aria-expanded={settingsOpen}
      onclick={() => (settingsOpen = !settingsOpen)}
    >⚙</button>
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

    <!-- Legend: bottom-left, always-on (toggleable) -->
    <div class="fg-legend">
      <Legend enabled={enabledRelTypes} onToggle={toggleRelType} />
    </div>

    <!-- Settings panel: bottom-right, toggle via header gear -->
    {#if settingsOpen}
      <div class="fg-settings">
        <TypeOrderPanel
          value={currentTypeOrder}
          onChange={setTypeOrder}
          onApply={() => void layoutByType()}
        />
      </div>
    {/if}

    {#if isLayingOut}
      <div class="fg-laying-out" aria-live="polite">Laying out…</div>
    {/if}
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

  .fg-settings-btn {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    flex-shrink: 0;
  }

  .fg-settings-btn.open {
    background: var(--color-accent);
    color: white;
    border-color: var(--color-accent);
  }

  .fg-legend {
    position: absolute;
    bottom: 12px;
    left: 12px;
    z-index: 5;
    pointer-events: auto;
  }

  .fg-settings {
    position: absolute;
    bottom: 12px;
    right: 12px;
    z-index: 5;
    pointer-events: auto;
  }

  .fg-laying-out {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 12px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-accent);
    border-radius: 12px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    z-index: 6;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
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
