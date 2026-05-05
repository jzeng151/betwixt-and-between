<script module lang="ts">
  // Tracks IDs of characters just created via the "+ New" button so the
  // detail view can open directly in edit mode for them.
  const pendingEditMode = new Set<string>();
</script>

<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { windowStore } from '$lib/stores/windows.js';
  import InlineEdit from '$lib/components/InlineEdit.svelte';
  import CharacterEditorBody from '$lib/components/CharacterEditorBody.svelte';
  import { openEntity } from '$lib/navigation.js';
  import { getCharacterIcon } from '$lib/icons/registry.js';

  interface Props { winId: string; entityId: string | null; }
  let { winId, entityId }: Props = $props();

  const ROLE_OPTIONS: { value: string; color: string }[] = [
    { value: '',            color: 'var(--color-text-muted)' },
    { value: 'Protagonist', color: 'var(--color-accent)' },
    { value: 'Antagonist',  color: 'var(--color-rel-rival)' },
    { value: 'Ally',        color: 'var(--color-rel-ally)' },
    { value: 'Rival',       color: 'var(--color-rel-rival)' },
    { value: 'Mentor',      color: 'var(--color-rel-mentor)' },
    { value: 'Supporting',  color: 'var(--color-rel-event)' },
  ];

  function roleColor(r: string): string {
    const lower = r.toLowerCase();
    return ROLE_OPTIONS.find((o) => o.value.toLowerCase() === lower)?.color ?? 'var(--color-text-muted)';
  }

  // entity.data is jsonb (object) post-T8a; coerce to Record<string,string> shape.
  function readData(data: Record<string, unknown> | undefined): Record<string, string> {
    return (data ?? {}) as Record<string, string>;
  }

  function initials(name: string): string {
    return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
  }

  const characters = $derived($entities.filter((e) => e.type === 'Character'));

  // ── List mode ─────────────────────────────────────────────────────────────
  let searchQuery = $state('');
  let createError = $state('');
  const filteredCharacters = $derived(
    searchQuery.trim()
      ? characters.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : characters
  );

  async function createCharacter() {
    createError = '';
    try {
      const created = await entities.createEntity('Character', 'New Character');
      pendingEditMode.add(created.id);
      try {
        openEntity(created.id);
      } catch (err) {
        // openEntity is a stable router but if it throws (e.g. window
        // store error), back out the pending-edit signal so the
        // already-created entity doesn't later pop into edit mode via
        // some other code path.
        pendingEditMode.delete(created.id);
        throw err;
      }
    } catch {
      // Surface the failure inline (was previously swallowed). Most likely
      // network or 500 from the server — user gets a brief notice and can
      // retry. Self-clears on the next attempt.
      createError = "Couldn't create character.";
    }
  }

  // Bulk-select state for list mode
  let selecting = $state(false);
  let selected = $state(new Set<string>());
  let confirmingBulkDelete = $state(false);
  let bulkDeleting = $state(false);
  let bulkDeleteError = $state('');
  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected = next;
  }
  function cancelSelect() {
    selecting = false;
    selected = new Set();
    confirmingBulkDelete = false;
    bulkDeleteError = '';
  }
  // Visible-only selection count: the search input stays active in select
  // mode, so an item the user selected can be filtered out of view. The
  // toolbar count and Delete (N) action both operate on the visible
  // intersection so the user can't accidentally delete characters they
  // can't currently see (Greptile P1).
  const visibleIds = $derived(new Set(filteredCharacters.map((c) => c.id)));
  const visibleSelected = $derived(new Set([...selected].filter((id) => visibleIds.has(id))));
  async function deleteSelected() {
    // Delete only the currently-VISIBLE selected ids. Hidden selections
    // are dropped from the Set but not deleted — same semantic as a
    // mail client: filtering hides messages, applies actions only to
    // what you can see.
    const ids = [...visibleSelected];
    if (ids.length === 0) return;
    bulkDeleting = true;
    bulkDeleteError = '';
    selected = new Set();
    selecting = false;
    confirmingBulkDelete = false;
    // Use allSettled so a partial failure (3/5 succeed) only re-selects
    // the IDs that ACTUALLY failed, instead of restoring the whole
    // pre-delete set including the 3 successes. Each per-id
    // entities.deleteEntity already does its own optimistic-update +
    // rollback for the entity row itself.
    const results = await Promise.allSettled(
      ids.map((id) => entities.deleteEntity(id))
    );
    const failedIds = ids.filter((_, i) => results[i].status === 'rejected');
    if (failedIds.length > 0) {
      selected = new Set(failedIds);
      selecting = true;
      bulkDeleteError =
        `Couldn't delete ${failedIds.length} character${failedIds.length === 1 ? '' : 's'}.`;
    }
    bulkDeleting = false;
  }

  // ── Detail mode ───────────────────────────────────────────────────────────
  // The editor surface (avatar, role, affiliation, icon picker, relationship
  // sections, timeline color, motivation, notes) lives in CharacterEditorBody.
  // This wrapper retains only the chrome: mode toggle, name InlineEdit,
  // popout/close, and the delete-confirm footer.
  const entity = $derived($entities.find((e) => e.id === entityId));

  let mode = $state<'view' | 'edit'>('view');
  let saveError = $state(''); // rename failures only — body owns its own save errors

  // Mode reset only fires when entityId actually changes (real
  // navigation), not on every parent re-render. Window.svelte's root
  // onmousedown calls windowStore.focus(id), so every click anywhere
  // in the window re-emits the window array → re-renders WindowManager's
  // {#each} → re-passes entityId to CharacterEditor. Without this
  // guard, the effect re-fires on every click and silently flips
  // mode='edit' back to 'view'. The plain `let` tracker is intentional —
  // it must be non-reactive (a $state would re-trigger the effect).
  let lastSyncedEntityId: string | null = null;
  $effect(() => {
    const id = entityId;
    if (id && id !== lastSyncedEntityId) {
      lastSyncedEntityId = id;
      if (pendingEditMode.has(id)) {
        pendingEditMode.delete(id);
        mode = 'edit';
      } else {
        mode = 'view';
      }
      confirmingDelete = false;
      deleteError = '';
    }
  });

  // Cancel discards any in-flight body drafts: flipping `mode` to 'view'
  // propagates `readOnly=true` to CharacterEditorBody, whose own
  // readOnly-transition $effect calls syncFromEntity() to revert. The
  // body's saveAll bails when readOnly is true, so a focus-shift blur
  // from the Cancel button can't commit a draft just before the revert.
  function cancelEdit() {
    confirmingDelete = false;
    deleteError = '';
    mode = 'view';
  }

  function toggleMode() {
    if (mode === 'view') {
      mode = 'edit';
    } else {
      // Going edit → view also clears any local confirmation state. The
      // body resets its own transient pickers via its readOnly-transition
      // $effect.
      confirmingDelete = false;
      deleteError = '';
      mode = 'view';
    }
  }

  async function rename(name: string) {
    if (!entityId) return;
    saveError = '';
    try { await entities.updateEntity(entityId, { name }); }
    catch { saveError = "Couldn't save."; }
  }

  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let deleteError = $state('');

  async function deleteCharacter() {
    if (!entityId) return;
    deleting = true;
    deleteError = '';
    try {
      await entities.deleteEntity(entityId);
      confirmingDelete = false;
      windowStore.close(winId);
    } catch {
      deleteError = "Couldn't delete character.";
    } finally {
      deleting = false;
    }
  }
