<script lang="ts">
  let { active = false }: { active?: boolean } = $props();

  const events = [
    { label: 'Act I', width: 35, color: 'var(--color-type-act)' },
    { label: 'Act II', width: 50, color: 'var(--color-type-act)', offset: 40 },
    { label: 'Act III', width: 25, color: 'var(--color-type-act)', offset: 95 },
  ];
</script>

<div class="mini-timeline" class:active role="img" aria-label="Timeline visualization showing story acts">
  <div class="track">
    {#each events as evt, i}
      <div class="bar" style="width: {evt.width}%; margin-left: {(evt.offset ?? 0) - (i > 0 ? events[i - 1].width : 0)}%; background: {evt.color}; --i: {i}">
        <span class="bar-label">{evt.label}</span>
      </div>
    {/each}
  </div>
  <div class="line"></div>
</div>

<style>
  .mini-timeline {
    opacity: 0;
    transition: opacity 0.6s ease 0.2s;
  }

  .mini-timeline.active {
    opacity: 1;
  }

  .track {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .bar {
    height: 14px;
    border-radius: 3px;
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.5s ease calc(0.2s + var(--i) * 0.2s);
  }

  .mini-timeline.active .bar {
    transform: scaleX(1);
  }

  .bar-label {
    display: block;
    font-family: var(--font-ui);
    font-size: 8px;
    color: var(--color-text);
    padding: 2px 6px;
    white-space: nowrap;
  }

  .line {
    height: 1px;
    background: var(--color-border);
    margin-top: 6px;
  }
</style>
