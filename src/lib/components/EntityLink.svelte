<script lang="ts">
  import { openEntity } from '$lib/navigation.js';
  import type { RelationshipType } from '$lib/server/db/schema.js';

  interface Props {
    id: string;
    name: string;
    relationshipType?: RelationshipType | 'arc' | 'other';
  }

  let { id, name, relationshipType = 'other' }: Props = $props();

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

<button
  class="entity-chip"
  style="--chip-color: {chipColor}"
  onclick={() => openEntity(id)}
  tabindex="0"
>
  {name}
</button>
