<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import InlineEdit from '$lib/components/InlineEdit.svelte';

  interface Props { entityId: string | null; }
  let { entityId }: Props = $props();

  const acts = $derived(
    $entities
      .filter((e) => e.type === 'Act')
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
  );

  const characters = $derived(
    $entities
      .filter((e) => e.type === 'Character')
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
  );

  const timelineItems = $derived(
    $entities.filter((e) => e.type === 'Event' || e.type === 'Scene')
  );

  function eventsOnTrack(actId: string, track: 'plot' | 'world') {
    return $relationships
      .filter(
        (r) =>
          r.type === 'appears_in' &&
          (r.label === track || (track === 'plot' && r.label == null)) &&
          (r.fromId === actId || r.toId === actId)
      )
      .map((r) => {
        const itemId = r.fromId === actId ? r.toId : r.fromId;
        const item = timelineItems.find((e) => e.id === itemId);
        return item ? { item, relId: r.id } : null;
      })
      .filter(Boolean) as { item: (typeof timelineItems)[number]; relId: string }[];
  }

  function charInAct(charId: string, actId: string) {
    return $relationships.some(
      (r) =>
        r.type === 'appears_in' &&
        ((r.fromId === charId && r.toId === actId) ||
          (r.fromId === actId && r.toId === charId))
    );
  }

  function eventActs(itemId: string) {
    return $relationships
      .filter(
        (r) =>
          r.type === 'appears_in' &&
          (r.label === 'plot' || r.label === 'world') &&
          (r.fromId === itemId || r.toId === itemId)
      )
      .map((r) => ({
        rel: r,
        act: acts.find((a) => a.id === r.fromId || a.id === r.toId)!,
        track: r.label as 'plot' | 'world'
      }))
      .filter((x) => x.act);
  }

  let saveError = $state('');

  const CHAR_COLORS = [
    { bg: 'rgba(200,100,150,0.25)', border: 'rgba(200,100,150,0.5)',  text: '#faa' },
    { bg: 'rgba(100,200,130,0.2)',  border: 'rgba(100,200,130,0.45)', text: '#afa' },
    { bg: 'rgba(200,160,80,0.2)',   border: 'rgba(200,160,80,0.45)',  text: '#fda' },
    { bg: 'rgba(130,100,220,0.2)',  border: 'rgba(130,100,220,0.45)', text: '#c8a0f0' },
    { bg: 'rgba(80,180,210,0.2)',   border: 'rgba(80,180,210,0.45)',  text: '#80d0f0' },
  ] as const;

  const SLOT_H = 26; // px per event slot (min-height + gap)

  const plotAutoH = $derived.by(() => {
    const max = Math.max(0, ...acts.map((a) => eventsOnTrack(a.id, 'plot').length));
    return (max + 1) * SLOT_H + 8;
  });

  const worldAutoH = $derived.by(() => {
    const max = Math.max(0, ...acts.map((a) => eventsOnTrack(a.id, 'world').length));
    return (max + 1) * SLOT_H + 8;
  });

  let colWidths   = $state<Record<string, number>>({});
  let plotHeight  = $state<number | null>(null);
  let worldHeight = $state<number | null>(null);
  let charHeights = $state<Record<string, number | null>>({});

  let draggingId = $state<string | null>(null);
  let dragOver   = $state<{ actId: string; track: 'plot' | 'world' } | null>(null);

  function startColResize(e: PointerEvent, actId: string) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().width;
    const onMove = (ev: PointerEvent) => { colWidths[actId] = Math.max(60, startW + ev.clientX - startX); };
    const onUp   = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startRowResize(e: PointerEvent, rowKey: string) {
    e.preventDefault();
    const trackLine = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement;
    const startY = e.clientY;
    const startH = trackLine.getBoundingClientRect().height;
    const onMove = (ev: PointerEvent) => {
      const h = Math.max(28, startH + ev.clientY - startY);
      if (rowKey === 'plot') plotHeight = h;
      else if (rowKey === 'world') worldHeight = h;
      else charHeights[rowKey] = h;
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function onDragStart(e: DragEvent, itemId: string) {
    draggingId = itemId;
    e.dataTransfer!.setData('text/plain', itemId);
    e.dataTransfer!.effectAllowed = 'link';
  }
  function onDragEnd() { draggingId = null; }
  function onDragOver(e: DragEvent) { e.preventDefault(); }

  async function onDropOnTrack(e: DragEvent, actId: string, track: 'plot' | 'world') {
    e.preventDefault();
    dragOver = null;
    const itemId = e.dataTransfer!.getData('text/plain');
    if (!itemId) return;
    const existingOnTrack = $relationships.filter(
      (r) =>
        r.type === 'appears_in' &&
        r.label === track &&
        (r.fromId === itemId || r.toId === itemId)
    );
    // Already in this exact act — no-op
    if (existingOnTrack.some((r) => r.fromId === actId || r.toId === actId)) {
      draggingId = null;
      return;
    }
    // Remove from any other act on this track (move semantics)
    for (const r of existingOnTrack) {
      try { await relationships.deleteRelationship(r.id); } catch { /* ignore */ }
    }
    try {
      await relationships.createRelationship(actId, itemId, 'appears_in', track);
    } catch { saveError = 'Could not assign event.'; }
    draggingId = null;
  }

  async function removeFromAct(relId: string) {
    try {
      await relationships.deleteRelationship(relId);
    } catch { saveError = 'Could not remove.'; }
  }

  function charActLinks(charId: string) {
    return $relationships
      .filter(
        (r) =>
          r.type === 'appears_in' &&
          r.label == null &&
          (r.fromId === charId || r.toId === charId) &&
          acts.some((a) => a.id === r.fromId || a.id === r.toId)
      )
      .map((r) => ({
        rel: r,
        act: acts.find((a) => a.id === r.fromId || a.id === r.toId)!
      }))
      .filter((x) => x.act);
  }

  async function onDropToCharAct(e: DragEvent, charId: string, actId: string) {
    e.preventDefault();
    if (e.dataTransfer!.getData('text/plain') !== charId || charInAct(charId, actId)) return;
    try {
      await relationships.createRelationship(actId, charId, 'appears_in');
    } catch { saveError = 'Could not assign character.'; }
    draggingId = null;
  }

  async function createAct() {
    saveError = '';
    try {
      await entities.createEntity('Act', 'New Act');
    } catch { saveError = 'Could not create act.'; }
  }

  async function deleteAct(id: string) {
    saveError = '';
    try {
      await entities.deleteEntity(id);
    } catch { saveError = 'Could not delete act.'; }
  }

  async function createEvent() {
    saveError = '';
    try {
      await entities.createEntity('Event', 'New Event');
    } catch { saveError = 'Could not create event.'; }
  }

  async function rename(id: string, name: string) {
    try {
      await entities.updateEntity(id, { name });
    } catch { saveError = "Couldn't rename."; }
  }
</script>

<div class="timeline-root">
  {#if acts.length === 0 && timelineItems.length === 0}
    <div class="empty-state">
      <p>No events yet. Add an Act to begin your story.</p>
      <button class="action-btn" onclick={createAct}>+ Add Act</button>
      {#if saveError}<p class="save-error">{saveError}</p>{/if}
    </div>

  {:else}
    <div class="tl-wrap">

      <div class="tl-toolbar">
        <button class="add-act-btn" onclick={createAct}>+ Act</button>
        {#if saveError}<span class="save-error">{saveError}</span>{/if}
      </div>

      <div class="tl-scroll">

        <!-- Act labels header -->
        <div class="tl-header">
          <div class="tl-gutter"></div>
          <div class="tl-acts-bar">
            {#each acts as act, i}
              <div
                class="tl-act-label"
                class:focused={act.id === entityId}
                style={colWidths[act.id] != null ? `flex:none;width:${colWidths[act.id]}px` : ''}
              >
                <span class="act-num">ACT {i + 1}</span>
                <InlineEdit value={act.name} onSave={(n) => rename(act.id, n)} class="act-name-edit" />
                <button class="act-delete" onclick={() => deleteAct(act.id)} title="Delete act">×</button>
                <div class="col-resize-handle" onpointerdown={(e) => startColResize(e, act.id)} role="separator" aria-label="Resize act column"></div>
              </div>
            {/each}
          </div>
        </div>

        <!-- Plot row -->
        <div class="tl-row" style="flex:none;height:{plotHeight ?? plotAutoH}px">
          <div class="tl-row-label">Plot</div>
          <div class="tl-track-line">
            {#each acts as act}
              <div
                class="tl-seg"
                class:drop-over={dragOver?.actId === act.id && dragOver?.track === 'plot'}
                class:focused={act.id === entityId}
                style={colWidths[act.id] != null ? `flex:none;width:${colWidths[act.id]}px` : ''}
                role="region"
                aria-label="Plot act segment"
                ondragover={onDragOver}
                ondragenter={() => (dragOver = { actId: act.id, track: 'plot' })}
                ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragOver = null; }}
                ondrop={(e) => onDropOnTrack(e, act.id, 'plot')}
              >
                {#each eventsOnTrack(act.id, 'plot') as { item, relId }}
                  <div
                    class="tl-event"
                    class:highlight={item.id === entityId}
                    class:dragging={draggingId === item.id}
                    role="listitem"
                    draggable="true"
                    ondragstart={(e) => onDragStart(e, item.id)}
                    ondragend={onDragEnd}
                  >
                    <InlineEdit value={item.name} onSave={(n) => rename(item.id, n)} class="event-name-edit" />
                    <button class="event-remove" onclick={() => removeFromAct(relId)}>×</button>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
          <div class="row-resize-handle" onpointerdown={(e) => startRowResize(e, 'plot')} role="separator" aria-label="Resize plot row"></div>
        </div>

        <!-- One track row per character -->
        {#each characters as char, ci}
          {@const cc = CHAR_COLORS[ci % CHAR_COLORS.length]}
          {@const charH = charHeights[char.id]}
          <div class="tl-row char-row" style="--char-bg:{cc.bg};--char-border:{cc.border};--char-color:{cc.text}{charH != null ? `;flex:none;height:${charH}px` : ''}">
            <div class="tl-row-label tl-char-label" class:focused={char.id === entityId}>
              {char.name}
            </div>
            <div class="tl-track-line" style={charH != null ? `height:${charH}px` : ''}>
              {#each acts as act}
                <div
                  class="tl-seg"
                  class:focused={act.id === entityId}
                  style={colWidths[act.id] != null ? `flex:none;width:${colWidths[act.id]}px` : ''}
                  role="region"
                  aria-label="Character act segment"
                  ondragover={onDragOver}
                  ondrop={(e) => onDropToCharAct(e, char.id, act.id)}
                >
                  {#if charInAct(char.id, act.id)}
                    <div class="tl-char-bar" class:highlight={char.id === entityId}>
                      {char.name}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            <div class="row-resize-handle" onpointerdown={(e) => startRowResize(e, char.id)} role="separator" aria-label="Resize character row"></div>
          </div>
        {/each}

        <!-- World row -->
        <div class="tl-row" style="flex:none;height:{worldHeight ?? worldAutoH}px">
          <div class="tl-row-label">World</div>
          <div class="tl-track-line">
            {#each acts as act}
              <div
                class="tl-seg"
                class:drop-over={dragOver?.actId === act.id && dragOver?.track === 'world'}
                class:focused={act.id === entityId}
                style={colWidths[act.id] != null ? `flex:none;width:${colWidths[act.id]}px` : ''}
                role="region"
                aria-label="World act segment"
                ondragover={onDragOver}
                ondragenter={() => (dragOver = { actId: act.id, track: 'world' })}
                ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragOver = null; }}
                ondrop={(e) => onDropOnTrack(e, act.id, 'world')}
              >
                {#each eventsOnTrack(act.id, 'world') as { item, relId }}
                  <div
                    class="tl-event ev-world"
                    class:highlight={item.id === entityId}
                    class:dragging={draggingId === item.id}
                    role="listitem"
                    draggable="true"
                    ondragstart={(e) => onDragStart(e, item.id)}
                    ondragend={onDragEnd}
                  >
                    <InlineEdit value={item.name} onSave={(n) => rename(item.id, n)} class="event-name-edit" />
                    <button class="event-remove" onclick={() => removeFromAct(relId)}>×</button>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
          <div class="row-resize-handle" onpointerdown={(e) => startRowResize(e, 'world')} role="separator" aria-label="Resize world row"></div>
        </div>

      </div>

      <!-- Events pool: drag chips onto Plot or World act segments above to place them -->
      <div class="tl-events-pool">
        <div class="pool-header">
          <span class="pool-label">Events</span>
          <button class="add-event-btn" onclick={createEvent}>+ Event</button>
        </div>
        <div class="pool-chips">
          {#each timelineItems.filter((item) => eventActs(item.id).length === 0) as item}
            <div
              class="pool-chip"
              class:dragging={draggingId === item.id}
              class:highlight={item.id === entityId}
              role="listitem"
              draggable="true"
              ondragstart={(e) => onDragStart(e, item.id)}
              ondragend={onDragEnd}
            >
              <InlineEdit value={item.name} onSave={(n) => rename(item.id, n)} class="event-name-edit" />
            </div>
          {/each}
          {#if timelineItems.length === 0}
            <span class="pool-empty">No events yet</span>
          {:else if timelineItems.every((item) => eventActs(item.id).length > 0)}
            <span class="pool-empty">All events placed</span>
          {/if}
        </div>
      </div>

      <!-- Characters pool: drag chips onto character row act segments above to assign presence -->
      <div class="tl-events-pool">
        <div class="pool-header">
          <span class="pool-label">Characters</span>
        </div>
        <div class="pool-chips">
          {#each characters as char, ci}
            {@const cc = CHAR_COLORS[ci % CHAR_COLORS.length]}
            {@const links = charActLinks(char.id)}
            <div
              class="pool-chip char-chip"
              role="listitem"
              style="--char-bg:{cc.bg};--char-border:{cc.border};--char-color:{cc.text}"
              draggable="true"
              ondragstart={(e) => onDragStart(e, char.id)}
              ondragend={onDragEnd}
            >
              <span>{char.name}</span>
              {#each links as { rel, act }}
                <span class="char-act-badge">{act.name}
                  <button class="badge-remove" onclick={() => removeFromAct(rel.id)}>×</button>
                </span>
              {/each}
              {#if links.length === 0}<span class="pool-unplaced">unplaced</span>{/if}
            </div>
          {/each}
          {#if characters.length === 0}
            <span class="pool-empty">No characters yet</span>
          {/if}
        </div>
      </div>

    </div>
  {/if}
</div>

<style>
  .timeline-root {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 0;
    color: var(--color-text-muted);
    font-size: 12px;
    text-align: center;
  }

  .action-btn {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 11px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .action-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

  .tl-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .tl-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .add-act-btn {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #778;
    border-radius: 3px;
    padding: 3px 10px;
    font-size: 10px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .add-act-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

  .add-event-btn {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #778;
    border-radius: 3px;
    padding: 3px 10px;
    font-size: 10px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .add-event-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

  .tl-scroll {
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 8px 8px 8px;
  }

  /* Act labels header */
  .tl-header {
    display: flex;
    flex-shrink: 0;
    margin-bottom: 2px;
  }

  .tl-gutter {
    width: 80px;
    flex-shrink: 0;
  }

  .tl-acts-bar {
    flex: 1;
    display: flex;
  }

  .tl-act-label {
    flex: 1;
    min-width: 60px;
    position: relative;
    font-size: 9px;
    color: #556;
    text-align: center;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    padding: 0 10px 4px 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: center;
    box-sizing: border-box;
  }
  .tl-act-label:first-child { border-left: none; }
  .tl-act-label.focused { color: var(--color-accent); }

  .act-delete {
    position: absolute;
    top: 2px;
    right: 8px;
    background: none;
    border: none;
    color: #445;
    font-size: 11px;
    line-height: 1;
    padding: 1px 3px;
    border-radius: 2px;
    cursor: pointer;
  }
  .act-delete:hover { opacity: 1; color: #ef4444; background: rgba(239, 68, 68, 0.12); }

  .col-resize-handle {
    position: absolute;
    right: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 2;
  }
  .col-resize-handle:hover,
  .col-resize-handle:active {
    background: var(--color-accent);
    opacity: 0.4;
  }

  .act-num {
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-accent);
    opacity: 0.7;
  }

  :global(.act-name-edit) {
    font-family: var(--font-display);
    font-size: 11px;
    color: var(--color-text);
    text-align: center;
  }

  /* Track rows */
  .tl-row {
    flex: 1;
    min-height: 32px;
    display: flex;
    align-items: stretch;
    position: relative;
    padding-bottom: 4px;
  }

  .row-resize-handle {
    position: absolute;
    bottom: 0;
    left: 80px;
    right: 0;
    height: 4px;
    cursor: row-resize;
    z-index: 2;
  }
  .row-resize-handle:hover,
  .row-resize-handle:active {
    background: var(--color-accent);
    opacity: 0.3;
  }

  .tl-row-label {
    width: 80px;
    flex-shrink: 0;
    font-size: 10px;
    color: #778;
    font-family: var(--font-ui);
    padding: 5px 8px 0 0;
  }
  .tl-char-label {
    font-size: 9px;
    color: var(--char-color, #778);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tl-row-label.focused { color: var(--color-accent); }

  /* Track line */
  .tl-track-line {
    flex: 1;
    display: flex;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
  }

  /* Act segment within a track line */
  .tl-seg {
    flex: 1;
    min-width: 60px;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    padding: 3px 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }
  .tl-seg:first-child { border-left: none; }
  .tl-seg.focused { background: color-mix(in srgb, var(--color-accent) 4%, transparent); }
  .tl-seg.drop-over { background: rgba(100, 150, 255, 0.1); }

  /* Plot event bar (blue) */
  .tl-event {
    background: rgba(100, 150, 255, 0.25);
    border: 1px solid rgba(100, 150, 255, 0.5);
    border-radius: 2px;
    padding: 2px 22px 2px 6px;
    position: relative;
    display: flex;
    align-items: center;
    min-height: 20px;
    color: #adf;
    cursor: grab;
  }
  .tl-event:active { cursor: grabbing; }
  .tl-event.dragging { opacity: 0.35; }
  .tl-event.highlight {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
  }

  .event-remove {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: inherit;
    font-size: 11px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    opacity: 0.4;
  }
  .event-remove:hover { opacity: 1; }

  /* World event bar (green) */
  .tl-event.ev-world {
    background: rgba(100, 200, 130, 0.2);
    border: 1px solid rgba(100, 200, 130, 0.45);
    color: #afa;
  }

  :global(.event-name-edit) {
    font-family: var(--font-ui);
    font-size: 10px;
    color: inherit;
    flex: 1;
    min-width: 0;
  }

  /* Character presence bar */
  .tl-char-bar {
    background: var(--char-bg, rgba(200, 100, 150, 0.25));
    border: 1px solid var(--char-border, rgba(200, 100, 150, 0.5));
    border-radius: 2px;
    padding: 2px 6px;
    font-size: 9px;
    color: var(--char-color, #faa);
    font-family: var(--font-ui);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    min-height: 20px;
    display: flex;
    align-items: center;
  }
  .tl-char-bar.highlight {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
  }

  /* Events pool */
  .tl-events-pool {
    flex-shrink: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding: 6px 8px 8px;
  }

  .pool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .pool-label {
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #556;
  }

  .pool-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    min-height: 28px;
  }

  .pool-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    background: rgba(100, 150, 255, 0.15);
    border: 1px solid rgba(100, 150, 255, 0.4);
    border-radius: 20px;
    color: #adf;
    cursor: grab;
    user-select: none;
    transition: opacity 0.1s;
  }
  .pool-chip:active { cursor: grabbing; }
  .pool-chip.dragging { opacity: 0.35; }
  .pool-chip.highlight { border-color: var(--color-accent); background: rgba(200, 148, 42, 0.12); color: var(--color-accent); }

  .char-chip {
    background: var(--char-bg);
    border-color: var(--char-border);
    color: var(--char-color);
  }

  .char-act-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    padding: 1px 5px;
    font-size: 8px;
    color: inherit;
  }

  .badge-remove {
    background: none;
    border: none;
    color: inherit;
    font-size: 11px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    opacity: 0.6;
  }
  .badge-remove:hover { opacity: 1; }

  .pool-unplaced {
    font-size: 8px;
    color: #445;
    font-style: italic;
  }

  .pool-empty {
    font-size: 10px;
    color: #445;
  }

  .save-error { color: #ef4444; font-size: 11px; }
</style>
