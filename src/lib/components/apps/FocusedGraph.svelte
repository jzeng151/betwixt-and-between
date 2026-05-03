<script lang="ts">
  import { onMount } from 'svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { intervals as intervalsStore } from '$lib/stores/intervals.js';
  import { playhead, intervalContainsT, isEdgeVisibleAtT, isMysteryEdgeAtT, hideOutOfScope } from '$lib/stores/playhead.js';
  import { windowStore, type FocusedGraphMode } from '$lib/stores/windows.js';
  import { openEntity } from '$lib/navigation.js';
  import { REL_COLOR, REL_EDGE_STYLE, REL_TYPES, nodeColorFor } from '$lib/relationship-colors.js';
  import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
  import { DEFAULT_TYPE_ORDER } from '$lib/graph/defaults.js';
  import type { Edge as TraversalEdge } from '$lib/graph/traversal.js';
  import { computeVisibleSet } from '$lib/graph/visible-set.js';
  import { radialLayout } from '$lib/graph/radial-layout.js';
  import GraphCanvas, {
    type GraphNode,
    type GraphEdge,
    type NodePosition
  } from '$lib/components/GraphCanvas.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import EditRelationshipModal from '$lib/components/EditRelationshipModal.svelte';
  import TypeOrderPanel from '$lib/components/TypeOrderPanel.svelte';
  import Legend from '$lib/components/Legend.svelte';
  import { entityAliases } from '$lib/stores/entity-aliases.js';
  import AliasModal from '$lib/components/AliasModal.svelte';

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
  const acts = $derived(
    $entities.filter((e) => e.type === 'Act').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  );

  // Edge list for traversal helpers (B2 contract).
  const edgeList = $derived<TraversalEdge[]>(
    $relationships.map((r) => ({ fromId: r.fromId, toId: r.toId, type: r.type }))
  );

  // ── Visible set (traversal output) ────────────────────────────────────────
  // Per C6 invariant: visibility is determined ONLY by viewMode + focalSet +
  // edges. Scrubber dimming layers ON TOP via dimmedNodes prop; it does NOT
  // alter this set. Layout-by-type (C5) reads this same visibleSet. The
  // mode→traversal-options mapping lives in `computeVisibleSet` so the rule
  // is unit-testable. All modes walk undirected (a focal Character reaches
  // scenes that are `pov_of` THEM); 'reachable' is 2-hop, not transitive.
  const visibleSet = $derived.by(() =>
    computeVisibleSet(viewMode, focalSetIds, edgeList)
  );

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

  const aliasEntityIds = $derived(
    new Set([...$entityAliases.map((a) => a.primaryEntityId), ...$entityAliases.map((a) => a.aliasEntityId)])
  );

  // ── View options (declared before derived scope logic that references them) ──
  let hardFilter = $state(true);
  let showGhostTrails = $state(false);

  // ── Out-of-scope at playhead (same shape as StoryGraph) ───────────────────
  // Stable interval map — only rebuilds when intervals change, not on scrubs.
  const entityIntervalMap = $derived.by(() => {
    const m = new Map<string, Array<{ startPosition: number; endPosition: number }>>();
    for (const iv of $intervalsStore) {
      const list = m.get(iv.entityId) ?? [];
      list.push(iv);
      m.set(iv.entityId, list);
    }
    return m;
  });

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

  const sortedSceneStarts = $derived(
    [...sceneRanges.values()].map((r) => r.start).sort((a, b) => a - b)
  );

  const scenesForReveal = $derived.by(() => {
    const result: { id: string; name: string; actId: string; position: number }[] = [];
    for (const [id, range] of sceneRanges) {
      const e = $entities.find((en) => en.id === id);
      if (e?.parentId) result.push({ id, name: e.name, actId: e.parentId, position: range.start });
    }
    return result.sort((a, b) => a.position - b.position);
  });

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

  // When hideOutOfScope is on, strip out-of-scope ids from the rendered set so
  // those nodes (and their edges) disappear entirely instead of just dimming.
  // When showGhostTrails is also on, keep nearby-ghost entities rendered so
  // their edges can show as ghost trails (they'll be dimmed via dimmedNodes).
  const renderedEntityIds = $derived.by(() => {
    if (!$hideOutOfScope) return displayEntityIds;
    const inScope = new Set([...displayEntityIds].filter((id) => !outOfScope.has(id)));
    if (!showGhostTrails || $playhead === null) return inScope;
    const t = $playhead;
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

  // Set of rel types that have at least one edge between two displayed
  // entities, BEFORE the Legend filter. Drives Legend's per-row dim
  // for absent types so the user sees which connections actually exist
  // on this view (e.g. opening FG on 2 Characters connected only by
  // `rivals` dims every other row in the legend).
  const presentRelTypes = $derived.by(() => {
    const s = new Set<RelationshipType>();
    for (const r of $relationships) {
      if (displayEntityIds.has(r.fromId) && displayEntityIds.has(r.toId)) {
        s.add(r.type);
      }
    }
    return s;
  });

  // ── GraphCanvas inputs ────────────────────────────────────────────────────

  // Character cycle index — same ordering the Timeline uses (filter
  // to Characters, position within that list). Lets graph node colors
  // match the Timeline bars for Characters without a custom data.color.
  const characterIndexById = $derived.by(() => {
    const m = new Map<string, number>();
    $entities.filter((e) => e.type === 'Character').forEach((e, i) => m.set(e.id, i));
    return m;
  });

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

  // Single source of truth for "edges currently in the graph": both endpoints
  // displayed (post-Note exclusion) AND the rel type is toggled on in the
  // Legend. graphEdges + layoutByType's edge list both project from this so
  // the filter predicate stays in lockstep.
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

  // Reference to the canvas for out-of-band position updates (reseed) +
  // refit calls after layout-by-type mutates positions. Set via bind:this.
  let canvas: GraphCanvas | undefined = $state();

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

  // Seed-from-state flags. `winMapLoaded` flips true after onMount's
  // fetch settles; `radialSeeded` flips true once we've laid out a
  // first-open radial seed. Both gate the $effect below so the radial
  // pass runs ONCE (when winMap is empty AND displayEntities is
  // populated) and then never again — subsequent changes to the focal
  // set would otherwise re-snap user-dragged positions back to the
  // ring.
  let winMapLoaded = $state(false);
  let radialSeeded = $state(false);

  onMount(() => {
    intervalsStore.load();
    entityAliases.load();
    void (async () => {
      // FG canvas is independent of StoryGraph: each FG window has
      // its own per-window state (Lane A). We don't inherit the
      // StoryGraph seed (`/api/canvas-positions`) because that
      // canvas is much wider than an FG window and produced offscreen-
      // clipping or unreadably-zoomed-out fits.
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
      pinnedSet = new Set(winRows.filter((r) => r.pinned === 1).map((r) => r.entityId));

      if (winRows.length > 0) {
        // Subsequent open — restore saved positions immediately.
        // Skip the radial-seed effect by marking it already done.
        initialPositions = winMap;
        currentPositions = { ...initialPositions };
        radialSeeded = true;
      }
      winMapLoaded = true;
    })();
  });

  // First-open radial seed: laid out once when displayEntityIds settles.
  // Replaces GraphCanvas's grid auto-place fallback for the FG case,
  // which produced a cascade-row look (focal + neighbors strung along
  // a single line at y=60). Radial reads as a graph: focal at center,
  // neighbors on a ring around it.
  $effect(() => {
    if (radialSeeded || !winMapLoaded) return;
    if (displayEntityIds.size === 0) return;
    const positions = radialLayout(focalSetIds, [...displayEntityIds]);
    initialPositions = positions;
    currentPositions = { ...positions };
    radialSeeded = true;
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
        // Over-estimate per-node rendered width: name @ ~9px/char +
        // 100px constant covers padding, gap, and the type-tag suffix.
        const layoutNodes = displayEntities.map((e) => ({
          id: e.id,
          type: e.type,
          width: Math.max(180, e.name.length * 9 + 100),
          height: 32
        }));
        // Reuse the same predicate that drives graphEdges — keeps the
        // visible-edge contract DRY.
        const layoutEdges = visibleRelationships.map((r) => ({
          fromId: r.fromId,
          toId: r.toId
        }));
        // Only include currently-visible entities. currentPositions accumulates
        // stale entries from prior display states; stale pinned positions skew
        // pinnedCentroid and shift the unpinned cluster away from visible pins.
        const displayEntityIdSet = new Set(displayEntities.map((e) => e.id));
        const positionsForCentroid = Object.entries(currentPositions)
          .filter(([id]) => displayEntityIdSet.has(id))
          .map(([id, p]) => ({ id, x: p.x, y: p.y }));

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
        initialPositions = { ...initialPositions, ...updates };
        // Push the new positions THROUGH GraphCanvas so the visible nodes
        // animate to their new spots immediately (rather than appearing
        // only after a window remount). canvas.reseed() merges into
        // GraphCanvas's internal nodePos and re-fits.
        canvas?.reseed(updates);
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
          // reseed() pushes positionsBefore back into the canvas so the
          // visual reverts too — without it the nodes would stay at the
          // new positions even though the data layer reverted.
          currentPositions = positionsBefore;
          initialPositions = initialBefore;
          canvas?.reseed(positionsBefore);
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
          canvas?.reseed(positionsBefore);
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

  // ── Alias position snap ────────────────────────────────────────────────────
  let snappedAliasIds = new Set<string>();
  $effect(() => {
    const t = $playhead;
    const updates: Record<string, NodePosition> = {};
    for (const alias of $entityAliases) {
      const id = alias.aliasEntityId;
      const isRevealed =
        t !== null &&
        !outOfScope.has(id) &&
        (alias.revealedAtPosition === null || t >= alias.revealedAtPosition);
      if (isRevealed && !snappedAliasIds.has(id)) {
        const pos = canvas?.getPosition(alias.primaryEntityId) ?? currentPositions[alias.primaryEntityId] ?? initialPositions[alias.primaryEntityId];
        if (pos) updates[id] = { ...pos };
      } else if (!isRevealed) {
        snappedAliasIds.delete(id);
      }
    }
    if (Object.keys(updates).length > 0) {
      canvas?.reseed(updates, { fit: false });
      for (const id of Object.keys(updates)) snappedAliasIds.add(id);
    }
  });

  // ── Right-click context menu ───────────────────────────────────────────────
  // FG variant per Phase 1B C3: focal nodes get "Remove from focal set"
  // instead of "Open Focused Graph"; non-focal nodes get an "Add to focal
  // set" affordance so the user can grow the focal selection without going
  // back to StoryGraph.
  let contextMenu = $state<{ entityId: string; x: number; y: number } | null>(null);
  let editRelMenu = $state<{ relationshipId: string; x: number; y: number } | null>(null);
  let aliasModal = $state<{ entity: { id: string; type: string; name: string } } | null>(null);

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
    items.push({
      label: 'Mark as alias of…',
      onSelect: () => {
        const entity = $entities.find((e) => e.id === id);
        if (entity) aliasModal = { entity };
        contextMenu = null;
      }
    });
    return items;
  });

  // Settings panel toggle (C7 panel anchored to the header).
  let settingsOpen = $state(false);
  let legendOpen = $state(true);
  let edgeLabelsVisible = $state(true);
  const currentTypeOrder = $derived<EntityType[]>(win?.typeOrder ?? DEFAULT_TYPE_ORDER);
</script>

<svelte:window
  onclick={(e) => {
    if (!settingsOpen) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('.fg-settings') || t?.closest('.fg-settings-btn') || t?.closest('.fg-mode')) return;
    settingsOpen = false;
  }}
/>

<div class="fg">
  <header class="fg-header">
    <label class="fg-mode">
      <span class="fg-mode-label">View</span>
      <select
        value={viewMode}
        onchange={(e) => setMode((e.currentTarget as HTMLSelectElement).value as FocusedGraphMode)}
      >
        <option value="their_worlds">Immediate connections</option>
        <option value="shared">Intersections</option>
        <option value="reachable">All</option>
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
      title="Reset view (discard layout, return to default)"
      aria-label="Reset view"
      onclick={() => {
        // Clear local + canvas positions and the radial-seeded flag.
        // The radial-seed $effect then re-runs and lays focals at
        // the canvas center with peripherals on a ring around it —
        // the FG's "default" unstructured state. Session-scoped:
        // server keeps the user's last-saved positions for reload.
        initialPositions = {};
        currentPositions = {};
        radialSeeded = false;
        canvas?.resetPositions();
      }}
    >↻</button>
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
    {#if viewMode === 'shared' && focalSetIds.size < 2}
      <div class="fg-mode-hint" role="note">
        Pick a second focal to see what they have in common.
      </div>
    {/if}
    <GraphCanvas
      bind:this={canvas}
      nodes={graphNodes}
      edges={graphEdges}
      dimmedNodes={outOfScope}
      {initialPositions}
      onNodeOpen={openEntity}
      {onNodePositionChange}
      onContextMenu={(id, x, y) => (contextMenu = { entityId: id, x, y })}
      onEdgeContextMenu={(id, x, y) => (editRelMenu = { relationshipId: id, x, y })}
      showEdgeLabels={edgeLabelsVisible}
    >
      {#snippet emptyState()}
        <div class="fg-empty">
          <p>Pick a focal entity to start.</p>
        </div>
      {/snippet}

      {#snippet nodeBadge({ id })}
        {#if pinnedSet.has(id)}
          <span
            class="pin-badge"
            title="Pinned to canvas (excluded from Layout by type)"
            aria-label="Pinned"
          >📌</span>
        {/if}
      {/snippet}

      {#snippet nodeOverlay({ id })}
        {#if !focalSetIds.has(id)}
          <button
            type="button"
            class="add-focal-btn"
            title="Add to focal set"
            aria-label="Add to focal set"
            onclick={(e) => {
              e.stopPropagation();
              addToFocalSet(id);
            }}
          >+</button>
        {/if}
      {/snippet}
    </GraphCanvas>

    <!-- Legend stack: toggle button + (when open) Legend above it.
         Toggle stays at bottom-left whether the legend is open or
         closed; legend renders ABOVE the button when shown. -->
    <div class="fg-legend-wrap">
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
        class="fg-settings-btn fg-legend-btn"
        class:open={legendOpen}
        title={legendOpen ? 'Hide legend' : 'Show legend'}
        aria-label={legendOpen ? 'Hide legend' : 'Show legend'}
        aria-pressed={legendOpen}
        onclick={() => (legendOpen = !legendOpen)}
      >☰</button>
    </div>

    <!-- Settings panel: bottom-right, toggle via header gear -->
    {#if settingsOpen}
      <div class="fg-settings">
        <TypeOrderPanel
          value={currentTypeOrder}
          onChange={setTypeOrder}
          onApply={() => void layoutByType()}
        />
        <label class="fg-settings-row">
          <span>Scrubbing</span>
          <select
            value={hardFilter ? 'hard' : 'soft'}
            onchange={(e) => (hardFilter = (e.currentTarget as HTMLSelectElement).value === 'hard')}
          >
            <option value="hard">Hide edges</option>
            <option value="soft">Dim edges</option>
          </select>
        </label>
        <label class="fg-settings-row">
          <span>Ghost trails</span>
          <input type="checkbox" bind:checked={showGhostTrails} />
        </label>
        <label class="fg-settings-row">
          <span>Hide out of scope</span>
          <input type="checkbox" checked={$hideOutOfScope} onchange={() => hideOutOfScope.set(!$hideOutOfScope)} />
        </label>
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
    font-size: 12px;
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
    font-size: 13px;
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
    font-size: 13px;
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
    font-size: 13px;
    line-height: 1;
    padding: 0;
  }

  .chip-x:hover {
    background: rgba(255, 255, 255, 0.4);
  }

  .chip-empty {
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 13px;
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
    font-size: 15px;
    line-height: 1;
    flex-shrink: 0;
  }

  .fg-settings-btn.open {
    background: var(--color-accent);
    color: white;
    border-color: var(--color-accent);
  }

  /* Bottom-left legend stack: toggle button + (when open) Legend
     above it. Button stays in the same position whether the legend
     is open or closed. */
  .fg-legend-wrap {
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
  .fg-legend-btn {
    align-self: flex-start;
  }

  .fg-settings {
    position: absolute;
    bottom: 12px;
    right: 12px;
    z-index: 5;
    pointer-events: auto;
  }
  .fg-settings-row {
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
  .fg-settings-row select {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 2px 4px;
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 12px;
  }

  /* Hover-only "+" badge on non-focal nodes for click-to-extend.
     Top-right corner; pin badge sits at top-left so the two never
     collide. Renders inside the overlay slot which GraphCanvas only
     mounts when the node is hovered. */
  .add-focal-btn {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 14px;
    line-height: 1;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }
  .add-focal-btn:hover {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-surface);
  }

  /* Mode-specific hint banner (e.g. shared mode needs ≥2 focals to
     differ from immediate-connections). Floats above the canvas at
     the top, doesn't block interaction since it's a thin strip. */
  .fg-mode-hint {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    padding: 4px 10px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--color-text-muted);
    white-space: nowrap;
    pointer-events: none;
  }

  .pin-badge {
    position: absolute;
    top: -8px;
    left: -8px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--color-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    pointer-events: none;
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
    font-size: 13px;
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
    font-size: 14px;
    pointer-events: none;
  }
</style>
