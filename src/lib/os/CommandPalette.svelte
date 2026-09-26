<script lang="ts">
  import { tick } from 'svelte';
  import { Search, X } from 'lucide-svelte';
  import { entities, entityLoadStatus, entitySnapshotReady } from '$lib/stores/entities.js';
  import { notesStore, noteEntries } from '$lib/stores/notes.js';
  import { focusTrap, isActiveFocusTrapTarget } from '$lib/actions/focus-trap.js';
  import { windowStore } from './windows-store.js';
  import { findCommands, type CommandResult } from './command-search.js';

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let trigger: HTMLButtonElement;
  let open = $state(false);
  let query = $state('');
  let selectedId = $state<string | null>(null);
  let notesLoading = $state(false);
  let notesError = $state(false);
  const matches = $derived(open ? findCommands($entitySnapshotReady ? $entities : [], query,
    $noteEntries.map((note) => ({ ...note, name: notesStore.drafts.get(note.id)?.name ?? note.name }))) : []);
  const results = $derived(matches.slice(0, 50));
  const active = $derived(results.length ? Math.max(0, results.findIndex((result) => result.id === selectedId)) : -1);

  $effect(() => {
    if (!open) return;
    return focusTrap(dialog, { onEscape: () => dialog.close() }).destroy;
  });

  function shortcut(event: KeyboardEvent) {
    return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k';
  }

  function show() {
    if (dialog.open || document.querySelector('dialog[open]') || isActiveFocusTrapTarget(document.activeElement)) return;
    query = '';
    selectedId = null;
    open = true;
    dialog.showModal();
    input.focus();
    void loadNotes();
  }

  async function loadNotes() {
    if (notesLoading) return;
    notesError = false;
    if (notesStore.entriesLoaded) return;
    notesLoading = true;
    try { await notesStore.loadEntries(); }
    catch { notesError = true; }
    finally { notesLoading = false; }
  }

  function globalKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || !shortcut(event) || !trigger?.getClientRects().length) return;
    if (document.querySelector('dialog[open]') || isActiveFocusTrapTarget(document.activeElement)) return;
    event.preventDefault();
    show();
  }

  async function choose(result: CommandResult) {
    dialog.close();
    // Let native dialog focus restoration finish before focusing the destination.
    await tick();
    if (result.note) {
      windowStore.open('notes');
      windowStore.setEntityId('notes', result.note.id);
    } else if (result.entity) windowStore.openForEntity(result.entity.id, result.entity.type);
    else windowStore.open(result.appId);
  }

  async function keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.ctrlKey && (event.key === 'w' || event.key === 'Tab')) event.preventDefault();
    if (shortcut(event)) { event.preventDefault(); dialog.close(); return; }
    if (event.target !== input) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      const selected = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      selectedId = results[selected].id;
      await tick();
      document.getElementById(`command-result-${selected}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (results[active]) void choose(results[active]);
    }
  }

  function backdrop(event: MouseEvent) {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
</script>

<svelte:window onkeydown={globalKeydown} />

<button bind:this={trigger} class="launcher" title="Command palette (Ctrl/Cmd+K)" aria-label="Command palette" aria-keyshortcuts="Control+k Meta+k" onclick={show}>
  <Search size={16} aria-hidden="true" /><span>Search</span>
</button>

<dialog bind:this={dialog} aria-label="Command palette" onclose={() => { open = false; }} onkeydown={keydown} onclick={backdrop}>
  <header><h2>Command palette</h2></header>
  <div class="search-field">
    <Search size={18} aria-hidden="true" />
    <input bind:this={input} bind:value={query} oninput={() => { selectedId = null; }} placeholder="Find an entity or app…" aria-label="Search this story and apps" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="command-results" aria-activedescendant={active >= 0 ? `command-result-${active}` : undefined} autocomplete="off" />
    <button class="close" aria-label="Close command palette" onclick={() => dialog.close()}><X size={18} aria-hidden="true" /></button>
  </div>
  {#if $entityLoadStatus === 'error'}
    <div class="load-message" role="alert"><span>{$entitySnapshotReady ? "Couldn't refresh your story. Showing saved entries." : "Couldn't load your story."}</span><button onclick={() => { void entities.load().catch(() => {}); }}>Retry</button></div>
  {:else if !$entitySnapshotReady}
    <p class="load-message" role="status">Loading story entries… Apps are available below.</p>
  {/if}
  {#if notesError}<div class="load-message" role="alert"><span>Couldn't refresh notebook notes.</span><button onclick={loadNotes}>Retry notes</button></div>
  {:else if notesLoading}<p class="load-message" role="status">Loading notebook notes…</p>{/if}
  <div id="command-results" role="listbox" aria-label="Search results">
    {#each results as result, index (result.id)}
      <button id={`command-result-${index}`} role="option" aria-selected={active === index} tabindex="-1" onmousedown={(event) => event.preventDefault()} onmouseenter={() => { selectedId = result.id; }} onclick={() => choose(result)}>
        <span class="result-name">{result.name}</span><span class="result-type">{result.type}</span>
      </button>
    {/each}
  </div>
  {#if results.length === 0}<p class="empty" role="status">No matches. Try a name or entity type.</p>{/if}
  <footer><span>{matches.length > 50 ? `Showing 50 of ${matches.length}. Refine your search.` : `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`}</span><span>Arrow keys to choose · Enter to open</span></footer>
</dialog>

<style>
  .launcher { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: 4px; background: transparent; color: var(--color-text-muted); font: inherit; font-size: 12px; cursor: pointer; }
  .launcher:hover { background: var(--color-surface); color: var(--color-text); }
  dialog { position: fixed; inset: 12vh 0 auto; margin: 0 auto; width: min(580px, calc(100vw - 32px)); max-height: 76dvh; padding: 0; border: 1px solid var(--color-border); border-radius: var(--window-radius); background: var(--color-surface); color: var(--color-text); overflow: auto; }
  dialog::backdrop { background: rgb(0 0 0 / 45%); }
  header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 4px; }
  h2 { margin: 0; font-size: 13px; font-weight: 600; }
  .close { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; color: var(--color-text-muted); cursor: pointer; }
  .close:hover { color: var(--color-text); background: var(--color-surface-2); }
  .search-field { display: flex; align-items: center; gap: 10px; margin: 8px 16px 12px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text-muted); }
  .search-field:focus-within { outline: 2px solid var(--color-focus); outline-offset: 1px; }
  input { min-width: 0; width: 100%; height: 44px; padding: 0; border: 0; background: transparent; color: var(--color-text); font: inherit; font-size: 15px; }
  input:focus-visible { outline: none !important; }
  input::placeholder { color: var(--color-text-muted); }
  [role='listbox'] { max-height: 42dvh; overflow-y: auto; padding: 4px 8px; }
  [role='option'] { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; width: 100%; min-height: 40px; padding: 10px 12px; border: 0; border-radius: 4px; background: transparent; color: var(--color-text); text-align: left; cursor: pointer; }
  [aria-selected='true'] { background: var(--color-surface-2); outline: 1px solid var(--color-focus); outline-offset: -1px; }
  .result-name { overflow-wrap: anywhere; font-size: 14px; }
  .result-type { flex-shrink: 0; color: var(--color-text-muted); font-size: 12px; }
  .load-message { display: flex; align-items: center; gap: 12px; margin: 0; padding: 8px 16px; font-size: 12px; }
  .load-message button { padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); background: var(--color-surface-2); }
  .empty { margin: 0; padding: 24px 16px; color: var(--color-text-muted); font-size: 14px; }
  footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--color-border); color: var(--color-text-muted); font-size: 11px; }
</style>
