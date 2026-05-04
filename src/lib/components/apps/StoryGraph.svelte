<script lang="ts">
  import { onMount } from 'svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { intervals as intervalsStore } from '$lib/stores/intervals.js';
  import { playhead, intervalContainsT, isEdgeVisibleAtT, isMysteryEdgeAtT, hideOutOfScope } from '$lib/stores/playhead.js';
  import { windowStore } from '$lib/stores/windows.js';
  import { openEntity } from '$lib/navigation.js';
  import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
  import { REL_COLOR, REL_EDGE_STYLE, REL_TYPES, nodeColorFor } from '$lib/relationship-colors.js';
  import { pickDefaultRelType } from '$lib/graph/rel-type-picker.js';
  import { DEFAULT_TYPE_ORDER } from '$lib/graph/defaults.js';
  import TypeOrderPanel from '$lib/components/TypeOrderPanel.svelte';
  import GraphCanvas, {
    type GraphNode,
    type GraphEdge,
    type NodePosition
  } from '$lib/components/GraphCanvas.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import EditRelationshipModal from '$lib/components/EditRelationshipModal.svelte';
  import { entityAliases } from '$lib/stores/entity-aliases.js';
  import AliasModal from '$lib/components/AliasModal.svelte';
  import Legend from '$lib/components/Legend.svelte';

  onMount(() => { intervalsStore.load(); entityAliases.load(); });

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

  // Character cycle index — Same ordering the Timeline uses
  // (filter to Characters, position within that list). Lets graph
  // node colors match the timeline bars for Characters without a
  // custom data.color.
  const characterIndexById = $derived.by(() => {
    const m = new Map<string, number>();
    $entities.filter((e) => e.type === 'Character').forEach((e, i) => m.set(e.id, i));
    return m;
  });

  const aliasEntityIds = $derived(
    new Set([...$entityAliases.map((a) => a.primaryEntityId), ...$entityAliases.map((a) => a.aliasEntityId)])
  );

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
  let hardFilter = $state(true);
  let showGhostTrails = $state(false);

  // ── Playhead scope ─────────────────────────────────────────────────────────
  // Stable map of entityId → intervals. Rebuilds only when intervals change,
  // not on every playhead scrub — used by ghost trail proximity checks.
  const entityIntervalMap = $derived.by(() => {
    const m = new Map<string, Array<{ startPosition: number; endPosition: number }>>();
    for (const iv of $intervalsStore) {
      const list = m.get(iv.entityId) ?? [];
      list.push(iv);
      m.set(iv.entityId, list);
    }
    return m;
  });

  // Fractional sub-ranges for Scenes within their parent Act's [pos, pos+1) window.
  // Rebuilds only when $entities changes. Scenes sorted by explicit position if set,
  // otherwise by $entities list order (= creation order from the seed).
  // e.position is a 1-indexed DB sort key; the playhead axis is 0-based.
  // Map each act to its 0-based rank so scope checks use [0,1), [1,2), …
  const actIndexById = $derived(
    new Map(
      [...$entities]
        .filter((e) => e.type === 'Act' && e.position != null)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((e, i): [string, number] => [e.id, i])
    )
  );

  const sceneRanges = $derived.by(() => {
    const ranges = new Map<string, { start: number; end: number }>();
    const scenesByAct = new Map<string, Array<{ id: string; position: number | null }>>();
    for (const e of $entities) {
      if (e.type === 'Scene' && e.parentId != null) {
        const list = scenesByAct.get(e.parentId) ?? [];
        list.push({ id: e.id, position: e.position ?? null });
        scenesByAct.set(e.parentId, list);
      }
    }
    for (const [actId, scenes] of scenesByAct) {
      const actIdx = actIndexById.get(actId);
      if (actIdx == null) continue;
      const sorted = [...scenes].sort((a, b) => {
        if (a.position != null && b.position != null) return a.position - b.position;
        if (a.position != null) return -1;
        if (b.position != null) return 1;
        return 0;
      });
      const n = sorted.length;
      for (let i = 0; i < n; i++) {
        ranges.set(sorted[i].id, { start: actIdx + i / n, end: actIdx + (i + 1) / n });
      }
    }
    return ranges;
  });

  // Scenes with their story-time start positions, for the "Revealed at" dropdowns.
  const scenesForReveal = $derived.by(() => {
    const result: { id: string; name: string; actId: string; position: number }[] = [];
    for (const [id, range] of sceneRanges) {
      const e = $entities.find((en) => en.id === id);
      if (e?.parentId) result.push({ id, name: e.name, actId: e.parentId, position: range.start });
    }
    return result.sort((a, b) => a.position - b.position);
  });

  // Sorted scene start positions for ghost trail proximity (scene-granular window).
  const sortedSceneStarts = $derived(
    [...sceneRanges.values()].map((r) => r.start).sort((a, b) => a - b)
  );

  // An entity is "out of scope" at T when:
  //   - It has intervals and none contain T (characters/events on the timeline)
  //   - It is an Act whose position window does not contain T
  //   - It is a Scene whose fractional sub-range within its Act does not contain T
  const outOfScope = $derived.by(() => {
    const set = new Set<string>();
    if ($playhead == null) return set;
    const t = $playhead;

    for (const [entityId, ivs] of entityIntervalMap) {
      const active = ivs.some((iv) => intervalContainsT(iv.startPosition, iv.endPosition, t));
      if (!active) set.add(entityId);
    }

    for (const e of displayEntities) {
      if (e.type === 'Act') {
        const actIdx = actIndexById.get(e.id);
        if (actIdx != null && !intervalContainsT(actIdx, actIdx + 1, t)) set.add(e.id);
      } else if (e.type === 'Scene') {
        const range = sceneRanges.get(e.id);
        if (range != null && !intervalContainsT(range.start, range.end, t)) set.add(e.id);
      }
    }

    return set;
  });

  const renderedEntityIds = $derived.by(() => {
    if (!$hideOutOfScope) return displayEntityIdSet;
    const inScope = new Set([...displayEntityIdSet].filter((id) => !outOfScope.has(id)));
    const t = $playhead;
    // When the alias's interval is active, force-include the primary so it renders
    // as a ghost trail (dimmed via outOfScope) at the swapped position.
    // The SNAP effect moves primary to the alias's old position on the same tick,
    // so primary is visible but displaced — no stacking at the same coordinates.
    if (t !== null) {
      for (const alias of $entityAliases) {
        if (alias.revealedAtPosition != null && t < alias.revealedAtPosition) continue;
        if (!inScope.has(alias.aliasEntityId)) continue;
        if (displayEntityIdSet.has(alias.primaryEntityId)) inScope.add(alias.primaryEntityId);
      }
    }
    if (!showGhostTrails || t === null) return inScope;
    const nearEnoughScene = (lo: number, hi: number) =>
      sortedSceneStarts.length > 0
        ? sortedSceneStarts.filter((s) => s > lo + 1e-9 && s <= hi + 1e-9).length <= 2
        : hi - lo <= 1;
    for (const [entityId, ivs] of entityIntervalMap) {
      if (!outOfScope.has(entityId)) continue;
      for (const iv of ivs) {
        if ((iv.endPosition <= t && nearEnoughScene(iv.endPosition, t)) ||
            (iv.startPosition > t && nearEnoughScene(t, iv.startPosition))) {
          inScope.add(entityId);
          break;
        }
      }
    }
    return inScope;
  });

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

  const presentRelTypes = $derived.by(() => {
    const s = new Set<RelationshipType>();
    for (const r of $relationships) {
      if (displayEntityIdSet.has(r.fromId) && displayEntityIdSet.has(r.toId)) {
        s.add(r.type);
      }
    }
    return s;
  });

  // Single source of truth for "edges currently in the graph": both
  // endpoints displayed AND the rel type is toggled on in the Legend.
  // graphEdges + layoutByType's edge list both project from this so
  // the filter stays in lockstep.
  const visibleRelationships = $derived(
    $relationships.filter(
      (r) =>
        renderedEntityIds.has(r.fromId) &&
        renderedEntityIds.has(r.toId)
    )
  );

  const graphEdges = $derived.by(() => {
    const t = $playhead;
    const edges: GraphEdge[] = [];
    for (const r of visibleRelationships) {
      const inWindow = isEdgeVisibleAtT(r, t);
      const style = REL_EDGE_STYLE[r.type];
      const mystery = isMysteryEdgeAtT(r, t);

      // Ghost mode: show edges near the playhead that aren't currently active.
      // Proximity is scene-granular: ≤2 scene boundaries between the interval
      // edge and T. Falls back to ≤1 act when no scenes exist.
      let ghostMode: 'past' | 'future' | null = null;
      if (showGhostTrails && t !== null && !mystery) {
        const endpointOutOfScope = outOfScope.has(r.fromId) || outOfScope.has(r.toId);
        if (!inWindow || endpointOutOfScope) {
          const nearEnough = (lo: number, hi: number) =>
            sortedSceneStarts.length > 0
              ? sortedSceneStarts.filter((s) => s > lo + 1e-9 && s <= hi + 1e-9).length <= 2
              : hi - lo <= 1;
          if (r.startPosition != null || r.endPosition != null) {
            const nearStart = r.startPosition != null && nearEnough(Math.min(r.startPosition, t), Math.max(r.startPosition, t));
            const nearEnd = r.endPosition != null && nearEnough(Math.min(r.endPosition, t), Math.max(r.endPosition, t));
            if (nearStart || nearEnd) {
              ghostMode = r.startPosition != null && r.startPosition > t ? 'future' : 'past';
            }
          } else {
            outer: for (const endpointId of [r.fromId, r.toId]) {
              for (const iv of entityIntervalMap.get(endpointId) ?? []) {
                if (iv.endPosition <= t && nearEnough(iv.endPosition, t)) { ghostMode = 'past'; break outer; }
                if (iv.startPosition > t && nearEnough(t, iv.startPosition)) { ghostMode = 'future'; break outer; }
              }
            }
          }
        }
      }

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
        ghostMode
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
        const { layoutByType: runLayout } = await import('$lib/graph/dagre-layout.js');
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
  onkeydown={(e) => {
    // Escape dismisses the delete-confirm modal. Bound at the window
    // level because the backdrop div has role="presentation" and no
    // tabindex, so it never receives keyboard focus and an
    // element-level handler would never fire.
    if (e.key === 'Escape' && deleteConfirm && !deleting) {
      deleteConfirm = null;
    }
  }}
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
          onchange={(e) => (hardFilter = (e.currentTarget as HTMLSelectElement).value === 'hard')}
        >
          <option value="hard">Hide edges</option>
          <option value="soft">Dim edges</option>
        </select>
      </label>
      <label class="sg-settings-row">
        <span>Ghost trails</span>
        <input type="checkbox" bind:checked={showGhostTrails} />
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
  <!-- Backdrop click cancels (matches OS modal convention). Escape is
       handled by the svelte:window onkeydown above, NOT here — this
       div is role="presentation" and never receives keyboard focus. -->
  <div
    class="delete-backdrop"
    role="presentation"
    onclick={() => (deleteConfirm = null)}
  ></div>
  <div class="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
    <h2 id="delete-title" class="delete-title">
      Delete <strong>{deleteConfirm.name}</strong>?
    </h2>
    <p class="delete-lead">
      This <strong>permanently</strong> removes the entity and everything that
      references it. There is no undo.
    </p>
    <ul class="delete-impact">
      <li>
        <span class="impact-icon">✕</span>
        <span>The {deleteConfirm.type} <strong>{deleteConfirm.name}</strong></span>
      </li>
      {#if deleteConfirm.relCount > 0}
        <li>
          <span class="impact-icon">✕</span>
          <span>
            {deleteConfirm.relCount}
            relationship{deleteConfirm.relCount === 1 ? '' : 's'} involving it
            (allies, rivals, mentors, locations, POVs, etc.)
          </span>
        </li>
      {/if}
      {#if deleteConfirm.intervalCount > 0}
        <li>
          <span class="impact-icon">✕</span>
          <span>
            {deleteConfirm.intervalCount}
            timeline interval{deleteConfirm.intervalCount === 1 ? '' : 's'}
            involving it (presence on the timeline disappears)
          </span>
        </li>
      {/if}
      {#if deleteConfirm.childSceneCount > 0}
        <li class="impact-warn">
          <span class="impact-icon">⚠</span>
          <span>
            <strong
              >{deleteConfirm.childSceneCount} child
              Scene{deleteConfirm.childSceneCount === 1 ? '' : 's'}</strong
            > inside this Act — deleted along with the Act.
          </span>
        </li>
      {/if}
    </ul>
    {#if deleteError}
      <p class="delete-error" role="alert">{deleteError}</p>
    {/if}
    <div class="delete-actions">
      <button
        type="button"
        class="delete-cancel"
        disabled={deleting}
        onclick={() => (deleteConfirm = null)}
      >Cancel</button>
      <button
        type="button"
        class="delete-confirm-btn"
        disabled={deleting}
        onclick={confirmDelete}
      >{deleting ? 'Deleting…' : `Delete ${deleteConfirm.type}`}</button>
    </div>
  </div>
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
  .delete-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 100;
    cursor: pointer;
  }
  .delete-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 101;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    padding: 22px 24px;
    width: min(440px, calc(100vw - 48px));
    color: var(--color-text);
    font-family: var(--font-ui);
  }
  .delete-title {
    margin: 0 0 8px;
    font-family: var(--font-display, var(--font-ui));
    font-size: 19px;
    font-weight: 500;
    color: var(--color-text);
    line-height: 1.3;
  }
  .delete-title strong {
    color: var(--color-text);
    font-weight: 600;
  }
  .delete-lead {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--color-text-muted);
    line-height: 1.5;
  }
  .delete-lead strong {
    color: #ef4444;
    font-weight: 600;
  }
  .delete-impact {
    list-style: none;
    margin: 0 0 16px;
    padding: 12px 14px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .delete-impact li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-size: 13px;
    line-height: 1.4;
    color: var(--color-text);
  }
  .delete-impact .impact-icon {
    font-size: 11px;
    color: #ef4444;
    line-height: 1.4;
    flex-shrink: 0;
    width: 14px;
    text-align: center;
  }
  .delete-impact .impact-warn {
    color: #fbbf24;
  }
  .delete-impact .impact-warn .impact-icon {
    color: #fbbf24;
  }
  .delete-error {
    margin: 0 0 12px;
    padding: 8px 10px;
    background: color-mix(in srgb, #ef4444 12%, transparent);
    border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
    border-radius: 4px;
    font-size: 12px;
    color: #ef4444;
  }
  .delete-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .delete-cancel {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    border-radius: 4px;
    padding: 7px 14px;
    font-size: 13px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .delete-cancel:hover { color: var(--color-text); border-color: var(--color-text); }
  .delete-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
  .delete-confirm-btn {
    background: #ef4444;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 7px 14px;
    font-size: 13px;
    font-family: var(--font-ui);
    font-weight: 600;
    cursor: pointer;
  }
  .delete-confirm-btn:hover { background: #dc2626; }
  .delete-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
