<script lang="ts">
  import 'tldraw/tldraw.css';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import type { RelationshipType } from '$lib/server/db/schema.js';

  type CanvasPos = { entityId: string; x: number; y: number; width: number; height: number };

  let container: HTMLDivElement = $state(null!);
  let reactRoot: any = null;
  let editor: any = null;

  let pending: {
    shapeId: string;
    fromEntityId: string;
    toEntityId: string;
    x: number;
    y: number;
  } | null = $state(null);

  let relType: RelationshipType = $state('allied_with');
  let relLabel = $state('');
  let saving = $state(false);
  let error: string | null = $state(null);

  const REL_TYPES: RelationshipType[] = [
    'allied_with',
    'rivals',
    'mentor_of',
    'appears_in',
    'takes_place_at',
    'caused_by',
    'located_at',
  ];

  const ENTITY_COLOR: Record<string, string> = {
    Character: 'blue',
    Location: 'green',
    Event: 'red',
    Act: 'orange',
    Scene: 'yellow',
  };

  const hasEntities = $derived($entities.filter((e) => e.type !== 'Note').length > 0);

  function entityShapeId(entityId: string): string {
    return `shape:ent-${entityId}`;
  }

  function entityIdFromShapeId(shapeId: string): string | null {
    const m = shapeId.match(/^shape:ent-(.+)$/);
    return m ? m[1] : null;
  }

  async function fetchPositions(): Promise<Record<string, CanvasPos>> {
    const res = await fetch('/api/canvas-positions');
    if (!res.ok) return {};
    const rows: CanvasPos[] = await res.json();
    return Object.fromEntries(rows.map((r) => [r.entityId, r]));
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSavePosition(entityId: string, x: number, y: number, w: number, h: number) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fetch('/api/canvas-positions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
        }),
      });
    }, 600);
  }

  function cancelPending() {
    if (pending && editor) editor.deleteShapes([pending.shapeId]);
    pending = null;
    relLabel = '';
    relType = 'allied_with';
  }

  async function savePending() {
    if (!pending) return;
    saving = true;
    try {
      const label = relLabel.trim() || undefined;
      await relationships.createRelationship(pending.fromEntityId, pending.toEntityId, relType, label);
      if (editor) {
        editor.updateShapes([{
          id: pending.shapeId,
          type: 'arrow',
          props: { text: label ?? relType.replace(/_/g, ' '), color: 'grey' },
        }]);
      }
    } catch (e) {
      console.error('Failed to save relationship', e);
    } finally {
      saving = false;
      pending = null;
      relLabel = '';
      relType = 'allied_with';
    }
  }

  function handleRelFormKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelPending();
    if (e.key === 'Enter' && !e.shiftKey) savePending();
  }

  onMount(async () => {
    try {
      const [
        { default: React },
        { createRoot },
        { Tldraw, getArrowBindings },
      ] = await Promise.all([
        import('react'),
        import('react-dom/client'),
        import('tldraw'),
      ]);

      const positions = await fetchPositions();

      function buildEntityShapes() {
        const ents = get(entities).filter((e) => e.type !== 'Note');
        return ents.map((e, i) => {
          const pos = positions[e.id];
          return {
            id: entityShapeId(e.id),
            type: 'geo',
            x: pos?.x ?? 80 + (i % 4) * 220,
            y: pos?.y ?? 80 + Math.floor(i / 4) * 120,
            props: {
              w: pos?.width ?? 160,
              h: pos?.height ?? 72,
              geo: 'rectangle',
              text: e.name,
              color: ENTITY_COLOR[e.type] ?? 'blue',
              fill: 'semi',
              size: 's',
              font: 'sans',
              align: 'middle',
              verticalAlign: 'middle',
            },
          };
        });
      }

      function TldrawApp() {
        return React.createElement(Tldraw, {
          inferDarkMode: false,
          onMount: (ed: any) => {
            editor = ed;

            // Create entity shapes
            const entityShapes = buildEntityShapes();
            if (entityShapes.length > 0) {
              ed.createShapes(entityShapes);
            }

            // Create relationship arrows with bindings
            const ents = get(entities).filter((e) => e.type !== 'Note');
            const rels = get(relationships);
            for (const rel of rels) {
              const fromExists = ents.some((e) => e.id === rel.fromId);
              const toExists = ents.some((e) => e.id === rel.toId);
              if (!fromExists || !toExists) continue;

              const arrowId = `shape:rel-${rel.id}`;
              ed.createShapes([{
                id: arrowId,
                type: 'arrow',
                x: 0,
                y: 0,
                props: {
                  text: rel.label ?? rel.type.replace(/_/g, ' '),
                  color: 'grey',
                  size: 's',
                },
              }]);
              ed.createBindings([
                {
                  type: 'arrow',
                  fromId: arrowId,
                  toId: entityShapeId(rel.fromId),
                  props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
                },
                {
                  type: 'arrow',
                  fromId: arrowId,
                  toId: entityShapeId(rel.toId),
                  props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
                },
              ]);
            }

            // Zoom to fit on load
            if (entityShapes.length > 0) {
              setTimeout(() => {
                try { ed.zoomToFit({ animation: { duration: 0 } }); } catch (_) {}
              }, 50);
            }

            // Watch for shape moves and new arrows
            const unsubStore = ed.store.listen(({ changes }: any) => {
              // Detect completed arrows drawn between entity shapes
              for (const record of Object.values(changes.added) as any[]) {
                if (record.typeName !== 'binding' || record.type !== 'arrow') continue;
                if (record.props?.terminal !== 'end') continue;

                const arrowId = record.fromId as string;
                if (arrowId.startsWith('shape:rel-')) continue;

                const arrow = ed.getShape(arrowId);
                if (!arrow || arrow.type !== 'arrow') continue;

                const arrowBindings = getArrowBindings(ed, arrow);
                if (!arrowBindings.start || !arrowBindings.end) continue;

                const fromEntityId = entityIdFromShapeId(arrowBindings.start.toId);
                const toEntityId = entityIdFromShapeId(arrowBindings.end.toId);
                if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) continue;

                // Compute form position at arrow midpoint in viewport space
                let formX = 200;
                let formY = 200;
                try {
                  const bounds = ed.getShapePageBounds(arrowId);
                  if (bounds) {
                    const vp = ed.pageToViewport({ x: bounds.midX, y: bounds.midY });
                    formX = vp.x;
                    formY = vp.y;
                  }
                } catch (_) {}

                pending = { shapeId: arrowId, fromEntityId, toEntityId, x: formX, y: formY };
                relType = 'allied_with';
                relLabel = '';
              }

              // Detect shape moves → save canvas position
              for (const [, [before, after]] of Object.entries(changes.updated) as any[]) {
                if (after.typeName !== 'shape') continue;
                const entityId = entityIdFromShapeId(after.id as string);
                if (!entityId) continue;
                if (
                  before.x === after.x &&
                  before.y === after.y &&
                  before.props?.w === after.props?.w &&
                  before.props?.h === after.props?.h
                ) continue;
                scheduleSavePosition(entityId, after.x, after.y, after.props.w, after.props.h);
              }
            });

            return unsubStore;
          },
        });
      }

      reactRoot = createRoot(container);
      reactRoot.render(React.createElement(TldrawApp));

      // Sync entity changes to tldraw
      const unsubEntities = entities.subscribe((ents) => {
        if (!editor) return;
        const filtered = ents.filter((e) => e.type !== 'Note');
        const entityIds = new Set(filtered.map((e) => e.id));

        // Add missing or update changed entities
        for (const e of filtered) {
          const sid = entityShapeId(e.id);
          const shape = editor.getShape(sid);
          if (!shape) {
            const i = filtered.indexOf(e);
            editor.createShapes([{
              id: sid,
              type: 'geo',
              x: positions[e.id]?.x ?? 80 + (i % 4) * 220,
              y: positions[e.id]?.y ?? 80 + Math.floor(i / 4) * 120,
              props: {
                w: positions[e.id]?.width ?? 160,
                h: positions[e.id]?.height ?? 72,
                geo: 'rectangle',
                text: e.name,
                color: ENTITY_COLOR[e.type] ?? 'blue',
                fill: 'semi',
                size: 's',
                font: 'sans',
                align: 'middle',
                verticalAlign: 'middle',
              },
            }]);
          } else if (shape.props.text !== e.name) {
            editor.updateShapes([{ id: sid, type: 'geo', props: { text: e.name } }]);
          }
        }

        // Remove shapes for deleted entities
        for (const shape of editor.getCurrentPageShapes()) {
          const entityId = entityIdFromShapeId(shape.id as string);
          if (entityId && !entityIds.has(entityId)) {
            editor.deleteShapes([shape.id]);
          }
        }
      });

      return () => {
        unsubEntities();
        reactRoot?.unmount();
        reactRoot = null;
        editor = null;
      };
    } catch (e) {
      console.error('StoryGraph failed to initialize', e);
      error = 'Graph failed to load. Refresh the window.';
    }
  });

  onDestroy(() => {
    reactRoot?.unmount();
  });
