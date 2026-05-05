<script lang="ts">
  import { onMount } from 'svelte';
  import Desktop from '$lib/components/Desktop.svelte';
  import WindowManager from '$lib/components/WindowManager.svelte';
  import Taskbar from '$lib/components/Taskbar.svelte';
  import TooSmall from '$lib/components/TooSmall.svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';
  import { entityAliases } from '$lib/stores/entity-aliases.js';
  import { worldMapStore } from '$lib/stores/world-map.js';

  onMount(async () => {
    await Promise.all([entities.load(), relationships.load(), entityAliases.load(), worldMapStore.loadMaps()]);
  });
</script>

<div class="too-small" style="display:none; height:100vh; align-items:center; justify-content:center; background:var(--color-desktop)">
  <TooSmall />
</div>

<div class="app-shell">
  <Desktop />
  <WindowManager />
  <Taskbar />
</div>

<style>
  .app-shell {
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    position: relative;
  }
</style>
