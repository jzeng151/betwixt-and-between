<script lang="ts">
	// Location-hierarchy breadcrumb: each ancestor button drills into that
	// Location's active variant. Styles come from WorldMap.svelte's
	// :global(.map-breadcrumb), :global(.breadcrumb-*) rules.

	let {
		ancestors,
		currentName,
		onNavigate
	}: {
		ancestors: Array<{ id: string; name: string }>;
		currentName: string;
		onNavigate: (locationId: string) => void;
	} = $props();
</script>

<nav class="map-breadcrumb" aria-label="Location hierarchy">
	{#each ancestors as ancestor (ancestor.id)}
		<button
			type="button"
			class="breadcrumb-link"
			onclick={() => onNavigate(ancestor.id)}
		>
			{ancestor.name}
		</button>
		<span class="breadcrumb-sep" aria-hidden="true">›</span>
	{/each}
	<span class="breadcrumb-current">{currentName}</span>
</nav>
