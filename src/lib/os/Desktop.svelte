<script lang="ts">
  import { entities } from '$lib/stores/entities.js';
  import { onMount } from 'svelte';

  let tutorialDismissed = $state(false);
  let showTutorial = $state(false);

  onMount(() => {
    tutorialDismissed = localStorage.getItem('tutorial-dismissed') === 'true';
    showTutorial = !tutorialDismissed;
  });

  function dismissTutorial() {
    tutorialDismissed = true;
    showTutorial = false;
    localStorage.setItem('tutorial-dismissed', 'true');
  }

  const hasEntities = $derived($entities.length > 0);

  const TUTORIAL_ITEMS = [
    { icon: '👤', name: 'Characters', desc: 'manage your cast' },
    { icon: '🕸', name: 'Story Graph', desc: 'see how they connect' },
    { icon: '📅', name: 'Timeline', desc: 'track events and arcs' },
    { icon: '🗺', name: 'World Map', desc: 'build your world' },
    { icon: '📝', name: 'Wiki', desc: 'capture your notes' },
  ];
</script>

<div class="desktop">
  {#if !hasEntities}
    <p class="empty-tagline">Your story starts here.</p>
  {/if}

  {#if showTutorial}
    <div class="tutorial-overlay" role="dialog" aria-label="Tutorial">
      <div class="tutorial-card">
        <p class="tutorial-heading">Welcome to betwixt-and-between</p>
        <ul class="tutorial-list">
          {#each TUTORIAL_ITEMS as item}
            <li>
              <span class="t-icon">{item.icon}</span>
              <span><strong>{item.name}</strong> — {item.desc}</span>
            </li>
          {/each}
        </ul>
        <button class="dismiss-btn" onclick={dismissTutorial}>Got it</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .desktop {
    position: fixed;
    inset: 0;
    bottom: 52px;
    background: var(--color-desktop);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .empty-tagline {
    font-family: var(--font-ui);
    font-size: 14px;
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
    pointer-events: none;
  }

  .tutorial-overlay {
    position: fixed;
    inset: 0;
    bottom: 52px;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 8000;
    pointer-events: all;
  }

  .tutorial-card {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 28px 32px;
    max-width: 380px;
    width: 100%;
    box-shadow: var(--window-shadow);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .tutorial-heading {
    font-family: var(--font-display);
    font-size: 21px;
    color: var(--color-text);
  }

  .tutorial-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tutorial-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--color-text-muted);
  }

  .tutorial-list strong {
    color: var(--color-text);
    font-weight: 500;
  }

  .t-icon {
    font-size: 17px;
    width: 24px;
    text-align: center;
    flex-shrink: 0;
  }

  .dismiss-btn {
    align-self: flex-end;
    background: var(--color-accent);
    color: var(--color-surface);
    border: none;
    border-radius: 6px;
    padding: 8px 20px;
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .dismiss-btn:hover {
    opacity: 0.85;
  }
</style>
