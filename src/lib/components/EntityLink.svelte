<script lang="ts">
  import { openEntity } from '$lib/navigation.js';
  import type { RelationshipType } from '$lib/server/db/schema.js';

  interface Props {
    id: string;
    name: string;
    relationshipType?: RelationshipType | 'arc' | 'other';
    /** When provided, renders a × button inside the chip's right edge.
     *  Caller is responsible for the actual delete (e.g. calling
     *  relationships.deleteRelationship). */
    onRemove?: () => void;
  }

  let { id, name, relationshipType = 'other', onRemove }: Props = $props();

  const COLOR_MAP: Record<string, string> = {
    appears_in:    'var(--color-rel-arc)',
    takes_place_at:'var(--color-rel-loc)',
    caused_by:     'var(--color-rel-event)',
    allied_with:   'var(--color-rel-ally)',
    rivals:        'var(--color-rel-rival)',
    mentor_of:     'var(--color-rel-mentor)',
    located_at:    'var(--color-rel-loc)',
    arc:           'var(--color-rel-arc)',
    other:         'var(--color-rel-other)',
  };

  const chipColor = $derived(COLOR_MAP[relationshipType] ?? 'var(--color-rel-other)');
</script>

<span class="entity-chip" style="--chip-color: {chipColor}">
  <button
    type="button"
    class="entity-chip-name"
    onclick={() => openEntity(id)}
    tabindex="0"
  >{name}</button>
  {#if onRemove}
    <button
      type="button"
      class="entity-chip-remove"
      aria-label="Remove {name}"
      title="Remove"
      onclick={onRemove}
    >×</button>
  {/if}
</span>
