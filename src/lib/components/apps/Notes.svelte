<script lang="ts">
  import { notesStore, noteFolders, noteEntries, type NoteEntry } from '$lib/stores/notes.js';
  import { onMount, onDestroy } from 'svelte';
  import ContextMenu from '$lib/os/ContextMenu.svelte';

  let selectedFolderId = $state<string | null>(null);
  let selectedEntryId = $state<string | null>(null);
  let editName = $state('');
  let editBody = $state('');
  const saveState = notesStore.saveState;
  let loadError = $state(false);
  let loadRequest = 0;

  // Tweak 1: New folder dialog
  let showNewFolderDialog = $state(false);
  let newFolderName = $state('');

  // Tweak 2: Context menu
  let contextMenu = $state<{ folderId: string; x: number; y: number } | null>(null);
  let confirmDeleteFolderId = $state<string | null>(null);

  // Tweak 4: Inline rename
  let renamingFolderId = $state<string | null>(null);
  let renameDraft = $state('');

  const folderEntries = $derived(
    selectedFolderId
      ? $noteEntries.filter((e: NoteEntry) => e.folderId === selectedFolderId)
      : []
  );

  const selectedEntry = $derived(
    selectedEntryId ? $noteEntries.find((e: NoteEntry) => e.id === selectedEntryId) ?? null : null
  );

  const selectedFolderName = $derived(
    selectedFolderId ? $noteFolders.find((f) => f.id === selectedFolderId)?.name ?? '' : ''
  );

  const viewMode = $derived<'empty' | 'entries-list' | 'editor'>(
    selectedEntryId ? 'editor' : selectedFolderId ? 'entries-list' : 'empty'
  );

  // ── Context menu items ──────────────────────────────────────────────────
  const contextMenuItems = $derived.by(() => {
    if (!contextMenu) return [];
    const id = contextMenu.folderId;
    return [
      { label: 'Open', onSelect: () => selectFolder(id) },
      {
        label: 'New Note...',
        onSelect: async () => {
          if (selectedEntryId && !await notesStore.flushDrafts(selectedEntryId)) return;
          await selectFolder(id);
          await addEntryInFolder(id);
        }
      },
      {
        label: 'Rename',
        onSelect: () => {
          const folder = $noteFolders.find((f) => f.id === id);
          if (folder) {
            renameDraft = folder.name;
            renamingFolderId = id;
          }
        }
      },
      { label: 'Delete', onSelect: () => { confirmDeleteFolderId = id; } }
    ];
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  function editField(field: 'name' | 'body', value: string) {
    if (field === 'name') editName = value;
    else editBody = value;
    if (selectedEntryId) notesStore.editDraft(selectedEntryId, { name: editName, body: editBody });
  }

  async function selectFolder(id: string) {
    const request = ++loadRequest;
    if (selectedEntryId && !await notesStore.flushDrafts(selectedEntryId)) return;
    if (request !== loadRequest) return;
    selectedFolderId = id;
    selectedEntryId = null;
    editName = '';
    editBody = '';
    renamingFolderId = null;
    try {
      await notesStore.loadEntries(id);
      if (request === loadRequest) loadError = false;
    } catch {
      if (request === loadRequest) loadError = true;
    }
  }

  function selectEntry(id: string) {
    selectedEntryId = id;
    const entry = notesStore.drafts.get(id) ?? $noteEntries.find((e) => e.id === id);
    editName = entry?.name ?? '';
    editBody = entry?.body ?? '';
  }

  // Tweak 1: New folder dialog
  function openNewFolderDialog() {
    newFolderName = '';
    showNewFolderDialog = true;
  }

  async function confirmNewFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    if (selectedEntryId && !await notesStore.flushDrafts(selectedEntryId)) return;
    const folder = await notesStore.createFolder(name);
    showNewFolderDialog = false;
    newFolderName = '';
    selectFolder(folder.id);
  }

  function cancelNewFolder() {
    showNewFolderDialog = false;
    newFolderName = '';
  }

  function handleNewFolderKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') confirmNewFolder();
    if (e.key === 'Escape') cancelNewFolder();
  }

  // Entries
  async function addEntry() {
    if (!selectedFolderId) return;
    const entry = await notesStore.createEntry('Untitled', selectedFolderId);
    selectedEntryId = entry.id;
    editName = entry.name;
    editBody = '';
  }

  async function addEntryInFolder(folderId: string) {
    const entry = await notesStore.createEntry('Untitled', folderId);
    if (folderId === selectedFolderId) {
      selectedEntryId = entry.id;
      editName = entry.name;
      editBody = '';
    }
  }

  async function removeEntry(id: string) {
    await notesStore.deleteEntry(id);
    if (selectedEntryId === id) selectedEntryId = null;
  }

  async function removeFolder(id: string) {
    await notesStore.deleteFolder(id);
    confirmDeleteFolderId = null;
    if (selectedFolderId === id) {
      selectedFolderId = null;
      selectedEntryId = null;
    }
  }

  // Tweak 2: Context menu
  function onFolderContextMenu(e: MouseEvent, folderId: string) {
    e.preventDefault();
    contextMenu = { folderId, x: e.clientX, y: e.clientY };
  }

  function handleRenameKeydown(e: KeyboardEvent, folderId: string) {
    if (e.key === 'Enter') {
      commitRename(folderId);
    } else if (e.key === 'Escape') {
      renamingFolderId = null;
    }
  }

  function commitRename(folderId: string) {
    const name = renameDraft.trim();
    if (name) {
      notesStore.renameFolder(folderId, name);
    }
    renamingFolderId = null;
  }

  async function loadNotes() {
    const request = ++loadRequest;
    try {
      await Promise.all([notesStore.loadFolders(), notesStore.loadEntries()]);
      if (request === loadRequest) loadError = false;
    } catch {
      if (request === loadRequest) loadError = true;
    }
  }

  onMount(() => { void loadNotes(); });
  onDestroy(() => { void notesStore.flushDrafts(); });
