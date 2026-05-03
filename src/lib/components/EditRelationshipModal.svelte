<script lang="ts">
  import type { Relationship } from '$lib/stores/relationships.js';
  import type { RelationshipType } from '$lib/server/db/schema.js';
  import { REL_TYPES } from '$lib/relationship-colors.js';

  interface Act {
    id: string;
    name: string;
    position: number | null;
  }

  interface Props {
    relationship: Relationship;
    acts: Act[];
    onSave: (fields: {
      type: RelationshipType;
      label: string | null;
      startActId: string | null;
      endActId: string | null;
      revealedAtPosition: number | null;
    }) => Promise<void>;
    onClose: () => void;
  }

  let { relationship, acts, onSave, onClose }: Props = $props();

  // Match start/end act by position — the store type carries positions, not FK ids.
  // $effect initializes on mount and re-syncs if the relationship prop changes.
  let editType = $state<RelationshipType>('allied_with');
  let editLabel = $state('');
  let editStartActId = $state('');
  let editEndActId = $state('');
  let editRevealedAtPosition = $state<number | null>(null);

  $effect(() => {
    editType = relationship.type;
    editLabel = relationship.label ?? '';
    editStartActId = acts.find((a) => a.position === relationship.startPosition)?.id ?? '';
    editEndActId = acts.find((a) => a.position === relationship.endPosition)?.id ?? '';
    editRevealedAtPosition = relationship.revealedAtPosition;
  });
  let saving = $state(false);
  let saveError = $state('');

  async function handleSave() {
    if ((editStartActId && !editEndActId) || (!editStartActId && editEndActId)) {
      saveError = 'Set both a start and end act, or neither.';
      return;
    }
    saving = true;
    saveError = '';
    try {
      await onSave({
        type: editType,
        label: editLabel.trim() || null,
        startActId: editStartActId || null,
        endActId: editEndActId || null,
        revealedAtPosition: editRevealedAtPosition
      });
    } catch (err) {
      saveError = (err as Error)?.message ?? 'Save failed';
    } finally {
      saving = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !saving) onClose();
    if (e.key === 'Enter' && !e.shiftKey) handleSave();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="backdrop" onclick={onClose} role="presentation"></div>

<div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-rel-title">
  <h2 class="modal-title" id="edit-rel-title">Edit relationship</h2>

  <div class="field-row">
    <label for="edit-rel-type">Type</label>
    <select id="edit-rel-type" bind:value={editType}>
      {#each REL_TYPES as t}
        <option value={t}>{t.replace(/_/g, ' ')}</option>
      {/each}
    </select>
  </div>

  <div class="field-row">
    <label for="edit-rel-label">Label</label>
    <input
      id="edit-rel-label"
      type="text"
      placeholder="Optional"
      bind:value={editLabel}
      autocomplete="off"
    />
  </div>

  {#if acts.length > 0}
    <div class="field-row">
      <label for="edit-rel-start">Starts</label>
      <select id="edit-rel-start" bind:value={editStartActId}>
        <option value="">Any time</option>
        {#each acts as act}
          <option value={act.id}>{act.name}</option>
        {/each}
      </select>
    </div>

    <div class="field-row">
      <label for="edit-rel-end">Ends</label>
      <select id="edit-rel-end" bind:value={editEndActId}>
        <option value="">Forever</option>
        {#each acts as act}
          <option value={act.id}>{act.name}</option>
        {/each}
      </select>
    </div>

    <div class="field-row">
      <label for="edit-rel-reveal">Revealed at</label>
      <select
        id="edit-rel-reveal"
        value={editRevealedAtPosition}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          editRevealedAtPosition = v ? Number(v) : null;
        }}
      >
        <option value="">Always visible</option>
        {#each acts as act}
          <option value={act.position}>{act.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if saveError}
    <p class="error" role="alert">{saveError}</p>
  {/if}

  <div class="actions">
    <button onclick={onClose} disabled={saving}>Cancel</button>
    <button class="primary" onclick={handleSave} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 100;
    cursor: pointer;
  }

  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 101;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    padding: 22px 24px;
    width: min(380px, calc(100vw - 48px));
    color: var(--color-text);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .modal-title {
    margin: 0;
    font-family: var(--font-display, var(--font-ui));
    font-size: 17px;
    font-weight: 500;
    color: var(--color-text);
  }

  .field-row {
    display: grid;
    grid-template-columns: 90px 1fr;
    align-items: center;
    gap: 8px;
  }

  .field-row label {
    font-size: 12px;
    color: var(--color-text-muted);
    text-align: right;
  }

  .field-row select,
  .field-row input {
    background: var(--color-surface-2, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 4px 8px;
    width: 100%;
  }

  .error {
    margin: 0;
    font-size: 12px;
    color: var(--color-rel-rival, #ef4444);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .actions button {
    padding: 6px 14px;
    border-radius: 5px;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 13px;
    cursor: pointer;
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions button.primary {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: #fff;
  }
</style>
