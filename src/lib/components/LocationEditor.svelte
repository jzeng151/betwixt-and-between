<!--
  LocationEditor — declarative shell for editing a Location entity.

  Phase 1 wiki-location-branch + wiki-rework slice 6b. Field set:
  Synopsis, Color, plus a read-only "Linked entities" chip row that
  preserves the at-a-glance relationship summary the WorldMap card
  showed before slice 6 reshaped routing. Edit-mode relationship CRUD
  (add/remove via picker dropdowns) is intentionally NOT here yet —
  WorldMap was read-only for relationships, so this is parity, not a
  step backward. A later polish slice can layer in relationship-picker
  groups similar to CharacterEditorBody's REL_GROUPS.

  Title is rendered by EntityDetail's header InlineEdit. This shell
  only declares the body content, matching ActEditor's shape.
-->

<script lang="ts">
	import EditableField from './EditableField.svelte';
	import EntityLink from './EntityLink.svelte';
	import { entities } from '$lib/stores/entities.js';
	import { relationships } from '$lib/stores/relationships.js';
	import { CHARACTER_COLORS } from '$lib/timeline-v2-helpers.js';

	interface Props {
		entityId: string;
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();

	const colorSwatches = CHARACTER_COLORS.map((hex) => ({
		value: hex,
		label: hex,
		color: hex
	}));

	// Mirrors WorldMap.svelte's linkedChips: every relationship row
	// touching this Location becomes a chip showing the OTHER entity,
	// styled by the relationship type's color via EntityLink.
	const linkedChips = $derived.by(() => {
		const out: { id: string; name: string; relType: string }[] = [];
		for (const r of $relationships) {
			if (r.fromId !== entityId && r.toId !== entityId) continue;
			const linkedId = r.fromId === entityId ? r.toId : r.fromId;
			const linked = $entities.find((e) => e.id === linkedId);
			if (!linked) continue;
			out.push({ id: linked.id, name: linked.name, relType: r.type });
		}
		return out;
	});
</script>

<div class="entity-detail location-editor" data-editor-type="Location">
	<EditableField
		{readOnly}
		{entityId}
		field="synopsis"
		label="Synopsis"
		kind="textarea"
		rows={6}
		placeholder="A few sentences describing this place…"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="color"
		label="Color"
		kind="swatches"
		swatchOptions={colorSwatches}
	/>

	<section class="linked-section" aria-label="Linked entities">
		<p class="section-label">Linked entities</p>
		{#if linkedChips.length === 0}
			<p class="linked-empty">
				Nothing links here yet. Characters, events, and scenes that
				reference this location will appear here.
			</p>
		{:else}
			<div class="chip-row">
				{#each linkedChips as chip (chip.id + '-' + chip.relType)}
					<EntityLink
						id={chip.id}
						name={chip.name}
						relationshipType={chip.relType as never}
					/>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.location-editor {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		flex: 1 1 0;
		overflow-y: auto;
		min-height: 0;
		gap: 12px;
	}

	.linked-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.section-label {
		margin: 0;
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	.linked-empty {
		margin: 0;
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
</style>
