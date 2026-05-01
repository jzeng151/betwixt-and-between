<script lang="ts">
	/**
	 * Drag-reorder list of EntityType ranks for "Layout by type" (Phase 1B C7).
	 *
	 * Order top → bottom mirrors the dagre rank assignment in C5: the entity
	 * type at index 0 lays out at the top of the canvas, index N-1 at the
	 * bottom. The user reorders via simple HTML5 drag-and-drop; an "Apply"
	 * button is exposed via the `onApply` callback so the host can run
	 * layout-by-type with the new ranks.
	 *
	 * State is owned by the host (passed in as `value`); changes flow back
	 * through `onChange`. The host typically mirrors `value` to per-window
	 * state via windowStore.setTypeOrder.
	 */
	import type { EntityType } from '$lib/server/db/schema.js';

	interface Props {
		value: EntityType[];
		onChange: (next: EntityType[]) => void;
		onApply?: () => void;
	}

	let { value, onChange, onApply }: Props = $props();

	let dragIndex = $state<number | null>(null);
	let overIndex = $state<number | null>(null);

	function onDragStart(e: DragEvent, i: number) {
		dragIndex = i;
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	function onDragOver(e: DragEvent, i: number) {
		e.preventDefault();
		overIndex = i;
	}

	function onDragLeave() {
		overIndex = null;
	}

	function onDrop(e: DragEvent, i: number) {
		e.preventDefault();
		const from = dragIndex;
		dragIndex = null;
		overIndex = null;
		if (from === null || from === i) return;
		const next = [...value];
		const [moved] = next.splice(from, 1);
		next.splice(i, 0, moved);
		onChange(next);
	}

	function onDragEnd() {
		dragIndex = null;
		overIndex = null;
	}
</script>

<div class="type-order">
	<p class="type-order-heading">Layout order (top → bottom)</p>
	<ul class="type-order-list">
		{#each value as type, i (type)}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<li
				class="type-order-item"
				class:dragging={dragIndex === i}
				class:over={overIndex === i && dragIndex !== i}
				draggable="true"
				ondragstart={(e) => onDragStart(e, i)}
				ondragover={(e) => onDragOver(e, i)}
				ondragleave={onDragLeave}
				ondrop={(e) => onDrop(e, i)}
				ondragend={onDragEnd}
			>
				<span class="grip" aria-hidden="true">⋮⋮</span>
				<span class="label">{type}</span>
			</li>
		{/each}
	</ul>
	{#if onApply}
		<button class="apply-btn" onclick={onApply}>Apply layout</button>
	{/if}
</div>

<style>
	.type-order {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-family: var(--font-ui);
		font-size: 12px;
		min-width: 180px;
	}

	.type-order-heading {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.type-order-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.type-order-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		cursor: grab;
		user-select: none;
	}

	.type-order-item.dragging {
		opacity: 0.4;
	}

	.type-order-item.over {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
	}

	.grip {
		color: var(--color-text-muted);
		font-size: 14px;
		line-height: 1;
		letter-spacing: -2px;
	}

	.label {
		color: var(--color-text);
	}

	.apply-btn {
		padding: 6px 10px;
		border: 1px solid var(--color-accent);
		border-radius: 4px;
		background: var(--color-accent);
		color: white;
		cursor: pointer;
		font-family: inherit;
		font-size: 12px;
	}

	.apply-btn:hover {
		filter: brightness(1.1);
	}
</style>
