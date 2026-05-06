<script lang="ts">
  import MiniWindow from './MiniWindow.svelte';
  import MiniGraph from './MiniGraph.svelte';
  import MiniTimeline from './MiniTimeline.svelte';
  import MiniMap from './MiniMap.svelte';

  let { activeSections = new Set<string>() }: { activeSections?: Set<string> } = $props();

  const charsActive = $derived(activeSections.has('characters'));
  const graphActive = $derived(activeSections.has('graph'));
  const timelineActive = $derived(activeSections.has('timeline'));
  const mapActive = $derived(activeSections.has('map'));
</script>

<div class="mini-desktop" role="img" aria-label="Miniature betwixt-and-between desktop workspace">
  <div class="windows">
    <div class="col col-left">
      <MiniWindow title="Characters" active={charsActive}>
        <div class="entity-list">
          <div class="entity-chip" style="border-color: var(--color-type-character)">Elena Ashford</div>
          <div class="entity-chip" style="border-color: var(--color-type-character)">Marcus Vael</div>
          <div class="entity-chip" style="border-color: var(--color-type-character)">Sera Lin</div>
        </div>
      </MiniWindow>
      <MiniWindow title="Timeline" active={timelineActive}>
        <MiniTimeline active={timelineActive} />
      </MiniWindow>
    </div>
    <div class="col col-right">
      <MiniWindow title="Story Graph" active={graphActive}>
        <MiniGraph active={graphActive} />
      </MiniWindow>
      <MiniWindow title="World Map" active={mapActive}>
        <MiniMap active={mapActive} />
      </MiniWindow>
    </div>
  </div>
</div>

<style>
  .mini-desktop {
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    background: var(--color-desktop);
    border-radius: 10px;
    border: 1px solid var(--color-border);
    padding: 12px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
    aspect-ratio: 16 / 10;
  }

  .windows {
    display: flex;
    gap: 10px;
    height: 100%;
  }

  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .entity-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .entity-chip {
    font-family: var(--font-display);
    font-size: 10px;
    color: var(--color-text);
    padding: 3px 6px;
    border-left: 2px solid;
    background: var(--color-surface-2);
    border-radius: 2px;
  }

  @media (max-width: 767px) {
    .mini-desktop {
      max-width: 80vw;
    }
  }
</style>
