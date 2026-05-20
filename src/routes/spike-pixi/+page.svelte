<script lang="ts">
  /**
   * Pre-Slice 0 spike: Pixi v8 + Svelte 5 integration via svelte-pixi@8.0.1.
   *
   * Validates the four acceptance criteria from
   * docs/plans/world-map-v3-pre-slice-0-spike.md:
   *   1. Mount        — Application + Graphics polygon + Sprite render without errors
   *   2. Lifecycle    — back-and-forth navigation leaks no Application instances
   *   3. Reactivity   — $state array mutations drive the canvas within one frame
   *   4. Hot reload   — Vite HMR updates canvas without page refresh or leaks
   *
   * The /spike-pixi route is DELETED before the branch merges. Findings doc is
   * the deliverable, not this code.
   */
  import { Application, Graphics, Sprite } from 'svelte-pixi';
  import { Texture, type Graphics as PixiGraphics, type Sprite as PixiSprite } from 'pixi.js';

  type Circle = { id: number; x: number; y: number; color: number; radius: number };

  // Polygon vertices for the static Graphics shape (a triangle is fine per spike doc).
  const triangle: [number, number][] = [
    [100, 50],
    [180, 200],
    [20, 200],
  ];

  // Reactive state — items array drives the canvas.
  let nextId = $state(0);
  let items = $state<Circle[]>([
    { id: nextId++, x: 320, y: 120, color: 0xff4d6d, radius: 24 },
    { id: nextId++, x: 420, y: 200, color: 0x4dd0e1, radius: 18 },
    { id: nextId++, x: 360, y: 280, color: 0xffd166, radius: 32 },
  ]);

  function randomColor(): number {
    return Math.floor(Math.random() * 0xffffff);
  }

  function addItem() {
    items.push({
      id: nextId++,
      x: 100 + Math.random() * 400,
      y: 100 + Math.random() * 300,
      color: randomColor(),
      radius: 12 + Math.random() * 24,
    });
  }

  function removeLast() {
    items.pop();
  }

  function recolorAll() {
    for (const it of items) {
      it.color = randomColor();
    }
  }

  function drawTriangle(g: PixiGraphics) {
    g.clear();
    g.poly(triangle.flat()).fill({ color: 0x6cc24a, alpha: 0.85 }).stroke({ color: 0xffffff, width: 2 });
  }

  function drawCircle(g: PixiGraphics, circle: Circle) {
    g.clear();
    g.circle(0, 0, circle.radius).fill({ color: circle.color }).stroke({ color: 0xffffff, width: 1 });
  }

  // Tint is not exposed on svelte-pixi's declarative SpriteProps; set it via instance bind.
  let spriteInstance: PixiSprite | undefined = $state();
  $effect(() => {
    if (spriteInstance) spriteInstance.tint = 0xa6e22e;
  });
</script>

<svelte:head>
  <title>Pixi v8 + Svelte 5 spike</title>
</svelte:head>

<div class="page">
  <header>
    <h1>Pre-Slice 0 spike</h1>
    <p>
      Pixi v8 + Svelte 5 integration via <code>svelte-pixi@8.0.1</code>. Tests mount, lifecycle, reactivity, HMR.
      <a href="/">← Home</a> · <a href="/spike-pixi">⟳ Reload</a>
    </p>
  </header>

  <div class="controls" data-testid="spike-controls">
    <button type="button" onclick={addItem} data-testid="add">Add item</button>
    <button type="button" onclick={removeLast} data-testid="remove">Remove last</button>
    <button type="button" onclick={recolorAll} data-testid="recolor">Recolor all</button>
    <span class="count" data-testid="count">Items: {items.length}</span>
  </div>

  <div class="stage-wrap" data-testid="stage-wrap">
    <Application width={640} height={420} background={0x101820} antialias>
      <!-- Static sprite: a tinted 1x1 WHITE texture as the spike's "image". Tint set via instance. -->
      <Sprite bind:instance={spriteInstance} texture={Texture.WHITE} x={20} y={20} width={60} height={20} />

      <!-- Static Graphics polygon (criterion 1: at least one polygon renders). -->
      <Graphics draw={drawTriangle} />

      <!-- Reactive Graphics circles driven by $state array (criterion 3). -->
      {#each items as item (item.id)}
        <Graphics x={item.x} y={item.y} draw={(g) => drawCircle(g, item)} />
      {/each}
    </Application>
  </div>

  <details class="notes">
    <summary>Spike notes (manual checks)</summary>
    <ol>
      <li><strong>Criterion 1 — Mount.</strong> Page loads, canvas renders polygon + sprite + 3 circles, console clean.</li>
      <li>
        <strong>Criterion 2 — Lifecycle.</strong> DevTools → Memory → Heap snapshot. Navigate to / and back ten times.
        Take second snapshot. Diff: zero retained <code>Application</code> instances.
      </li>
      <li>
        <strong>Criterion 3 — Reactivity.</strong> Click Add / Remove / Recolor. Canvas updates within one frame.
      </li>
      <li>
        <strong>Criterion 4 — Hot reload.</strong> Edit this file with <code>npm run dev</code> running.
        Canvas updates without page refresh, no console errors, no retained instances across 10 saves.
      </li>
    </ol>
  </details>
</div>

<style>
  .page {
    max-width: 720px;
    margin: 40px auto;
    padding: 0 24px;
    font-family: var(--font-ui, system-ui);
    color: var(--color-text, #e6e6e6);
  }
  header h1 {
    margin: 0 0 4px;
    font-size: 24px;
  }
  header p {
    margin: 0 0 24px;
    font-size: 14px;
    color: var(--color-text-muted, #9aa);
  }
  header a {
    color: var(--color-accent, #4dd0e1);
  }
  .controls {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    align-items: center;
  }
  .controls button {
    background: var(--color-accent, #4dd0e1);
    color: #101820;
    border: 0;
    padding: 8px 14px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .controls button:hover {
    opacity: 0.9;
  }
  .count {
    margin-left: auto;
    font-size: 13px;
    color: var(--color-text-muted, #9aa);
  }
  .stage-wrap {
    width: 640px;
    max-width: 100%;
    aspect-ratio: 640 / 420;
    background: #000;
    border-radius: 8px;
    overflow: hidden;
  }
  .notes {
    margin-top: 24px;
    font-size: 13px;
    color: var(--color-text-muted, #9aa);
  }
  .notes ol {
    margin: 8px 0 0 20px;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
</style>
