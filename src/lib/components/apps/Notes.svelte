<script lang="ts">
  import { notes } from '$lib/stores/notes.js';
  import { onMount } from 'svelte';

  let selectedFolderId = $state<string | null>(null);
  let selectedEntryId = $state<string | null>(null);
  let editName = $state('');
  let editBody = $state('');
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const folderEntries = $derived(
    selectedFolderId
      ? $notes.entries.filter((e) => e.folderId === selectedFolderId)
      : []
  );

  const selectedEntry = $derived(
    selectedEntryId ? $notes.entries.find((e) => e.id === selectedEntryId) ?? null : null
  );

  function debouncedSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (selectedEntryId && (editName || editBody)) {
        notes.updateEntry(selectedEntryId, { name: editName, body: editBody });
      }
    }, 300);
  }

  function selectFolder(id: string) {
    selectedFolderId = id;
    selectedEntryId = null;
    editName = '';
    editBody = '';
    notes.loadEntries(id);
  }

  function selectEntry(id: string) {
    selectedEntryId = id;
    const entry = $notes.entries.find((e) => e.id === id);
    editName = entry?.name ?? '';
    editBody = entry?.body ?? '';
  }

  async function addFolder() {
    const folder = await notes.createFolder('New Folder');
    selectedFolderId = folder.id;
    notes.loadEntries(folder.id);
  }

  async function addEntry() {
    if (!selectedFolderId) return;
    const entry = await notes.createEntry('Untitled', selectedFolderId);
    selectedEntryId = entry.id;
  }

  async function removeEntry(id: string) {
    await notes.deleteEntry(id);
    if (selectedEntryId === id) selectedEntryId = null;
  }

  async function removeFolder(id: string) {
    await notes.deleteFolder(id);
    if (selectedFolderId === id) {
      selectedFolderId = null;
      selectedEntryId = null;
    }
  }

  onMount(() => {
    notes.loadFolders().catch(() => {});
    notes.loadEntries().catch(() => {});
  });
</script>

<div class="notes-app">
  <div class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Folders</span>
      <button class="icon-btn" onclick={addFolder} title="New folder">+</button>
    </div>
    <ul class="folder-list">
      {#each $notes.folders as folder (folder.id)}
        <li
          class="folder-item"
          class:selected={selectedFolderId === folder.id}
          onclick={() => selectFolder(folder.id)}
        >
          <span class="folder-name">{folder.name}</span>
          <button class="icon-btn small" onclick={(e) => { e.stopPropagation(); removeFolder(folder.id); }} title="Delete folder">&times;</button>
        </li>
      {/each}
    </ul>

    {#if selectedFolderId}
      <div class="sidebar-header entries-header">
        <span class="sidebar-title">Entries</span>
        <button class="icon-btn" onclick={addEntry} title="New entry">+</button>
      </div>
      <ul class="entry-list">
        {#each folderEntries as entry (entry.id)}
          <li
            class="entry-item"
            class:selected={selectedEntryId === entry.id}
            onclick={() => selectEntry(entry.id)}
          >
            <span class="entry-name">{entry.name}</span>
            <button class="icon-btn small" onclick={(e) => { e.stopPropagation(); removeEntry(entry.id); }} title="Delete entry">&times;</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="editor">
    {#if selectedEntry}
      <input
        class="entry-title"
        type="text"
        bind:value={editName}
        oninput={debouncedSave}
        placeholder="Entry title"
      />
      <textarea
        class="entry-body"
        bind:value={editBody}
        oninput={debouncedSave}
        placeholder="Start writing..."
      ></textarea>
    {:else}
      <div class="editor-empty">
        <p>Select an entry to edit</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .notes-app {
    display: flex;
    height: 100%;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 13px;
  }

  .sidebar {
    width: 200px;
    min-width: 200px;
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--color-surface-2);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
  }

  .entries-header {
    margin-top: auto;
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
  }

  .sidebar-title {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-muted);
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }

  .icon-btn:hover {
    background: var(--color-border);
    color: var(--color-text);
  }

  .icon-btn.small {
    font-size: 12px;
    padding: 1px 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .folder-item:hover .icon-btn.small,
  .entry-item:hover .icon-btn.small {
    opacity: 1;
  }

  .folder-list, .entry-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .folder-item, .entry-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 4px;
    margin: 0 4px;
  }

  .folder-item:hover, .entry-item:hover {
    background: var(--color-border);
  }

  .folder-item.selected, .entry-item.selected {
    background: var(--color-accent);
    color: #000;
  }

  .folder-name, .entry-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .entry-title {
    border: none;
    border-bottom: 1px solid var(--color-border);
    padding: 10px 14px;
    font-size: 16px;
    font-weight: 600;
    background: transparent;
    color: var(--color-text);
    outline: none;
  }

  .entry-body {
    flex: 1;
    border: none;
    padding: 14px;
    font-size: 13px;
    font-family: inherit;
    background: transparent;
    color: var(--color-text);
    resize: none;
    outline: none;
    line-height: 1.6;
  }

  .editor-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
  }
</style>
