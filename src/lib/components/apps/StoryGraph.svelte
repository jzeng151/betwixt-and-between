<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import EntityLink from '$lib/components/EntityLink.svelte';

  const entityList = $derived($entities.filter((e) => e.type !== 'Note'));
</script>

<div class="story-graph">
  {#if entityList.length === 0}
    <div class="empty-state">
      <p>No characters yet. Create one in Characters — it will appear here automatically.</p>
      <div class="ghost-nodes">
        <span class="ghost-node">Character</span>
        <span class="ghost-arrow">──</span>
        <span class="ghost-node">Location</span>
      </div>
    </div>
  {:else}
    <div class="graph-placeholder">
      <p class="hint">Story Graph (tldraw canvas — Phase 3)</p>
      <div class="entity-list">
        {#each entityList as e}
          <EntityLink id={e.id} name={e.name} />
        {/each}
      </div>
      <div class="rel-list">
        {#each $relationships as rel}
          {@const from = $entities.find((e) => e.id === rel.fromId)}
          {@const to = $entities.find((e) => e.id === rel.toId)}
          {#if from && to}
            <p class="rel-row">
              <span>{from.name}</span>
              <span class="rel-label">— {rel.type} →</span>
              <span>{to.name}</span>
            </p>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .story-graph {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--color-text-muted);
    font-size: 12px;
    text-align: center;
  }

  .ghost-nodes {
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0.3;
  }

  .ghost-node {
    border: 1px dashed var(--color-border);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .ghost-arrow {
    color: var(--color-border);
    font-size: 10px;
  }

  .graph-placeholder {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .hint {
    font-size: 10px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .entity-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .rel-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .rel-row {
    font-size: 11px;
    color: var(--color-text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .rel-label {
    color: var(--color-accent);
    font-size: 10px;
  }
</style>
