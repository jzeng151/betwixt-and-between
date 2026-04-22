<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import EntityLink from '$lib/components/EntityLink.svelte';
  import { onMount } from 'svelte';

  interface Props { entityId: string | null; }
  let { entityId }: Props = $props();

  const timelineEntities = $derived(
    $entities
      .filter((e) => e.type === 'Act' || e.type === 'Scene' || e.type === 'Event')
      .sort((a, b) => {
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt);
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : Number(b.createdAt);
        return ta - tb;
      })
  );

  let expanded = $state<Set<string>>(new Set());

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function linkedChips(entityId: string) {
    return $relationships
      .filter((r) => r.fromId === entityId || r.toId === entityId)
      .map((r) => {
        const linkedId = r.fromId === entityId ? r.toId : r.fromId;
        return { entity: $entities.find((e) => e.id === linkedId), rel: r };
      })
      .filter((x) => x.entity);
  }

  let saveError = $state('');

  async function createAct() {
    saveError = '';
    try {
      await entities.createEntity('Act', 'New Act');
    } catch {
      saveError = 'Timeline failed to load.';
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

<div class="timeline" bind:this={el}>
  {#if timelineEntities.length === 0}
    <div class="empty-state">
      <p>No events yet. Add an Act or Event to begin your story.</p>
      <button class="action-btn" onclick={createAct}>+ Add Act</button>
      {#if saveError}<p class="save-error">{saveError}</p>{/if}
    </div>
  {:else}
    <div class="actions-row">
      <button class="action-btn small" onclick={createAct}>+ Add Act</button>
    </div>
    {#each timelineEntities as item}
      <div class="timeline-row" data-id={item.id} class:focus={item.id === entityId}>
        <div class="row-header">
          <button
            class="expand-btn"
            onclick={() => toggle(item.id)}
            aria-expanded={expanded.has(item.id)}
          >
            {#if item.type !== 'Event'}
              {expanded.has(item.id) ? '▼' : '▶'}
            {:else}
              •
            {/if}
          </button>
          <div class="row-info">
            <span class="row-name">{item.name}</span>
            <span class="row-type">{item.type}</span>
          </div>
        </div>

        {#if expanded.has(item.id)}
          <div class="row-chips">
            {#each linkedChips(item.id) as { entity, rel }}
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
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 8px;
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

  .timeline-row {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.15s;
  }

  .timeline-row.focus {
    border-color: var(--color-accent);
  }

  .row-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .expand-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 10px;
    cursor: pointer;
    width: 16px;
    flex-shrink: 0;
    padding: 0;
  }

  .row-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .row-name {
    font-family: var(--font-display);
    font-size: 14px;
    color: var(--color-text);
  }

  .row-type {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
  }

  .row-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding-left: 24px;
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
