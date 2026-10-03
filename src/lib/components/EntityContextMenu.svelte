<script lang="ts">
  import ContextMenu from '$lib/os/ContextMenu.svelte';
  import { entities } from '$lib/stores/entities.js';
  import { sendReferenceToBoard } from '$lib/features/whiteboard/send-to-board.js';

  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  let layer = $state<HTMLDivElement>();
  const entity = $derived($entities.find(entity => entity.id === menu?.id));
  $effect(() => { if (layer) layer.showPopover(); });

  function open(event: MouseEvent | KeyboardEvent) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event instanceof KeyboardEvent && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    // Keep native text editing menus and let existing app menus handle their own targets.
    if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const target = event.target.closest<HTMLElement>('[data-entity-id]');
    const id = target?.dataset.entityId;
    if (!target || !$entities.some(entity => entity.id === id)) return;
    event.preventDefault();
    const trigger = event.target.closest<HTMLElement>('button, summary, [tabindex]');
    trigger?.focus();
    const rect = (trigger ?? target).getBoundingClientRect();
    menu = { id: id!, x: event instanceof MouseEvent ? event.clientX : rect.left, y: event instanceof MouseEvent ? event.clientY : rect.bottom };
  }
</script>

<svelte:window oncontextmenu={open} onkeydown={open} />

{#if menu && entity}
  <div bind:this={layer} popover="manual" style="padding: 0; border: 0; background: transparent; overflow: visible;">
    <ContextMenu items={[{ label: 'Send to whiteboard…', onSelect: () => sendReferenceToBoard({ kind: 'entity', id: entity.id }, entity.name) }]} x={menu.x} y={menu.y} onClose={() => (menu = null)} />
  </div>
{/if}
