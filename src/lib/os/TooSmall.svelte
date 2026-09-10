<script lang="ts">
  let { onContinue }: { onContinue: () => void } = $props();
</script>

<div class="too-small-inner">
  <p class="app-name">betwixt-and-between</p>
  <p class="message">Works best on a larger screen.<br>Expand your browser window for more room, or continue at this size.</p>
  <button onclick={onContinue}>Continue at this size</button>
</div>

<style>
  .too-small-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--color-text-muted);
    text-align: center;
    padding: 40px;
  }

  .app-name {
    font-family: var(--font-display);
    font-size: 21px;
    color: var(--color-text);
  }

  .message {
    font-size: 15px;
    line-height: 1.6;
  }
</style>
