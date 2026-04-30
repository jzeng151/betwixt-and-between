<script lang="ts">
  interface Props {
    value: string;
    onSave: (value: string) => void;
    class?: string;
    placeholder?: string;
    /** Always show the input, never the read-only display + pencil.
     *  Used when the host is already in an explicit edit mode and the
     *  extra click on the pencil is unnecessary friction. */
    forceEditing?: boolean;
  }
  let {
    value,
    onSave,
    class: cls = '',
    placeholder = 'Untitled',
    forceEditing = false
  }: Props = $props();

  let editing = $state(false);
  let draft = $state('');

  $effect(() => { draft = value; });

  // Render the input whenever the host pins us to editing OR the user
  // clicked the pencil to start a one-off rename.
  const showInput = $derived(forceEditing || editing);

  function commit() {
    editing = false;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      draft = value;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { editing = false; draft = value; }
  }

  function startEdit() {
    draft = value;
    editing = true;
  }
</script>

{#if showInput}
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="inline-edit-input {cls}"
    bind:value={draft}
    onblur={commit}
    onkeydown={handleKeydown}
    autofocus
    {placeholder}
  />
{:else}
  <span class="inline-edit-wrap">
    <span class="inline-edit-text {cls}">{value || placeholder}</span>
    <button
      class="edit-btn"
      onclick={startEdit}
      title="Rename"
      aria-label="Rename"
      tabindex="0"
    >
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
        <path d="M7.5 1.5 l2 2 -6 6 -2.5 0.5 0.5-2.5 6-6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
      </svg>
    </button>
  </span>
{/if}

<style>
  .inline-edit-wrap {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .inline-edit-text {
    cursor: default;
  }

  .edit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 2px;
    border-radius: 3px;
    color: var(--color-text-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .inline-edit-wrap:hover .edit-btn,
  .edit-btn:focus {
    opacity: 1;
  }

  .edit-btn:hover {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }

  .inline-edit-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-accent);
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    width: 100%;
    outline: none;
    padding: 0;
  }
</style>
