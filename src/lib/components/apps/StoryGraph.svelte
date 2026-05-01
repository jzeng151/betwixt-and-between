<script lang="ts">
  import { onMount } from 'svelte';
  import { untrack } from 'svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { intervals as intervalsStore } from '$lib/stores/intervals.js';
  import { playhead, intervalContainsT } from '$lib/stores/playhead.js';
  import { openEntity } from '$lib/navigation.js';
  import type { RelationshipType } from '$lib/server/db/schema.js';
  import { REL_COLOR, NODE_COLOR, REL_TYPES } from '$lib/relationship-colors.js';

  // ── Constants ──────────────────────────────────────────────────────────────
  const NODE_W = 120;
  const NODE_H = 32;

  // ── Viewport transform ─────────────────────────────────────────────────────
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);

  // ── Node positions (canvas coords) ─────────────────────────────────────────
  let nodePos = $state<Record<string, { x: number; y: number; w: number; h: number }>>({});

  // ── Interaction ────────────────────────────────────────────────────────────
  // Svelte 5 type-narrowing: `let foo: T | null = $state(null)` narrows
  // $state(null) to literally `null`, not T | null. Use the `$state<T>()`
  // type parameter so the rune declares the union shape correctly.
  let draggingNode = $state<{ id: string; offX: number; offY: number } | null>(null);
  // connecting: screen-space endpoint as the mouse moves
  let connecting = $state<{ fromId: string; screenX: number; screenY: number } | null>(null);
  let panning = $state<{ startMX: number; startMY: number; startPX: number; startPY: number } | null>(null);
  let pending = $state<{ fromId: string; toId: string; sx: number; sy: number } | null>(null);
  let hoveredNodeId = $state<string | null>(null);
  // First × click arms delete; second click on same node confirms
  let confirmDeleteId: string | null = $state(null);

  // ── Relationship form ──────────────────────────────────────────────────────
  let relType: RelationshipType = $state('allied_with');
  let relLabel = $state('');
  let saving = $state(false);

  let viewport: HTMLDivElement = $state(null!);

  // ── Derived ────────────────────────────────────────────────────────────────
  const displayEntities = $derived($entities.filter((e) => e.type !== 'Note'));
  const hasEntities = $derived(displayEntities.length > 0);

  // ── Playhead scope ─────────────────────────────────────────────────────────
  // An entity is "out of scope" at T iff it has at least one interval AND none
  // of its intervals contain T. Entities without intervals (Locations, Acts,
  // Scenes, unplaced Characters/Events) are always considered in-scope.
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

  // Edges in viewport (screen) coords — reacts to pan/zoom/nodePos changes
  const screenEdges = $derived(
    $relationships
      .filter((r) =>
        displayEntities.some((e) => e.id === r.fromId) &&
        displayEntities.some((e) => e.id === r.toId)
      )
      .map((r) => {
        const fp = nodePos[r.fromId];
        const tp = nodePos[r.toId];
        if (!fp || !tp) return null;
        const fw = fp.w || NODE_W, fh = fp.h || NODE_H;
        const tw = tp.w || NODE_W, th = tp.h || NODE_H;
        const dimmed = outOfScope.has(r.fromId) || outOfScope.has(r.toId);
        return {
          id: r.id,
          x1: panX + (fp.x + fw / 2) * zoom,
          y1: panY + (fp.y + fh / 2) * zoom,
          x2: panX + (tp.x + tw / 2) * zoom,
          y2: panY + (tp.y + th / 2) * zoom,
          color: REL_COLOR[r.type] ?? 'var(--color-rel-other)',
          label: r.label ?? r.type.replace(/_/g, ' '),
          dimmed,
        };
      })
      .filter(Boolean) as {
        id: string; x1: number; y1: number; x2: number; y2: number;
        color: string; label: string; dimmed: boolean;
      }[]
  );

  // Screen position of connecting-line start (center of fromId node)
  const connectLineStart = $derived(
    connecting ? (() => {
      const fp = nodePos[connecting.fromId];
      if (!fp) return null;
      return {
        x: panX + (fp.x + (fp.w || NODE_W) / 2) * zoom,
        y: panY + (fp.y + (fp.h || NODE_H) / 2) * zoom,
      };
    })() : null
  );

  // ── Position persistence ───────────────────────────────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSave(id: string) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const p = untrack(() => nodePos[id]);
      if (!p) return;
      fetch('/api/canvas-positions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.w), height: Math.round(p.h) }),
      });
    }, 500);
  }

  // ── Fit-to-view ────────────────────────────────────────────────────────────
  function fitView(np: Record<string, { x: number; y: number; w: number; h: number }>) {
    if (!viewport) return;
    const ents = displayEntities;
    if (ents.length === 0) return;
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const xs = ents.map((e) => np[e.id]?.x ?? 0);
    const ys = ents.map((e) => np[e.id]?.y ?? 0);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xs) + NODE_W, maxY = Math.max(...ys) + NODE_H;
    const contentW = maxX - minX + 80, contentH = maxY - minY + 80;
    // Clamp zoom: 0.7 minimum keeps text readable, 2 maximum avoids over-scaling
    const z = Math.min(2, Math.max(0.7, Math.min((vw - 40) / contentW, (vh - 40) / contentH)));
    zoom = z;
    panX = (vw - contentW * z) / 2 - (minX - 40) * z;
    panY = (vh - contentH * z) / 2 - (minY - 40) * z;
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  // Sync onMount so the cleanup return is well-typed (Svelte's onMount rejects
  // async callbacks that return a cleanup — Promise<() => void> doesn't fit
  // the `() => any | void` signature). The async load is fired-and-awaited
  // inside via an IIFE; the ResizeObserver cleanup is returned synchronously.
  onMount(() => {
    void (async () => {
      const res = await fetch('/api/canvas-positions').catch(() => null);
      const rows: { entityId: string; x: number; y: number; width: number; height: number }[] =
        res?.ok ? await res.json() : [];
      const stored = Object.fromEntries(
        rows.map((r) => [r.entityId, { x: r.x, y: r.y, w: r.width, h: r.height }])
      );

      const ents = displayEntities;
      const positions: Record<string, { x: number; y: number; w: number; h: number }> = {};
      ents.forEach((e, i) => {
        positions[e.id] = stored[e.id] ?? {
          x: 60 + (i % 4) * 180,
          y: 60 + Math.floor(i / 4) * 100,
          w: NODE_W,
          h: NODE_H,
        };
      });
      nodePos = positions;
      fitView(positions);
    })();

    // Re-fit when the viewport is resized (window resize or window drag-resize)
    const ro = new ResizeObserver(() => {
      fitView(untrack(() => nodePos));
    });
    ro.observe(viewport);
    return () => ro.disconnect();
  });

  // Place new entities as they appear
  $effect(() => {
    const ents = displayEntities;
    const missing = ents.filter((e) => !untrack(() => nodePos[e.id]));
    if (missing.length > 0) {
      const current = untrack(() => nodePos);
      const idx = Object.keys(current).length;
      const additions: Record<string, { x: number; y: number; w: number; h: number }> = {};
      missing.forEach((e, i) => {
        additions[e.id] = {
          x: 60 + ((idx + i) % 4) * 180,
          y: 60 + Math.floor((idx + i) / 4) * 100,
          w: NODE_W,
          h: NODE_H,
        };
      });
      nodePos = { ...current, ...additions };
    }
  });

  // ── Coord helpers ──────────────────────────────────────────────────────────
  function screenToCanvas(clientX: number, clientY: number) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panX) / zoom,
      y: (clientY - rect.top  - panY) / zoom,
    };
  }

  function viewportXY(clientX: number, clientY: number) {
    const rect = viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // ── Pointer handlers ───────────────────────────────────────────────────────
  function onViewportPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.node') || target.closest('.rel-form')) return;
    panning = { startMX: e.clientX, startMY: e.clientY, startPX: panX, startPY: panY };
    viewport.setPointerCapture(e.pointerId);
  }

  function onNodePointerDown(e: PointerEvent, id: string) {
    if ((e.target as HTMLElement).classList.contains('connect-btn')) return;
    e.stopPropagation();
    const p = nodePos[id];
    if (!p) return;
    const rect = viewport.getBoundingClientRect();
    draggingNode = {
      id,
      offX: e.clientX - rect.left - (panX + p.x * zoom),
      offY: e.clientY - rect.top  - (panY + p.y * zoom),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onConnectPointerDown(e: PointerEvent, fromId: string) {
    e.stopPropagation();
    const vp = viewportXY(e.clientX, e.clientY);
    connecting = { fromId, screenX: vp.x, screenY: vp.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (draggingNode) {
      const rect = viewport.getBoundingClientRect();
      const nx = (e.clientX - rect.left - draggingNode.offX - panX) / zoom;
      const ny = (e.clientY - rect.top  - draggingNode.offY - panY) / zoom;
      nodePos = { ...nodePos, [draggingNode.id]: { ...nodePos[draggingNode.id], x: nx, y: ny } };
    } else if (panning) {
      panX = panning.startPX + (e.clientX - panning.startMX);
      panY = panning.startPY + (e.clientY - panning.startMY);
    } else if (connecting) {
      const vp = viewportXY(e.clientX, e.clientY);
      connecting = { ...connecting, screenX: vp.x, screenY: vp.y };
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (draggingNode) {
      scheduleSave(draggingNode.id);
      draggingNode = null;
    } else if (panning) {
      panning = null;
    } else if (connecting) {
      const c = screenToCanvas(e.clientX, e.clientY);
      const target = displayEntities.find((ent) => {
        if (ent.id === connecting!.fromId) return false;
        const p = nodePos[ent.id];
        if (!p) return false;
        const w = p.w || NODE_W, h = p.h || NODE_H;
        return c.x >= p.x && c.x <= p.x + w && c.y >= p.y && c.y <= p.y + h;
      });
      if (target) {
        const vp = viewportXY(e.clientX, e.clientY);
        pending = { fromId: connecting.fromId, toId: target.id, sx: vp.x, sy: vp.y };
        relType = 'allied_with';
        relLabel = '';
      }
      connecting = null;
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.2, Math.min(4, zoom * factor));
    panX = mx - (mx - panX) * (newZoom / zoom);
    panY = my - (my - panY) * (newZoom / zoom);
    zoom = newZoom;
  }

  function onNodeDblClick(e: MouseEvent, id: string) {
    e.stopPropagation();
    openEntity(id);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  function onDeleteClick(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (confirmDeleteId === id) {
      entities.deleteEntity(id);
      confirmDeleteId = null;
      hoveredNodeId = null;
    } else {
      confirmDeleteId = id;
    }
  }

  // ── Rel form ───────────────────────────────────────────────────────────────
  function cancelPending() { pending = null; relLabel = ''; relType = 'allied_with'; }

  async function savePending() {
    if (!pending) return;
    saving = true;
    try {
      await relationships.createRelationship(pending.fromId, pending.toId, relType, relLabel.trim() || undefined);
      pending = null; relLabel = ''; relType = 'allied_with';
    } catch { /* noop */ }
    finally { saving = false; }
  }

  function onRelFormKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelPending();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); savePending(); }
  }
</script>

<div
  class="viewport"
  role="application"
  aria-label="Story graph canvas"
  bind:this={viewport}
  onpointerdown={onViewportPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onwheel={onWheel}
  style:cursor={panning ? 'grabbing' : 'default'}
>
  <!-- Edge SVG fills the viewport in screen coords — no transform needed -->
  <svg class="edges" aria-hidden="true">
    {#each screenEdges as edge (edge.id)}
      {@const mx = (edge.x1 + edge.x2) / 2}
      {@const my = (edge.y1 + edge.y2) / 2}
      <line
        x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
        stroke={edge.color} stroke-width="1.5"
        stroke-opacity={edge.dimmed ? '0.1' : '0.45'}
      />
      <text
        x={mx} y={my - 5}
        fill={edge.color} font-size="9" text-anchor="middle"
        opacity={edge.dimmed ? '0.15' : '0.75'}
        font-family="Inter, Segoe UI, sans-serif"
      >{edge.label}</text>
    {/each}
    {#if connecting && connectLineStart}
      <line
        x1={connectLineStart.x} y1={connectLineStart.y}
        x2={connecting.screenX}  y2={connecting.screenY}
        stroke="var(--color-accent)" stroke-width="1.5"
        stroke-dasharray="5 3" stroke-opacity="0.6"
      />
    {/if}
  </svg>

  <!-- Node canvas layer: pan/zoom applied here -->
  <div
    class="canvas"
    style="transform: translate({panX}px,{panY}px) scale({zoom}); transform-origin: 0 0"
  >
    {#each displayEntities as entity (entity.id)}
      {@const p = nodePos[entity.id]}
      {#if p}
        {@const nc = NODE_COLOR[entity.type] ?? 'var(--color-accent)'}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="node"
          class:node-active={hoveredNodeId === entity.id || draggingNode?.id === entity.id}
          class:node-out-of-scope={outOfScope.has(entity.id)}
          style="left:{p.x}px; top:{p.y}px; --nc:{nc}"
          onpointerdown={(e) => onNodePointerDown(e, entity.id)}
          ondblclick={(e) => onNodeDblClick(e, entity.id)}
          onpointerenter={() => (hoveredNodeId = entity.id)}
          onpointerleave={() => {
            if (draggingNode?.id !== entity.id) hoveredNodeId = null;
            if (confirmDeleteId === entity.id) confirmDeleteId = null;
          }}
          role="button"
          tabindex="0"
          aria-label="Open {entity.name}"
        >
          <span class="node-name">{entity.name}</span>
          <span class="node-type">{entity.type}</span>
          {#if hoveredNodeId === entity.id && !draggingNode && !panning}
            <button
              class="connect-btn"
              title="Drag to connect"
              onpointerdown={(e) => onConnectPointerDown(e, entity.id)}
              aria-label="Connect {entity.name}"
            >◉</button>
            <button
              class="delete-btn"
              class:armed={confirmDeleteId === entity.id}
              title={confirmDeleteId === entity.id ? 'Click again to confirm delete' : 'Delete'}
              onclick={(e) => onDeleteClick(e, entity.id)}
              aria-label="Delete {entity.name}"
            >×</button>
          {/if}
        </div>
      {/if}
    {/each}
  </div>

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
      <div class="rel-form-actions">
        <button onclick={cancelPending}>Cancel</button>
        <button class="primary" onclick={savePending} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .viewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--color-surface);
    touch-action: none;
    user-select: none;
  }

  /* SVG fills viewport; edges are computed in screen coords, no transform needed */
  .edges {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* Canvas layer: only nodes live here; transformed for pan/zoom */
  .canvas {
    position: absolute;
    width: 0;
    height: 0;
  }

  /* Nodes */
  .node {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--color-surface-2);
    border: 1.5px solid color-mix(in srgb, var(--nc) 40%, transparent);
    border-radius: 6px;
    box-shadow: 0 0 12px color-mix(in srgb, var(--nc) 12%, transparent);
    cursor: grab;
    font-family: var(--font-ui);
    white-space: nowrap;
    transition: border-color 0.12s, box-shadow 0.12s, opacity 0.15s ease;
  }
  .node-out-of-scope {
    opacity: 0.18;
  }
  .node-out-of-scope:hover {
    opacity: 0.4;
  }
  .node:hover,
  .node.node-active {
    border-color: var(--nc);
    box-shadow: 0 0 16px color-mix(in srgb, var(--nc) 28%, transparent);
  }
  .node.node-active { cursor: grabbing; }

  .node-name {
    font-size: 11px;
    color: var(--color-text);
  }

  .node-type {
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
  }

  .connect-btn {
    background: none;
    border: none;
    padding: 0 0 0 2px;
    font-size: 9px;
    line-height: 1;
    color: var(--nc);
    cursor: crosshair;
    opacity: 0.7;
    flex-shrink: 0;
  }
  .connect-btn:hover { opacity: 1; }

  .delete-btn {
    background: none;
    border: none;
    padding: 0 0 0 2px;
    font-size: 13px;
    line-height: 1;
    color: var(--color-text-muted);
    cursor: pointer;
    opacity: 0.5;
    flex-shrink: 0;
  }
  .delete-btn:hover { color: var(--color-rel-rival); opacity: 1; }
  .delete-btn.armed { color: var(--color-rel-rival); opacity: 1; font-weight: 700; }

  /* Empty state */
  .empty-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    pointer-events: none;
  }
  .empty-overlay p {
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--color-text-muted);
    text-align: center;
    max-width: 260px;
  }
  .ghost-nodes {
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0.3;
  }
  .ghost-node {
    border: 1px dashed var(--color-border);
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 11px;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
  }
  .ghost-sep { color: var(--color-border); font-size: 10px; }

  /* Relationship form */
  .rel-form {
    position: absolute;
    transform: translate(-50%, -50%);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 200px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    z-index: 100;
    font-family: var(--font-ui);
  }
  .rel-form-heading {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .rel-form select,
  .rel-form input {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    padding: 6px 8px;
    width: 100%;
    outline: none;
  }
  .rel-form select:focus,
  .rel-form input:focus { border-color: var(--color-accent); }
  .rel-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .rel-form-actions button {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
  }
  .rel-form-actions button:hover { background: var(--color-border); }
  .rel-form-actions button.primary {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-surface);
    font-weight: 600;
  }
  .rel-form-actions button.primary:hover { opacity: 0.85; }
  .rel-form-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
