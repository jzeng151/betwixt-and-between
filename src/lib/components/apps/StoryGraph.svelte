<script lang="ts">
  import { onMount } from 'svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { intervals as intervalsStore } from '$lib/stores/intervals.js';
  import { playhead, intervalContainsT } from '$lib/stores/playhead.js';
  import { windowStore } from '$lib/stores/windows.js';
  import { openEntity } from '$lib/navigation.js';
  import type { RelationshipType } from '$lib/server/db/schema.js';
  import { REL_COLOR, REL_TYPES } from '$lib/relationship-colors.js';
  import GraphCanvas, {
    type GraphNode,
    type GraphEdge,
    type NodePosition
  } from '$lib/components/GraphCanvas.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';

  // ── Relationship form ──────────────────────────────────────────────────────
  let relType: RelationshipType = $state('allied_with');
  let relLabel = $state('');
  let saving = $state(false);
  let pending = $state<{ fromId: string; toId: string; sx: number; sy: number } | null>(null);

  // First × click arms delete; second click on same node confirms.
  let confirmDeleteId = $state<string | null>(null);

  // Right-click context menu state.
  let contextMenu = $state<{ entityId: string; x: number; y: number } | null>(null);

  // Reference to the canvas so the per-node overlay UI can trigger connect drags.
  let canvas: GraphCanvas;

  // ── Store-derived data ─────────────────────────────────────────────────────
  const displayEntities = $derived($entities.filter((e) => e.type !== 'Note'));
  const hasEntities = $derived(displayEntities.length > 0);

  const graphNodes = $derived<GraphNode[]>(
    displayEntities.map((e) => ({ id: e.id, type: e.type, name: e.name }))
  );

  // ── Playhead scope ─────────────────────────────────────────────────────────
  // An entity is "out of scope" at T iff it has at least one interval AND
  // none of its intervals contain T. Entities without intervals (Locations,
  // Acts, Scenes, unplaced Characters/Events) are always considered in-scope.
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

  const graphEdges = $derived<GraphEdge[]>(
    $relationships
      .filter(
        (r) =>
          displayEntities.some((e) => e.id === r.fromId) &&
          displayEntities.some((e) => e.id === r.toId)
      )
      .map((r) => ({
        id: r.id,
        fromId: r.fromId,
        toId: r.toId,
        color: REL_COLOR[r.type] ?? 'var(--color-rel-other)',
        label: r.label ?? r.type.replace(/_/g, ' '),
        dimmed: outOfScope.has(r.fromId) || outOfScope.has(r.toId)
      }))
  );

  // ── Position seed from /api/canvas-positions ───────────────────────────────
  // Reactive so when entities are created, GraphCanvas's auto-place runs;
  // when stored positions arrive, GraphCanvas seeds from them.
  let initialPositions = $state<Record<string, NodePosition>>({});

  onMount(() => {
    void (async () => {
      const res = await fetch('/api/canvas-positions').catch(() => null);
      const rows: { entityId: string; x: number; y: number; width: number; height: number }[] =
        res?.ok ? await res.json() : [];
      initialPositions = Object.fromEntries(
        rows.map((r) => [r.entityId, { x: r.x, y: r.y, w: r.width, h: r.height }])
      );
    })();
  });

  // ── Position persistence (per-node debounce) ──────────────────────────────
  // Greptile P2 on PR #12: a single shared timer dropped cross-node writes
  // when two drags completed within 500 ms. Per-node map preserves the
  // coalescing semantic for rapid re-drags of the SAME node while never
  // canceling a different node's pending PUT.
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function onNodePositionChange(id: string, p: NodePosition) {
    const existing = saveTimers.get(id);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      id,
      setTimeout(() => {
        saveTimers.delete(id);
        fetch('/api/canvas-positions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityId: id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            width: Math.round(p.w),
            height: Math.round(p.h)
          })
        });
      }, 500)
    );
  }

  // ── Connect → rel-form ─────────────────────────────────────────────────────
  let saveError = $state('');

  /**
   * Pick a default rel type for a new edge between this pair: prefer a type
   * the pair doesn't already have so the dropdown lands on a value that'll
   * succeed. Two entities can hold multiple relationships of DIFFERENT
   * types (schema UNIQUE on (from_id, to_id, type) allows it) — the user
   * shouldn't have to manually click through the dropdown to find an
   * unused one. `appears_in` is excluded as the API rejects it (deprecated;
   * presence lives in intervals).
   */
  function pickDefaultRelType(fromId: string, toId: string): RelationshipType {
    const existing = new Set(
      $relationships
        .filter((r) => r.fromId === fromId && r.toId === toId)
        .map((r) => r.type)
    );
    for (const t of REL_TYPES) {
      if (t === 'appears_in') continue;
      if (!existing.has(t)) return t;
    }
    // All types used — fall back to the form's classic default. Save will
    // fail with a clear error, which is the right signal at saturation.
    return 'allied_with';
  }

  function onConnect(fromId: string, toId: string, screenX: number, screenY: number) {
    pending = { fromId, toId, sx: screenX, sy: screenY };
    relType = pickDefaultRelType(fromId, toId);
    relLabel = '';
    saveError = '';
  }

  function cancelPending() {
    pending = null;
    relLabel = '';
    relType = 'allied_with';
    saveError = '';
  }

  async function savePending() {
    if (!pending) return;
    saving = true;
    saveError = '';
    try {
      await relationships.createRelationship(
        pending.fromId,
        pending.toId,
        relType,
        relLabel.trim() || undefined
      );
      pending = null;
      relLabel = '';
      relType = 'allied_with';
    } catch (err) {
      // Surface the failure (was previously silently swallowed). Most
      // common cause: a relationship of this type between this pair
      // already exists (UNIQUE violation surfaces as a 400 from the API).
      // Show a short message and let the user pick a different type.
      const msg = (err as Error)?.message ?? 'Save failed';
      saveError = msg.includes('unique') || msg.includes('duplicate')
        ? `A "${relType.replace(/_/g, ' ')}" relationship between these already exists.`
        : 'Couldn\'t save — pick a different type or try again.';
    } finally {
      saving = false;
    }
  }

  function onRelFormKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelPending();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      savePending();
    }
  }

  // ── Delete (second-click confirms) ─────────────────────────────────────────
  function onDeleteClick(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (confirmDeleteId === id) {
      entities.deleteEntity(id);
      confirmDeleteId = null;
    } else {
      confirmDeleteId = id;
    }
  }

  // ── Right-click context menu ───────────────────────────────────────────────
  // Locked menu items per Phase 1B C3:
  //   Open in window, View connections, Open Focused Graph, Edit, Delete,
  //   Pin to canvas. (Pin is deferred until the per-window pin state UI lands;
  //   ships disabled here so the slot is reserved.)
  const contextMenuItems = $derived.by(() => {
    if (!contextMenu) return [];
    const id = contextMenu.entityId;
    return [
      {
        label: 'Open in window',
        onSelect: () => openEntity(id)
      },
      {
        label: 'Open Focused Graph',
        onSelect: () => windowStore.openFocusedGraph([id], 'their_worlds')
      },
      {
        label: 'Delete',
        onSelect: () => entities.deleteEntity(id)
      }
    ];
  });
