<script lang="ts">
  import { onMount } from 'svelte';
  import { takeNextFocusReturn } from '$lib/actions/focus-trap.js';
  import { windowStore, PIN_Z_BASE } from '$lib/os/windows-store.js';

  interface Props {
    id: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    minimized: boolean;
    maximized: boolean;
    bare?: boolean;
    compact?: boolean;
    alwaysOnTop?: boolean;
    children?: import('svelte').Snippet;
  }

  let { id, title, x, y, width, height, zIndex, minimized, maximized, bare = false, compact = false, alwaysOnTop = false, children }: Props = $props();

  const effectiveZ = $derived(alwaysOnTop ? PIN_Z_BASE + zIndex : zIndex);

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  type ResizeDir = 'l' | 'r' | 'b' | 'bl' | 'br';
  let resizeDir: ResizeDir | null = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;
  let resizeStartLeft = 0;
  let windowElement = $state<HTMLElement>();
  let returnFocus: HTMLElement | null = null;

  function focusWindow() {
    queueMicrotask(() => {
      if (windowElement && !windowElement.contains(document.activeElement)) windowElement.focus();
    });
  }

  function restoreFocus() {
    queueMicrotask(() => {
      if (returnFocus?.isConnected && !returnFocus.closest('[aria-hidden="true"]')) {
        returnFocus.focus();
        return;
      }
      [...document.querySelectorAll<HTMLElement>('.window')]
        .sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex))
        .at(-1)
        ?.focus();
    });
  }

  $effect(() => {
    const focused = windowStore.focusedWindow();
    if (!minimized && focused?.id === id && focused.zIndex === zIndex) focusWindow();
  });

  onMount(() => {
    returnFocus = takeNextFocusReturn(
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    );
    return restoreFocus;
  });

  function minimizeWindow() {
    windowStore.minimize(id);
    restoreFocus();
  }

  // svelte-ignore state_referenced_locally
  const MIN_W = compact ? 240 : 280;
  // svelte-ignore state_referenced_locally
  const MIN_H = compact ? 88 : 200;

  function onTitlebarMousedown(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.win-control')) return;
    if ((e.target as HTMLElement).closest('.titlebar-action')) return;
    if (maximized) return;
    dragging = true;
    dragOffsetX = e.clientX - x;
    dragOffsetY = e.clientY - y;
    windowStore.focus(id);
    e.preventDefault();
  }

  function onTitlebarKeydown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget || !e.altKey || maximized) return;
    const delta = 16;
    const direction = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
      : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : 0;
    if (direction === 0) return;
    e.preventDefault();
    windowStore.focus(id);
    if (e.shiftKey) {
      const nextWidth = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
        ? Math.max(MIN_W, width + direction * delta)
        : width;
      const nextHeight = e.key === 'ArrowUp' || e.key === 'ArrowDown'
        ? Math.max(MIN_H, height + direction * delta)
        : height;
      windowStore.resize(id, nextWidth, nextHeight);
    } else {
      const nextX = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
        ? Math.max(0, x + direction * delta)
        : x;
      const nextY = e.key === 'ArrowUp' || e.key === 'ArrowDown'
        ? Math.max(0, y + direction * delta)
        : y;
      windowStore.move(id, nextX, nextY);
    }
  }

  function onResizeMousedown(e: MouseEvent, dir: ResizeDir) {
    if (maximized) return;
    resizeDir = dir;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = width;
    resizeStartH = height;
    resizeStartLeft = x;
    windowStore.focus(id);
    e.stopPropagation();
    e.preventDefault();
  }

  function onMousemove(e: MouseEvent) {
    if (dragging) {
      const nx = e.clientX - dragOffsetX;
      const ny = e.clientY - dragOffsetY;
      windowStore.move(id, Math.max(0, nx), Math.max(0, ny));
      return;
    }
    if (resizeDir) {
      const dx = e.clientX - resizeStartX;
      const dy = e.clientY - resizeStartY;

      let nw = resizeStartW;
      let nh = resizeStartH;
      let nx = resizeStartLeft;

      if (resizeDir === 'r' || resizeDir === 'br') {
        nw = Math.max(MIN_W, resizeStartW + dx);
      }
      if (resizeDir === 'l' || resizeDir === 'bl') {
        // Dragging left edge: width grows by -dx, x shifts by +dx (clamped).
        nw = Math.max(MIN_W, resizeStartW - dx);
        nx = resizeStartLeft + (resizeStartW - nw);
      }
      if (resizeDir === 'b' || resizeDir === 'bl' || resizeDir === 'br') {
        nh = Math.max(MIN_H, resizeStartH + dy);
      }

      if (nx !== x || nw !== width) {
        windowStore.move(id, Math.max(0, nx), y);
      }
      windowStore.resize(id, nw, nh);
    }
  }

  function onMouseup() {
    dragging = false;
    resizeDir = null;
  }
</script>

<svelte:window onmousemove={onMousemove} onmouseup={onMouseup} />

