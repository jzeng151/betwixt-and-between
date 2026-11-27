<script lang="ts">
	import type { Snippet } from 'svelte';

	const { type, readOnly, children }: {
		type: 'Act' | 'Scene' | 'Event' | 'Location';
		readOnly: boolean;
		children: Snippet;
	} = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (Read-only fields need a tab stop for native keyboard scrolling.) -->
<div
	class="entity-detail"
	data-editor-type={type}
	role={readOnly ? 'region' : undefined}
	aria-label={readOnly ? `${type} details` : undefined}
	tabindex={readOnly ? 0 : undefined}
>
	{@render children()}
</div>

<style>
	.entity-detail {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		flex: 1 1 0;
		overflow-y: auto;
		min-height: 0;
	}
	.entity-detail[data-editor-type='Location'] {
		gap: 12px;
	}
	.entity-detail:focus-visible {
		outline: 2px solid var(--color-text);
		outline-offset: -3px;
	}
</style>
