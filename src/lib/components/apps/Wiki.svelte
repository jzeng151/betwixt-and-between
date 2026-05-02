<script lang="ts">
  import { marked } from 'marked';
  import { entities } from '$lib/stores/entities.js';
  import InlineEdit from '$lib/components/InlineEdit.svelte';

  interface Props { entityId: string | null; }
  let { entityId }: Props = $props();

  // entity.data is jsonb (object) post-T8a; no parse needed.
  function readBody(data: Record<string, unknown>): string {
    return (data?.body as string) ?? '';
  }

  const notes = $derived(
    $entities
      .filter((e) => e.type === 'Note')
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
  );

  let searchQuery = $state('');
  // Don't seed from `entityId` directly — that captures the initial value
  // and won't track prop updates (Svelte's state_referenced_locally
  // warning). The effect below picks up the initial entityId on mount AND
  // any prop changes thereafter.
  let selectedId = $state<string | null>(null);

  $effect(() => {
    if (entityId) selectedId = entityId;
  });

  const filteredNotes = $derived(
    searchQuery.trim()
      ? notes.filter((n) => n.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : notes
  );

  let addError = $state('');

  async function createNote() {
    addError = '';
    try {
      const created = await entities.createEntity('Note', 'Untitled Note');
      selectedId = created.id;
    } catch {
      addError = "Couldn't create note.";
    }
  }

  const selectedNote = $derived(notes.find((n) => n.id === selectedId));

  let editBody = $state('');
  let previewMode = $state(false);
  let saveError = $state('');

  $effect(() => {
    if (selectedNote) {
      editBody = readBody(selectedNote.data);
      previewMode = false;
    }
  });

  const renderedHtml = $derived.by(() => {
    if (!editBody) return '<p class="preview-empty">Nothing to preview.</p>';
    return marked.parse(editBody, { async: false }) as string;
  });

  async function save() {
    if (!selectedId) return;
    saveError = '';
    try {
      await entities.updateEntity(selectedId, { data: { body: editBody } });
    } catch {
      saveError = "Couldn't save.";
    }
  }

  async function rename(name: string) {
    if (!selectedId) return;
    saveError = '';
    try {
      await entities.updateEntity(selectedId, { name });
    } catch {
      saveError = "Couldn't rename.";
    }
  }
</script>

{#if notes.length === 0}
  <div class="empty-state">
    <p>No notes yet.</p>
    <button class="action-btn" onclick={createNote}>+ New Note</button>
    {#if addError}<p class="err">{addError}</p>{/if}
  </div>
{:else}
  <div class="wiki-layout">

    <div class="wiki-sidebar">
      <div class="sidebar-toolbar">
        <input
          class="search-input"
          type="search"
          placeholder="Search notes…"
          aria-label="Search notes"
          bind:value={searchQuery}
        />
        <button class="new-note-btn" onclick={createNote} title="New note">+</button>
      </div>

      {#if filteredNotes.length === 0}
        <p class="empty-sidebar">No results.</p>
      {:else}
        {#each filteredNotes as note}
          <button
            class="note-item"
            class:active={note.id === selectedId}
            onclick={() => (selectedId = note.id)}
          >{note.name}</button>
        {/each}
      {/if}
    </div>

    <div class="wiki-editor">
      {#if selectedNote}
        <div class="editor-header">
          <h2 class="note-title">
            <InlineEdit value={selectedNote.name} onSave={rename} />
          </h2>
          <div class="mode-toggle">
            <button class="toggle-btn" class:active={!previewMode} onclick={() => (previewMode = false)}>Edit</button>
            <button class="toggle-btn" class:active={previewMode} onclick={() => (previewMode = true)}>Preview</button>
          </div>
        </div>

        {#if previewMode}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="markdown-preview"
            role="region"
            aria-label="Preview"
            ondblclick={() => (previewMode = false)}
            onkeydown={(e) => { if (e.key === 'Escape') previewMode = false; }}
          >
            {@html renderedHtml}
          </div>
        {:else}
          <textarea
            class="note-body"
            bind:value={editBody}
            onblur={save}
            placeholder="Write in Markdown…"
          ></textarea>
        {/if}

        {#if saveError}<p class="err">{saveError}</p>{/if}
      {:else}
        <p class="no-selection">Select a note to edit.</p>
      {/if}
    </div>

  </div>
{/if}

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 0;
    color: var(--color-text-muted);
    font-size: 13px;
    text-align: center;
  }

  .action-btn {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .action-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

  .wiki-layout {
    display: flex;
    height: 100%;
    gap: 12px;
    overflow: hidden;
  }

  .wiki-sidebar {
    width: 130px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    border-right: 1px solid var(--color-border);
    padding-right: 10px;
  }

  .sidebar-toolbar {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
    margin-bottom: 2px;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 5px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 4px 6px;
    outline: none;
  }
  .search-input:focus { border-color: var(--color-accent); }

  .new-note-btn {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: var(--color-accent);
    border-radius: 5px;
    padding: 3px 7px;
    font-size: 15px;
    font-family: var(--font-ui);
    cursor: pointer;
    flex-shrink: 0;
    line-height: 1;
  }
  .new-note-btn:hover { background: color-mix(in srgb, var(--color-accent) 20%, transparent); }

  .note-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 5px 8px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--color-text-muted);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background 0.1s, color 0.1s;
  }
  .note-item:hover {
    background: var(--color-surface-2);
    color: var(--color-text);
  }
  .note-item.active {
    background: var(--color-surface-2);
    border-color: var(--color-accent);
    color: var(--color-text);
  }

  .empty-sidebar {
    font-size: 12px;
    color: var(--color-text-muted);
    padding: 8px 0;
    text-align: center;
  }

  .wiki-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
  }

  .editor-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    flex-shrink: 0;
  }

  .note-title {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 400;
    color: var(--color-text);
    flex: 1;
    min-width: 0;
  }

  .mode-toggle {
    display: flex;
    flex-shrink: 0;
  }

  .toggle-btn {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .toggle-btn:first-child { border-radius: 4px 0 0 4px; }
  .toggle-btn:last-child  { border-radius: 0 4px 4px 0; border-left: none; }
  .toggle-btn.active {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-surface);
    font-weight: 600;
  }

  .note-body {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.6;
    resize: none;
    min-height: 160px;
    outline: none;
  }

  .markdown-preview {
    flex: 1;
    min-height: 160px;
    font-family: var(--font-ui);
    font-size: 14px;
    line-height: 1.7;
    color: var(--color-text);
    overflow-y: auto;
    cursor: text;
  }

  :global(.markdown-preview h1),
  :global(.markdown-preview h2),
  :global(.markdown-preview h3) {
    font-family: var(--font-display);
    font-weight: 400;
    color: var(--color-text);
    margin: 0.8em 0 0.3em;
  }
  :global(.markdown-preview p) { margin: 0 0 0.6em; }
  :global(.markdown-preview p.preview-empty) { color: var(--color-text-muted); font-size: 13px; }
  :global(.markdown-preview code) {
    background: var(--color-surface-2);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 12px;
  }
  :global(.markdown-preview pre) {
    background: var(--color-surface-2);
    border-radius: 6px;
    padding: 10px 12px;
    overflow: auto;
  }
  :global(.markdown-preview blockquote) {
    border-left: 2px solid var(--color-accent);
    margin: 0;
    padding-left: 12px;
    color: var(--color-text-muted);
  }
  :global(.markdown-preview ul), :global(.markdown-preview ol) {
    padding-left: 18px;
    margin: 0 0 0.6em;
  }

  .no-selection {
    color: var(--color-text-muted);
    font-size: 13px;
    padding: 40px 0;
    text-align: center;
  }

  .err { color: var(--color-rel-rival); font-size: 12px; }
</style>
