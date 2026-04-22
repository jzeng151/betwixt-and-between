<script lang="ts">
  import { windowStore } from '$lib/stores/windows.js';
  import Window from './Window.svelte';
  import CharacterEditor from './apps/CharacterEditor.svelte';
  import Wiki from './apps/Wiki.svelte';
  import Timeline from './apps/Timeline.svelte';
  import WorldMap from './apps/WorldMap.svelte';
  import StoryGraph from './apps/StoryGraph.svelte';

  const APP_TITLES: Record<string, string> = {
    'character-editor': 'Character',
    'world-map': 'World Map',
    'timeline': 'Timeline',
    'wiki': 'Wiki',
    'story-graph': 'Story Graph',
  };

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
    title={APP_TITLES[win.appId] ?? win.appId}
    x={win.x}
    y={win.y}
    width={win.width}
    height={win.height}
    zIndex={win.zIndex}
    minimized={win.minimized}
    bare={win.appId === 'story-graph'}
  >
    {#if win.appId === 'character-editor'}
      <CharacterEditor winId={win.id} entityId={win.entityId} />
    {:else if win.appId === 'wiki'}
      <Wiki entityId={win.entityId} />
    {:else if win.appId === 'timeline'}
      <Timeline entityId={win.entityId} />
    {:else if win.appId === 'world-map'}
      <WorldMap entityId={win.entityId} />
    {:else if win.appId === 'story-graph'}
      <StoryGraph />
    {/if}
  </Window>
{/each}
