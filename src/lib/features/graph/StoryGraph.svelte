<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { preferences } from '$lib/os/preferences-store.js';
  import { applyPreferencePatch } from '$lib/os/preferences-sync.js';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { intervals as intervalsStore } from '$lib/features/timeline/intervals-store.js';
  import { playhead, isEdgeVisibleAtT, isMysteryEdgeAtT, hideOutOfScope } from '$lib/features/timeline/playhead-store.js';
  import { jumpToCause, isCausalEdgeClickable } from '$lib/features/timeline/jump-to-cause.js';
  import { windowStore } from '$lib/os/windows-store.js';
  import { worldMapStore, worldMaps } from '$lib/features/map/store.js';
  import { openEntity } from '$lib/navigation.js';
  import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
  import { REL_COLOR, REL_EDGE_STYLE, REL_TYPES, nodeColorFor } from '$lib/relationship-colors.js';
  import { pickDefaultRelType } from '$lib/features/graph/rel-type-picker.js';
  import { DEFAULT_TYPE_ORDER } from '$lib/features/graph/defaults.js';
  import TypeOrderPanel from '$lib/components/TypeOrderPanel.svelte';
  import GraphCanvas, {
    type GraphNode,
    type GraphEdge
  } from '$lib/features/graph/GraphCanvas.svelte';
  import type { NodePosition } from '$lib/features/graph/radial-layout.js';
  import ContextMenu from '$lib/os/ContextMenu.svelte';
  import EntityColorPopover from '$lib/components/EntityColorPopover.svelte';
  import EditRelationshipModal from '$lib/components/EditRelationshipModal.svelte';
  import { entityAliases } from '$lib/stores/entity-aliases.js';
  import AliasModal from '$lib/components/AliasModal.svelte';
  import Legend from '$lib/features/graph/Legend.svelte';
  import DeleteConfirmDialog, { type DeleteImpact } from '$lib/components/DeleteConfirmDialog.svelte';
  import {
    buildEntityIntervalMap,
    buildActIndexById,
    buildSceneRanges,
    extractSortedSceneStarts,
    computeOutOfScope,
    classifyGhostMode,
    computeRenderedEntityIds
  } from '$lib/features/graph/scope.js';
  import {
    buildCharacterIndexById,
    buildPresentRelTypes,
    buildAliasEntityIdSet,
    filterVisibleRelationships,
    buildScenesForReveal
  } from '$lib/features/graph/view-builders.js';

  onMount(() => { intervalsStore.load(); entityAliases.load(); worldMapStore.loadMaps(); });

  // ── Relationship form ──────────────────────────────────────────────────────
  let relType: RelationshipType = $state('allied_with');
  let relLabel = $state('');
  let relStartActId = $state('');
  let relEndActId = $state('');
  let relRevealedAtPosition = $state<number | null>(null);
  let saving = $state(false);
  let pending = $state<{ fromId: string; toId: string; sx: number; sy: number } | null>(null);

  // First × click arms delete; second click on same node confirms.
  let confirmDeleteId = $state<string | null>(null);

  // Right-click context menu state (nodes).
  let contextMenu = $state<{ entityId: string; x: number; y: number } | null>(null);

  // Item 2: right-click → "Recolor" opens an anchored color popover that writes
  // data.color (reaches the node, the timeline, and the map sprite).
  let recolorMenu = $state<{ entityId: string; x: number; y: number } | null>(null);

  // Edge right-click → edit relationship modal.
  let editRelMenu = $state<{ relationshipId: string; x: number; y: number } | null>(null);

  // Right-click → alias modal.
  let aliasModal = $state<{ entity: { id: string; type: string; name: string } } | null>(null);

  // Reference to the canvas so the per-node overlay UI can trigger connect drags.
  let canvas: GraphCanvas;

  // ── Store-derived data ─────────────────────────────────────────────────────
  const displayEntities = $derived($entities.filter((e) => e.type !== 'Note'));
  const hasEntities = $derived(displayEntities.length > 0);
  const acts = $derived(
    $entities.filter((e) => e.type === 'Act').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  );

  const characterIndexById = $derived(buildCharacterIndexById($entities));
  const aliasEntityIds = $derived(buildAliasEntityIdSet($entityAliases));
  const displayEntityIdSet = $derived(new Set(displayEntities.map((e) => e.id)));

  const nodeColorById = $derived.by(() => {
    const m = new Map<string, string>();
    for (const e of displayEntities) {
      const color = nodeColorFor(e, characterIndexById.get(e.id));
      if (color) m.set(e.id, color);
    }
    return m;
  });

  const graphNodes = $derived<GraphNode[]>(
    displayEntities
      .filter((e) => renderedEntityIds.has(e.id))
      .map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        color: nodeColorFor(e, characterIndexById.get(e.id)),
        aliasMember: aliasEntityIds.has(e.id)
      }))
  );

  // ── View options (declared before derived scope logic that references them) ──
  // Item 4: hydrate from the global graph-toggle defaults on open; changing a
  // toggle here writes the new default back so every graph window opens that way.
  let hardFilter = $state(get(preferences).graph.hardFilter);
  let showGhostTrails = $state(get(preferences).graph.showGhostTrails);

  // codex P2: a graph window opened DURING the initial /api/preferences hydrate
  // (fresh browser / cleared cache) snapshots built-in defaults via get() above;
  // without this, the local state never picks up the server-saved graph prefs
  // that hydrate installs a moment later. Sync local state from the store UNTIL
  // the user toggles — then their in-window choice sticks (and is written
  // through). Only writes local $state (no applyPreferencePatch) → no write loop.
  let graphPrefsTouched = false;
  $effect(() => {
    const g = $preferences.graph;
    if (!graphPrefsTouched) {
      hardFilter = g.hardFilter;
      showGhostTrails = g.showGhostTrails;
    }
  });

  function setHardFilter(v: boolean) {
    graphPrefsTouched = true;
    hardFilter = v;
    applyPreferencePatch({ set: { graph: { hardFilter: v } } });
  }
  function setShowGhostTrails(v: boolean) {
    graphPrefsTouched = true;
    showGhostTrails = v;
    applyPreferencePatch({ set: { graph: { showGhostTrails: v } } });
  }

  // ── Playhead scope ─────────────────────────────────────────────────────────
  // Pure projections of stores → derived view; see src/lib/features/graph/scope.ts.
  const entityIntervalMap = $derived(buildEntityIntervalMap($intervalsStore));
  const actIndexById = $derived(buildActIndexById($entities));
  const sceneRanges = $derived(buildSceneRanges($entities, actIndexById));
  const sortedSceneStarts = $derived(extractSortedSceneStarts(sceneRanges));

  // Scenes with their story-time start positions, for the "Revealed at" dropdowns.
  const scenesForReveal = $derived(buildScenesForReveal(sceneRanges, $entities));

  const outOfScope = $derived(
    computeOutOfScope($playhead, entityIntervalMap, actIndexById, sceneRanges, displayEntities)
  );

  // Apply hideOutOfScope filter + alias-swap + ghost-trail re-inclusion.
  // When SPOTLIGHT reveals an alias, force-include the primary so it can
  // snap-move to the alias's old position on the same tick (avoids stacking
  // both at the same coordinates).
  const renderedEntityIds = $derived(
    computeRenderedEntityIds({
      hideOutOfScope: $hideOutOfScope,
      showGhostTrails,
      t: $playhead,
      displayEntityIds: displayEntityIdSet,
      outOfScope,
      entityIntervalMap,
      sortedSceneStarts,
      entityAliases: $entityAliases
    })
  );

  // ── Legend state (rel-type hard filter) ───────────────────────────────────
  // Toggle off a type → those edges disappear from the graph entirely.
  // Pairs cleanly with scrubber dimming (the SOFT filter): a hidden type
  // stays hidden regardless of playhead, and a dimmed edge is dimmed only
  // when its type is currently shown. In-memory per-window for v1; default
  // all types on. Mirror of FocusedGraph's pattern (Phase 1B C4) — same
  // contract, same component.
  let enabledRelTypes = $state<Set<RelationshipType>>(new Set(REL_TYPES));

  function toggleRelType(t: RelationshipType) {
    const next = new Set(enabledRelTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    enabledRelTypes = next;
  }

  const presentRelTypes = $derived(buildPresentRelTypes($relationships, displayEntityIdSet));

  // Single source of truth for "edges currently in the graph": both
  // endpoints rendered. graphEdges + layoutByType's edge list both project
  // from this so the filter stays in lockstep.
  const visibleRelationships = $derived(filterVisibleRelationships($relationships, renderedEntityIds));

  const graphEdges = $derived.by(() => {
    const t = $playhead;
    const edges: GraphEdge[] = [];
    for (const r of visibleRelationships) {
      const inWindow = isEdgeVisibleAtT(r, t);
      // Fallback to 'other' for any legacy pre-migration type that survives a
      // deploy-before-migration window (drizzle/0011). REL_COLOR has the same
      // defensive shape on the color line below.
      const style = REL_EDGE_STYLE[r.type] ?? REL_EDGE_STYLE.other;
      const mystery = isMysteryEdgeAtT(r, t);

      // Ghost mode: show edges near the playhead that aren't currently active.
      // Proximity is scene-granular (≤2 scene boundaries crossed, fallback ≤1 act).
      const ghostMode = t === null
        ? null
        : classifyGhostMode(
            r,
            { t, sortedSceneStarts, entityIntervalMap, outOfScope },
            { inWindow, mystery, showGhostTrails }
          );

      // Legend hard filter: skip disabled types unless they're showing as a ghost trail
      if (!enabledRelTypes.has(r.type) && ghostMode === null) continue;
      if (!inWindow && hardFilter && ghostMode === null) continue;
      const ghostEntityId = ghostMode !== null
        ? (outOfScope.has(r.fromId) ? r.fromId : r.toId)
        : null;
      edges.push({
        id: r.id,
        fromId: r.fromId,
        toId: r.toId,
        color: ghostEntityId !== null
          ? (nodeColorById.get(ghostEntityId) ?? REL_COLOR[r.type] ?? 'var(--color-rel-other)')
          : (REL_COLOR[r.type] ?? 'var(--color-rel-other)'),
        label: r.label ?? r.type.replace(/_/g, ' '),
        dimmed: !mystery && !ghostMode && (outOfScope.has(r.fromId) || outOfScope.has(r.toId) || (!inWindow && !hardFilter)),
        dasharray: style.dasharray,
        width: style.width,
        arrow: style.arrow,
        startPosition: r.startPosition,
        endPosition: r.endPosition,
        mysteryMode: mystery,
        ghostMode,
        // WM3 Slice 5 (D5): only scoped, non-mystery caused_by edges jump on
        // click; the pointer-cursor affordance is gated identically (shared
        // predicate so the spoiler guard lives in one place).
        clickable: isCausalEdgeClickable(r, mystery)
      });
    }
    // Alias edges: dashed "aka" line per pair where both endpoints are visible
    for (const alias of $entityAliases) {
      if (!renderedEntityIds.has(alias.primaryEntityId) || !renderedEntityIds.has(alias.aliasEntityId)) continue;
      if (alias.revealedAtPosition != null && t != null && t < alias.revealedAtPosition) continue;
      edges.push({
        id: `alias-${alias.id}`,
        fromId: alias.primaryEntityId,
        toId: alias.aliasEntityId,
        color: 'var(--color-rel-other)',
        label: 'aka',
        dimmed: false,
        dasharray: '1 2',
        width: 1,
        arrow: false
      });
    }
    // Ghost edges emitted first → render behind normal edges in SVG
    return [...edges.filter((e) => e.ghostMode), ...edges.filter((e) => !e.ghostMode)];
  });

  // ── Position seed ─────────────────────────────────────────────────────────
  // StoryGraph defaults to its unstructured "hairball" state on every
  // mount: GraphCanvas's auto-place fallback fills positions in a tight
  // grid as new entities arrive. We deliberately do NOT seed from
  // `/api/canvas-positions` here so a prior `Layout by type` run or
  // any old saved positions don't sticky-load on reload — the user
  // wanted the default to be a fresh hairball every time. Drag
  // persistence below stays wired so a single session's manual
  // arrangements still PUT (cheap; the data just isn't read on next
  // mount). If we ever want session-preserving drag-to-arrange back,
  // re-enable the fetch here.
  let initialPositions = $state<Record<string, NodePosition>>({});

  // ── Position persistence (per-node debounce) ──────────────────────────────
  // Greptile P2 on PR #12: a single shared timer dropped cross-node writes
  // when two drags completed within 500 ms. Per-node map preserves the
  // coalescing semantic for rapid re-drags of the SAME node while never
  // canceling a different node's pending PUT.
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function onNodePositionChange(id: string, p: NodePosition) {
    initialPositions = { ...initialPositions, [id]: p };
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

  // ── Layout-by-type (StoryGraph variant of FG's C5) ────────────────────────
  // StoryGraph stores positions in the per-entity `canvas_positions` table
  // (not Lane A's per-window state). PUTs go one-at-a-time since this table
  // has no batch endpoint; for the typical 50-200 entity load that's fine.
  // No pinnedSet — pinning is FG-only (per-window state). Layout always runs
  // against the full visible set.
  let typeOrder = $state<EntityType[]>([...DEFAULT_TYPE_ORDER]);
  let settingsOpen = $state(false);
  let legendOpen = $state(true);
  let edgeLabelsVisible = $state(true);
  let layoutLock = Promise.resolve();
  let layoutQueueDepth = $state(0);
  const isLayingOut = $derived(layoutQueueDepth > 0);

  async function layoutByType() {
    layoutQueueDepth++;
    layoutLock = layoutLock.then(async () => {
      try {
        const { layoutByType: runLayout } = await import('$lib/features/graph/dagre-layout.js');
        // Over-estimate per-node rendered width: name @ ~9px/char +
        // 100px constant covers padding, gap, and the type-tag suffix
        // (e.g. "Character" alone is ~50px at the smaller font).
        // Better to over-allot than under-allot — under-allotting
        // cascades long-label nodes into each other, which has been
        // the recurring complaint with the seeded dataset.
        const layoutNodes = displayEntities.map((e) => ({
          id: e.id,
          type: e.type,
          width: Math.max(180, e.name.length * 9 + 100),
          height: 32
        }));
        const layoutEdges = visibleRelationships.map((r) => ({
          fromId: r.fromId,
          toId: r.toId
        }));
        // No pinned ids on StoryGraph; pass empty set so dagre lays out
        // every visible node.
        const newPositions = await runLayout({
          nodes: layoutNodes,
          edges: layoutEdges,
          pinnedIds: new Set<string>(),
          currentPositions: Object.entries(initialPositions).map(([id, p]) => ({
            id,
            x: p.x,
            y: p.y
          })),
          typeOrder
        });
        if (newPositions.length === 0) return;

        // Apply locally: update initialPositions + push through canvas
        // so visible nodes animate to new spots.
        const updates: Record<string, NodePosition> = {};
        for (const np of newPositions) {
          const existing = initialPositions[np.id];
          updates[np.id] = {
            x: np.x,
            y: np.y,
            w: existing?.w ?? 120,
            h: existing?.h ?? 32
          };
        }
        initialPositions = { ...initialPositions, ...updates };
        canvas?.reseed(updates);

        // Persist via N parallel PUTs to /api/canvas-positions. The PUT
        // handler upserts via ON CONFLICT, so the order of resolution
        // doesn't matter and a partial failure leaves successful rows
        // saved.
        await Promise.all(
          newPositions.map((np) =>
            fetch('/api/canvas-positions', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                entityId: np.id,
                x: Math.round(np.x),
                y: Math.round(np.y),
                width: 120,
                height: 32
              })
            }).catch(() => null)
          )
        );
      } catch (err) {
        console.warn('[StoryGraph] layoutByType failed', err);
      } finally {
        layoutQueueDepth--;
      }
    });
  }

  // ── Connect → rel-form ─────────────────────────────────────────────────────
  let saveError = $state('');

  function onConnect(fromId: string, toId: string, screenX: number, screenY: number) {
    pending = { fromId, toId, sx: screenX, sy: screenY };
    relType = pickDefaultRelType($relationships, fromId, toId);
    relLabel = '';
    saveError = '';
  }

  function cancelPending() {
    pending = null;
    relLabel = '';
    relType = 'allied_with';
    relStartActId = '';
    relEndActId = '';
    relRevealedAtPosition = null;
    saveError = '';
  }

  async function savePending() {
    if (!pending) return;
    if ((relStartActId && !relEndActId) || (!relStartActId && relEndActId)) {
      saveError = 'Set both a start and end act, or neither.';
      return;
    }
    saving = true;
    saveError = '';
    try {
      const temporalOpts: { startActId?: string; endActId?: string; revealedAtPosition?: number | null } = {};
      if (relStartActId && relEndActId) {
        temporalOpts.startActId = relStartActId;
        temporalOpts.endActId = relEndActId;
      }
      if (relRevealedAtPosition !== null) {
        temporalOpts.revealedAtPosition = relRevealedAtPosition;
      }
      await relationships.createRelationship(
        pending.fromId,
        pending.toId,
        relType,
        relLabel.trim() || undefined,
        Object.keys(temporalOpts).length ? temporalOpts : undefined
      );
      pending = null;
      relLabel = '';
      relType = 'allied_with';
      relStartActId = '';
      relEndActId = '';
      relRevealedAtPosition = null;
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

  // ── Delete confirmation (right-click path) ────────────────────────────────
  // Right-click Delete is a destructive cascade: the entity goes, plus every
  // relationship involving it, every interval involving it, and (for Acts)
  // every child Scene. Single-click destruction is too easy to misfire on,
  // so the menu's "Delete…" entry opens a modal listing the exact blast
  // radius before the user confirms. Cancel closes; Delete actually runs.
  let deleteConfirm = $state<{
    id: string;
    name: string;
    type: string;
    relCount: number;
    intervalCount: number;
    childSceneCount: number;
  } | null>(null);
  let deleting = $state(false);
  let deleteError = $state('');

  function openDeleteConfirm(id: string) {
    const entity = $entities.find((e) => e.id === id);
    if (!entity) return;
    const relCount = $relationships.filter(
      (r) => r.fromId === id || r.toId === id
    ).length;
    const intervalCount = $intervalsStore.filter(
      (iv) => iv.entityId === id || iv.startActId === id || iv.endActId === id
    ).length;
    const childSceneCount =
      entity.type === 'Act'
        ? $entities.filter((e) => e.type === 'Scene' && e.parentId === id).length
        : 0;
    deleteConfirm = {
      id,
      name: entity.name,
      type: entity.type,
      relCount,
      intervalCount,
      childSceneCount
    };
    deleting = false;
    deleteError = '';
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    deleting = true;
    deleteError = '';
    try {
      await entities.deleteEntity(deleteConfirm.id);
      deleteConfirm = null;
    } catch {
      deleteError = "Couldn't delete. The server rejected the request.";
    } finally {
      deleting = false;
    }
  }

  // ── Alias position swap ────────────────────────────────────────────────────
  // When an alias enters scope: snap it to the primary's current canvas
  // position so the two entities stack at the same spot.
  // When the alias exits scope: snap the primary to the alias's current
  // position — so if the alias was dragged while in scope, the primary picks
  // up at that spot rather than teleporting back to its pre-alias location.
  // Plain Set (not $state) so writes don't trigger reactive re-runs.
  let snappedAliasIds = new Set<string>();
  $effect(() => {
    // Capture reactive deps synchronously (registers tracking, snapshots values).
    const t = $playhead;
    const aliases = $entityAliases;
    const scope = outOfScope;
    // Defer position reads/writes to a microtask so:
    // (a) GraphCanvas's auto-placement effect has run first — getPosition()
    //     returns valid coords for nodes that just entered `nodes`.
    // (b) Reading and writing nodePos (via getPosition/reseed) happens outside
    //     the reactive tracking scope — no read-write cycle, no
    //     effect_update_depth_exceeded error.
    queueMicrotask(() => {
      const updates: Record<string, NodePosition> = {};
      const newlySnapped = new Set<string>();
      for (const alias of aliases) {
        const id = alias.aliasEntityId;
        const isRevealed =
          t !== null &&
          !scope.has(id) &&
          (alias.revealedAtPosition === null || t >= alias.revealedAtPosition);
        if (isRevealed && !snappedAliasIds.has(id)) {
          // Alias entering scope: full position swap.
          // Alias → primary's position; primary → alias's position (becomes ghost trail).
          const primaryPos = canvas?.getPosition(alias.primaryEntityId) ?? initialPositions[alias.primaryEntityId];
          const aliasPos = canvas?.getPosition(id);
          if (primaryPos) updates[id] = { x: primaryPos.x, y: primaryPos.y, w: primaryPos.w, h: primaryPos.h };
          if (aliasPos) updates[alias.primaryEntityId] = { x: aliasPos.x, y: aliasPos.y, w: aliasPos.w, h: aliasPos.h };
          newlySnapped.add(id);
        } else if (!isRevealed && snappedAliasIds.has(id)) {
          // Alias exiting scope: full position swap back.
          // Primary → alias's current position; alias → primary's current position.
          const primaryPos = canvas?.getPosition(alias.primaryEntityId);
          const aliasPos = canvas?.getPosition(id);
          if (aliasPos) updates[alias.primaryEntityId] = { x: aliasPos.x, y: aliasPos.y, w: aliasPos.w, h: aliasPos.h };
          if (primaryPos) updates[id] = { x: primaryPos.x, y: primaryPos.y, w: primaryPos.w, h: primaryPos.h };
          snappedAliasIds.delete(id);
        } else if (!isRevealed) {
          snappedAliasIds.delete(id);
        }
      }
      if (Object.keys(updates).length > 0) {
        canvas?.reseed(updates, { fit: false });
        for (const id of newlySnapped) snappedAliasIds.add(id);
      }
    });
  });

  // ── Right-click context menu ───────────────────────────────────────────────
  // Locked menu items per Phase 1B C3:
  //   Open in window, View connections, Open Focused Graph, Edit, Delete,
  //   Pin to canvas. (Pin is deferred until the per-window pin state UI lands;
  //   ships disabled here so the slot is reserved.)
  const contextMenuItems = $derived.by(() => {
    if (!contextMenu) return [];
    const id = contextMenu.entityId;
    const entity = $entities.find((e) => e.id === id);
    const hasLinkedMap = entity?.type === 'Location' && $worldMaps.some((m) => m.locationId === id);
    return [
      {
        label: 'Open in window',
        onSelect: () => openEntity(id)
      },
      ...(hasLinkedMap
        ? [{ label: 'Open map', onSelect: () => windowStore.open('world-map', id) }]
        : []),
      {
        label: 'Open Focused Graph',
        onSelect: () => windowStore.openFocusedGraph([id], 'their_worlds')
      },
      {
        label: 'Recolor…',
        onSelect: () => {
          if (contextMenu) recolorMenu = { entityId: id, x: contextMenu.x, y: contextMenu.y };
          contextMenu = null;
        }
      },
      {
        label: 'Mark as alias of…',
        onSelect: () => {
          const entity = $entities.find((e) => e.id === id);
          if (entity) aliasModal = { entity };
          contextMenu = null;
        }
      },
      {
        label: 'Delete…',
        onSelect: () => openDeleteConfirm(id)
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
  onEdgeContextMenu={(id, x, y) => (editRelMenu = { relationshipId: id, x, y })}
  onEdgeClick={(id) => jumpToCause($relationships.find((r) => r.id === id))}
  showEdgeLabels={edgeLabelsVisible}
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

<!-- Layout settings: gear button at top-right + popover panel below
     it. Click-outside dismisses (svelte:window handler). Mirrors the
     FG settings flow but the panel hangs from the toggle instead of
     anchoring at the bottom corner. -->
<svelte:window
  onclick={(e) => {
    if (!settingsOpen) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('.sg-settings') || t?.closest('.sg-settings-btn')) return;
    settingsOpen = false;
  }}
/>
<div class="sg-controls">
  <div class="sg-controls-row">
    <button
      type="button"
      class="sg-icon-btn"
      title="Reset view (discard layout, return to default)"
      aria-label="Reset view"
      onclick={() => {
        // Clear local + canvas positions. GraphCanvas's auto-place
        // $effect will re-fill from scratch with the grid fallback.
        // This intentionally does NOT persist — server keeps the
        // user's last-saved positions; reload restores them. Reset
        // is a "show me the unstructured state in this session"
        // affordance, not a destructive purge.
        initialPositions = {};
        canvas?.resetPositions();
      }}
    >↻</button>
    <button
      type="button"
      class="sg-icon-btn sg-settings-btn"
      class:open={settingsOpen}
      title="Layout settings"
      aria-label="Toggle layout settings"
      aria-expanded={settingsOpen}
      onclick={() => (settingsOpen = !settingsOpen)}
    >⚙</button>
  </div>
  {#if settingsOpen}
    <div class="sg-settings">
      <TypeOrderPanel
        value={typeOrder}
        onChange={(next) => (typeOrder = next)}
        onApply={() => void layoutByType()}
      />
      <label class="sg-settings-row">
        <span>Scrubbing</span>
        <select
          value={hardFilter ? 'hard' : 'soft'}
          onchange={(e) => setHardFilter((e.currentTarget as HTMLSelectElement).value === 'hard')}
        >
          <option value="hard">Hide edges</option>
          <option value="soft">Dim edges</option>
        </select>
      </label>
      <label class="sg-settings-row">
        <span>Ghost trails</span>
        <input
          type="checkbox"
          checked={showGhostTrails}
          onchange={(e) => setShowGhostTrails((e.currentTarget as HTMLInputElement).checked)}
        />
      </label>
      <label class="sg-settings-row">
        <span>Hide out of scope</span>
        <input type="checkbox" checked={$hideOutOfScope} onchange={() => hideOutOfScope.set(!$hideOutOfScope)} />
      </label>
    </div>
  {/if}
</div>

{#if isLayingOut}
  <div class="sg-laying-out" aria-live="polite">Laying out…</div>
{/if}

<!-- Legend: bottom-left, hard filter for rel types. Same component +
     contract as FocusedGraph (Phase 1B C4). pointer-events: auto on the
     element itself; the canvas underneath stays interactive everywhere
     else. -->
<!-- Legend toggle anchored at bottom-left where the legend itself
     displays. Button always visible; legend renders ABOVE the button
     when open. Stack uses the wrapper for consistent positioning. -->
<div class="sg-legend-wrap">
  {#if legendOpen}
    <Legend
      enabled={enabledRelTypes}
      onToggle={toggleRelType}
      presentTypes={presentRelTypes}
      {edgeLabelsVisible}
      onToggleEdgeLabels={() => (edgeLabelsVisible = !edgeLabelsVisible)}
      {showGhostTrails}
    />
  {/if}
  <button
    type="button"
    class="sg-icon-btn sg-legend-btn"
    class:open={legendOpen}
    title={legendOpen ? 'Hide legend' : 'Show legend'}
    aria-label={legendOpen ? 'Hide legend' : 'Show legend'}
    aria-pressed={legendOpen}
    onclick={() => (legendOpen = !legendOpen)}
  >☰</button>
</div>

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
    {#if acts.length > 0}
      <div class="rel-form-temporal">
        <div class="rel-form-temporal-row">
          <span class="rel-form-temporal-label">Starts</span>
          <select bind:value={relStartActId}>
            <option value="">Any time</option>
            {#each acts as act}
              <option value={act.id}>{act.name}</option>
            {/each}
          </select>
        </div>
        <div class="rel-form-temporal-row">
          <span class="rel-form-temporal-label">Ends</span>
          <select bind:value={relEndActId}>
            <option value="">Forever</option>
            {#each acts as act}
              <option value={act.id}>{act.name}</option>
            {/each}
          </select>
        </div>
      </div>
    {/if}
    {#if acts.length > 0}
      <details class="rel-form-advanced">
        <summary>Advanced</summary>
        <div class="rel-form-temporal-row">
          <span class="rel-form-temporal-label">Revealed at</span>
          <select
            value={relRevealedAtPosition}
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              relRevealedAtPosition = v ? Number(v) : null;
            }}
          >
            <option value="">Always visible</option>
            {#each acts as act, i}
              <option value={i}>{act.name}</option>
            {/each}
          </select>
        </div>
      </details>
    {/if}
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

{#if recolorMenu}
  {@const recolorEntity = $entities.find((e) => e.id === recolorMenu!.entityId)}
  {#if recolorEntity}
    <EntityColorPopover
      entity={recolorEntity}
      x={recolorMenu.x}
      y={recolorMenu.y}
      onClose={() => (recolorMenu = null)}
    />
  {/if}
{/if}

{#if editRelMenu}
  {@const rel = $relationships.find((r) => r.id === editRelMenu!.relationshipId)}
  {#if rel}
    <EditRelationshipModal
      relationship={rel}
      {acts}
      scenes={scenesForReveal}
      onSave={async (fields) => {
        await relationships.updateRelationship(rel.id, fields);
        editRelMenu = null;
      }}
      onClose={() => (editRelMenu = null)}
    />
  {/if}
{/if}

{#if aliasModal}
  <AliasModal
    entity={aliasModal.entity}
    allEntities={$entities}
    {acts}
    scenes={scenesForReveal}
    onSave={async (primaryEntityId, revealedAtPosition) => {
      await entityAliases.createAlias(primaryEntityId, aliasModal!.entity.id, revealedAtPosition);
      aliasModal = null;
    }}
    onClose={() => (aliasModal = null)}
  />
{/if}

{#if deleteConfirm}
  {@const dc = deleteConfirm}
  {@const impacts = [
    { parts: [`The ${dc.type} `, { bold: dc.name }] },
    ...(dc.relCount > 0
      ? [{ parts: [`${dc.relCount} relationship${dc.relCount === 1 ? '' : 's'} involving it (allies, rivals, mentors, locations, POVs, etc.)`] }]
      : []),
    ...(dc.intervalCount > 0
      ? [{ parts: [`${dc.intervalCount} timeline interval${dc.intervalCount === 1 ? '' : 's'} involving it (presence on the timeline disappears)`] }]
      : []),
    ...(dc.childSceneCount > 0
      ? [{ parts: [{ bold: `${dc.childSceneCount} child Scene${dc.childSceneCount === 1 ? '' : 's'}` }, ' inside this Act — deleted along with the Act.'], warn: true }]
      : [])
  ] satisfies DeleteImpact[]}
  <DeleteConfirmDialog
    name={dc.name}
    {impacts}
    confirmLabel={`Delete ${dc.type}`}
    {deleting}
    error={deleteError}
    onConfirm={confirmDelete}
    onCancel={() => (deleteConfirm = null)}
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
    font-size: 12px;
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

  /* Top-right control bar: legend toggle + layout-settings gear in a
     horizontal row, with the settings panel hanging below the gear.
     Click-outside dismissal for the panel handled in markup via
     svelte:window. */
  .sg-controls {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    pointer-events: auto;
  }
  .sg-controls-row {
    display: flex;
    flex-direction: row;
    gap: 6px;
  }
  .sg-icon-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.1s, color 0.1s;
  }
  .sg-icon-btn:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .sg-icon-btn.open {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .sg-settings {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 10px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    min-width: 220px;
  }
  .sg-laying-out {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    padding: 4px 10px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--color-text-muted);
    pointer-events: none;
  }

  /* Bottom-left legend stack: toggle button + (when open) Legend
     above it. The button stays in the same position whether the
     legend is open or closed. */
  .sg-legend-wrap {
    position: absolute;
    bottom: 12px;
    left: 12px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    pointer-events: auto;
  }
  .sg-legend-btn {
    align-self: flex-start;
  }

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
    font-size: 14px;
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
    font-size: 13px;
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
    font-size: 12px;
    color: var(--color-text-muted);
  }

  .rel-form select,
  .rel-form input {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 4px 6px;
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 13px;
  }

  .rel-form-temporal {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rel-form-temporal-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .rel-form-temporal-label {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--color-text-muted);
    width: 32px;
    flex-shrink: 0;
  }
  .rel-form-temporal-row select {
    flex: 1;
  }

  .rel-form-advanced {
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--color-text-muted);
  }
  .rel-form-advanced summary {
    cursor: pointer;
    user-select: none;
    padding: 2px 0;
  }
  .rel-form-advanced .rel-form-temporal-row {
    margin-top: 6px;
  }
  .rel-form-advanced .rel-form-temporal-label {
    width: 52px;
  }

  .sg-settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--color-border);
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--color-text-muted);
    cursor: default;
  }
  .sg-settings-row select {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 2px 4px;
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 12px;
  }

  .rel-form-error {
    margin: 0;
    color: var(--color-rel-rival);
    font-family: var(--font-ui);
    font-size: 12px;
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
    font-size: 13px;
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

  /* ── Delete-cascade confirmation modal ────────────────────────────────── */
</style>
