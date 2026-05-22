<!--
  EventEditor — declarative shell for editing an Event entity.

  Locked 2026-04-29 in /plan-design-review (D5). Field set:
    Title — inline-edit on the panel header (rendered by EntityDetail wrapper)
    Description — textarea
    Outcome — picklist (Dwight Swain 5-value: yes / yes-but / no / no-and / mixed)
    Mood — single-line, freeform
    Color — swatch row

  Note: the POV characters multi-entity-picker (pov_of relationship) was
  removed by the 2026-05-20 audit (Step 5.5) — pov_of had no read-side
  consumer and was deleted in drizzle/0011_data_model_cleanup.sql.
  Per-POV simulation is a v4-scale slice; revisit then.
-->

<script lang="ts">
	import EditableField from './EditableField.svelte';
	import { CHARACTER_COLORS } from '$lib/features/timeline/timeline-helpers.js';

	interface Props {
		entityId: string;
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();

	const outcomeOptions = [
		{ value: 'yes', label: 'Yes — they got what they wanted' },
		{ value: 'yes-but', label: 'Yes-but — got it with a complication' },
		{ value: 'no', label: 'No — they failed' },
		{ value: 'no-and', label: 'No-and — failed and made it worse' },
		{ value: 'mixed', label: 'Mixed — partial success/failure' }
	];

	const colorSwatches = CHARACTER_COLORS.map((hex) => ({
		value: hex,
		label: hex,
		color: hex
	}));
</script>

<div class="entity-detail event-editor" data-editor-type="Event">
	<EditableField
		{readOnly}
		{entityId}
		field="description"
		label="Description"
		kind="textarea"
		rows={5}
		placeholder="A few sentences describing what happens in this event…"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="outcome"
		label="Outcome"
		kind="picklist"
		picklistOptions={outcomeOptions}
		placeholder="Pick an outcome…"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="mood"
		label="Mood"
		kind="single-line"
		placeholder="One word or phrase — tense, melancholic, jubilant…"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="color"
		label="Color"
		kind="swatches"
		swatchOptions={colorSwatches}
	/>
</div>

<style>
	.event-editor {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		flex: 1 1 0;
		overflow-y: auto;
		min-height: 0;
	}
</style>
