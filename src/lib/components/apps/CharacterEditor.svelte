<script module lang="ts">
  // Tracks IDs of characters just created via the "+ New" button so the
  // detail view can open directly in edit mode for them.
  const pendingEditMode = new Set<string>();
</script>

<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { relationships, type Relationship } from '$lib/stores/relationships.js';
  import { windowStore } from '$lib/stores/windows.js';
  import EntityLink from '$lib/components/EntityLink.svelte';
  import InlineEdit from '$lib/components/InlineEdit.svelte';
  import { openEntity } from '$lib/navigation.js';
  import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
  import type { Entity } from '$lib/stores/entities.js';
  import { CHARACTER_COLORS, HEX_COLOR_RE, type TimelineLabelMode } from '$lib/timeline-v2-helpers.js';
  import {
    getCharacterIcon,
    listCharacterIcons,
    CHARACTER_ICON_CATEGORIES,
    type IconCategory,
  } from '$lib/icons/registry.js';

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
  const entity = $derived($entities.find((e) => e.id === entityId));

  let mode = $state<'view' | 'edit'>('view');

  let saveError = $state('');
  let role = $state('');
  let affiliation = $state('');
  let motivation = $state('');
  let notes = $state('');
  let avatar = $state('');
  let icon = $state<string>('');
  let iconPickerOpen = $state(false);
  // Timeline display config
  let color = $state<string | null>(null);
  let customHex = $state('');
  let customHexError = $state('');
  let timelineLabel = $state<TimelineLabelMode>({ mode: 'name-and-note' });


  // Avatar upload ref
  let fileInput: HTMLInputElement = $state(null!);

  // Pull all local form fields from the entity's stored data. Used by
  // the data-sync effect (when the entity changes externally) AND by
  // the Cancel button (to discard any not-yet-saved local edits and
  // revert to the server-confirmed values).
  function syncFromEntity() {
    if (!entity) return;
    const d = readData(entity.data);
    role = d.role ?? '';
    affiliation = d.affiliation ?? '';
    motivation = d.motivation ?? '';
    notes = d.notes ?? '';
    avatar = d.avatar ?? '';
    icon = d.icon ?? '';
    iconPickerOpen = false;
    const rawColor = (d as Record<string, unknown>).color;
    color = typeof rawColor === 'string' && HEX_COLOR_RE.test(rawColor) ? rawColor : null;
    customHex = '';
    customHexError = '';
    const rawLabel = (d as Record<string, unknown>).timelineLabel as TimelineLabelMode | undefined;
    if (rawLabel && typeof rawLabel === 'object' && 'mode' in rawLabel) {
      if (rawLabel.mode === 'name-only' || rawLabel.mode === 'name-and-note') {
        timelineLabel = { mode: rawLabel.mode };
      } else if (rawLabel.mode === 'custom') {
        timelineLabel = { mode: 'custom', field: typeof rawLabel.field === 'string' ? rawLabel.field : '' };
      } else {
        timelineLabel = { mode: 'name-and-note' };
      }
    } else {
      timelineLabel = { mode: 'name-and-note' };
    }
  }

  $effect(() => {
    if (entity) syncFromEntity();
  });

  function cancelEdit() {
    syncFromEntity();
    pickerGroup = null;
    confirmingDelete = false;
    deleteError = '';
    mode = 'view';
  }

  // Toggle mode via the Edit/Done button. Going from edit → view also
  // closes any transient pickers/confirmations the user may have left
  // open; otherwise the relationship picker dropdown (rendered when
  // `pickerGroup` is set) would remain clickable in view mode and let
  // the user create relationships outside edit mode.
  function toggleMode() {
    if (mode === 'view') {
      mode = 'edit';
    } else {
      pickerGroup = null;
      iconPickerOpen = false;
      confirmingDelete = false;
      deleteError = '';
      mode = 'view';
    }
  }

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

  async function rename(name: string) {
    if (!entityId) return;
    saveError = '';
    try { await entities.updateEntity(entityId, { name }); }
    catch { saveError = "Couldn't save."; }
  }

  async function saveAll() {
    if (!entityId) return;
    // Bail when not in edit mode. The Cancel button flips `mode = 'view'`
    // on mousedown — earlier than the focused input's `blur` event, which
    // fires during the focus-shift to the Cancel button. A blur-triggered
    // saveAll would otherwise PATCH the draft value just before
    // cancelEdit() runs, so the "cancelled" text would lurk in the entity
    // store and re-appear on the next $effect re-sync.
    if (mode !== 'edit') return;
    saveError = '';
    // Preserve any unknown keys in the existing data blob so we don't drop
    // fields we don't manage here (e.g. custom user fields used for
    // timelineLabel.mode === 'custom').
    const existing = entity ? readData(entity.data) : {};
    const data: Record<string, unknown> = {
      ...existing,
      role,
      affiliation,
      motivation,
      notes,
      avatar,
      timelineLabel
    };
    if (color) {
      data.color = color;
    } else {
      delete data.color;
    }
    // Image and icon are mutually exclusive — only persist one. Empty
    // string deletes the key so we don't carry stale icon refs after a
    // user uploads an image.
    if (icon) {
      data.icon = icon;
    } else {
      delete data.icon;
    }
    try {
      await entities.updateEntity(entityId, { data });
    } catch {
      saveError = "Couldn't save.";
    }
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

  // ── Color picker ──────────────────────────────────────────────────────────
  async function chooseColor(hex: string) {
    color = hex;
    customHex = '';
    customHexError = '';
    await saveAll();
  }
  async function resetColor() {
    color = null;
    customHex = '';
    customHexError = '';
    await saveAll();
  }
  async function commitCustomHex() {
    const val = customHex.trim();
    if (!val) { customHexError = ''; return; }
    if (!HEX_COLOR_RE.test(val)) {
      customHexError = 'Use #rrggbb (e.g. #c8942a)';
      return;
    }
    customHexError = '';
    color = val.toLowerCase();
    customHex = '';
    await saveAll();
  }
  function handleHexKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitCustomHex();
    if (e.key === 'Escape') { customHex = ''; customHexError = ''; }
  }

  // Live preview of the typed hex value while the user is still
  // composing it. Only valid 6-digit hex shows a preview; partial /
  // invalid input falls through to null and the preview swatch is
  // hidden so we don't paint random fragments.
  const customHexPreview = $derived(
    customHex.trim() && HEX_COLOR_RE.test(customHex.trim())
      ? customHex.trim().toLowerCase()
      : null
  );

  // ── Timeline label config ─────────────────────────────────────────────────
  async function setTimelineMode(mode: 'name-only' | 'name-and-note' | 'custom') {
    if (mode === 'custom') {
      const field = timelineLabel.mode === 'custom' ? timelineLabel.field : '';
      timelineLabel = { mode: 'custom', field };
    } else {
      timelineLabel = { mode };
    }
    await saveAll();
  }
  async function commitCustomField(field: string) {
    timelineLabel = { mode: 'custom', field: field.trim() };
    await saveAll();
  }


  async function pickIcon(id: string) {
    icon = id;
    avatar = '';
    iconPickerOpen = false;
    await saveAll();
  }
  async function clearIcon() {
    icon = '';
    iconPickerOpen = false;
    await saveAll();
  }
  function iconsInCategory(cat: IconCategory) {
    return listCharacterIcons().filter((i) => i.category === cat);
  }

  // Map of normalized hex → name of an OTHER entity that already uses
  // that color, scanned across every entity type (not just characters).
  // Drives the "this color is already taken" UX. Excludes the current
  // entity so its own selected color doesn't trigger a self-collision
  // warning. We normalise to lowercase since hex picker / wheel /
  // user-typed paste can produce mixed-case strings.
  const usedColors = $derived.by(() => {
    const m = new Map<string, string>();
    for (const e of $entities) {
      if (e.id === entityId) continue;
      const d = readData(e.data);
      const c = typeof d.color === 'string' ? d.color.toLowerCase() : '';
      if (c && HEX_COLOR_RE.test(c)) m.set(c, e.name);
    }
    return m;
  });

  // Auto-color this character would receive if no custom color is set.
  // Mirrors timeline-v2-helpers' colorFor() exactly so the view-mode
  // "default" preview matches what actually renders on the timeline.
  const autoColor = $derived.by(() => {
    if (!entityId) return CHARACTER_COLORS[0];
    const chars = $entities.filter((e) => e.type === 'Character');
    const idx = chars.findIndex((e) => e.id === entityId);
    return CHARACTER_COLORS[(idx < 0 ? 0 : idx) % CHARACTER_COLORS.length];
  });

  // Resolved icon entry for the currently-set icon ID. Null when no icon
  // is set OR the saved ID is unknown (registry was edited; saved ID no
  // longer exists). Falls back gracefully to initials in that case.
  const iconEntry = $derived(getCharacterIcon(icon));

  // Avatar upload — resize to ≤200px before storing
  function triggerAvatarUpload() { fileInput.click(); }

  function handleAvatarUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const max = 200;
        const ratio = Math.min(1, max / img.width, max / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        avatar = canvas.toDataURL('image/jpeg', 0.82);
        // Uploading a real image overrides any selected icon — they're
        // mutually exclusive at the render layer too.
        icon = '';
        await saveAll();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  // Story-arc presence (appears_in) is now owned by the Timeline app — drag a
  // character chip from the palette onto a track to create an interval.
  const REL_GROUPS: { label: string; type: RelationshipType }[] = [
    { label: 'Allies',      type: 'allied_with' },
    { label: 'Rivals',      type: 'rivals' },
    { label: 'Mentors',     type: 'mentor_of' },
    { label: 'Locations',   type: 'located_at' },
    { label: 'Key Events',  type: 'takes_place_at' },
  ];

  function getLinked(type: RelationshipType): { rel: Relationship; other: Entity }[] {
    if (!entityId) return [];
    const out: { rel: Relationship; other: Entity }[] = [];
    for (const r of $relationships) {
      if (r.type !== type) continue;
      if (r.fromId !== entityId && r.toId !== entityId) continue;
      const linkedId = r.fromId === entityId ? r.toId : r.fromId;
      const other = $entities.find((e) => e.id === linkedId);
      if (other) out.push({ rel: r, other });
    }
    return out;
  }

  async function removeRelationship(id: string) {
    saveError = '';
    try {
      await relationships.deleteRelationship(id);
    } catch {
      saveError = "Couldn't remove relationship.";
    }
  }

  function timelineLabelDescription(tl: TimelineLabelMode): string {
    if (tl.mode === 'name-only') return 'Name only';
    if (tl.mode === 'custom') return tl.field ? `Custom field: ${tl.field}` : 'Custom field (none chosen)';
    return 'Name + note snippet';
  }

  // ── Entity picker ──────────────────────────────────────────────────────────
  const PICKER_TYPES: Partial<Record<RelationshipType, EntityType[]>> = {
    allied_with:   ['Character'],
    rivals:        ['Character'],
    mentor_of:     ['Character'],
    located_at:    ['Location'],
    takes_place_at: ['Event', 'Scene'],
    caused_by:     ['Event', 'Scene'],
  };

  let pickerGroup: RelationshipType | null = $state(null);

  function pickerOptions(relType: RelationshipType) {
    const types = PICKER_TYPES[relType] ?? [];
    const linked = new Set(getLinked(relType).map(({ other }) => other.id));
    return $entities.filter(
      (e) => types.includes(e.type as EntityType) && e.id !== entityId && !linked.has(e.id)
    );
  }

  async function pickEntity(relType: RelationshipType, targetId: string) {
    pickerGroup = null;
    try {
      await relationships.createRelationship(entityId!, targetId, relType);
    } catch {
      saveError = "Couldn't add relationship.";
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

    <!-- Avatar + name row -->
    <div class="header">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="avatar-stack">
        <div
          class="avatar-lg"
          class:avatar-lg-roled={!avatar && (role || iconEntry)}
          style={!avatar && (role || iconEntry) ? `--rc:${roleColor(role)}` : ''}
          onclick={triggerAvatarUpload}
          title="Click to change avatar"
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && triggerAvatarUpload()}
        >
          {#if avatar}
            <img src={avatar} alt={entity.name} class="avatar-lg-img" />
          {:else if iconEntry}
            {@const IconComp = iconEntry.component}
            <span class="avatar-lg-icon" aria-label={iconEntry.label}>
              <IconComp size={26} strokeWidth={1.6} />
            </span>
          {:else}
            <span class="avatar-lg-initials">{initials(entity.name)}</span>
          {/if}
          <div class="avatar-overlay">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
            </svg>
          </div>
        </div>
        {#if mode === 'edit'}
          <button
            type="button"
            class="icon-pick-link"
            onclick={() => (iconPickerOpen = !iconPickerOpen)}
            aria-expanded={iconPickerOpen}
          >{iconEntry ? 'Change icon' : 'Pick icon'}</button>
        {/if}
      </div>
      <input
        type="file"
        accept="image/*"
        class="file-input-hidden"
        bind:this={fileInput}
        onchange={handleAvatarUpload}
      />

      <div class="header-info">
        <h1 class="entity-name">
          {#if mode === 'edit'}
            <InlineEdit value={entity.name} onSave={rename} forceEditing />
          {:else}
            <span>{entity.name}</span>
          {/if}
        </h1>
        <div class="header-meta">
          <!-- Role -->
          {#if mode === 'edit'}
            <select class="hfield-select" bind:value={role} onchange={saveAll}>
              {#each ROLE_OPTIONS as opt}
                <option value={opt.value}>{opt.value || '— none —'}</option>
              {/each}
            </select>
          {:else}
            {#if role}
              <span class="role-badge" style="--rc:{roleColor(role)}">{role}</span>
            {:else}
              <span class="hfield-empty">Role</span>
            {/if}
          {/if}
          <!-- Affiliation -->
          {#if mode === 'edit'}
            <input
              class="hfield-input"
              bind:value={affiliation}
              onblur={saveAll}
              placeholder="Affiliation"
            />
          {:else}
            {#if affiliation}
              <span class="hfield-text">{affiliation}</span>
            {:else}
              <span class="hfield-empty">Affiliation</span>
            {/if}
          {/if}
        </div>
      </div>
    </div>

    {#if iconPickerOpen && mode === 'edit'}
      <div class="icon-picker">
        {#each CHARACTER_ICON_CATEGORIES as cat}
          <div class="icon-picker-cat">
            <p class="section-label">{cat}</p>
            <div class="icon-grid">
              {#each iconsInCategory(cat) as entry}
                {@const IconComp = entry.component}
                <button
                  type="button"
                  class="icon-tile"
                  class:icon-tile-selected={icon === entry.id}
                  title={entry.label}
                  aria-label={entry.label}
                  aria-pressed={icon === entry.id}
                  onclick={() => pickIcon(entry.id)}
                >
                  <IconComp size={20} strokeWidth={1.6} />
                </button>
              {/each}
            </div>
          </div>
        {/each}
        {#if iconEntry}
          <button type="button" class="icon-picker-clear" onclick={clearIcon}>Clear icon</button>
        {/if}
      </div>
    {/if}

    {#if saveError}<p class="save-error">{saveError}</p>{/if}

    {#if mode === 'edit' && pickerGroup}
      <div class="picker-backdrop" role="presentation" onclick={() => (pickerGroup = null)} onkeydown={() => (pickerGroup = null)}></div>
    {/if}

    {#each REL_GROUPS as group}
      {@const linked = getLinked(group.type)}
      <section class="rel-group">
        <p class="section-label">{group.label}</p>
        <div class="chip-row">
          {#each linked as link (link.rel.id)}
            <EntityLink
              id={link.other.id}
              name={link.other.name}
              relationshipType={group.type}
              onRemove={mode === 'edit' ? () => removeRelationship(link.rel.id) : undefined}
            />
          {/each}
          <div class="picker-wrap">
            {#if mode === 'edit'}
              <button
                class="chip-add"
                class:chip-add-open={pickerGroup === group.type}
                onclick={() => (pickerGroup = pickerGroup === group.type ? null : group.type)}
                title="Add {group.label}"
              >+</button>
            {/if}
            {#if mode === 'edit' && pickerGroup === group.type}
              {@const opts = pickerOptions(group.type)}
              <div class="picker-dropdown">
                {#if opts.length === 0}
                  <p class="picker-empty">Nothing available to add.</p>
                {:else}
                  {#each opts as opt}
                    <button class="picker-item" onclick={() => pickEntity(group.type, opt.id)}>
                      <span class="picker-name">{opt.name}</span>
                      <span class="picker-type">{opt.type}</span>
                    </button>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </section>
    {/each}

    <hr class="divider" />

    <div class="details">

      <!-- Timeline color picker -->
      <div class="field-header">
        <span class="field-label">Timeline color</span>
        {#if mode === 'edit' && color}
          <button class="field-edit-btn" onclick={resetColor} data-testid="char-color-reset">Reset to default</button>
        {/if}
      </div>
      {#if mode === 'edit'}
        <!-- 2-row grid: swatches (row 1, left) + hex input (row 2,
             left), color wheel spans both rows on the right and fills
             the otherwise-blank space. align-self: stretch lets the
             wheel grow to the combined row height. -->
        <div class="color-grid">
          <div class="swatch-row" role="group" aria-label="Timeline color">
            {#each CHARACTER_COLORS as hex}
              {@const inUse = usedColors.has(hex.toLowerCase())}
              <button
                type="button"
                class="swatch"
                class:swatch-selected={color === hex}
                class:swatch-used={inUse && color !== hex}
                style="--sw:{hex}"
                aria-label={inUse ? `${hex} (used by ${usedColors.get(hex.toLowerCase())})` : hex}
                aria-pressed={color === hex}
                data-testid="char-color-{hex}"
                title={inUse ? `Already used by ${usedColors.get(hex.toLowerCase())}` : hex}
                onclick={() => chooseColor(hex)}
              ></button>
            {/each}
          </div>
          <div class="hex-row">
            <input
              class="hex-input"
              type="text"
              placeholder="#rrggbb"
              maxlength="7"
              bind:value={customHex}
              onblur={commitCustomHex}
              onkeydown={handleHexKeydown}
              data-testid="char-color-custom-input"
            />
            {#if customHexPreview}
              <span
                class="swatch swatch-display"
                style="--sw:{customHexPreview}"
                aria-hidden="true"
                data-testid="char-color-custom-preview"
              ></span>
            {/if}
          </div>
          <!-- Native color picker spans both grid rows so the right
               column has no blank space below the wheel. -->
          <input
            type="color"
            class="color-wheel"
            value={color ?? autoColor}
            onchange={(e) => chooseColor((e.currentTarget as HTMLInputElement).value.toLowerCase())}
            aria-label="Custom color picker"
            data-testid="char-color-wheel"
          />
        </div>
        {#if customHexError}
          <p class="hex-error" data-testid="char-color-custom-error">{customHexError}</p>
        {/if}
        {#if color && usedColors.has(color)}
          <p class="color-collision" data-testid="char-color-collision">
            Also used by {usedColors.get(color)}.
          </p>
        {/if}
      {:else}
        <!-- View mode: show only the chosen color (or the auto-assigned
             default for this character) so the reader sees the actual
             color rendered on the timeline. Less visual noise than the
             full picker. -->
        <div class="display-row">
          {#if color}
            <span class="swatch swatch-display" style="--sw:{color}" aria-hidden="true"></span>
            <span class="display-text">{color}</span>
          {:else}
            <span class="swatch swatch-display" style="--sw:{autoColor}" aria-hidden="true"></span>
            <span class="display-text display-muted">Default ({autoColor})</span>
          {/if}
        </div>
      {/if}

      <!-- Show on timeline -->
      <div class="field-header">
        <span class="field-label">Show on timeline</span>
      </div>
      {#if mode === 'edit'}
        <div class="radio-group" role="radiogroup" aria-label="Show on timeline">
          <label class="radio-row">
            <input
              type="radio"
              name="timelineLabelMode"
              value="name-only"
              checked={timelineLabel.mode === 'name-only'}
              onchange={() => setTimelineMode('name-only')}
              data-testid="char-tl-name-only"
            />
            <span class="radio-text">Name only</span>
          </label>
          <label class="radio-row">
            <input
              type="radio"
              name="timelineLabelMode"
              value="name-and-note"
              checked={timelineLabel.mode === 'name-and-note'}
              onchange={() => setTimelineMode('name-and-note')}
              data-testid="char-tl-name-and-note"
            />
            <span class="radio-text">Name + note snippet (default)</span>
          </label>
          <label class="radio-row">
            <input
              type="radio"
              name="timelineLabelMode"
              value="custom"
              checked={timelineLabel.mode === 'custom'}
              onchange={() => setTimelineMode('custom')}
              data-testid="char-tl-custom"
            />
            <span class="radio-text">Custom field</span>
          </label>
          {#if timelineLabel.mode === 'custom'}
            <input
              class="custom-field-input"
              type="text"
              placeholder="field name (e.g. motivation)"
              value={timelineLabel.field}
              onblur={(e) => commitCustomField((e.currentTarget as HTMLInputElement).value)}
              onkeydown={(e) => { if (e.key === 'Enter') commitCustomField((e.currentTarget as HTMLInputElement).value); }}
              data-testid="char-tl-custom-field"
            />
          {/if}
        </div>
      {:else}
        <!-- View mode: collapse the radio group into a single line. -->
        <div class="display-row">
          <span class="display-text">{timelineLabelDescription(timelineLabel)}</span>
        </div>
      {/if}

      <label class="field-label" for="char-motivation">Motivation</label>
      {#if mode === 'edit'}
        <textarea
          id="char-motivation"
          class="field-textarea"
          placeholder="What drives this character?"
          bind:value={motivation}
          onblur={saveAll}
          rows="3"
        ></textarea>
      {:else}
        <p class="field-display" class:field-empty={!motivation}>
          {motivation || 'Not set.'}
        </p>
      {/if}

      <label class="field-label" for="char-notes">Notes</label>
      {#if mode === 'edit'}
        <textarea
          id="char-notes"
          class="field-textarea"
          placeholder="Additional notes…"
          bind:value={notes}
          onblur={saveAll}
          rows="4"
        ></textarea>
      {:else}
        <p class="field-display" class:field-empty={!notes}>
          {notes || 'Not set.'}
        </p>
      {/if}

      {#if saveError}<p class="save-error">{saveError}</p>{/if}
    </div>

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

  /* ── Detail mode ── */
  .char-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 100%;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* Avatar */
  .avatar-lg {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
    overflow: hidden;
  }
  /* Roled detail-view placeholder mirrors .char-avatar-roled. */
  .avatar-lg-roled {
    background: color-mix(in srgb, var(--rc) 18%, transparent);
    border-color: color-mix(in srgb, var(--rc) 35%, transparent);
  }
  .avatar-lg-roled .avatar-lg-initials {
    color: var(--rc);
  }

  .avatar-lg-initials {
    font-size: 17px;
    font-weight: 600;
    font-family: var(--font-ui);
    color: var(--color-accent);
    letter-spacing: 0.02em;
    pointer-events: none;
  }
  .avatar-lg-icon {
    color: var(--color-accent);
    pointer-events: none;
    display: inline-flex;
  }
  .avatar-lg-roled .avatar-lg-icon { color: var(--rc); }

  .avatar-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .icon-pick-link {
    background: none;
    border: none;
    padding: 0;
    font-size: 10px;
    font-family: var(--font-ui);
    color: var(--color-text-muted);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .icon-pick-link:hover { color: var(--color-accent); }

  /* Icon picker */
  .icon-picker {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .icon-picker-cat {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .icon-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .icon-tile {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.1s, color 0.1s;
  }
  .icon-tile:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .icon-tile-selected {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .icon-picker-clear {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .icon-picker-clear:hover { color: var(--color-text); border-color: var(--color-text); }

  .avatar-lg-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  .avatar-overlay {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .avatar-lg:hover .avatar-overlay { opacity: 1; }

  .file-input-hidden { display: none; }

  .header-info {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    flex: 1;
  }

  .entity-name {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 400;
    color: var(--color-text);
  }

  .role-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--rc, var(--color-accent));
    background: color-mix(in srgb, var(--rc, var(--color-accent)) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--rc, var(--color-accent)) 35%, transparent);
    border-radius: 20px;
    padding: 2px 9px;
    align-self: flex-start;
  }

  /* Header inline-edit fields (role + affiliation) */
  .header-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }


  .hfield-empty {
    font-size: 11px;
    color: var(--color-text-muted);
    font-style: italic;
    font-family: var(--font-ui);
  }

  .hfield-text {
    font-size: 12px;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
  }

  .hfield-select {
    background: var(--color-surface-2);
    border: 1px solid var(--color-accent);
    border-radius: 5px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    padding: 2px 6px;
    outline: none;
    cursor: pointer;
  }


  .hfield-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-accent);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    outline: none;
    padding: 0;
    width: 90px;
  }

  .rel-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .section-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-text-muted);
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
  }

  .chip-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 9px;
    border-radius: 20px;
    font-size: 14px;
    font-family: var(--font-ui);
    color: var(--color-text-muted);
    background: transparent;
    border: 1px dashed var(--color-border);
    cursor: pointer;
    line-height: 1;
    transition: border-color 0.1s, color 0.1s;
  }
  .chip-add:hover,
  .chip-add-open {
    border-color: var(--color-accent);
    color: var(--color-accent);
    border-style: solid;
  }

  /* (chip × delete now lives inside the chip — see app.css
     `.entity-chip-remove`. EntityLink takes an optional onRemove prop.) */

  /* Picker */
  .picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9;
  }

  .picker-wrap {
    position: relative;
  }

  .picker-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 10;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 4px;
    min-width: 160px;
    max-height: 200px;
    overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .picker-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-family: var(--font-ui);
    text-align: left;
  }
  .picker-item:hover { background: var(--color-surface); }

  .picker-name {
    font-size: 13px;
    color: var(--color-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-type {
    font-size: 10px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  .picker-empty {
    font-size: 12px;
    color: var(--color-text-muted);
    padding: 6px 8px;
    font-family: var(--font-ui);
  }

  .divider {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 0;
  }

  /* Details section */
  .details {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-text-muted);
  }

  .field-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
  }

  .field-edit-btn {
    background: none;
    border: none;
    font-size: 11px;
    font-family: var(--font-ui);
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 1px 6px;
    border-radius: 4px;
  }
  .field-edit-btn:hover { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 10%, transparent); }

  .field-display {
    font-size: 13px;
    color: var(--color-text);
    font-family: var(--font-ui);
    line-height: 1.5;
    white-space: pre-wrap;
    margin: 0;
  }
  .field-display.field-empty { color: var(--color-text-muted); font-style: italic; }

  .field-textarea {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.5;
    padding: 6px 10px;
    width: 100%;
    resize: none;
    outline: none;
  }
  .field-textarea:focus { outline: 2px solid var(--color-accent); outline-offset: 0; border-color: var(--color-accent); }


  .save-error { color: var(--color-rel-rival); font-size: 12px; }
  .muted { color: var(--color-text-muted); font-size: 13px; }
  .center { text-align: center; padding: 40px 0; }

  /* Timeline color picker */
  .swatch-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--sw);
    border: 2px solid var(--color-border);
    padding: 0;
    cursor: pointer;
    transition: border-color 0.1s, transform 0.1s;
  }
  .swatch:hover { border-color: var(--color-text-muted); }
  .swatch-selected {
    border-color: var(--color-text);
    transform: scale(1.1);
  }
  .hex-input {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 5px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    padding: 3px 6px;
    width: 80px;
    outline: none;
  }
  .hex-input:focus { border-color: var(--color-accent); }

  /* 2-row grid layout: swatches (row 1) + hex input (row 2) on the
     left column, color wheel spans both rows on the right.
     align-self: stretch on the wheel makes it fill the full combined
     height so there's no blank space in the right column. */
  .color-grid {
    display: grid;
    grid-template-columns: 1fr 60px;
    grid-template-rows: auto auto;
    column-gap: 10px;
    row-gap: 6px;
    align-items: center;
  }
  .color-grid .swatch-row { grid-column: 1; grid-row: 1; }
  .color-grid .hex-row { grid-column: 1; grid-row: 2; }
  .color-grid .color-wheel {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: stretch;
    width: 100%;
    height: auto;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }
  .color-wheel::-webkit-color-swatch-wrapper { padding: 3px; }
  .color-wheel::-webkit-color-swatch { border: none; border-radius: 4px; }
  .color-wheel::-moz-color-swatch { border: none; border-radius: 4px; }
  .color-wheel:hover { border-color: var(--color-accent); }

  .hex-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Used-elsewhere swatch indicator — a small dot in the top-right
     corner. Doesn't disable the swatch (with >8 characters collision
     is forced anyway), just signals "if you pick this, you'll match
     someone else." Skipped for the currently-selected color. */
  .swatch { position: relative; }
  .swatch-used::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-text);
    border: 1.5px solid var(--color-surface);
    transform: translate(40%, -40%);
    pointer-events: none;
  }

  .color-collision {
    margin: 4px 0 0;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* View-mode collapsed display row for color + timeline-label. */
  .display-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--color-text);
  }
  .display-text { font-size: 13px; color: var(--color-text); }
  .display-muted { color: var(--color-text-muted); font-style: italic; }
  .swatch-display {
    width: 16px;
    height: 16px;
    pointer-events: none;
  }

  .hex-error {
    color: var(--color-rel-rival);
    font-size: 11px;
    font-family: var(--font-ui);
    margin: 0;
  }

  /* Timeline label radio group */
  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .radio-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .radio-row input[type='radio'] {
    accent-color: var(--color-accent);
    margin: 0;
  }
  .radio-text {
    font-size: 12px;
    color: var(--color-text);
    font-family: var(--font-ui);
  }
  .custom-field-input {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 5px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    padding: 3px 8px;
    margin-left: 22px;
    margin-top: 2px;
    outline: none;
    width: 200px;
  }
  .custom-field-input:focus { border-color: var(--color-accent); }

  /* View/edit toggle row + per-mode gating (Block 5). */
  .mode-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
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

  /* Detail-view footer sits at the bottom of the visible area (matches
     EntityDetail). Outline-style Delete defers attention to Edit/Done at
     the top; the filled .btn-danger only appears after confirmation. */
  .detail-footer {
    margin-top: auto;
    padding-top: 12px;
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

  /* In view mode: hide field-edit buttons + the avatar's hover camera
     icon. The full timeline color picker, hex input, and radio group
     are now conditionally rendered (mode === 'edit'), so no view-mode
     opacity/pointer-events overrides are needed. */
  .view-mode .field-edit-btn,
  .view-mode .avatar-overlay {
    display: none;
  }
  .view-mode .avatar-lg { cursor: default; pointer-events: none; }
</style>
