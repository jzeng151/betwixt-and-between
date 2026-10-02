<script lang="ts">
  import { onMount } from 'svelte';
  import { entities, entitySnapshotReady, entityLoadStatus } from '$lib/stores/entities.js';
  import { worldMaps } from '$lib/features/map/store.js';

  type Target = { kind: 'entity' | 'map' | 'graph'; id: string };
  let { disabled = false, onAdd, onClose }: {
    disabled?: boolean;
    onAdd: (targets: Target[]) => boolean;
    onClose: () => void;
  } = $props();

  let query = $state(''), type = $state('all'), selected = $state<Target[]>([]);
  let search: HTMLInputElement;
  const storyEntities = $derived($entitySnapshotReady ? $entities.filter(entity => entity.type !== 'Note' || !entity.data.isFolder) : []);
  const types = $derived([...new Set(storyEntities.map(entity => entity.type))].sort());
  const candidates = $derived([
    ...(type === 'map' ? [] : storyEntities.filter(entity => type === 'all' || type === 'graph' || type === entity.type).map(entity => ({
      kind: type === 'graph' ? 'graph' as const : 'entity' as const,
      id: entity.id,
      name: entity.name,
      label: type === 'graph' ? `Focused graph · ${entity.type}` : entity.type
    }))),
    ...(type === 'all' || type === 'map' ? $worldMaps.map(map => ({ kind: 'map' as const, id: map.id, name: map.name, label: 'Map' })) : [])
  ]);
  const matches = $derived(candidates.filter(item => `${item.name} ${item.label} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase())));
  const visible = $derived(matches.slice(0, 100));

  onMount(() => { search.focus(); });

  export function focus() { search.focus(); }

  function toggle(target: Target, checked: boolean) {
    if (disabled) return;
    selected = checked ? [...selected, { kind: target.kind, id: target.id }] : selected.filter(item => item.kind !== target.kind || item.id !== target.id);
  }
  function add() {
    if (!disabled && selected.length && onAdd($state.snapshot(selected))) onClose();
  }
  function keydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Picker controls own their keyboard events so canvas shortcuts cannot edit the board.) -->
<section class="story-picker" aria-label="Add from story" onkeydown={keydown}>
  <h2>Add from story</h2>
  <div class="filters">
    <label class="search">Find <input bind:this={search} bind:value={query} aria-label="Find story items" placeholder="Search by name or type" disabled={disabled} /></label>
    <label>Type <select bind:value={type} aria-label="Story item type" disabled={disabled}>
      <option value="all">All types</option>
      {#each types as entityType}<option value={entityType}>{entityType}</option>{/each}
      <option value="map">Maps</option>
      <option value="graph">Focused graphs</option>
    </select></label>
  </div>
  {#if !$entitySnapshotReady}
    {#if $entityLoadStatus === 'error'}
      <div class="load-message" role="alert"><span>Couldn't load story items.</span><button disabled={disabled} onclick={() => { void entities.load().catch(() => {}); }}>Retry story items</button></div>
    {:else}
      <p class="load-message" role="status">Loading story items…</p>
    {/if}
  {/if}
  <div class="results" aria-label="Story items">
    {#each visible as item (`${item.kind}:${item.id}`)}
      <label class="result" class:unavailable={disabled}>
        <input type="checkbox" checked={selected.some(target => target.kind === item.kind && target.id === item.id)} disabled={disabled} onchange={event => toggle(item, event.currentTarget.checked)} />
        <span class="name">{item.name}</span><span class="type">{item.label}</span>
      </label>
    {/each}
    {#if !matches.length && ($entitySnapshotReady || type === 'map')}
      <p class="empty">{query.trim() ? 'No story items match this search. Try another name or type.' : type === 'all' ? 'No story items yet. Create an entity or map, then add it here.' : 'No items of this type yet. Choose another type or create one in your story.'}</p>
    {/if}
  </div>
  <footer>
    <div class="counts" role="status">
      <strong>{selected.length} selected</strong>
      <span>{matches.length > 100 ? `Showing 100 of ${matches.length} matches. Refine your search to find more.` : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`}</span>
    </div>
    <button onclick={onClose}>Cancel</button>
    <button class="primary" disabled={disabled || !selected.length} onclick={add}>Add {selected.length} {selected.length === 1 ? 'item' : 'items'}</button>
  </footer>
</section>

<style>
  .story-picker { flex-shrink: 0; padding: 10px; border-bottom: 1px solid var(--color-border); color: var(--color-text); font: 12px var(--font-ui, 'Inter', sans-serif); }
  h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
  button, input, select { box-sizing: border-box; min-height: 32px; border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); background: var(--color-surface-2); font: inherit; }
  button { padding: 5px 10px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--color-surface); }
  button:disabled, input:disabled, select:disabled, .unavailable { opacity: 0.5; cursor: default; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  input, select { padding: 5px 7px; min-width: 0; }
  input { caret-color: var(--color-focus); }
  input::placeholder { color: var(--color-text-muted); }
  input::selection { color: var(--color-surface); background: var(--color-focus); }
  .filters, .filters label, footer, .load-message { display: flex; align-items: center; gap: 8px; }
  .filters, footer { flex-wrap: wrap; }
  .search { flex: 1 1 200px; }
  .search input { width: 100%; }
  .results { max-height: 180px; overflow-y: auto; margin-top: 8px; scrollbar-color: var(--color-border) var(--color-surface); }
  .result { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
  .result:hover, .result:has(input:checked) { background: var(--color-surface-2); }
  .result input { flex-shrink: 0; width: 16px; height: 16px; min-height: 0; margin: 0; accent-color: var(--color-focus); }
  .name { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .type { color: var(--color-text-muted); font-size: 11px; text-align: right; }
  .empty, .load-message { margin: 0; padding: 10px 6px; color: var(--color-text-muted); line-height: 1.5; }
  .load-message { flex-wrap: wrap; }
  footer { margin-top: 8px; }
  .counts { display: flex; flex: 1 1 180px; flex-wrap: wrap; gap: 4px 10px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
  .counts strong { color: var(--color-text); font-weight: 600; }
  .primary { border-color: var(--color-focus); font-weight: 600; }
</style>
