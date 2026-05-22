<!--
  EntityLink — clickable chip referring to another entity.

  By default the chip click calls openEntity(id), which spawns a new
  entity-detail window per ENTITY_APP routing. When rendered inside a
  component subtree that provides the WIKI_NAV context (currently:
  Wiki.svelte's content pane), the click instead calls navigate(id) to
  swap the host's content area in-window — Wikipedia-style. See
  src/lib/contexts/wiki-nav.ts for the full ambient-hijack contract.

  Before navigating (either path), drainPendingCommit() awaits any
  in-flight EditableField textarea drafts so a click during edit can't
  PATCH against a stale entity reference (slice 7 commit 1 fix).
-->

<script lang="ts">
  import { getContext } from 'svelte';
  import { openEntity } from '$lib/navigation.js';
  import { WIKI_NAV, type WikiNavContext } from '$lib/contexts/wiki-nav.js';
  import { drainPendingCommit } from '$lib/util/pending-commit.js';
  import type { RelationshipType } from '$lib/server/db/schema.js';

  interface Props {
    id: string;
    name: string;
    relationshipType?: RelationshipType | 'arc';
    /** When provided, renders a × button inside the chip's right edge.
     *  Caller is responsible for the actual delete (e.g. calling
     *  relationships.deleteRelationship). */
    onRemove?: () => void;
  }

  let { id, name, relationshipType = 'other', onRemove }: Props = $props();

  // Record<RelationshipType | 'arc', string> forces an exhaustiveness
  // check at compile time so the next enum trim breaks this file until
  // the contributor updates it (rather than silently leaving orphan
  // keys behind, the way appears_in + mentor_of did pre-Step-5.5).
  const COLOR_MAP: Record<RelationshipType | 'arc', string> = {
    takes_place_at:'var(--color-rel-loc)',
    caused_by:     'var(--color-rel-event)',
    allied_with:   'var(--color-rel-ally)',
    rivals:        'var(--color-rel-rival)',
    located_at:    'var(--color-rel-loc)',
    note_of:       'var(--color-type-note)',
    part_of:       'var(--color-rel-loc)',
    other:         'var(--color-rel-other)',
    arc:           'var(--color-rel-arc)',
  };

  const chipColor = $derived(COLOR_MAP[relationshipType] ?? 'var(--color-rel-other)');

  // Pulled at component construction. Svelte 5 context follows the
  // component tree, so a chip rendered inside Wiki.svelte's subtree gets
  // the in-window navigate; one rendered in a popout window or any other
  // subtree gets undefined and falls back to openEntity.
  const wikiNav = getContext<WikiNavContext | undefined>(WIKI_NAV);

  async function handleClick() {
    // Drain any in-flight textarea draft before swapping context.
    // Without this, the navigate-then-blur sequence runs commit AFTER
    // the EntityDetail unmounts and the PATCH targets the wrong entity.
    await drainPendingCommit();
    if (wikiNav) wikiNav.navigate(id);
    else openEntity(id);
  }
</script>

<span class="entity-chip" style="--chip-color: {chipColor}">
  <button
    type="button"
    class="entity-chip-name"
    onclick={handleClick}
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
