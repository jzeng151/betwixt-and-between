<script lang="ts">
  import type { Component } from 'svelte';
  import { windowStore, type AppId } from '$lib/os/windows-store.js';
  import { APP_CATALOG, isBare } from '$lib/os/app-catalog.js';
  import { entities } from '$lib/stores/entities.js';
  import Window from './Window.svelte';

  // Dynamic windows have deliberately different prop contracts. The runtime
  // branch below narrows appId before rendering each component.
  type AppComponent = Component<any>;
  const appLoaders: Record<AppId, () => Promise<{ default: AppComponent }>> = {
    'character-editor': () => import('$lib/features/character/CharacterEditor.svelte'),
    'wiki': () => import('$lib/components/apps/Wiki.svelte'),
    'timeline': () => import('$lib/features/timeline/Timeline.svelte'),
    'world-map': () => import('$lib/features/map/WorldMap.svelte'),
    'story-graph': () => import('$lib/features/graph/StoryGraph.svelte'),
    'focused-graph': () => import('$lib/features/graph/FocusedGraph.svelte'),
    'settings': () => import('$lib/components/apps/Settings.svelte'),
    'notes': () => import('$lib/components/apps/Notes.svelte'),
    'story-player': () => import('$lib/features/timeline/PlayerDock.svelte'),
    'entity-detail': () => import('$lib/components/EntityDetail.svelte')
  };
  const appPromises = new Map<AppId, Promise<AppComponent>>();
  let loadedApps = $state<Partial<Record<AppId, AppComponent>>>({});
  let failedApps = $state<Set<AppId>>(new Set());

  function loadApp(appId: AppId): Promise<AppComponent> {
    let promise = appPromises.get(appId);
    if (!promise) {
      promise = appLoaders[appId]().then((module) => module.default);
      appPromises.set(appId, promise);
    }
    return promise;
  }

  function retryApp(appId: AppId) {
    appPromises.delete(appId);
    failedApps = new Set([...failedApps].filter((id) => id !== appId));
  }

  $effect(() => {
    for (const win of $windowStore) {
      if (loadedApps[win.appId] || failedApps.has(win.appId)) continue;
      void loadApp(win.appId)
        .then((component) => {
          loadedApps = { ...loadedApps, [win.appId]: component };
        })
        .catch(() => {
          failedApps = new Set(failedApps).add(win.appId);
        });
    }
  });

  function windowTitle(appId: AppId, entityId: string | null): string {
    const fallback = APP_CATALOG[appId].title;
    if (entityId && (appId === 'character-editor' || appId === 'entity-detail')) {
      return $entities.find((e) => e.id === entityId)?.name ?? fallback;
    }
    return fallback;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      const focused = windowStore.focusedWindow();
      if (focused) windowStore.close(focused.id);
    }
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) windowStore.cycleBackward();
      else windowStore.cycleForward();
    }
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#each $windowStore as win (win.id)}
  <Window
    id={win.id}
    title={windowTitle(win.appId, win.entityId)}
    x={win.x}
    y={win.y}
    width={win.width}
    height={win.height}
    zIndex={win.zIndex}
    minimized={win.minimized}
    maximized={win.maximized}
    bare={isBare(win.appId)}
    compact={win.appId === 'story-player'}
    alwaysOnTop={win.alwaysOnTop ?? false}
  >
    {@const App = loadedApps[win.appId]}
    {#if App}
      {#if win.appId === 'character-editor'}
        <App winId={win.id} entityId={win.entityId} />
      {:else if win.appId === 'wiki'}
        <App entityId={win.entityId} />
      {:else if win.appId === 'timeline'}
        <App />
      {:else if win.appId === 'entity-detail'}
        <App
          entityId={win.entityId}
          isPopout={true}
          onClose={() => windowStore.close(win.id)}
        />
      {:else if win.appId === 'world-map'}
        <App entityId={win.entityId ?? undefined} windowId={win.id} />
      {:else if win.appId === 'story-graph'}
        <App />
      {:else if win.appId === 'focused-graph'}
        <App windowId={win.id} />
      {:else if win.appId === 'settings'}
        <App />
      {:else if win.appId === 'notes'}
        <App />
      {:else if win.appId === 'story-player'}
        <App winId={win.id} pinned={win.alwaysOnTop ?? false} />
      {/if}
    {:else if failedApps.has(win.appId)}
      <div class="app-loading app-loading--error" role="alert">
        <span>Couldn't open {APP_CATALOG[win.appId].title}.</span>
        <button type="button" onclick={() => retryApp(win.appId)}>Retry</button>
      </div>
    {:else}
      <div class="app-loading" role="status">Opening {APP_CATALOG[win.appId].title}…</div>
    {/if}
  </Window>
{/each}

<style>
  .app-loading {
    min-height: 100%;
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    font-size: 13px;
  }
  .app-loading--error {
    color: var(--color-danger);
    gap: 10px;
  }
  .app-loading--error button {
    color: var(--color-text);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 6px 10px;
    cursor: pointer;
  }
</style>
