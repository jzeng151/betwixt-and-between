<script lang="ts">
  import { onMount } from 'svelte';
  import { windowStore } from '$lib/os/windows-store.js';
  import type { PageData } from './$types.js';

  import Desktop from '$lib/os/Desktop.svelte';
  import WindowManager from '$lib/os/WindowManager.svelte';
  import Taskbar from '$lib/os/Taskbar.svelte';
  import TooSmall from '$lib/os/TooSmall.svelte';
  import { entities } from '$lib/stores/entities.js';
  import { relationships } from '$lib/stores/relationships.js';

  let { data }: { data: PageData } = $props();
  const userId = $derived(data.user.id);
  const storyId = $derived(data.story.id);
  $effect(() => windowStore.startSession(userId, storyId));

  let allowSmallScreen = $state(false);
  let loaded = false;

  function loadCoreStores() {
    if (loaded) return;
    loaded = true;
    void Promise.allSettled([entities.load(), relationships.load()]);
  }

  function continueAtThisSize() {
    allowSmallScreen = true;
    try { sessionStorage.setItem('betwixt-small-screen', 'true'); } catch { /* Storage is optional. */ }
    loadCoreStores();
  }

  onMount(() => {
    try { allowSmallScreen = sessionStorage.getItem('betwixt-small-screen') === 'true'; } catch { /* Storage is optional. */ }
    const supported = window.matchMedia('(min-width: 1280px)');
    function loadIfSupported() {
      if (supported.matches || allowSmallScreen) loadCoreStores();
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
  <TooSmall onContinue={continueAtThisSize} />
</div>

<div class="app-shell" class:small-screen-accepted={allowSmallScreen}>
  <Desktop />
  <div class="story-name" title="Switch or rename stories in Settings → Stories">{data.story.name}</div>
  <WindowManager />
  <Taskbar />
</div>

<style>
  .story-name { position: absolute; top: 12px; left: 20px; color: var(--color-text-muted); max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
  .app-shell {
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    position: relative;
  }
</style>
