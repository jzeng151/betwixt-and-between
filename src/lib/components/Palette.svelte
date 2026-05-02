<!--
  Palette — left sidebar for TimelineV2.

  Renders Characters and Events sections as draggable chips matching the
  locked v2 mockup. Drag uses HTML5 DnD with a custom MIME so V1 Timeline
  ignores our drags and we ignore V1's. Already-placed entities (those with
  any existing interval) get a `.placed` greyed treatment so the writer can
  see at a glance who's still missing from the timeline.
-->

<script lang="ts">
  import type { Entity } from '$lib/stores/entities.js';

  interface Props {
    characters: Entity[];
    events: Entity[];
    /** Set of entity ids that already have ≥1 interval on the timeline. */
    placedEntityIds: Set<string>;
    colorFor: (entity: Entity, idx: number) => string;
    /** Create handler — parent creates the event with a default name and
     *  opens the editor. Returns when the create round-trip completes. */
    onCreateEvent: () => Promise<void>;
  }
  let { characters, events, placedEntityIds, colorFor, onCreateEvent }: Props = $props();

  function setDragData(e: DragEvent, id: string) {
    // Custom MIME so V1 Timeline's text/plain drop handlers ignore our drags.
    // text/plain stays for browser DnD compat.
    e.dataTransfer!.setData('application/x-betwixt-v2-entity', id);
    e.dataTransfer!.setData('text/plain', id);
    e.dataTransfer!.effectAllowed = 'copy';
  }

  let savingEvent = $state(false);
  async function addEventClick() {
    if (savingEvent) return;
    savingEvent = true;
    try {
      await onCreateEvent();
    } finally {
      savingEvent = false;
    }
  }
</script>

<aside class="palette" aria-label="Timeline palette">
  <section class="palette-section">
    <header class="palette-label">
      <span>Characters</span>
      <span class="palette-filter" aria-hidden="true">all ▾</span>
    </header>
    {#each characters as char, i (char.id)}
      <div
        class="palette-item"
        class:placed={placedEntityIds.has(char.id)}
        data-entity-id={char.id}
        draggable="true"
        role="button"
        tabindex="0"
        aria-label="Drag {char.name} onto timeline"
        ondragstart={(e) => setDragData(e, char.id)}
      >
        <span class="palette-dot" style="background: {colorFor(char, i)}" aria-hidden="true"></span>
        <span class="palette-name">{char.name}</span>
        <span class="palette-grip" aria-hidden="true">⋮⋮</span>
      </div>
    {/each}
    {#if characters.length === 0}
      <div class="palette-empty">No characters yet.</div>
    {/if}
  </section>

  <section class="palette-section">
    <header class="palette-label">
      <span>Events</span>
      <button
        class="palette-add-btn"
        aria-label="Add event"
        title="Add event"
        disabled={savingEvent}
        onclick={addEventClick}
      >+</button>
    </header>
    {#each events as ev, i (ev.id)}
      <div
        class="palette-item"
        class:placed={placedEntityIds.has(ev.id)}
        data-entity-id={ev.id}
        draggable="true"
        role="button"
        tabindex="0"
        aria-label="Drag {ev.name} onto timeline"
        ondragstart={(e) => setDragData(e, ev.id)}
      >
        <span class="palette-dot" style="background: {colorFor(ev, i)}" aria-hidden="true"></span>
        <span class="palette-name">{ev.name}</span>
        <span class="palette-grip" aria-hidden="true">⋮⋮</span>
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
    display: flex;
    flex-direction: column;
  }
  .palette-section {
    padding: 18px 16px 12px;
    border-bottom: 1px solid var(--color-border, #2a2d35);
  }
  .palette-section:last-child {
    border-bottom: none;
  }
  .palette-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .palette-filter {
    font-size: 10px;
    color: var(--color-text-muted, #6b7280);
    text-transform: none;
    letter-spacing: 0;
    cursor: default;
    /* Cosmetic placeholder — actual filter behavior is deferred per
       CONSIDERATIONS.md "Open Decisions". */
  }
  .palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 6px;
    margin-bottom: 4px;
    cursor: grab;
    transition: background 0.15s ease, opacity 0.15s ease;
  }
  .palette-item:active {
    cursor: grabbing;
  }
  .palette-item:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  /* Already-placed entities get a subtle greyed treatment so the writer can
     see who's still missing from the timeline at a glance. They remain
     draggable (per the locked design — drag-again creates a gap). */
  .palette-item.placed {
    opacity: 0.55;
  }
  .palette-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .palette-name {
    flex: 1;
    font-family: var(--font-display, 'Fraunces', Georgia, serif);
    font-size: 15px;
    font-weight: 400;
    color: var(--color-text, #e8e0d0);
  }
  .palette-grip {
    color: var(--color-text-muted, #6b7280);
    font-size: 15px;
    line-height: 1;
    letter-spacing: -1px;
    user-select: none;
  }
  .palette-empty {
    font-size: 12px;
    color: var(--color-text-muted, #6b7280);
    font-style: italic;
    padding: 4px 10px;
  }
  .palette-add-btn {
    background: transparent;
    border: 1px solid var(--color-border, #2a2d35);
    color: var(--color-text-muted, #6b7280);
    border-radius: 4px;
    width: 18px;
    height: 18px;
    line-height: 1;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .palette-add-btn:hover {
    color: var(--color-accent, #c8942a);
    border-color: var(--color-accent, #c8942a);
    background: rgba(200, 148, 42, 0.08);
  }
  .palette-add-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
