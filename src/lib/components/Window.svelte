<script lang="ts">
  import { windowStore } from '$lib/stores/windows.js';

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
    children?: import('svelte').Snippet;
  }

  let { id, title, x, y, width, height, zIndex, minimized, maximized, bare = false, children }: Props = $props();

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let resizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;

  function onTitlebarMousedown(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.win-control')) return;
    if (maximized) return;
    dragging = true;
    dragOffsetX = e.clientX - x;
    dragOffsetY = e.clientY - y;
    windowStore.focus(id);
    e.preventDefault();
  }

  function onResizeMousedown(e: MouseEvent) {
    if (maximized) return;
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = width;
    resizeStartH = height;
    e.preventDefault();
  }

  function onMousemove(e: MouseEvent) {
    if (dragging) {
      const nx = e.clientX - dragOffsetX;
      const ny = e.clientY - dragOffsetY;
      windowStore.move(id, Math.max(0, nx), Math.max(0, ny));
    }
    if (resizing) {
      const nw = Math.max(280, resizeStartW + (e.clientX - resizeStartX));
      const nh = Math.max(200, resizeStartH + (e.clientY - resizeStartY));
      windowStore.resize(id, nw, nh);
    }
  }

  function onMouseup() {
    dragging = false;
    resizing = false;
  }
</script>

<svelte:window onmousemove={onMousemove} onmouseup={onMouseup} />

{#if !minimized}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="window"
    class:maximized
    style={maximized ? `z-index:${zIndex}` : `left:${x}px; top:${y}px; width:${width}px; height:${height}px; z-index:${zIndex}`}
    onmousedown={() => windowStore.focus(id)}
    role="dialog"
    aria-label={title}
    tabindex="-1"
  >
    <div class="titlebar" onmousedown={onTitlebarMousedown} role="presentation">
      <div class="win-controls">
        <button
          class="win-control close"
          aria-label="Close"
          onclick={(e) => { e.stopPropagation(); windowStore.close(id); }}
        ></button>
        <button
          class="win-control minimize"
          aria-label="Minimize"
          onclick={(e) => { e.stopPropagation(); windowStore.minimize(id); }}
        ></button>
        <button
          class="win-control maximize-btn"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onclick={(e) => { e.stopPropagation(); windowStore.maximize(id); }}
        ></button>
      </div>
      <span class="win-title">{title}</span>
    </div>
    <div class="win-content" class:bare>
      {@render children?.()}
    </div>
    <div class="resize-handle" onmousedown={onResizeMousedown} role="presentation"></div>
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
    gap: 6px;
    flex-shrink: 0;
  }

  .win-control {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .win-control.close    { background: #ef4444; }
  .win-control.minimize { background: #c8942a; }
  .win-control.maximize-btn { background: #28c840; }

  .window.maximized {
    position: fixed;
    inset: 0;
    bottom: 52px;
    width: auto !important;
    height: auto !important;
    border-radius: 0;
  }

  .win-title {
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    flex: 1;
    text-align: center;
    pointer-events: none;
  }

  .win-content {
    flex: 1;
    overflow: auto;
    padding: 16px;
    position: relative;
  }

  .win-content.bare {
    padding: 0;
    overflow: hidden;
  }

  .resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    cursor: se-resize;
  }
</style>
