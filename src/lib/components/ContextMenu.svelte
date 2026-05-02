<script lang="ts">
  import { clampToViewport } from './context-menu-clamp.js';

  interface Item {
    /** Display label */
    label: string;
    /** Optional icon (emoji or single character — keep it simple). */
    icon?: string;
    /** Optional disabled state (renders dimmed, not clickable). */
    disabled?: boolean;
    /** Click handler. */
    onSelect: () => void;
  }

  interface Props {
    items: Item[];
    /** Viewport-local coords where the menu's top-left should anchor. */
    x: number;
    y: number;
    onClose: () => void;
  }

  let { items, x, y, onClose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let buttonEls: (HTMLButtonElement | null)[] = $state([]);
  let pos = $state({ x: 0, y: 0 });
  // Index of the focused item. Initialized to first non-disabled.
  let focusIndex = $state(0);

  function selectItem(i: number) {
    const item = items[i];
    if (!item || item.disabled) return;
    item.onSelect();
    // Close after select. The component owns dismiss for Escape and
    // click-outside; selection should follow the same shape so callsites
    // don't have to wrap every onSelect with an explicit close.
    onClose();
  }

  function focusItem(i: number) {
    focusIndex = i;
    buttonEls[i]?.focus();
  }

  function moveFocus(delta: 1 | -1) {
    if (items.length === 0) return;
    const enabledIdxs = items
      .map((it, i) => (it.disabled ? -1 : i))
      .filter((i) => i >= 0);
    if (enabledIdxs.length === 0) return;
    const cur = enabledIdxs.indexOf(focusIndex);
    // If focusIndex isn't on an enabled item (shouldn't happen but be safe),
    // pick the first/last based on direction.
    const nextOrdinal =
      cur === -1
        ? delta === 1
          ? 0
          : enabledIdxs.length - 1
        : (cur + delta + enabledIdxs.length) % enabledIdxs.length;
    focusItem(enabledIdxs[nextOrdinal]);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (focusIndex >= 0) selectItem(focusIndex);
      return;
    }
  }

  // Mount: clamp to viewport (one pass), auto-focus first enabled item.
  // Reads of x/y/items here are intentionally one-shot (mount-only) — the
  // component is destroyed and remounted at a fresh anchor for each open.
  $effect(() => {
    if (!menuEl) return;
    const firstEnabled = items.findIndex((it) => !it.disabled);
    focusIndex = firstEnabled;
    const rect = menuEl.getBoundingClientRect();
    pos = clampToViewport(
      x,
      y,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight
    );
    if (firstEnabled >= 0) {
      buttonEls[firstEnabled]?.focus();
    }
  });

  // Click-outside: pointerdown anywhere outside the menu closes it.
  $effect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!menuEl) return;
      const target = e.target as Node | null;
      if (target && menuEl.contains(target)) return;
      onClose();
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={menuEl}
  class="context-menu"
  style="left: {pos.x}px; top: {pos.y}px;"
  role="menu"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  {#each items as item, i (i)}
    <button
      bind:this={buttonEls[i]}
      type="button"
      class="context-menu-item"
      class:disabled={item.disabled}
      role="menuitem"
      disabled={item.disabled}
      tabindex={item.disabled ? -1 : 0}
      onclick={() => selectItem(i)}
    >
      {#if item.icon}<span class="icon" aria-hidden="true">{item.icon}</span>{/if}
      <span class="label">{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .context-menu {
    position: fixed;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    min-width: 160px;
    font-family: var(--font-ui);
    font-size: 13px;
    z-index: 100;
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--color-text);
    font-family: inherit;
    font-size: inherit;
    text-align: left;
    cursor: pointer;
    width: 100%;
  }

  .context-menu-item:hover:not(.disabled),
  .context-menu-item:focus-visible {
    background: var(--color-accent);
    color: white;
    outline: none;
  }

  .context-menu-item.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .icon {
    display: inline-flex;
    width: 14px;
    justify-content: center;
  }

  .label {
    flex: 1;
  }
</style>
