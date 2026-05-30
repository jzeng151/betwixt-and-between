<script lang="ts">
	/**
	 * PlaceablePalette — Slice 4 PR-D. The single placeables palette, merging the
	 * former PlaceablesPalette (click-to-arm) and AssetLibrary (drag-to-drop) into
	 * one chip rail. Each chip supports BOTH affordances:
	 *
	 *   - click → arms the chip (keyboard- and touch-accessible); the parent
	 *     (WorldMap) places it on the next canvas tap. Click the armed chip again
	 *     to cancel.
	 *   - drag → drag source carrying `application/x-betwixt-asset`; WorldMap's
	 *     drop handler creates a placement at the dropped point. Mouse-only, so
	 *     click-to-arm remains the accessible path.
	 *
	 * Membership (D3 fix): one source list, filtered to PlaceableEntityType
	 * (Character / Artifact / Item — the polymorphic FK constraint on
	 * map_placements.placeable_id) AND `data.is_asset !== false`. Setting
	 * `data.is_asset = false` now removes an entity from the palette entirely —
	 * the old PlaceablesPalette ignored the flag, so "remove from library" leaked
	 * the entity back into the click-to-place list.
	 *
	 * Inline `+ Artifact` / `+ Item` mint a placeable without leaving the map
	 * (new Characters are authored in the Characters app).
	 */
	import { entities } from '$lib/stores/entities.js';
	import { windowStore } from '$lib/os/windows-store.js';
	import { pendingEditMode } from '$lib/components/EntityDetail.svelte';
	import { getEntityTypeColor } from '$lib/entity-type-colors.js';
	import { ASSET_DRAG_MIME } from './asset-drag.js';
	import type { Entity } from '$lib/stores/entities.js';
	import type { EntityType } from '$lib/server/db/schema.js';

	interface Props {
		armedId: string | null;
		onArm: (id: string | null) => void;
	}
	let { armedId, onArm }: Props = $props();

	const PLACEABLE_TYPES: EntityType[] = ['Character', 'Artifact', 'Item'];

	let busy = $state(false);
	let createError = $state('');
	let draggingId = $state<string | null>(null);

	let placeables = $derived(
		$entities
			.filter((e) => {
				if (!PLACEABLE_TYPES.includes(e.type)) return false;
				// D3: opt-out via data.is_asset === false. Default true. Applied to
				// the single list so click-to-place respects it too (the old
				// PlaceablesPalette didn't, leaking opted-out entities).
				const flag = (e.data ?? {})['is_asset'];
				return flag !== false;
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	function toggleArm(id: string) {
		onArm(armedId === id ? null : id);
	}

	function onDragStart(e: DragEvent, entity: Entity): void {
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'copy';
		e.dataTransfer.setData(ASSET_DRAG_MIME, entity.id);
		// Plain-text fallback for dev tools / accidental drops outside our handler.
		e.dataTransfer.setData('text/plain', `betwixt-asset:${entity.id}`);
		draggingId = entity.id;
	}

	function onDragEnd(): void {
		draggingId = null;
	}

	async function createNew(type: 'Artifact' | 'Item') {
		if (busy) return;
		busy = true;
		createError = '';
		try {
			// `Untitled <Type>` reads as in-progress rather than broken when the new
			// row briefly appears in other lists before the user types a real name.
			const created = await entities.createEntity(type, `Untitled ${type}`);
			pendingEditMode.add(created.id);
			windowStore.open('entity-detail', created.id);
			onArm(created.id);
		} catch (err) {
			createError = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<div class="placeable-palette" data-testid="placeable-palette">
	<div class="palette-header">
		<span class="palette-title">Placeables</span>
		<span class="palette-hint">
			{#if draggingId}
				drop on the map to place
			{:else if armedId}
				click on map to place
			{:else}
				click or drag a chip onto the map
			{/if}
		</span>
	</div>

	<div class="palette-body">
		<div class="palette-chips">
			{#each placeables as p (p.id)}
				<button
					class="chip"
					class:armed={armedId === p.id}
					class:dragging={draggingId === p.id}
					aria-pressed={armedId === p.id}
					style="--type-color: {getEntityTypeColor(p.type)}"
					draggable="true"
					ondragstart={(e) => onDragStart(e, p)}
					ondragend={onDragEnd}
					onclick={() => toggleArm(p.id)}
					title={`${p.type} — click to arm, or drag onto the map`}
					type="button"
				>
					<span class="chip-stripe" aria-hidden="true"></span>
					<span class="chip-name">{p.name}</span>
				</button>
			{/each}
			{#if placeables.length === 0}
				<span class="empty">
					No placeables yet. Create a Character, Artifact, or Item to place it here.
				</span>
			{/if}
		</div>

		<div class="palette-new">
			<button type="button" disabled={busy} onclick={() => createNew('Artifact')}>+ Artifact</button>
			<button type="button" disabled={busy} onclick={() => createNew('Item')}>+ Item</button>
		</div>
	</div>

	{#if createError}
		<div class="palette-error" role="alert">{createError}</div>
	{/if}
</div>

<style>
	.placeable-palette {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 10px;
		background: var(--color-panel, rgba(0, 0, 0, 0.6));
		border-top: 1px solid var(--color-border, #333);
		font-size: 12px;
		/* Sit above the MapSidebar (z-index:100). The sidebar is absolutely
		   positioned and would otherwise paint over this bottom-of-column
		   rail, swallowing chip clicks on its right end. */
		position: relative;
		z-index: 150;
	}
	.palette-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.palette-title {
		font-weight: 600;
		color: var(--color-text, #ddd);
	}
	.palette-hint {
		color: var(--color-text-muted, #888);
		font-style: italic;
		font-size: 11px;
	}
	.palette-body {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.palette-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px;
		border-radius: 12px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		cursor: grab;
	}
	.chip:hover {
		border-color: var(--type-color);
	}
	.chip:active {
		cursor: grabbing;
	}
	.chip.armed {
		border-color: var(--type-color);
		background: color-mix(in srgb, var(--type-color) 25%, transparent);
		box-shadow: 0 0 0 1px var(--type-color);
	}
	.chip.dragging {
		opacity: 0.6;
		border-color: var(--type-color);
		box-shadow: 0 0 0 1px var(--type-color);
	}
	.chip-stripe {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--type-color);
	}
	.palette-new {
		display: flex;
		gap: 4px;
	}
	.palette-new button {
		font-size: 11px;
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px dashed var(--color-border, #444);
		background: transparent;
		color: var(--color-text-muted, #aaa);
		cursor: pointer;
	}
	.palette-new button:hover:not(:disabled) {
		color: var(--color-text, #ddd);
		border-color: var(--color-accent, #e8a838);
	}
	.palette-new button:disabled {
		opacity: 0.5;
		cursor: wait;
	}
	.empty {
		color: var(--color-text-muted, #888);
		font-style: italic;
	}
	.palette-error {
		color: #ef4444;
		font-size: 11px;
	}
</style>
