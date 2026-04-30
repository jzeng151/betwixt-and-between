<!--
  SceneEditor — declarative shell for editing a Scene entity.

  Pulled into Phase 1.6 per T3 (was original 8C deferred). Field set per the
  revised D5/Issue 8 from /plan-eng-review:
    Title — inline-edit on the panel header (rendered by EntityDetail wrapper)
    Description — textarea
    POV — multi-entity-picker for Characters via 'pov_of' relationship
    Goal — single-line, what does the POV character want in this scene
    Outcome — picklist (Dwight Swain 5-value)
    Sensory anchor — single-line, one specific sense detail
    Word-count target — numeric single-line
    Color — swatch row
-->

<script lang="ts">
	import EditableField from './EditableField.svelte';
	import { CHARACTER_COLORS } from '$lib/timeline-v2-helpers.js';

	interface Props {
		entityId: string;
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();

	const outcomeOptions = [
		{ value: 'yes', label: 'Yes — POV got what they wanted' },
		{ value: 'yes-but', label: 'Yes-but — got it with a complication' },
		{ value: 'no', label: 'No — POV failed' },
		{ value: 'no-and', label: 'No-and — failed and made it worse' },
		{ value: 'mixed', label: 'Mixed — partial success/failure' }
	];

	const colorSwatches = CHARACTER_COLORS.map((hex) => ({
		value: hex,
		label: hex,
		color: hex
	}));
</script>

<div class="entity-detail scene-editor" data-editor-type="Scene">
	<EditableField
		{readOnly}
		{entityId}
		field="description"
		label="Description"
		kind="textarea"
		rows={5}
		placeholder="A few sentences describing this scene…"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="pov"
		label="POV characters"
		kind="multi-entity-picker"
		relationshipType="pov_of"
		targetEntityType="Character"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="goal"
		label="Goal"
		kind="single-line"
		placeholder="What does the POV character want in this scene?"
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
		field="sensoryAnchor"
		label="Sensory anchor"
		kind="single-line"
		placeholder="One specific sense detail to ground this scene"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="wordCountTarget"
		label="Word-count target"
		kind="single-line"
		placeholder="e.g. 1500"
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
	.scene-editor {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
	}
</style>
