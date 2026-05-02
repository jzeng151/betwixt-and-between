<script lang="ts">
  import { windowStore, type AppId } from '$lib/stores/windows.js';
  import { entities } from '$lib/stores/entities.js';
  import { nodeColorFor } from '$lib/relationship-colors.js';

  interface DockApp {
    id: AppId;
    label: string;
    icon: string;
    entityId?: string | null;
  }

  const DOCK_APPS: DockApp[] = [
    { id: 'character-editor', label: 'Characters', icon: '👤' },
    { id: 'story-graph',      label: 'Story Graph', icon: '🕸' },
    { id: 'timeline',         label: 'Timeline', icon: '📅' },
    { id: 'world-map',        label: 'World Map', icon: '🗺' },
    { id: 'wiki',             label: 'Wiki', icon: '📝' },
  ];

  type GroupedWindow = {
    appId: AppId;
    label: string;
    icon: string;
    windows: typeof $windowStore;
  };

  // ── Hover popover state ────────────────────────────────────────────────────
  // Hovering a dock group surfaces a list of all windows in that group; click
  // any item to raise that window. ~200ms close timer lets the cursor travel
  // from icon → popover via the visual gap without the popover dismissing
  // mid-bridge. Clicking the icon ALSO toggles (touch / keyboard fallback).
  const HOVER_CLOSE_MS = 200;
  let hoveredAppId: AppId | null = $state(null);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function showPopover(appId: AppId) {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    hoveredAppId = appId;
  }

  function scheduleClose() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      hoveredAppId = null;
      closeTimer = null;
    }, HOVER_CLOSE_MS);
  }

  function dismissNow() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    hoveredAppId = null;
  }

  // Cleanup on unmount: cancel any pending close-delay timer so it
  // doesn't fire after the component is gone and try to mutate
  // hoveredAppId on a dead instance.
  $effect(() => () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  });

  // Character cycle index — same indexing used by Timeline + graph apps so
  // a character's swatch in the popover matches the color it gets on the
  // Timeline bar / Story Graph node.
  const characterIndexById = $derived.by(() => {
    const m = new Map<string, number>();
    $entities.filter((e) => e.type === 'Character').forEach((e, i) => m.set(e.id, i));
    return m;
  });

  // FocusedGraph windows are surfaced UNDER the Story Graph dock group
  // (no separate dock entry) since they're a derivative graph view, not
  // a top-level app the user would launch from scratch. The popover
  // distinguishes them per-row via a different icon glyph + subtitle.
  const APP_PARENT: Partial<Record<AppId, AppId>> = {
    'focused-graph': 'story-graph'
  };

  // Per-window-type icon override for the popover. Single-focal Story
  // Graph windows render with the dock glyph (🕸); FG windows get 🎯
  // so users can tell them apart inside the shared group.
  const PICKER_ICON: Partial<Record<AppId, string>> = {
    'focused-graph': '🎯'
  };

  function pickerLabel(win: (typeof $windowStore)[number], fallback: string): string {
    // FocusedGraph: synthesize a name from the focal set since FG
    // windows aren't bound to a single entity.
    if (win.appId === 'focused-graph') {
      const focals = win.focalSet ?? [];
      if (focals.length === 0) return 'Focused Graph (no focal)';
      const names = focals.slice(0, 2).map((id) => {
        const e = $entities.find((x) => x.id === id);
        return e?.name ?? id.slice(0, 6);
      });
      if (focals.length === 1) return names[0];
      if (focals.length === 2) return `${names[0]}, ${names[1]}`;
      return `${names[0]} + ${focals.length - 1} others`;
    }
    if (!win.entityId) return fallback;
    const entity = $entities.find((e) => e.id === win.entityId);
    return entity?.name ?? fallback;
  }

  function pickerSubtitle(win: (typeof $windowStore)[number]): string | null {
    if (win.appId === 'focused-graph') return 'Focused Graph';
    if (!win.entityId) return null;
    const entity = $entities.find((e) => e.id === win.entityId);
    return entity?.type ?? null;
  }

  function pickerSwatch(win: (typeof $windowStore)[number]): string | null {
    if (!win.entityId) return null;
    const entity = $entities.find((e) => e.id === win.entityId);
    if (!entity) return null;
    return nodeColorFor(entity, characterIndexById.get(entity.id));
  }

  function pickerIcon(win: (typeof $windowStore)[number], fallback: string): string {
    return PICKER_ICON[win.appId as AppId] ?? fallback;
  }

  const grouped = $derived(() => {
    const map = new Map<AppId, GroupedWindow>();
    for (const app of DOCK_APPS) {
      map.set(app.id, { appId: app.id, label: app.label, icon: app.icon, windows: [] });
    }
    for (const win of $windowStore) {
      // Resolve a window to the dock group it should appear in. Most
      // windows go to their own appId; child appIds (e.g. focused-graph)
      // get hoisted to their parent (story-graph).
      const targetAppId = (APP_PARENT[win.appId as AppId] ?? win.appId) as AppId;
      const group = map.get(targetAppId);
      if (group) group.windows.push(win);
    }
    return [...map.values()];
  });