</script>

<div class="notes-app">
  <!-- Sidebar: folders only -->
  <div class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Folders</span>
      <button class="icon-btn" onclick={openNewFolderDialog} title="New folder">+</button>
    </div>
    <div class="folder-list">
      {#each $noteFolders as folder (folder.id)}
        <div
          class="folder-item"
          class:selected={selectedFolderId === folder.id}
          role="button"
          tabindex="0"
          onclick={() => { if (renamingFolderId !== folder.id) void selectFolder(folder.id); }}
          onkeydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void selectFolder(folder.id); } }}
          oncontextmenu={(e) => onFolderContextMenu(e, folder.id)}
        >
          {#if renamingFolderId === folder.id}
            <input
              class="rename-input"
              type="text"
              bind:value={renameDraft}
              onkeydown={(e) => handleRenameKeydown(e, folder.id)}
              onblur={() => commitRename(folder.id)}
            />
          {:else}
            <span class="folder-name">{folder.name}</span>
          {/if}
        </div>
        {#if confirmDeleteFolderId === folder.id}
          <div class="confirm-delete-bar">
            <span>Delete "{folder.name}"?</span>
            <div class="confirm-delete-actions">
              <button class="confirm-btn cancel" onclick={() => (confirmDeleteFolderId = null)}>Cancel</button>
              <button class="confirm-btn delete" onclick={() => removeFolder(folder.id)}>Delete</button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  </div>

  <!-- Content area: entries list or editor -->
  <div class="content">
    {#if loadError}
      <div role="alert">Couldn't load notes. <button onclick={loadNotes}>Retry loading</button></div>
    {/if}
    <div class="save-status" role="status">
      {#if $saveState === 'error'}
        Couldn't save. Your draft is kept in this session.
        <button onclick={() => notesStore.flushDrafts()}>Retry saving</button>
      {:else if $saveState === 'saving'}Saving...
      {:else if $saveState === 'unsaved'}Unsaved changes
      {:else}Saved{/if}
    </div>
    {#if viewMode === 'editor' && selectedEntry}
      <button class="back-to-notes" onclick={() => selectedFolderId && selectFolder(selectedFolderId)}>Back to notes</button>
      <input
        class="entry-title"
        type="text"
        value={editName}
        oninput={(event) => editField('name', event.currentTarget.value)}
        placeholder="Entry title"
      />
      <textarea
        class="entry-body"
        value={editBody}
        oninput={(event) => editField('body', event.currentTarget.value)}
        placeholder="Start writing..."
      ></textarea>
    {:else if viewMode === 'entries-list'}
      <div class="entries-list-header">
        <span class="entries-list-title">{selectedFolderName}</span>
        <button class="icon-btn" onclick={addEntry} title="New note">+</button>
      </div>
      <div class="content-entry-list">
        {#each folderEntries as entry (entry.id)}
          <div
            class="content-entry-item"
            class:selected={selectedEntryId === entry.id}
            role="button"
            tabindex="0"
            onclick={() => selectEntry(entry.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectEntry(entry.id); }}
          >
            <span class="content-entry-name">{entry.name}</span>
            <button class="icon-btn small" onclick={(e) => { e.stopPropagation(); removeEntry(entry.id); }} title="Delete entry">&times;</button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="editor-empty">
        <p>Select a folder to view notes</p>
      </div>
    {/if}
  </div>

  <!-- New folder dialog -->
  {#if showNewFolderDialog}
    <div class="dialog-backdrop" role="presentation" onclick={cancelNewFolder}></div>
    <div class="dialog">
      <div class="dialog-title">New Folder</div>
      <label class="dialog-field">
        <span>Name</span>
        <input
          type="text"
          bind:value={newFolderName}
          onkeydown={handleNewFolderKeydown}
        />
      </label>
      <div class="dialog-actions">
        <button class="dialog-btn" onclick={cancelNewFolder}>Cancel</button>
        <button class="dialog-btn primary" onclick={confirmNewFolder} disabled={!newFolderName.trim()}>Create</button>
      </div>
    </div>
  {/if}

  <!-- Context menu -->
  {#if contextMenu}
    <ContextMenu
      items={contextMenuItems}
      x={contextMenu.x}
      y={contextMenu.y}
      onClose={() => (contextMenu = null)}
    />
  {/if}
</div>

<style>
  .save-status { padding: 8px 16px; color: var(--color-text-muted); }
  .back-to-notes { align-self: flex-start; margin: 8px 16px; }
  .notes-app {
    display: flex;
    height: 100%;
    position: relative;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 13px;
  }

  /* ── Sidebar ─────────────────────────────────────────────────────────── */

  .sidebar {
    width: 35%;
    min-width: 100px;
    max-width: 200px;
    flex-shrink: 0;
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

  .sidebar-title {
    font-weight: 600;
    font-size: 11px;
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

  .content-entry-item:hover .icon-btn.small {
    opacity: 1;
  }

  .folder-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .folder-item {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 4px;
    margin: 0 4px;
  }

  .folder-item:hover {
    background: var(--color-border);
  }

  .folder-item.selected {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }

  .folder-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .rename-input {
    flex: 1;
    border: none;
    border-bottom: 1.5px solid var(--color-accent);
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
    padding: 0;
  }

  /* ── Delete confirmation ─────────────────────────────────────────────── */

  .confirm-delete-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    margin: 2px 4px;
    border-radius: 4px;
    background: rgba(239, 68, 68, 0.08);
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .confirm-delete-actions {
    display: flex;
    gap: 6px;
  }

  .confirm-btn {
    border: none;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .confirm-btn.cancel {
    background: var(--color-border);
    color: var(--color-text);
  }

  .confirm-btn.delete {
    background: var(--color-danger-solid);
    color: var(--color-on-danger);
  }

  .confirm-btn.delete:hover {
    background: #dc2626;
  }

  /* ── Content area ─────────────────────────────────────────────────────── */

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .entries-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-bottom: 1px solid var(--color-border);
  }

  .entries-list-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 14px;
  }

  .content-entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .content-entry-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    cursor: pointer;
    border-bottom: 1px solid var(--color-border);
  }

  .content-entry-item:hover {
    background: var(--color-surface-2);
  }

  .content-entry-item.selected {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }

  .content-entry-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    font-size: 14px;
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

  /* ── New folder dialog ───────────────────────────────────────────────── */

  .dialog-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .dialog {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 101;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 20px;
    min-width: 280px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  }

  .dialog-title {
    font-weight: 600;
    font-size: 15px;
    margin-bottom: 16px;
  }

  .dialog-field {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }

  .dialog-field span {
    font-size: 13px;
    color: var(--color-text-muted);
    min-width: 40px;
  }

  .dialog-field input {
    flex: 1;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 13px;
    background: var(--color-surface-2);
    color: var(--color-text);
    outline: none;
  }

  .dialog-field input:focus {
    border-color: var(--color-accent);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .dialog-btn {
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
    background: var(--color-border);
    color: var(--color-text);
  }

  .dialog-btn:hover {
    opacity: 0.9;
  }

  .dialog-btn.primary {
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-weight: 600;
  }

  .dialog-btn.primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
