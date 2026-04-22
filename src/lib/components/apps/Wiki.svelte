<script lang="ts">
  import { marked } from 'marked';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import EntityLink from '$lib/components/EntityLink.svelte';

  interface Props { entityId: string | null; }
  let { entityId }: Props = $props();

  const notes = $derived($entities.filter((e) => e.type === 'Note'));
  let selected = $state<string | null>(null);
  $effect(() => { if (selected === null && entityId) selected = entityId; });
  $effect(() => { if (selected === null && notes.length > 0) selected = notes[0].id; });

  const current = $derived($entities.find((e) => e.id === selected));
  let saveError = $state('');
  let editBody = $state('');
  let previewMode = $state(false);
  let searchQuery = $state('');

  $effect(() => {
    if (current) {
      try {
        editBody = JSON.parse(current.data)?.body ?? '';
      } catch {
        editBody = '';
      }
    }
    previewMode = false;
  });

  const renderedHtml = $derived(
    editBody
      ? (marked.parse(editBody, { async: false }) as string)
      : '<p style="color: var(--color-text-muted); font-size: 12px;">Nothing to preview.</p>'
  );

  // Entities linked to this note via relationships
  const linkedEntities = $derived(() => {
    if (!selected) return [];
    const rels = $relationships.filter((r) => r.fromId === selected || r.toId === selected);
    const linked = rels.map((r) => {
      const otherId = r.fromId === selected ? r.toId : r.fromId;
      const entity = $entities.find((e) => e.id === otherId);
      return entity ? { entity, rel: r } : null;
    });
    return linked.filter(Boolean) as { entity: typeof $entities[0]; rel: typeof $relationships[0] }[];
  });

  // Filtered notes list
  const filteredNotes = $derived(
    searchQuery.trim()
      ? notes.filter((n) => {
          const q = searchQuery.toLowerCase();
          if (n.name.toLowerCase().includes(q)) return true;
          try { return (JSON.parse(n.data)?.body ?? '').toLowerCase().includes(q); } catch { return false; }
        })
      : notes
  );

  async function save() {
    if (!selected) return;
    saveError = '';
    try {
      await entities.updateEntity(selected, { data: { body: editBody } });
    } catch {
      saveError = "Couldn't save note.";
    }
  }

  async function createNote() {
    saveError = '';
    try {
      const created = await entities.createEntity('Note', 'Untitled Note');
      selected = created.id;
    } catch {
      saveError = "Couldn't create note.";
    }
  }
</script>

<div class="wiki">
  <!-- Sidebar -->
  <div class="sidebar">
    <input
      class="search-bar"
      type="search"
      placeholder="Search notes…"
      bind:value={searchQuery}
      aria-label="Search notes"
    />
    <button class="new-note-btn" onclick={createNote}>+ New Note</button>
    {#if filteredNotes.length === 0}
      <p class="empty-sidebar">{searchQuery ? 'No results.' : 'No notes yet.'}</p>
    {/if}
    {#each filteredNotes as note}
      <button
        class="note-item"
        class:active={note.id === selected}
        onclick={() => (selected = note.id)}
      >
        {note.name}
      </button>
    {/each}
  </div>

  <!-- Editor -->
  <div class="editor">
    {#if !current}
      <div class="empty-state">
        <p>No notes yet. Create your first note.</p>
        <button class="action-btn" onclick={createNote}>+ New Note</button>
      </div>
    {:else}
      <div class="editor-header">
        <h2 class="note-title">{current.name}</h2>
        <div class="mode-toggle">
          <button
            class="toggle-btn"
            class:active={!previewMode}
            onclick={() => (previewMode = false)}
          >Edit</button>
          <button
            class="toggle-btn"
            class:active={previewMode}
            onclick={() => (previewMode = true)}
          >Preview</button>
        </div>
      </div>

      {#if previewMode}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="markdown-preview" ondblclick={() => (previewMode = false)}>
          {@html renderedHtml}
        </div>
      {:else}
        <textarea
          class="note-body"
          bind:value={editBody}
          onblur={save}
          placeholder="Write your note in Markdown…"
        ></textarea>
      {/if}

      {#if saveError}
        <p class="save-error">{saveError}</p>
      {/if}

      <!-- Linked entities panel -->
      {#if linkedEntities().length > 0}
        <div class="linked-panel">
          <p class="linked-heading">Linked Entities</p>
          <div class="linked-chips">
            {#each linkedEntities() as { entity, rel }}
              <EntityLink id={entity.id} name={entity.name} relationshipType={rel.type} />
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .wiki {
    display: flex;
    height: 100%;
    gap: 0;
    margin: -16px;
  }

  /* Sidebar */
  .sidebar {
    width: 150px;
    flex-shrink: 0;
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    overflow-y: auto;
  }

  .search-bar {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 5px 8px;
    width: 100%;
    outline: none;
    margin-bottom: 4px;
  }

  .search-bar:focus {
    border-color: var(--color-accent);
    outline: 2px solid var(--color-accent);
    outline-offset: -1px;
  }

  .new-note-btn {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: var(--color-accent);
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 10px;
    font-family: var(--font-ui);
    cursor: pointer;
    margin-bottom: 4px;
  }

  .note-item {
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    font-size: 11px;
    font-family: var(--font-ui);
    padding: 5px 8px;
    border-radius: 5px;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .note-item:hover { background: var(--color-surface-2); color: var(--color-text); }
  .note-item.active { background: var(--color-surface-2); color: var(--color-text); }

  .empty-sidebar {
    font-size: 10px;
    color: var(--color-text-muted);
    padding: 4px 8px;
  }

  /* Editor */
  .editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    overflow-y: auto;
    min-width: 0;
  }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .note-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 400;
    color: var(--color-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mode-toggle {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .toggle-btn {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 10px;
    padding: 3px 8px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
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
    font-size: 12px;
    line-height: 1.6;
    resize: none;
    min-height: 180px;
  }

  .note-body:focus { outline: none; }

  .markdown-preview {
    flex: 1;
    min-height: 180px;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.7;
    color: var(--color-text);
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
  :global(.markdown-preview code) {
    background: var(--color-surface-2);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
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
  :global(.markdown-preview a) { color: var(--color-accent); }
  :global(.markdown-preview ul), :global(.markdown-preview ol) {
    padding-left: 18px;
    margin: 0 0 0.6em;
  }

  /* Linked entities panel */
  .linked-panel {
    border-top: 1px solid var(--color-border);
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .linked-heading {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .linked-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Misc */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--color-text-muted);
    font-size: 12px;
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

  .action-btn:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .save-error {
    color: var(--color-rel-rival);
    font-size: 11px;
  }
</style>