</script>

<div class="taskbar">
  <div class="dock">
    {#each grouped() as group}
      <!-- Wrap is the hover-zone: covers icon AND popover so cursor travel
           between them doesn't dismiss. Both onmouseenter and onmouseleave
           target this container; the popover renders inside it (above) so
           the gap between icon and popover counts as inside-zone. -->
      <div
        class="dock-item-wrap"
        onmouseenter={() => showPopover(group.appId)}
        onmouseleave={scheduleClose}
        role="presentation"
      >
        <button
          class="dock-btn"
          class:has-windows={group.windows.length > 0}
          onclick={() => {
            // Touch / keyboard fallback (mouseenter doesn't fire on touch).
            // 0 windows: open a fresh one. 1 window: minimize/focus toggle
            // matches OS taskbar conventions. 2+: just toggle the popover.
            if (group.windows.length === 0) {
              windowStore.open(group.appId);
              dismissNow();
            } else if (group.windows.length === 1) {
              const win = group.windows[0];
              if (win.minimized) windowStore.focus(win.id);
              else windowStore.minimize(win.id);
              dismissNow();
            } else {
              hoveredAppId = hoveredAppId === group.appId ? null : group.appId;
            }
          }}
          title={group.label}
        >
          <span class="dock-icon">{group.icon}</span>
          <span class="dock-label">{group.label}</span>
          {#if group.windows.length > 1}
            <span class="count-badge">{group.windows.length}</span>
          {/if}
          {#if group.windows.length > 0}
            <span class="active-dot"></span>
          {/if}
        </button>

        {#if hoveredAppId === group.appId && group.windows.length > 0}
          <div class="window-picker">
            {#each group.windows as win (win.id)}
              {@const swatch = pickerSwatch(win)}
              {@const subtitle = pickerSubtitle(win)}
              <button
                class="picker-item"
                class:minimized={win.minimized}
                onclick={() => {
                  windowStore.focus(win.id);
                  dismissNow();
                }}
              >
                <span class="picker-icon">{pickerIcon(win, group.icon)}</span>
                {#if swatch}
                  <span class="picker-swatch" style="--c:{swatch}"></span>
                {/if}
                <span class="picker-text">
                  <span class="picker-name">{pickerLabel(win, group.label)}</span>
                  {#if subtitle}
                    <span class="picker-subtitle">{subtitle}</span>
                  {/if}
                </span>
                {#if win.minimized}
                  <span class="picker-minimized" aria-label="Minimized">▼</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<!-- Close popover on outside click (touch / keyboard fallback). Hover
     events handle the mouse case via scheduleClose. -->
<svelte:window onclick={(e) => {
  if (!(e.target as HTMLElement).closest('.dock-item-wrap')) dismissNow();
}} />

<style>
  .taskbar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 52px;
    background: color-mix(in srgb, var(--color-surface-2) 90%, transparent);
    border-top: 1px solid var(--color-border);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9000;
    padding: 0 16px;
  }

  .dock {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .dock-item-wrap {
    position: relative;
  }

  .dock-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--color-text-muted);
    font-size: 11px;
    font-family: var(--font-ui);
    transition: background 0.12s, color 0.12s;
    cursor: pointer;
    position: relative;
    min-width: 56px;
  }

  .dock-btn:hover,
  .dock-btn.has-windows {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .dock-icon {
    font-size: 19px;
    line-height: 1;
  }

  .dock-label {
    font-size: 10px;
    letter-spacing: 0.02em;
  }

  .active-dot {
    position: absolute;
    bottom: 3px;
    left: 50%;
    transform: translateX(-50%);
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-accent);
  }

  .count-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    background: var(--color-accent);
    color: var(--color-surface);
    font-size: 10px;
    font-weight: 700;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .window-picker {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 240px;
    max-width: 320px;
    box-shadow: var(--window-shadow);
    z-index: 9001;
  }

  .picker-item {
    display: flex;
    align-items: center;
    gap: 10px;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-size: 13px;
    font-family: var(--font-ui);
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .picker-item:hover {
    background: var(--color-surface);
  }

  /* Minimized rows render in a quieter style so the user can spot
     what to revive without clicking through every entry. */
  .picker-item.minimized {
    opacity: 0.55;
    font-style: italic;
  }

  .picker-icon {
    font-size: 16px;
    line-height: 1;
    flex-shrink: 0;
  }

  /* Per-entity color swatch — Character entries get the same color as
     their Timeline bar / graph node via nodeColorFor. Other entity
     types may render swatches too; harmless if absent. */
  .picker-swatch {
    width: 4px;
    height: 22px;
    border-radius: 2px;
    background: var(--c);
    flex-shrink: 0;
  }

  .picker-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .picker-name {
    font-size: 13px;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picker-subtitle {
    font-size: 10px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .picker-minimized {
    color: var(--color-text-muted);
    font-size: 9px;
    flex-shrink: 0;
  }
</style>
