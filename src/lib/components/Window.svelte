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

  type ResizeDir = 'l' | 'r' | 'b' | 'bl' | 'br';
  let resizeDir: ResizeDir | null = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;
  let resizeStartLeft = 0;

  const MIN_W = 280;
  const MIN_H = 200;

  function onTitlebarMousedown(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.win-control')) return;
    if (maximized) return;
    dragging = true;
    dragOffsetX = e.clientX - x;
    dragOffsetY = e.clientY - y;
    windowStore.focus(id);
    e.preventDefault();
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
