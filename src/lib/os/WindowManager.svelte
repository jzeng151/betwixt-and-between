<script lang="ts">
  import { windowStore } from '$lib/os/windows-store.js';
  import { entities } from '$lib/stores/entities.js';
  import Window from './Window.svelte';
  import CharacterEditor from '$lib/components/apps/CharacterEditor.svelte';
  import Wiki from '$lib/components/apps/Wiki.svelte';
  import Timeline from '$lib/features/timeline/Timeline.svelte';
  import WorldMap from '$lib/components/apps/WorldMap.svelte';
  import StoryGraph from '$lib/features/graph/StoryGraph.svelte';
  import FocusedGraph from '$lib/features/graph/FocusedGraph.svelte';
  import Settings from '$lib/components/apps/Settings.svelte';
  import Notes from '$lib/components/apps/Notes.svelte';
  import PlayerDock from '$lib/features/timeline/PlayerDock.svelte';
  import EntityDetail from '$lib/components/EntityDetail.svelte';

  const APP_TITLES: Record<string, string> = {
    'character-editor': 'Characters',
    'world-map': 'World Map',
    'timeline': 'Timeline',
    'entity-detail': 'Entity',
    'wiki': 'Wiki',
    'story-graph': 'Story Graph',
    'focused-graph': 'Focused Graph',
    'settings': 'Settings',
    'notes': 'Notes',
    'story-player': 'Story Player',
  };

  function windowTitle(appId: string, entityId: string | null): string {
    if (entityId && (appId === 'character-editor' || appId === 'entity-detail')) {
      return $entities.find((e) => e.id === entityId)?.name ?? APP_TITLES[appId] ?? appId;
    }
    return APP_TITLES[appId] ?? appId;
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
    bare={win.appId === 'story-graph' || win.appId === 'focused-graph' || win.appId === 'world-map' || win.appId === 'story-player'}
    compact={win.appId === 'story-player'}
    alwaysOnTop={win.alwaysOnTop ?? false}
  >
    {#if win.appId === 'character-editor'}
      <CharacterEditor winId={win.id} entityId={win.entityId} />
    {:else if win.appId === 'wiki'}
      <Wiki entityId={win.entityId} />
    {:else if win.appId === 'timeline'}
      <Timeline />
    {:else if win.appId === 'entity-detail'}
      <EntityDetail
        entityId={win.entityId}
        isPopout={true}
        onClose={() => windowStore.close(win.id)}
      />
    {:else if win.appId === 'world-map'}
      <WorldMap entityId={win.entityId ?? undefined} />
    {:else if win.appId === 'story-graph'}
      <StoryGraph />
    {:else if win.appId === 'focused-graph'}
      <FocusedGraph windowId={win.id} />
    {:else if win.appId === 'settings'}
      <Settings />
    {:else if win.appId === 'notes'}
      <Notes />
    {:else if win.appId === 'story-player'}
      <PlayerDock winId={win.id} pinned={win.alwaysOnTop ?? false} />
    {/if}
  </Window>
{/each}
