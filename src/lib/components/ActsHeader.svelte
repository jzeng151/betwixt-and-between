<!--
  ActsHeader — acts header row + scenes row for TimelineV2.

  Renders act names, scene counts, and the dotted-ellipsis "act-level only"
  placeholder for acts without scenes broken out.
-->

<script lang="ts">
  import type { Entity } from '$lib/stores/entities.js';

  interface Props {
    acts: Entity[];
    scenesByActId: Map<string, Entity[]>;
  }
  let { acts, scenesByActId }: Props = $props();
</script>

<!-- Acts header -->
<div class="acts-header">
  {#each acts as act (act.id)}
    <div class="act-col-header" style="flex: 1;">
      <div class="act-name">{act.name}</div>
      <div class="act-meta">
        {#if (scenesByActId.get(act.id)?.length ?? 0) > 0}
          {scenesByActId.get(act.id)!.length} scenes
        {:else}
          act-level only
        {/if}
      </div>
    </div>
  {/each}
  {#if acts.length === 0}
    <div class="acts-empty">No acts yet. Add an Act to begin your story.</div>
  {/if}
</div>

<!-- Scenes row -->
{#if acts.length > 0}
  <div class="scenes-row">
    {#each acts as act (act.id)}
      <div class="scenes-act">
        {#if (scenesByActId.get(act.id)?.length ?? 0) > 0}
          {#each scenesByActId.get(act.id)! as scene, k (scene.id)}
            <div class="scene-cell" title={scene.name}>s{k}</div>
          {/each}
        {:else}
          <div class="scenes-act-empty">· · · · ·</div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .acts-header {
    display: flex;
    height: 56px;
    background: var(--color-surface-2, #1c1f28);
    border-bottom: 1px solid var(--color-border, #2a2d35);
  }
  .act-col-header {
    border-right: 1px solid var(--color-border, #2a2d35);
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }
  .act-col-header:last-child {
    border-right: none;
  }
  .act-name {
    font-family: var(--font-display, 'Fraunces', Georgia, serif);
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text, #e8e0d0);
  }
  .act-meta {
    font-size: 10px;
    color: var(--color-text-muted, #6b7280);
  }
  .acts-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--color-text-muted, #6b7280);
    font-style: italic;
  }

  .scenes-row {
    display: flex;
    height: 24px;
    background: var(--color-desktop, #0d0f14);
    border-bottom: 1px solid var(--color-border, #2a2d35);
  }
  .scenes-act {
    flex: 1;
    border-right: 1px solid var(--color-border, #2a2d35);
    display: flex;
  }
  .scenes-act:last-child {
    border-right: none;
  }
  .scene-cell {
    flex: 1;
    border-right: 1px dashed rgba(42, 45, 53, 0.6);
    font-size: 9px;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scene-cell:last-child {
    border-right: none;
  }
  .scenes-act-empty {
    flex: 1;
    font-size: 9px;
    color: var(--color-text-muted, #6b7280);
    font-style: italic;
    opacity: 0.5;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