{#if !minimized}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    bind:this={windowElement}
    class="window"
    class:maximized
    class:compact
    class:pinned={alwaysOnTop}
    style={maximized ? `z-index:${effectiveZ}` : `left:${x}px; top:${y}px; width:${width}px; height:${height}px; z-index:${effectiveZ}`}
    onmousedown={() => windowStore.focus(id)}
    role="dialog"
    aria-label={title}
    tabindex="-1"
  >
    <div
      class="titlebar"
      onmousedown={onTitlebarMousedown}
      onkeydown={onTitlebarKeydown}
      role="toolbar"
      aria-label={maximized
        ? `${title} window`
        : `${title} window. Alt plus arrow keys moves; Shift, Alt, and arrow keys resizes.`}
      tabindex={maximized ? undefined : 0}
    >
      <span class="win-title">{title}</span>
      <!-- Item 3: persist this window's current size (+ position for
           single-instance apps) as the open default for its app. -->
      <button
        type="button"
        class="titlebar-action"
        aria-label="Set current size and position as default"
        title="Set current size & position as default"
        onclick={(e) => { e.stopPropagation(); windowStore.setAsDefault(id); }}
      >Set default</button>
      <div class="win-controls">
        <button
          class="win-control close"
          aria-label="Close"
          onclick={(e) => { e.stopPropagation(); windowStore.close(id); }}
        >×</button>
        <button
          class="win-control minimize"
          aria-label="Minimize"
          onclick={(e) => { e.stopPropagation(); minimizeWindow(); }}
        >−</button>
        <button
          class="win-control maximize-btn"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onclick={(e) => { e.stopPropagation(); windowStore.maximize(id); }}
        >{maximized ? '◇' : '□'}</button>
      </div>
    </div>
    <div class="win-content" class:bare>
      {@render children?.()}
    </div>
    <!-- Resize handles. Top edge intentionally omitted (per UX spec —
         use the title bar to move). Edges + bottom corners only. -->
    <div class="resize resize-l" onmousedown={(e) => onResizeMousedown(e, 'l')} role="presentation"></div>
    <div class="resize resize-r" onmousedown={(e) => onResizeMousedown(e, 'r')} role="presentation"></div>
    <div class="resize resize-b" onmousedown={(e) => onResizeMousedown(e, 'b')} role="presentation"></div>
    <div class="resize resize-bl" onmousedown={(e) => onResizeMousedown(e, 'bl')} role="presentation"></div>
    <div class="resize resize-br" onmousedown={(e) => onResizeMousedown(e, 'br')} role="presentation"></div>
  </div>
{/if}

<style>
  .window {
    position: fixed;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--window-radius);
    box-shadow: var(--window-shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 280px;
    min-height: 200px;
  }

  .window.compact {
    min-width: 240px;
    min-height: 88px;
  }

  .window.pinned {
    box-shadow: 0 0 0 1px var(--color-accent, #c8942a), var(--window-shadow);
  }

  .titlebar {
    height: var(--titlebar-height);
    min-height: var(--titlebar-height);
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    padding: 0 10px;
    cursor: move;
    user-select: none;
    gap: 8px;
  }

  .win-controls {
    display: flex;
    gap: 0;
    flex-shrink: 0;
  }

  .win-control {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    border-radius: 4px;
    font-size: 15px;
    line-height: 1;
  }

  .win-control:hover {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .win-control.close:hover {
    background: var(--color-danger-solid);
    color: var(--color-on-danger);
  }

  .window.maximized {
    position: fixed;
    inset: 0;
    bottom: var(--taskbar-height);
    width: auto !important;
    height: auto !important;
    border-radius: 0;
  }

  .win-title {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  .titlebar-action {
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    font-size: 11px;
    line-height: 1.2;
    width: auto;
    height: 24px;
    padding: 0 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .titlebar-action:hover {
    color: var(--color-text);
    background: var(--color-surface);
  }
  .titlebar-action:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }

  .win-content {
    flex: 1;
    overflow: auto;
    padding: 16px;
    position: relative;
    /* Contain the content's z-indexes in their own stacking context so app
       chrome (e.g. the World Map toolbar at z-index:1000, its sidebar, and
       the bottom palettes) can't paint over the window's resize handles —
       which otherwise made the window un-resizable from the covered edges. */
    isolation: isolate;
  }

  .win-content.bare {
    padding: 0;
    overflow: hidden;
  }

  /* Resize handles. Edges are 6px wide strips; corners are 14px squares
     stacked on top so the corner cursor wins where they overlap. */
  .resize {
    position: absolute;
  }
  .resize-l {
    top: 0;
    left: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .resize-r {
    top: 0;
    right: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .resize-b {
    left: 0;
    right: 0;
    bottom: 0;
    height: 6px;
    cursor: ns-resize;
  }
  .resize-bl {
    left: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: sw-resize;
    z-index: 1;
  }
  .resize-br {
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: se-resize;
    z-index: 1;
  }
  .window.maximized .resize {
    display: none;
  }
</style>
