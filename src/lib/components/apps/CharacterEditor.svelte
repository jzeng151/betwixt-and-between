<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { windowStore } from '$lib/stores/windows.js';
  import EntityLink from '$lib/components/EntityLink.svelte';
  import type { RelationshipType } from '$lib/server/db/schema.js';

  interface Props { winId: string; entityId: string | null; }
  let { winId, entityId }: Props = $props();

  // When opened from the dock with no entity, track local creation
  let newName = $state('');
  let creating = $state(false);
  let createError = $state('');

  async function createCharacter() {
    if (!newName.trim()) return;
    creating = true;
    createError = '';
    try {
      const created = await entities.createEntity('Character', newName.trim());
      windowStore.setEntityId(winId, created.id);
    } catch {
      createError = "Couldn't create character. Try again.";
    } finally {
      creating = false;
    }
  }

  function handleCreateKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') createCharacter();
  }

  const entity = $derived($entities.find((e) => e.id === entityId));

  type RelGroup = { label: string; type: RelationshipType };

  const REL_GROUPS: RelGroup[] = [
    { label: 'STORY ARCS',  type: 'appears_in' },
    { label: 'ALLIES',      type: 'allied_with' },
    { label: 'RIVALS',      type: 'rivals' },
    { label: 'MENTORS',     type: 'mentor_of' },
    { label: 'LOCATIONS',   type: 'located_at' },
    { label: 'KEY EVENTS',  type: 'takes_place_at' },
  ];

  function getLinkedEntities(type: RelationshipType) {
    if (!entityId) return [];
    return $relationships
      .filter((r) => r.type === type && (r.fromId === entityId || r.toId === entityId))
      .map((r) => {
        const linkedId = r.fromId === entityId ? r.toId : r.fromId;
        return $entities.find((e) => e.id === linkedId);
      })
      .filter(Boolean);
  }

  let detailsOpen = $state(false);
  let saveError = $state('');
  let name = $state('');

  $effect(() => {
    if (entity) name = entity.name;
  });

  async function save() {
    if (!entityId || !name.trim()) return;
    saveError = '';
    try {
      await entities.updateEntity(entityId, { name });
    } catch {
      saveError = "Couldn't save. Try again.";
    }
  }
</script>

{#if !entityId}
  <div class="create-state">
    <p class="create-heading">New Character</p>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="field-input"
      placeholder="Character name…"
      bind:value={newName}
      onkeydown={handleCreateKeydown}
      autofocus
    />
    {#if createError}<p class="save-error">{createError}</p>{/if}
    <button class="create-btn" onclick={createCharacter} disabled={creating || !newName.trim()}>
      {creating ? 'Creating…' : 'Create Character'}
    </button>
  </div>
{:else if !entity}
  <p class="muted center">Loading…</p>
{:else}
  <div class="char-editor">
    <div class="header">
      <h1 class="entity-name">{entity.name}</h1>
      <span class="type-badge">{entity.type}</span>
    </div>

    {#each REL_GROUPS as group}
      {@const linked = getLinkedEntities(group.type)}
      {#if linked.length > 0}
        <section class="rel-group">
          <p class="section-label">{group.label}</p>
          <div class="chip-row">
            {#each linked as e}
              {#if e}
                <EntityLink id={e.id} name={e.name} relationshipType={group.type} />
              {/if}
            {/each}
          </div>
        </section>
      {/if}
    {/each}

    <hr class="divider" />

    <button class="disclosure" onclick={() => (detailsOpen = !detailsOpen)}>
      {detailsOpen ? '▲' : '▼'} Details
    </button>

    {#if detailsOpen}
      <div class="details">
        <label class="field-label" for="char-name">Name</label>
        <input
          id="char-name"
          class="field-input"
          bind:value={name}
          onblur={save}
        />
        {#if saveError}
          <p class="save-error">{saveError}</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .char-editor {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }

  .entity-name {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 400;
    color: var(--color-text);
  }

  .type-badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    border-radius: 10px;
    padding: 2px 8px;
  }

  .rel-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    gap: 6px;
    align-items: center;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--color-border);
  }

  .disclosure {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 11px;
    font-family: var(--font-ui);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  .disclosure:hover {
    color: var(--color-text);
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  .field-input {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 12px;
    padding: 6px 10px;
    width: 100%;
  }

  .field-input:focus {
    outline: 2px solid var(--color-accent);
    outline-offset: 0;
    border-color: var(--color-accent);
  }

  .save-error {
    color: var(--color-rel-rival);
    font-size: 11px;
  }

  .create-state {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 0;
  }

  .create-heading {
    font-family: var(--font-display);
    font-size: 16px;
    color: var(--color-text);
  }

  .create-btn {
    background: var(--color-accent);
    border: none;
    border-radius: 6px;
    color: var(--color-surface);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 600;
    padding: 8px 16px;
    cursor: pointer;
    transition: opacity 0.12s;
    align-self: flex-start;
  }

  .create-btn:hover { opacity: 0.85; }
  .create-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .muted {
    color: var(--color-text-muted);
    font-size: 12px;
  }

  .center {
    text-align: center;
    padding: 40px 0;
  }
</style>
