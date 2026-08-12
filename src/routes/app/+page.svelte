<script lang="ts">
  import { onMount } from 'svelte';
  import Desktop from '$lib/os/Desktop.svelte';
  import WindowManager from '$lib/os/WindowManager.svelte';
  import Taskbar from '$lib/os/Taskbar.svelte';
  import TooSmall from '$lib/os/TooSmall.svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';

  onMount(async () => {
    if (window.innerWidth < 1280) return;
    await Promise.all([entities.load(), relationships.load()]);
  });
</script>

<svelte:head>
  <title>Betwixt &amp; Between</title>
</svelte:head>

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
