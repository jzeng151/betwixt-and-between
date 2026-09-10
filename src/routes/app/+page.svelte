<script lang="ts">
  import { onMount } from 'svelte';
  import Desktop from '$lib/os/Desktop.svelte';
  import WindowManager from '$lib/os/WindowManager.svelte';
  import Taskbar from '$lib/os/Taskbar.svelte';
  import TooSmall from '$lib/os/TooSmall.svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';

  let allowSmallScreen = $state(false);
  let loaded = false;

  function loadCoreStores() {
    if (loaded) return;
    loaded = true;
    void Promise.allSettled([entities.load(), relationships.load()]);
  }

  onMount(() => {
    const supported = window.matchMedia('(min-width: 1280px)');
    function loadIfSupported() {
      if (supported.matches) loadCoreStores();
    }
    loadIfSupported();
    supported.addEventListener('change', loadIfSupported);
    return () => supported.removeEventListener('change', loadIfSupported);
  });
</script>

<svelte:head>
  <title>Betwixt &amp; Between</title>
</svelte:head>

<div class="too-small" class:small-screen-accepted={allowSmallScreen} style="display:none; height:100vh; align-items:center; justify-content:center; background:var(--color-desktop)">
  <TooSmall onContinue={() => { allowSmallScreen = true; loadCoreStores(); }} />
</div>

<div class="app-shell" class:small-screen-accepted={allowSmallScreen}>
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
