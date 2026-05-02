<script lang="ts">
  import { windowStore, type AppId } from '$lib/stores/windows.js';

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
    showPicker: boolean;
  };

  let pickerOpen: AppId | null = $state(null);

  const grouped = $derived(() => {
    const map = new Map<AppId, GroupedWindow>();
    for (const app of DOCK_APPS) {
      map.set(app.id, { appId: app.id, label: app.label, icon: app.icon, windows: [], showPicker: false });
    }
    for (const win of $windowStore) {
      const group = map.get(win.appId as AppId);
      if (group) group.windows.push(win);
    }
    return [...map.values()];
  });
</script>

<div class="taskbar">
  <div class="dock">
    {#each grouped() as group}
      <div class="dock-item-wrap">
        <button
          class="dock-btn"
          class:has-windows={group.windows.length > 0}
          onclick={() => {
            if (group.windows.length === 0) {
              windowStore.open(group.appId);
              pickerOpen = null;
            } else if (group.windows.length === 1) {
              const win = group.windows[0];
              if (win.minimized) windowStore.focus(win.id);
              else windowStore.minimize(win.id);
              pickerOpen = null;
            } else {
              pickerOpen = pickerOpen === group.appId ? null : group.appId;
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

        {#if pickerOpen === group.appId && group.windows.length > 1}
          <div class="window-picker">
            {#each group.windows as win}
              <button
                class="picker-item"
                onclick={() => { windowStore.focus(win.id); pickerOpen = null; }}
              >
                {win.entityId ? win.entityId.slice(0, 8) + '…' : group.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<!-- Close picker on outside click -->
<svelte:window onclick={(e) => {
  if (!(e.target as HTMLElement).closest('.dock-item-wrap')) pickerOpen = null;
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
    min-width: 140px;
    box-shadow: var(--window-shadow);
    z-index: 9001;
  }

  .picker-item {
    background: transparent;
    border: none;
    color: var(--color-text);
    font-size: 12px;
    font-family: var(--font-ui);
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
  }

  .picker-item:hover {
    background: var(--color-surface);
  }
</style>
