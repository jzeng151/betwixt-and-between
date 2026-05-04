<script lang="ts">
  interface Entity {
    id: string;
    type: string;
    name: string;
  }

  interface Act {
    id: string;
    name: string;
    position: number | null;
  }

  interface Scene {
    id: string;
    name: string;
    actId: string;
    position: number;
  }

  interface Props {
    /** The entity being registered as an alias (right-clicked node). */
    entity: Entity;
    allEntities: Entity[];
    acts: Act[];
    scenes?: Scene[];
    onSave: (primaryEntityId: string, revealedAtPosition: number | null) => Promise<void>;
    onClose: () => void;
  }

  let { entity, allEntities, acts, scenes = [], onSave, onClose }: Props = $props();

  // Same-type candidates, excluding the entity itself and any already-alias pairs
  // (server enforces uniqueness; modal just shows the sensible picker)
  const candidates = $derived(
    allEntities.filter((e) => e.id !== entity.id && e.type === entity.type)
  );

  let selectedPrimaryId = $state('');
  let selectedRevealedAtPosition = $state<number | null>(null);
  let saving = $state(false);
  let saveError = $state('');

  async function handleSave() {
    if (!selectedPrimaryId) {
      saveError = 'Pick the primary entity.';
      return;
    }
    saving = true;
    saveError = '';
    try {
      await onSave(selectedPrimaryId, selectedRevealedAtPosition);
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Save failed';
      saveError = msg.includes('409') || msg.includes('already')
        ? 'This alias relationship already exists.'
        : msg.includes('422') || msg.includes('type')
          ? 'Both entities must be the same type.'
          : msg;
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

<div class="modal" role="dialog" aria-modal="true" aria-labelledby="alias-modal-title">
  <h2 class="modal-title" id="alias-modal-title">
    Mark <em>{entity.name}</em> as alias of…
  </h2>

  {#if candidates.length === 0}
    <p class="empty">No other {entity.type.toLowerCase()} entities exist to alias with.</p>
  {:else}
    <div class="field-row">
      <label for="alias-primary">Primary</label>
      <select id="alias-primary" bind:value={selectedPrimaryId}>
        <option value="">Pick {entity.type.toLowerCase()}…</option>
        {#each candidates as c}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </div>

    {#if acts.length > 0}
      <div class="field-row">
        <label for="alias-reveal">Revealed at</label>
        <select
          id="alias-reveal"
          value={selectedRevealedAtPosition}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            selectedRevealedAtPosition = v ? Number(v) : null;
          }}
        >
          <option value="">Always visible</option>
          {#each acts as act, i}
            <option value={i}>{act.name}</option>
            {#each scenes.filter((s) => s.actId === act.id) as scene}
              <option value={scene.position}>  ↳ {scene.name}</option>
            {/each}
          {/each}
        </select>
      </div>
    {/if}
  {/if}

  {#if saveError}
    <p class="error" role="alert">{saveError}</p>
  {/if}

  <div class="actions">
    <button onclick={onClose} disabled={saving}>Cancel</button>
    {#if candidates.length > 0}
      <button class="primary" onclick={handleSave} disabled={saving || !selectedPrimaryId}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    {/if}
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
    width: min(360px, calc(100vw - 48px));
    color: var(--color-text);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .modal-title {
    margin: 0;
    font-family: var(--font-display, var(--font-ui));
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text);
  }

  .modal-title em {
    font-style: normal;
    color: var(--color-accent);
  }

  .field-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 8px;
  }

  .field-row label {
    font-size: 12px;
    color: var(--color-text-muted);
    text-align: right;
  }

  .field-row select {
    background: var(--color-surface-2, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 4px 8px;
    width: 100%;
  }

  .empty {
    margin: 0;
    font-size: 13px;
    color: var(--color-text-muted);
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
