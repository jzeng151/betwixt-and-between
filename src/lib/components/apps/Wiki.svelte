<script lang="ts">
  import { entities } from '$lib/stores/entities.js';

  interface Props { entityId: string | null; }
  let { entityId }: Props = $props();

  const notes = $derived($entities.filter((e) => e.type === 'Note'));
  // eslint-disable-next-line svelte/no-reactive-reassign
  let selected = $state<string | null>(null);
  $effect(() => { if (selected === null) selected = entityId; });

  const current = $derived($entities.find((e) => e.id === selected));
  let saveError = $state('');
  let editBody = $state('');

  $effect(() => {
    if (current) {
      try {
        editBody = JSON.parse(current.data)?.body ?? '';
      } catch {
        editBody = '';
      }
    }
  });

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
  <div class="sidebar">
    <button class="new-note-btn" onclick={createNote}>+ New Note</button>
    {#if notes.length === 0}
      <p class="empty-sidebar">No notes yet.</p>
    {/if}
    {#each notes as note}
      <button
        class="note-item"
        class:active={note.id === selected}
        onclick={() => (selected = note.id)}
      >
        {note.name}
      </button>
    {/each}
  </div>

  <div class="editor">
    {#if !current}
      <div class="empty-state">
        <p>No notes yet. Create your first note.</p>
        <button class="action-btn" onclick={createNote}>+ New Note</button>
      </div>
    {:else}
      <h2 class="note-title">{current.name}</h2>
      <textarea
        class="note-body"
        bind:value={editBody}
        onblur={save}
        placeholder="Write your note here…"
      ></textarea>
      {#if saveError}
        <p class="save-error">{saveError}</p>
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

  .sidebar {
    width: 140px;
    flex-shrink: 0;
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    overflow-y: auto;
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
  }

  .note-item:hover { background: var(--color-surface-2); color: var(--color-text); }
  .note-item.active { background: var(--color-surface-2); color: var(--color-text); }

  .empty-sidebar {
    font-size: 10px;
    color: var(--color-text-muted);
    padding: 4px 8px;
  }

  .editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    overflow-y: auto;
  }

  .note-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 400;
    color: var(--color-text);
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
    min-height: 200px;
  }

  .note-body:focus {
    outline: none;
  }

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
