<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { windowStore } from '$lib/stores/windows.js';
  import EntityLink from '$lib/components/EntityLink.svelte';
  import InlineEdit from '$lib/components/InlineEdit.svelte';
  import { openEntity } from '$lib/navigation.js';
  import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
  import { CHARACTER_COLORS, HEX_COLOR_RE, type TimelineLabelMode } from '$lib/timeline-v2-helpers.js';

  interface Props { winId: string; entityId: string | null; }
  let { entityId }: Props = $props();

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

  function parseData(raw: string): Record<string, string> {
    try { return JSON.parse(raw) ?? {}; } catch { return {}; }
  }

  function initials(name: string): string {
    return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
  }

  const characters = $derived($entities.filter((e) => e.type === 'Character'));

  // ── List mode ─────────────────────────────────────────────────────────────
  let newName = $state('');
  let addError = $state('');

  async function commitAdd() {
    const name = newName.trim();
    if (!name) return;
    addError = '';
    try {
      const created = await entities.createEntity('Character', name);
      newName = '';
      openEntity(created.id);
    } catch {
      addError = "Couldn't create character.";
    }
  }

  function handleAddKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitAdd();
    if (e.key === 'Escape') { newName = ''; addError = ''; }
  }

  // ── Detail mode ───────────────────────────────────────────────────────────
  const entity = $derived($entities.find((e) => e.id === entityId));

  let saveError = $state('');
  let role = $state('');
  let affiliation = $state('');
  let motivation = $state('');
  let notes = $state('');
  let avatar = $state('');
  // Timeline display config
  let color = $state<string | null>(null);
  let customHex = $state('');
  let customHexError = $state('');
  let timelineLabel = $state<TimelineLabelMode>({ mode: 'name-and-note' });

  // Edit-mode state for role, affiliation, motivation & notes
  let editingRole = $state(false);
  let editingAffiliation = $state(false);
  let editingMotivation = $state(false);
  let editingNotes = $state(false);
  let draftRole = $state('');
  let draftAffiliation = $state('');
  let draftMotivation = $state('');
  let draftNotes = $state('');

  // Avatar upload ref
  let fileInput: HTMLInputElement = $state(null!);

  $effect(() => {
    if (entity) {
      const d = parseData(entity.data);
      role = d.role ?? '';
      affiliation = d.affiliation ?? '';
      motivation = d.motivation ?? '';
      notes = d.notes ?? '';
      avatar = d.avatar ?? '';
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
      editingRole = false;
      editingAffiliation = false;
      editingMotivation = false;
      editingNotes = false;
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
    saveError = '';
    // Preserve any unknown keys in the existing data blob so we don't drop
    // fields we don't manage here (e.g. custom user fields used for
    // timelineLabel.mode === 'custom').
    const existing = entity ? parseData(entity.data) : {};
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
    try {
      await entities.updateEntity(entityId, { data });
    } catch {
      saveError = "Couldn't save.";
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

  // Role edit
  function startRole() { draftRole = role; editingRole = true; }
  function cancelRole() { editingRole = false; }
  async function commitRole() {
    role = draftRole;
    editingRole = false;
    await saveAll();
  }

  // Affiliation edit
  function startAffiliation() { draftAffiliation = affiliation; editingAffiliation = true; }
  function cancelAffiliation() { editingAffiliation = false; }
  async function commitAffiliation() {
    affiliation = draftAffiliation.trim();
    editingAffiliation = false;
    await saveAll();
  }
  function handleAffiliationKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitAffiliation();
    if (e.key === 'Escape') cancelAffiliation();
  }

  // Motivation edit
  function startMotivation() { draftMotivation = motivation; editingMotivation = true; }
  function cancelMotivation() { editingMotivation = false; }
  async function commitMotivation() {
    motivation = draftMotivation;
    editingMotivation = false;
    await saveAll();
  }

  // Notes edit
  function startNotes() { draftNotes = notes; editingNotes = true; }
  function cancelNotes() { editingNotes = false; }
  async function commitNotes() {
    notes = draftNotes;
    editingNotes = false;
    await saveAll();
  }

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
        await saveAll();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  const REL_GROUPS: { label: string; type: RelationshipType }[] = [
    { label: 'Story Arcs',  type: 'appears_in' },
    { label: 'Allies',      type: 'allied_with' },
    { label: 'Rivals',      type: 'rivals' },
    { label: 'Mentors',     type: 'mentor_of' },
    { label: 'Locations',   type: 'located_at' },
    { label: 'Key Events',  type: 'takes_place_at' },
  ];

  function getLinked(type: RelationshipType) {
    if (!entityId) return [];
    return $relationships
      .filter((r) => r.type === type && (r.fromId === entityId || r.toId === entityId))
      .map((r) => {
        const linkedId = r.fromId === entityId ? r.toId : r.fromId;
        return $entities.find((e) => e.id === linkedId);
      })
      .filter(Boolean);
  }

  // ── Entity picker ──────────────────────────────────────────────────────────
  const PICKER_TYPES: Record<RelationshipType, EntityType[]> = {
    appears_in:    ['Act', 'Scene', 'Event'],
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
    const linked = new Set(getLinked(relType).map((e) => e?.id));
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
    <div class="add-row">
      <input
        class="add-input"
        placeholder="Character name…"
        bind:value={newName}
        onkeydown={handleAddKeydown}
      />
      {#if addError}<p class="add-error">{addError}</p>{/if}
    </div>

    {#if characters.length === 0}
      <p class="empty">No characters yet.</p>
    {:else}
      <ul class="char-list">
        {#each characters as char}
          {@const d = parseData(char.data)}
          <li>
            <button class="char-row" onclick={() => openEntity(char.id)}>
              <div class="char-avatar">
                {#if d.avatar}
                  <img src={d.avatar} alt={char.name} class="avatar-thumb" />
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
  <div class="char-detail">

    <!-- Avatar + name row -->
    <div class="header">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="avatar-lg"
        onclick={triggerAvatarUpload}
        title="Click to change avatar"
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && triggerAvatarUpload()}
      >
        {#if avatar}
          <img src={avatar} alt={entity.name} class="avatar-lg-img" />
        {:else}
          <span class="avatar-lg-initials">{initials(entity.name)}</span>
        {/if}
        <div class="avatar-overlay">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
          </svg>
        </div>
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
          <InlineEdit value={entity.name} onSave={rename} />
        </h1>
        <div class="header-meta">
          <!-- Role -->
          {#if editingRole}
            <div class="hfield-editing">
              <select class="hfield-select" bind:value={draftRole} onchange={commitRole}>
                {#each ROLE_OPTIONS as opt}
                  <option value={opt.value}>{opt.value || '— none —'}</option>
                {/each}
              </select>
              <button class="hfield-cancel" onclick={cancelRole} title="Cancel">×</button>
            </div>
          {:else}
            <div class="hfield-wrap">
              {#if role}
                <span class="role-badge" style="--rc:{roleColor(role)}">{role}</span>
              {:else}
                <span class="hfield-empty">Role</span>
              {/if}
              <button class="hfield-pencil" onclick={startRole} title="Edit role">
                <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M7.5 1.5 l2 2 -6 6 -2.5 0.5 0.5-2.5 6-6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
                </svg>
              </button>
            </div>
          {/if}
          <!-- Affiliation -->
          {#if editingAffiliation}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="hfield-input"
              bind:value={draftAffiliation}
              onblur={commitAffiliation}
              onkeydown={handleAffiliationKeydown}
              placeholder="Affiliation"
              autofocus
            />
          {:else}
            <div class="hfield-wrap">
              {#if affiliation}
                <span class="hfield-text">{affiliation}</span>
              {:else}
                <span class="hfield-empty">Affiliation</span>
              {/if}
              <button class="hfield-pencil" onclick={startAffiliation} title="Edit affiliation">
                <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M7.5 1.5 l2 2 -6 6 -2.5 0.5 0.5-2.5 6-6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
                </svg>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if saveError}<p class="save-error">{saveError}</p>{/if}

    {#if pickerGroup}
      <div class="picker-backdrop" role="presentation" onclick={() => (pickerGroup = null)} onkeydown={() => (pickerGroup = null)}></div>
    {/if}

    {#each REL_GROUPS as group}
      {@const linked = getLinked(group.type)}
      <section class="rel-group">
        <p class="section-label">{group.label}</p>
        <div class="chip-row">
          {#each linked as e}
            {#if e}
              <EntityLink id={e.id} name={e.name} relationshipType={group.type} />
            {/if}
          {/each}
          <div class="picker-wrap">
            <button
              class="chip-add"
              class:chip-add-open={pickerGroup === group.type}
              onclick={() => (pickerGroup = pickerGroup === group.type ? null : group.type)}
              title="Add {group.label}"
            >+</button>
            {#if pickerGroup === group.type}
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
        {#if color}
          <button class="field-edit-btn" onclick={resetColor} data-testid="char-color-reset">Reset to default</button>
        {/if}
      </div>
      <div class="swatch-row" role="group" aria-label="Timeline color">
        {#each CHARACTER_COLORS as hex}
          <button
            type="button"
            class="swatch"
            class:swatch-selected={color === hex}
            style="--sw:{hex}"
            aria-label={hex}
            aria-pressed={color === hex}
            data-testid="char-color-{hex}"
            onclick={() => chooseColor(hex)}
          ></button>
        {/each}
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
      </div>
      {#if customHexError}
        <p class="hex-error" data-testid="char-color-custom-error">{customHexError}</p>
      {/if}

      <!-- Show on timeline -->
      <div class="field-header">
        <span class="field-label">Show on timeline</span>
      </div>
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

      <div class="field-header">
        <label class="field-label" for="char-motivation">Motivation</label>
        {#if !editingMotivation}
          <button class="field-edit-btn" onclick={startMotivation}>Edit</button>
        {/if}
      </div>
      {#if editingMotivation}
        <textarea
          id="char-motivation"
          class="field-textarea"
          placeholder="What drives this character?"
          bind:value={draftMotivation}
          rows="3"
        ></textarea>
        <div class="field-actions">
          <button class="field-cancel-btn" onclick={cancelMotivation}>Cancel</button>
          <button class="field-save-btn" onclick={commitMotivation}>Save</button>
        </div>
      {:else}
        <p class="field-display" class:field-empty={!motivation}>
          {motivation || 'Not set.'}
        </p>
      {/if}

      <div class="field-header">
        <label class="field-label" for="char-notes">Notes</label>
        {#if !editingNotes}
          <button class="field-edit-btn" onclick={startNotes}>Edit</button>
        {/if}
      </div>
      {#if editingNotes}
        <textarea
          id="char-notes"
          class="field-textarea"
          placeholder="Additional notes…"
          bind:value={draftNotes}
          rows="4"
        ></textarea>
        <div class="field-actions">
          <button class="field-cancel-btn" onclick={cancelNotes}>Cancel</button>
          <button class="field-save-btn" onclick={commitNotes}>Save</button>
        </div>
      {:else}
        <p class="field-display" class:field-empty={!notes}>
          {notes || 'Not set.'}
        </p>
      {/if}

      {#if saveError}<p class="save-error">{saveError}</p>{/if}
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

  .add-row { display: flex; flex-direction: column; gap: 4px; }

  .add-input {
    background: var(--color-surface);
    border: 1px solid var(--color-accent);
    border-radius: 6px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    padding: 6px 10px;
    width: 100%;
    outline: none;
  }

  .add-error { font-size: 10px; color: var(--color-rel-rival); }

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
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-ui);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    letter-spacing: 0.02em;
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
    font-size: 12px;
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
    font-size: 9px;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    white-space: nowrap;
  }

  .char-role-badge {
    display: inline-block;
    font-size: 9px;
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
    font-size: 14px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .empty {
    color: var(--color-text-muted);
    font-size: 12px;
    text-align: center;
    padding: 32px 0;
  }

  /* ── Detail mode ── */
  .char-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .avatar-lg-initials {
    font-size: 16px;
    font-weight: 600;
    font-family: var(--font-ui);
    color: var(--color-accent);
    letter-spacing: 0.02em;
    pointer-events: none;
  }

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
    font-size: 18px;
    font-weight: 400;
    color: var(--color-text);
  }

  .role-badge {
    display: inline-block;
    font-size: 10px;
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

  .hfield-wrap {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .hfield-pencil {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 2px;
    border-radius: 3px;
    color: var(--color-text-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s;
    flex-shrink: 0;
  }
  .hfield-wrap:hover .hfield-pencil,
  .hfield-pencil:focus {
    opacity: 1;
  }
  .hfield-pencil:hover {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }

  .hfield-empty {
    font-size: 10px;
    color: var(--color-text-muted);
    font-style: italic;
    font-family: var(--font-ui);
  }

  .hfield-text {
    font-size: 11px;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
  }

  .hfield-editing {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .hfield-select {
    background: var(--color-surface-2);
    border: 1px solid var(--color-accent);
    border-radius: 5px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 2px 6px;
    outline: none;
    cursor: pointer;
  }

  .hfield-cancel {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 13px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }
  .hfield-cancel:hover { color: var(--color-rel-rival); }

  .hfield-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-accent);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 11px;
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
    font-size: 9px;
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
    font-size: 13px;
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
    font-size: 12px;
    color: var(--color-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-type {
    font-size: 9px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  .picker-empty {
    font-size: 11px;
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
    font-size: 9px;
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
    font-size: 10px;
    font-family: var(--font-ui);
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 1px 6px;
    border-radius: 4px;
  }
  .field-edit-btn:hover { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 10%, transparent); }

  .field-display {
    font-size: 12px;
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
    font-size: 12px;
    line-height: 1.5;
    padding: 6px 10px;
    width: 100%;
    resize: none;
    outline: none;
  }
  .field-textarea:focus { outline: 2px solid var(--color-accent); outline-offset: 0; border-color: var(--color-accent); }

  .field-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .field-cancel-btn {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    cursor: pointer;
  }
  .field-cancel-btn:hover { border-color: var(--color-text-muted); color: var(--color-text); }
  .field-save-btn {
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
    color: var(--color-surface);
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 5px;
    cursor: pointer;
  }
  .field-save-btn:hover { opacity: 0.85; }

  .save-error { color: var(--color-rel-rival); font-size: 11px; }
  .muted { color: var(--color-text-muted); font-size: 12px; }
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
    font-size: 11px;
    padding: 3px 6px;
    width: 80px;
    outline: none;
  }
  .hex-input:focus { border-color: var(--color-accent); }
  .hex-error {
    color: var(--color-rel-rival);
    font-size: 10px;
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
    font-size: 11px;
    color: var(--color-text);
    font-family: var(--font-ui);
  }
  .custom-field-input {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 5px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 3px 8px;
    margin-left: 22px;
    margin-top: 2px;
    outline: none;
    width: 200px;
  }
  .custom-field-input:focus { border-color: var(--color-accent); }
</style>
