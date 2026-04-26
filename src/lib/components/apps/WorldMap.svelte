<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import EntityLink from '$lib/components/EntityLink.svelte';
  import InlineEdit from '$lib/components/InlineEdit.svelte';
  import { onMount } from 'svelte';

  interface Props { entityId: string | null; }
  let { entityId }: Props = $props();

  const locations = $derived($entities.filter((e) => e.type === 'Location'));

  function linkedChips(locId: string) {
    return $relationships
      .filter((r) => r.fromId === locId || r.toId === locId)
      .map((r) => {
        const linkedId = r.fromId === locId ? r.toId : r.fromId;
        return { entity: $entities.find((e) => e.id === linkedId), rel: r };
      })
      .filter((x) => x.entity);
  }

  let saveError = $state('');

  async function createLocation() {
    saveError = '';
    try {
      await entities.createEntity('Location', 'New Location');
    } catch {
      saveError = "Couldn't create location.";
    }
  }

  async function renameLocation(id: string, newName: string) {
    try {
      await entities.updateEntity(id, { name: newName });
    } catch {
      saveError = "Couldn't rename.";
    }
  }

  let el: HTMLElement | undefined;
  onMount(() => {
    if (entityId && el) {
      const target = el.querySelector(`[data-id="${entityId}"]`);
      target?.scrollIntoView({ block: 'center' });
    }
  });
</script>

<div class="world-map" bind:this={el}>
  {#if locations.length === 0}
    <div class="empty-state">
      <p>No locations yet. Add a location to place your story.</p>
      <button class="action-btn" onclick={createLocation}>+ Add Location</button>
      {#if saveError}<p class="save-error">{saveError}</p>{/if}
    </div>
  {:else}
    <div class="actions-row">
      <button class="action-btn small" onclick={createLocation}>+ Add Location</button>
    </div>
    {#each locations as loc}
      {@const chips = linkedChips(loc.id)}
      <div class="loc-card" data-id={loc.id} class:focus={loc.id === entityId}>
        <h3 class="loc-name">
          <InlineEdit value={loc.name} onSave={(n) => renameLocation(loc.id, n)} />
        </h3>
        {#if chips.length > 0}
          <div class="chip-row">
            {#each chips as { entity, rel }}
              {#if entity}
                <EntityLink id={entity.id} name={entity.name} relationshipType={rel.type} />
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .world-map {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 0;
    color: var(--color-text-muted);
    font-size: 12px;
    text-align: center;
  }

  .actions-row {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
  }

  .loc-card {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.15s;
  }

  .loc-card.focus {
    border-color: var(--color-accent);
  }

  .loc-name {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 400;
    color: var(--color-text);
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
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

  .action-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
  .action-btn.small { padding: 4px 10px; font-size: 10px; }

  .save-error { color: var(--color-rel-rival); font-size: 11px; }
</style>
