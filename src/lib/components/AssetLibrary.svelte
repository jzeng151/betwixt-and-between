<script lang="ts">
	/**
	 * AssetLibrary — Slice 3 T8' drag-drop palette.
	 *
	 * Outside-voice B1 correction: drops on the map create
	 * `map_placements` rows (NOT new `entities` rows). The drop wiring
	 * lives in WorldMap.svelte; this component is the drag SOURCE.
	 *
	 * Membership: by default every Character / Artifact / Item entity is
	 * a library asset. The user opts an entity OUT by setting
	 * `entity.data.is_asset = false`. Per the eng-review thread #2
	 * resolution this is a flag on entity.data rather than a new
	 * EntityType — keeps the polymorphic FK surface unchanged. Other
	 * EntityType values (Act/Scene/Note/Location/Event) are never in
	 * the library because PlaceableEntityType constrains the
	 * map_placements.placeable_id polymorphic FK.
	 *
	 * Drag protocol: dataTransfer carries
	 * `application/x-betwixt-asset` with the entity id as the payload.
	 * WorldMap.svelte's drop handler reads it; only drops with this
	 * MIME type are accepted (avoids accidental file-drop creating a
	 * placement).
	 *
	 * Slice 3 keeps the click-to-arm flow in PlaceablesPalette
	 * untouched. AssetLibrary is the new drag-drop affordance and lives
	 * alongside.
	 */
	import { entities } from '$lib/stores/entities.js';
	import { getEntityTypeColor } from '$lib/entity-type-colors.js';
	import { ASSET_DRAG_MIME } from './asset-drag.js';
	import type { Entity } from '$lib/stores/entities.js';
	import type { EntityType } from '$lib/server/db/schema.js';

	const PLACEABLE_TYPES: EntityType[] = ['Character', 'Artifact', 'Item'];

	let assets = $derived(
		$entities
			.filter((e) => {
				if (!PLACEABLE_TYPES.includes(e.type)) return false;
				// Opt-out via data.is_asset === false. Default true (any
				// PlaceableEntityType is a library item unless flagged off).
				const flag = (e.data ?? {})['is_asset'];
				return flag !== false;
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	let draggingId = $state<string | null>(null);

	function onDragStart(e: DragEvent, entity: Entity): void {
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'copy';
		e.dataTransfer.setData(ASSET_DRAG_MIME, entity.id);
		// Plain-text fallback for cross-browser dev tools / accidental
		// drops outside our handler — gives a readable hint instead of
		// an opaque MIME blob.
		e.dataTransfer.setData('text/plain', `betwixt-asset:${entity.id}`);
		draggingId = entity.id;
	}

	function onDragEnd(): void {
		draggingId = null;
	}
</script>

<div class="asset-library" data-testid="asset-library">
	<div class="palette-header">
		<span class="palette-title">Library</span>
		<span class="palette-hint">
			{#if draggingId}
				drop on the map to place
			{:else}
				drag a chip onto the map
			{/if}
		</span>
	</div>

	<div class="palette-body">
		{#each assets as a (a.id)}
			<button
				type="button"
				class="chip"
				class:dragging={draggingId === a.id}
				style="--type-color: {getEntityTypeColor(a.type)}"
				draggable="true"
				ondragstart={(e) => onDragStart(e, a)}
				ondragend={onDragEnd}
				title={`${a.type} — drag onto the map to place`}
			>
				<span class="chip-stripe" aria-hidden="true"></span>
				<span class="chip-name">{a.name}</span>
			</button>
		{:else}
			<span class="empty">No Characters / Artifacts / Items yet.</span>
		{/each}
	</div>
</div>

<style>
	.asset-library {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 10px;
		background: var(--color-panel, rgba(0, 0, 0, 0.6));
		border-top: 1px solid var(--color-border, #333);
		font-size: 12px;
		/* Sit above the MapSidebar (z-index:100) so the absolutely-positioned
		   sidebar doesn't paint over this bottom-of-column rail. */
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
		gap: 4px;
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
	.empty {
		color: var(--color-text-muted, #888);
		font-style: italic;
	}
</style>
