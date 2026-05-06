<script lang="ts">
  let { active = false }: { active?: boolean } = $props();

  const nodes = [
    { x: 40, y: 30, color: 'var(--color-type-character)', label: 'Elena' },
    { x: 120, y: 60, color: 'var(--color-type-character)', label: 'Marcus' },
    { x: 80, y: 100, color: 'var(--color-type-location)', label: 'Thornfield' },
    { x: 160, y: 35, color: 'var(--color-type-event)', label: 'The Fire' },
  ];

  const edges = [
    { from: 0, to: 1, color: 'var(--color-rel-arc)' },
    { from: 0, to: 2, color: 'var(--color-rel-loc)' },
    { from: 1, to: 3, color: 'var(--color-rel-event)' },
    { from: 2, to: 3, color: 'var(--color-rel-event)' },
  ];
</script>

<div class="mini-graph" class:active role="img" aria-label="Story graph visualization showing character connections">
  <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    {#each edges as edge, i}
      <line
        x1={nodes[edge.from].x}
        y1={nodes[edge.from].y}
        x2={nodes[edge.to].x}
        y2={nodes[edge.to].y}
        stroke={edge.color}
        stroke-width="1"
        class="edge"
        style="--i: {i}"
      />
    {/each}
    {#each nodes as node, i}
      <circle cx={node.x} cy={node.y} r="8" fill={node.color} class="node" style="--i: {i}" />
      <text x={node.x} y={node.y + 18} text-anchor="middle" fill="var(--color-text-muted)" font-size="7" font-family="var(--font-ui)" class="label" style="--i: {i}">{node.label}</text>
    {/each}
  </svg>
</div>

<style>
  .mini-graph {
    opacity: 0;
    transition: opacity 0.6s ease 0.2s;
  }

  .mini-graph.active {
    opacity: 1;
  }

  .edge {
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
    transition: stroke-dashoffset 0.8s ease calc(0.3s + var(--i) * 0.15s);
  }

  .mini-graph.active .edge {
    stroke-dashoffset: 0;
  }

  .node {
    opacity: 0;
    transform-origin: center;
    transition: opacity 0.4s ease calc(0.1s + var(--i) * 0.1s);
  }

  .mini-graph.active .node {
    opacity: 1;
  }

  .label {
    opacity: 0;
    transition: opacity 0.3s ease calc(0.5s + var(--i) * 0.1s);
  }

  .mini-graph.active .label {
    opacity: 1;
  }
</style>
