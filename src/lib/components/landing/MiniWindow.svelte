<script lang="ts">
  let { title = '', active = false, children }: { title?: string; active?: boolean; children?: import('svelte').Snippet } = $props();
</script>

<div class="mini-window" class:active>
  <div class="titlebar">
    <div class="dots">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
    <span class="title">{title}</span>
  </div>
  <div class="content">
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>

<style>
  .mini-window {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
    opacity: 0;
    transform: translateY(8px) scale(0.96);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }

  .mini-window.active {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .titlebar {
    background: var(--color-surface-2);
    padding: 4px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid var(--color-border);
  }

  .dots {
    display: flex;
    gap: 3px;
  }

  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-border);
  }

  .title {
    font-family: var(--font-ui);
    font-size: 9px;
    font-weight: 500;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .content {
    padding: 8px;
    min-height: 40px;
  }
</style>
