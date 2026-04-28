<script lang="ts">
  import { windowStore } from '$lib/stores/windows.js';
  import { entities } from '$lib/stores/entities.js';
  import Window from './Window.svelte';
  import CharacterEditor from './apps/CharacterEditor.svelte';
  import Wiki from './apps/Wiki.svelte';
  import Timeline from './apps/Timeline.svelte';
  import TimelineV2 from './apps/TimelineV2.svelte';
  import WorldMap from './apps/WorldMap.svelte';
  import StoryGraph from './apps/StoryGraph.svelte';

  const APP_TITLES: Record<string, string> = {
    'character-editor': 'Characters',
    'world-map': 'World Map',
    'timeline': 'Timeline',
    'timeline-v2': 'Timeline (V2 preview)',
    'wiki': 'Wiki',
    'story-graph': 'Story Graph',
  };

  function windowTitle(appId: string, entityId: string | null): string {
    if (entityId && appId === 'character-editor') {
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
    bare={win.appId === 'story-graph'}
  >
    {#if win.appId === 'character-editor'}
      <CharacterEditor winId={win.id} entityId={win.entityId} />
    {:else if win.appId === 'wiki'}
      <Wiki entityId={win.entityId} />
    {:else if win.appId === 'timeline'}
      <Timeline entityId={win.entityId} />
    {:else if win.appId === 'timeline-v2'}
      <TimelineV2 entityId={win.entityId} />
    {:else if win.appId === 'world-map'}
      <WorldMap entityId={win.entityId} />
    {:else if win.appId === 'story-graph'}
      <StoryGraph />
    {/if}
  </Window>
{/each}