</script>

<GraphCanvas
  bind:this={canvas}
  nodes={graphNodes}
  edges={graphEdges}
  dimmedNodes={outOfScope}
  {initialPositions}
  onConnect={onConnect}
  onNodeOpen={openEntity}
  onNodePositionChange={onNodePositionChange}
  onContextMenu={(id, x, y) => (contextMenu = { entityId: id, x, y })}
>
  {#snippet emptyState()}
    {#if !hasEntities}
      <div class="empty-overlay">
        <p>Create characters, locations, or events — they'll appear here automatically.</p>
        <div class="ghost-nodes">
          <span class="ghost-node">Character</span>
          <span class="ghost-sep">──</span>
          <span class="ghost-node">Location</span>
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet nodeOverlay({ id })}
    <button
      class="connect-btn gc-no-drag"
      title="Drag to connect"
      onpointerdown={(e) => canvas.startConnect(e, id)}
      aria-label="Connect node"
    >◉</button>
    <button
      class="delete-btn gc-no-drag"
      class:armed={confirmDeleteId === id}
      title={confirmDeleteId === id ? 'Click again to confirm delete' : 'Delete'}
      onclick={(e) => onDeleteClick(e, id)}
      aria-label="Delete node"
    >×</button>
  {/snippet}
</GraphCanvas>

{#if pending}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="rel-form"
    style="left:{pending.sx}px; top:{pending.sy}px"
    onkeydown={onRelFormKeydown}
    role="dialog"
    tabindex="-1"
    aria-label="Define relationship"
  >
    <p class="rel-form-heading">Define relationship</p>
    <select bind:value={relType}>
      {#each REL_TYPES as t}
        <option value={t}>{t.replace(/_/g, ' ')}</option>
      {/each}
    </select>
    <input
      type="text"
      placeholder="Label (optional)"
      bind:value={relLabel}
      autocomplete="off"
    />
    {#if saveError}
      <p class="rel-form-error" role="alert">{saveError}</p>
    {/if}
    <div class="rel-form-actions">
      <button onclick={cancelPending}>Cancel</button>
      <button class="primary" onclick={savePending} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
{/if}

{#if contextMenu}
  <ContextMenu
    items={contextMenuItems}
    x={contextMenu.x}
    y={contextMenu.y}
    onClose={() => (contextMenu = null)}
  />
{/if}

<style>
  /* ── Per-node overlay buttons ───────────────────────────────────────────── */
  .connect-btn,
  .delete-btn {
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .connect-btn {
    right: -10px;
    top: 50%;
    transform: translateY(-50%);
    background: var(--color-accent);
    color: white;
  }

  .delete-btn {
    right: -10px;
    top: -8px;
    background: var(--color-surface-2);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }

  .delete-btn:hover {
    color: var(--color-rel-rival);
    border-color: var(--color-rel-rival);
  }

  .delete-btn.armed {
    background: var(--color-rel-rival);
    color: white;
    border-color: var(--color-rel-rival);
  }

  /* ── Empty state ───────────────────────────────────────────────────────── */
  .empty-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--color-text-muted);
    pointer-events: none;
    text-align: center;
    padding: 0 24px;
  }

  .empty-overlay p {
    max-width: 360px;
    margin: 0;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.5;
  }

  .ghost-nodes {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .ghost-node {
    padding: 6px 12px;
    border: 1.5px dashed var(--color-border);
    border-radius: 6px;
    font-family: var(--font-ui);
    font-size: 12px;
    opacity: 0.5;
  }

  .ghost-sep {
    opacity: 0.3;
  }

  /* ── Relationship form (overlay positioned in viewport coords) ─────────── */
  .rel-form {
    position: absolute;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 180px;
    z-index: 10;
  }

  .rel-form-heading {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .rel-form select,
  .rel-form input {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 4px 6px;
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 12px;
  }

  .rel-form-error {
    margin: 0;
    color: var(--color-rel-rival);
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.3;
  }

  .rel-form-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .rel-form-actions button {
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    cursor: pointer;
  }

  .rel-form-actions .primary {
    background: var(--color-accent);
    color: white;
    border-color: var(--color-accent);
  }

  .rel-form-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
