<!--
  Palette — left sidebar for TimelineV2.

  Renders Characters and Events sections with a color dot + name per item.
  No drag behavior yet (placeholder cursor only); subsequent commits add
  svelte-dnd-action.
-->

<script lang="ts">
  import type { Entity } from '$lib/stores/entities.js';

  interface Props {
    characters: Entity[];
    events: Entity[];
    colorFor: (entity: Entity, idx: number) => string;
  }
  let { characters, events, colorFor }: Props = $props();
</script>

<aside class="palette" aria-label="Timeline palette">
  <section class="palette-section">
    <header class="palette-label">Characters</header>
    {#each characters as char, i (char.id)}
      <div
        class="palette-item"
        data-entity-id={char.id}
        draggable="true"
        role="button"
        tabindex="0"
        aria-label="Drag {char.name} onto timeline"
        ondragstart={(e) => {
          e.dataTransfer!.setData('application/x-betwixt-v2-entity', char.id);
          e.dataTransfer!.setData('text/plain', char.id);
          e.dataTransfer!.effectAllowed = 'copy';
        }}
      >
        <span
          class="palette-dot"
          style="background: {colorFor(char, i)}"
          aria-hidden="true"
        ></span>
        <span class="palette-name">{char.name}</span>
      </div>
    {/each}
    {#if characters.length === 0}
      <div class="palette-empty">No characters yet.</div>
    {/if}
  </section>

  <section class="palette-section">
    <header class="palette-label">Events</header>
    {#each events as ev, i (ev.id)}
      <div
        class="palette-item"
        data-entity-id={ev.id}
        draggable="true"
        role="button"
        tabindex="0"
        aria-label="Drag {ev.name} onto timeline"
        ondragstart={(e) => {
          e.dataTransfer!.setData('application/x-betwixt-v2-entity', ev.id);
          e.dataTransfer!.setData('text/plain', ev.id);
          e.dataTransfer!.effectAllowed = 'copy';
        }}
      >
        <span class="palette-dot" style="background: {colorFor(ev, i)}" aria-hidden="true"></span>
        <span class="palette-name">{ev.name}</span>
      </div>
    {/each}
    {#if events.length === 0}
      <div class="palette-empty">No events yet.</div>
    {/if}
  </section>
</aside>

<style>
  .palette {
    width: 240px;
    flex-shrink: 0;
    background: var(--color-surface-2, #1c1f28);
    border-right: 1px solid var(--color-border, #2a2d35);
    overflow-y: auto;
  }
  .palette-section {
    padding: 18px 16px 12px;
    border-bottom: 1px solid var(--color-border, #2a2d35);
  }
  .palette-section:last-child {
    border-bottom: none;
  }
  .palette-label {
    font-size: 9px;
    font-weight: 600;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 10px;
  }
  .palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 6px;
    margin-bottom: 4px;
    cursor: grab;
    transition: background 0.15s ease;
  }
  .palette-item:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .palette-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .palette-name {
    font-family: var(--font-display, 'Fraunces', Georgia, serif);
    font-size: 14px;
    font-weight: 400;
  }
  .palette-empty {
    font-size: 11px;
    color: var(--color-text-muted, #6b7280);
    font-style: italic;
    padding: 4px 10px;
  }
</style>
