<script lang="ts">
  import { windowStore } from '$lib/stores/windows.js';
  import { entities } from '$lib/stores/entities.js';
  import Window from './Window.svelte';
  import CharacterEditor from './apps/CharacterEditor.svelte';
  import Wiki from './apps/Wiki.svelte';
  import Timeline from './apps/Timeline.svelte';
  import WorldMap from './apps/WorldMap.svelte';
  import StoryGraph from './apps/StoryGraph.svelte';
  import FocusedGraph from './apps/FocusedGraph.svelte';
  import Notes from './apps/Notes.svelte';
  import EntityDetail from './EntityDetail.svelte';

  const APP_TITLES: Record<string, string> = {
    'character-editor': 'Characters',
    'world-map': 'World Map',
    'timeline': 'Timeline',
    'entity-detail': 'Entity',
    'wiki': 'Wiki',
    'story-graph': 'Story Graph',
    'focused-graph': 'Focused Graph',
    'notes': 'Notes',
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
    bare={win.appId === 'story-graph' || win.appId === 'focused-graph'}
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
      <WorldMap entityId={win.entityId} />
    {:else if win.appId === 'story-graph'}
      <StoryGraph />
    {:else if win.appId === 'focused-graph'}
      <FocusedGraph windowId={win.id} />
    {:else if win.appId === 'notes'}
      <Notes />
    {/if}
  </Window>
{/each}
