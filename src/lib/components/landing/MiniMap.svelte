<script lang="ts">
  let { active = false }: { active?: boolean } = $props();
</script>

<div class="mini-map" class:active role="img" aria-label="World map visualization">
  <div class="map-container">
    <div class="region" style="top: 20%; left: 15%; width: 30%; height: 25%;">
      <span class="region-label">Northern Reach</span>
    </div>
    <div class="region" style="top: 55%; left: 40%; width: 35%; height: 30%;">
      <span class="region-label">Thornfield</span>
    </div>
    <div class="pin" style="top: 30%; left: 25%;"></div>
    <div class="pin" style="top: 70%; left: 55%;"></div>
  </div>
</div>

<style>
  .mini-map {
    opacity: 0;
    transition: opacity 0.6s ease 0.2s;
  }

  .mini-map.active {
    opacity: 1;
  }

  .map-container {
    position: relative;
    width: 100%;
    height: 100px;
    background: var(--color-surface-2);
    border-radius: 4px;
    border: 1px solid var(--color-border);
    overflow: hidden;
  }

  .region {
    position: absolute;
    border: 1px dashed var(--color-accent);
    border-radius: 3px;
    opacity: 0;
    transform: scale(0.9);
    transition: opacity 0.5s ease calc(0.3s + var(--i, 0) * 0.2s), transform 0.5s ease calc(0.3s + var(--i, 0) * 0.2s);
  }

  .mini-map.active .region {
    opacity: 0.4;
    transform: scale(1);
  }

  .region-label {
    display: block;
    font-family: var(--font-ui);
    font-size: 7px;
    color: var(--color-accent);
    padding: 2px;
    opacity: 0;
    transition: opacity 0.3s ease 0.8s;
  }

  .mini-map.active .region-label {
    opacity: 1;
  }

  .pin {
    position: absolute;
    width: 6px;
    height: 6px;
    background: var(--color-accent);
    border-radius: 50%;
    opacity: 0;
    transition: opacity 0.3s ease 0.7s;
  }

  .mini-map.active .pin {
    opacity: 1;
  }
</style>
