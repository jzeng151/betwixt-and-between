<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { focusTrap } from '$lib/actions/focus-trap.js';
  import { windowStore } from '$lib/os/windows-store.js';
  import { failedWrites, writeRetryKey } from '$lib/stores/pending-writes.js';
  import { entities } from '$lib/stores/entities.js';
  import { boardImport, type BoardImport } from './send-to-board.js';
  import { graphDiagram, graphSnapshot } from './graph-import.js';
  import { activeBoardId, boardList, boardDrafts, loadBoards, loadBoard, createBoard, editBoard, uploadBoardImage, boardImageRetryKey } from './store.js';
  import type { BoardElement } from './model.js';

  let dialog: HTMLDialogElement;
  let destinationSelect = $state<HTMLSelectElement>();
  let request = $state<BoardImport | null>(null);
  let destination = $state('');
  let newName = $state('');
  let loading = $state(false);
  let adding = $state(false);
  let error = $state('');
  let createdId = $state<string | null>(null);
  let snapshotFile: File | undefined;
  const attemptedWrites = new Set<string>();
  const titleId = $props.id();

  $effect(() => {
    if (!$boardImport) return;
    request = $boardImport;
    untrack(() => {
      createdId = null; snapshotFile = undefined; attemptedWrites.clear(); newName = ''; error = ''; destination = '';
      dialog.showModal(); void refresh();
    });
  });
  $effect(() => {
    if (!request) return;
    return focusTrap(dialog, { onEscape: close }).destroy;
  });

  async function refresh() {
    loading = true; error = '';
    try { await loadBoards(); destination = get(activeBoardId) ?? 'new'; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load boards. Try again.'; }
    finally { loading = false; await tick(); if (dialog.open) destinationSelect?.focus(); }
  }
  function close() {
    if (adding) return;
    // Cancel abandons only this import's failed attempts. Successful writes already clear their key.
    failedWrites.update(failures => failures.filter(f => typeof f.retryKey !== 'string' || !attemptedWrites.has(f.retryKey)));
    request = null; boardImport.set(null); dialog.close();
  }
  async function add() {
    if (!request || adding || loading || !destination) return;
    adding = true; error = '';
    try {
      let id = destination;
      if (id === 'new') {
        if (!createdId) {
          attemptedWrites.add(writeRetryKey('whiteboard:create', { name: newName.trim() }));
          createdId = await createBoard(newName.trim());
        }
        id = createdId!;
      }
      await loadBoard(id);
      const current = get(boardDrafts)[id];
      const x = current.document.elements.length ? Math.max(...current.document.elements.map(e => e.x + e.width)) + 64 : 0;
      if (request.kind === 'snapshot') {
        snapshotFile ??= await graphSnapshot(request.graph, request.name);
        attemptedWrites.add(boardImageRetryKey(id, snapshotFile));
        await uploadBoardImage(id, snapshotFile, { x, y: 0 }, request.caption);
      } else {
        const added: BoardElement[] = request.kind === 'reference'
          ? [{ id: crypto.randomUUID(), type: 'reference', target: request.target, x: 0, y: 0, width: 200, height: 90, color: '#c8942a' }]
          : graphDiagram(request.graph, request.name, request.caption);
        const width = Math.max(...added.map(e => e.x + e.width)), height = Math.max(...added.map(e => e.y + e.height));
        editBoard(id, { ...current.document, elements: [...current.document.elements, ...added.map(e => ({ ...e, x: e.x + x }))],
          viewport: { x: x - 24, y: -24, zoom: Math.max(0.1, Math.min(1, 850 / (width + 48), 480 / (height + 48))) } });
      }
      activeBoardId.set(id);
      adding = false; close(); await tick(); windowStore.open('whiteboard');
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not add to the board. Try again.'; }
    finally { adding = false; }
  }
</script>

<dialog bind:this={dialog} aria-labelledby={titleId} oncancel={event => { event.preventDefault(); close(); }} onclose={() => { request = null; boardImport.set(null); }}>
  <form onsubmit={event => { event.preventDefault(); void add(); }}>
    <h2 id={titleId}>Send to whiteboard</h2>
    {#if request}
      <p class="summary">{request.name}</p>
      {#if request.kind === 'reference'}{@const target = request.target}<p class="description">{target.kind === 'map' ? 'Map' : target.kind === 'graph' ? 'Focused graph' : $entities.find(entity => entity.id === target.id)?.type ?? 'Entity'}. Adds a live reference that opens its editor.</p>
      {:else}<p class="description">{request.kind === 'snapshot' ? 'A frozen image of the complete filtered graph.' : 'Editable cards and connectors. Entity names stay live; the layout and relationships are copied.'}</p>{/if}
    {/if}
    {#if loading}<p role="status">Loading boards…</p>
    {:else}
      <label>Destination board<select bind:this={destinationSelect} bind:value={destination} disabled={adding || !destination}><option value="new">New board…</option>{#each $boardList as board}<option value={board.id}>{board.name}</option>{/each}</select></label>
      {#if destination === 'new'}<label>New board name<input bind:value={newName} maxlength="100" required disabled={adding || !!createdId} /></label>{/if}
    {/if}
    {#if error}<p role="alert">{error}{#if !destination}<button type="button" onclick={refresh}>Retry loading</button>{/if}</p>{/if}
    <footer><button type="button" onclick={close} disabled={adding}>Cancel</button><button class="primary" disabled={loading || adding || !destination || destination === 'new' && !newName.trim()}>{adding ? 'Adding…' : 'Add to board'}</button></footer>
  </form>
</dialog>

<style>
  dialog { margin: auto; width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow: auto; padding: 20px; border: 1px solid var(--color-border); border-radius: var(--window-radius); background: var(--color-surface); color: var(--color-text); font: 13px var(--font-ui); }
  dialog::backdrop { background: rgb(0 0 0 / 45%); }
  h2 { margin: 0 0 12px; font-size: 17px; font-weight: 600; }
  p { line-height: 1.5; overflow-wrap: anywhere; }
  .summary { font-weight: 600; }
  .description { color: var(--color-text-muted); }
  label { display: grid; gap: 6px; margin: 16px 0; }
  input, select, button { font: inherit; color: var(--color-text); background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 4px; padding: 8px 10px; min-width: 0; }
  button { cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--color-text-muted); }
  button:disabled { opacity: 0.45; cursor: default; }
  .primary { background: var(--color-accent); color: var(--color-on-accent); border-color: var(--color-accent); }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
  [role='alert'] { color: var(--color-danger); }
</style>