</script>

{#if !entityId}
  <!-- ── List mode ── -->
  <div class="list-view">
    <div class="list-toolbar">
      <input
        class="search-input"
        placeholder="Search characters…"
        bind:value={searchQuery}
      />
      {#if selecting}
        {#if confirmingBulkDelete}
          <span class="bulk-confirm-msg">Delete {visibleSelected.size}?</span>
          <button
            class="select-cancel-btn"
            disabled={bulkDeleting}
            onclick={() => (confirmingBulkDelete = false)}
          >Cancel</button>
          <button
            class="btn-danger"
            disabled={bulkDeleting}
            onclick={deleteSelected}
          >{bulkDeleting ? '…' : 'Delete'}</button>
        {:else}
          <button class="select-cancel-btn" onclick={cancelSelect}>Cancel</button>
          {#if visibleSelected.size > 0}
            <button class="btn-danger" onclick={() => (confirmingBulkDelete = true)}>Delete ({visibleSelected.size})</button>
          {/if}
        {/if}
      {:else}
        <button class="select-toggle-btn" onclick={() => (selecting = true)}>Select</button>
        <button class="create-btn" onclick={createCharacter}>+ New</button>
      {/if}
    </div>

    {#if createError}
      <p class="create-error" role="alert">{createError}</p>
    {/if}
    {#if bulkDeleteError}
      <p class="create-error" role="alert">{bulkDeleteError}</p>
    {/if}

    {#if characters.length === 0}
      <p class="empty">No characters yet.</p>
    {:else if filteredCharacters.length === 0}
      <p class="empty">No matches.</p>
    {:else}
      <ul class="char-list">
        {#each filteredCharacters as char (char.id)}
          {@const d = readData(char.data)}
          {@const rowIcon = getCharacterIcon(d.icon)}
          <li class="char-item">
            {#if selecting}
              <div
                class="char-check"
                role="checkbox"
                aria-checked={selected.has(char.id)}
                tabindex="0"
                onclick={(e) => { e.stopPropagation(); toggleSelect(char.id); }}
                onkeydown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggleSelect(char.id);
                  }
                }}
              >
                <input type="checkbox" checked={selected.has(char.id)} tabindex="-1" readonly />
              </div>
            {/if}
            <button
              class="char-row"
              onclick={() => {
                if (selecting) toggleSelect(char.id);
                else openEntity(char.id);
              }}
            >
              <div
                class="char-avatar"
                class:char-avatar-roled={!d.avatar && (d.role || rowIcon)}
                style={!d.avatar && (d.role || rowIcon) ? `--rc:${roleColor(d.role)}` : ''}
              >
                {#if d.avatar}
                  <img src={d.avatar} alt={char.name} class="avatar-thumb" />
                {:else if rowIcon}
                  {@const RowIconComp = rowIcon.component}
                  <RowIconComp size={16} strokeWidth={1.6} />
                {:else}
                  {initials(char.name)}
                {/if}
              </div>
              <div class="char-meta">
                <span class="char-name">{char.name}</span>
                <div class="char-badges">
                  {#if d.role}
                    <span class="char-role-badge" style="--rc:{roleColor(d.role)}">{d.role}</span>
                  {/if}
                  {#if d.affiliation}
                    <span class="char-affiliation">{d.affiliation}</span>
                  {/if}
                </div>
              </div>
              <span class="char-arrow">›</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

{:else if !entity}
  <p class="muted center">Loading…</p>

{:else}
  <!-- ── Detail mode ── -->
  <div class="char-detail" class:view-mode={mode === 'view'}>
    <div class="mode-row">
      {#if mode === 'edit'}
        <button
          type="button"
          class="mode-cancel"
          onmousedown={() => (mode = 'view')}
          onclick={cancelEdit}
        >Cancel</button>
      {/if}
      <button
        type="button"
        class="mode-toggle"
        onclick={toggleMode}
      >{mode === 'view' ? 'Edit' : 'Done'}</button>
    </div>

    <h1 class="entity-name">
      {#if mode === 'edit'}
        <InlineEdit value={entity.name} onSave={rename} forceEditing />
      {:else}
        <span>{entity.name}</span>
      {/if}
    </h1>

    {#if saveError}<p class="save-error">{saveError}</p>{/if}

    <CharacterEditorBody {entityId} readOnly={mode === 'view'} />

    <div class="detail-footer">
      {#if confirmingDelete}
        <div class="delete-confirm">
          <span class="delete-confirm-msg">Delete <strong>{entity.name}</strong>?</span>
          <div class="delete-confirm-btns">
            <button
              type="button"
              class="btn-cancel"
              disabled={deleting}
              onclick={() => (confirmingDelete = false)}
            >Cancel</button>
            <button
              type="button"
              class="btn-danger"
              disabled={deleting}
              onclick={deleteCharacter}
            >{deleting ? '…' : 'Delete'}</button>
          </div>
          {#if deleteError}<div class="delete-error">{deleteError}</div>{/if}
        </div>
      {:else}
        <button
          type="button"
          class="btn-delete"
          onclick={() => (confirmingDelete = true)}
        >Delete character</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ── List mode ── */
  .list-view {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .list-toolbar { display: flex; flex-direction: row; gap: 6px; align-items: center; }

  .search-input {
    flex: 1;
    min-width: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 6px 10px;
    outline: none;
  }
  .search-input:focus { border-color: var(--color-accent); }

  .create-btn {
    flex-shrink: 0;
    background: var(--color-accent);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 6px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .create-btn:hover { opacity: 0.85; }

  .create-error {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--color-rel-rival);
    font-family: var(--font-ui);
  }

  .select-toggle-btn, .select-cancel-btn {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 6px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .select-toggle-btn:hover, .select-cancel-btn:hover {
    border-color: var(--color-text);
    color: var(--color-text);
  }

  /* Filled-red destructive button — used for bulk Delete (N) and the
     confirmation step in the detail-view footer. Matches EntityDetail's
     .btn-danger so destructive actions feel consistent across the app. */
  .btn-danger {
    flex-shrink: 0;
    background: #ef4444;
    border: none;
    border-radius: 4px;
    color: #fff;
    font-family: var(--font-ui);
    font-size: 12px;
    padding: 6px 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-danger:hover { opacity: 0.9; }
  .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-cancel {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    border-radius: 4px;
    padding: 6px 12px;
    font-family: var(--font-ui);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .char-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .char-check {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 4px;
    cursor: pointer;
  }
  .char-check input {
    cursor: pointer;
    accent-color: var(--color-accent);
    width: 14px;
    height: 14px;
  }

  .bulk-confirm-msg {
    flex: 1;
    font-size: 12px;
    color: var(--color-text);
    font-family: var(--font-ui);
  }

  .char-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .char-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 7px;
    padding: 8px 10px;
    cursor: pointer;
    font-family: var(--font-ui);
    transition: border-color 0.1s;
    text-align: left;
  }
  .char-row:hover { border-color: var(--color-accent); }

  .char-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
    color: var(--color-accent);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font-ui);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    letter-spacing: 0.02em;
  }
  /* When a role is set and no image is uploaded, tint the placeholder
     with that role's color so the row reads as "Antagonist" or "Ally"
     at a glance — same trick as the role badge, applied to the avatar. */
  .char-avatar-roled {
    background: color-mix(in srgb, var(--rc) 18%, transparent);
    border-color: color-mix(in srgb, var(--rc) 35%, transparent);
    color: var(--rc);
  }

  .avatar-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  .char-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .char-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .char-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .char-affiliation {
    font-size: 10px;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    white-space: nowrap;
  }

  .char-role-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--rc);
    background: color-mix(in srgb, var(--rc) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--rc) 35%, transparent);
    border-radius: 20px;
    padding: 1px 7px;
    white-space: nowrap;
    align-self: flex-start;
  }

  .char-arrow {
    font-size: 15px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .empty {
    color: var(--color-text-muted);
    font-size: 13px;
    text-align: center;
    padding: 32px 0;
  }

  /* ── Detail mode (wrapper chrome only — body styles live in
     CharacterEditorBody.svelte) ── */
  .char-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 100%;
  }

  .entity-name {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 400;
    color: var(--color-text);
    margin: 0;
    padding: 0 18px;
  }

  .save-error { color: var(--color-rel-rival); font-size: 12px; padding: 0 18px; }
  .muted { color: var(--color-text-muted); font-size: 13px; }
  .center { text-align: center; padding: 40px 0; }

  .mode-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    padding: 0 18px;
  }
  .mode-toggle {
    background: var(--color-accent);
    color: var(--color-surface);
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .mode-toggle:hover { filter: brightness(1.1); }

  .mode-cancel {
    background: transparent;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .mode-cancel:hover { color: var(--color-text); border-color: var(--color-text); }

  .detail-footer {
    margin-top: auto;
    padding: 12px 18px 0;
    border-top: 1px solid var(--color-border);
    display: flex;
    justify-content: flex-start;
    align-items: center;
  }
  .btn-delete {
    background: transparent;
    border: 1px solid var(--color-border);
    color: #ef4444;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .btn-delete:hover { border-color: #ef4444; }
  .delete-confirm {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .delete-confirm-msg {
    font-size: 13px;
    color: var(--color-text);
    font-family: var(--font-ui);
  }
  .delete-confirm-btns {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .delete-error {
    color: #ef4444;
    font-size: 11px;
    font-family: var(--font-ui);
  }
</style>
