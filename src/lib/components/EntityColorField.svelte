<!--
  EntityColorField — Settings customization Phase 2, Item 2 (edit-in-place).
  A compact picker that writes the per-entity `data.color` override (the layer
  shared by the graph node, the timeline bar, AND the map sprite via
  characterColorFor / style-cascade). Reused by PlacementStylePopover ("this
  entity everywhere") and the story-graph node right-click recolor, so both use
  ONE write path — `entities.updateEntity` with a merged data blob, the same
  path CharacterEditorBody uses.

  Swatches + native color wheel + reset. Writes optimistically through the
  entities store; the map/graph repaint follows from the store update.
-->
<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { CHARACTER_COLORS, HEX_COLOR_RE } from '$lib/features/timeline/timeline-helpers.js';
	import type { Entity } from '$lib/stores/entities.js';

	interface Props {
		entity: Entity;
	}
	let { entity }: Props = $props();

	const current = $derived.by(() => {
		const c = (entity.data as Record<string, unknown> | null | undefined)?.color;
		return typeof c === 'string' && HEX_COLOR_RE.test(c) ? c.toLowerCase() : null;
	});

	async function write(color: string | null) {
		const data = { ...((entity.data as Record<string, unknown>) ?? {}) };
		if (color) data.color = color;
		else delete data.color;
		await entities.updateEntity(entity.id, { data });
	}
</script>

<div class="entity-color">
	<div class="swatch-row" role="group" aria-label="Entity color">
		{#each CHARACTER_COLORS as hex}
			<button
				type="button"
				class="swatch"
				class:swatch-selected={current === hex}
				style="--sw:{hex}"
				aria-label={hex}
				aria-pressed={current === hex}
				title={hex}
				onclick={() => write(hex)}
			></button>
		{/each}
		<input
			type="color"
			class="color-wheel"
			value={current ?? CHARACTER_COLORS[0]}
			onchange={(e) => write((e.currentTarget as HTMLInputElement).value.toLowerCase())}
			aria-label="Custom color picker"
		/>
	</div>
	{#if current}
		<button type="button" class="reset-btn" onclick={() => write(null)}>Reset to default</button>
	{/if}
</div>

<style>
	.entity-color {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.swatch-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--sw);
		border: 1px solid var(--color-border, #2a2d35);
		cursor: pointer;
	}
	.swatch-selected {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.swatch:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.color-wheel {
		width: 28px;
		height: 28px;
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 0;
		background: transparent;
		cursor: pointer;
	}
	.reset-btn {
		align-self: flex-start;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 10px;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
		padding: 0;
	}
	.reset-btn:hover {
		color: var(--color-accent);
	}
</style>