</script>

<div class="story-graph-root">
  {#if error}
    <div class="error-state">
      <p>{error}</p>
      <button onclick={() => window.location.reload()}>Retry</button>
    </div>
  {:else}
    <div class="canvas-wrap" bind:this={container}></div>

    {#if !hasEntities}
      <div class="empty-overlay">
        <p>No characters yet. Create one in Characters → it will appear here automatically.</p>
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
        role="dialog"
        aria-label="Define relationship"
        tabindex="-1"
        style="left:{pending.x}px; top:{pending.y}px"
        onkeydown={handleRelFormKeydown}
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
  {/if}
</div>

<style>
  .story-graph-root {
    position: absolute;
    inset: 0;
  }

  .canvas-wrap {
    position: absolute;
    inset: 0;
  }

  .empty-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: rgba(13, 15, 20, 0.85);
    z-index: 10;
    pointer-events: none;
    text-align: center;
    padding: 24px;
  }

  .empty-overlay p {
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--color-text-muted);
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

  .ghost-sep {
    color: var(--color-border);
    font-size: 10px;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 12px;
  }

  .error-state button {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }

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
    box-shadow: var(--window-shadow);
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
  .rel-form input:focus {
    border-color: var(--color-accent);
    outline: 2px solid var(--color-accent);
    outline-offset: -1px;
  }

  .rel-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 2px;
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
    transition: background 0.12s;
  }

  .rel-form-actions button:hover {
    background: var(--color-border);
  }

  .rel-form-actions button.primary {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-surface);
    font-weight: 600;
  }

  .rel-form-actions button.primary:hover {
    opacity: 0.85;
  }

  .rel-form-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
