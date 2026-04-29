<!--
  ActEditor — declarative shell for editing an Act entity.

  Locked 2026-04-29 in /plan-design-review (D5). Field set:
    Title — inline-edit on the panel header (rendered by EntityDetail wrapper)
    Synopsis — textarea ~6 lines, the workspace
    Goal — single-line, what protagonist wants by end of this act
    Stakes — single-line, what happens if they fail
    Turning point — single-line, the moment that ends this act
    Color — swatch row (CHARACTER_COLORS palette + amber accent default)

  Reads/writes via $entities + entities.updateEntity. All field state lives
  in EditableField; this shell only declares the field list.
-->

<script lang="ts">
	import EditableField from './EditableField.svelte';
	import { CHARACTER_COLORS } from '$lib/timeline-v2-helpers.js';

	interface Props {
		entityId: string;
	}
	const { entityId }: Props = $props();

	const colorSwatches = CHARACTER_COLORS.map((hex) => ({
		value: hex,
		label: hex,
		color: hex
	}));
</script>

<div class="entity-detail act-editor" data-editor-type="Act">
	<EditableField
		{entityId}
		field="synopsis"
		label="Synopsis"
		kind="textarea"
		rows={6}
		placeholder="A few sentences describing what happens in this act…"
	/>
	<EditableField
		{entityId}
		field="goal"
		label="Goal"
		kind="single-line"
		placeholder="What does the protagonist want by the end of this act?"
	/>
	<EditableField
		{entityId}
		field="stakes"
		label="Stakes"
		kind="single-line"
		placeholder="What happens if they fail?"
	/>
	<EditableField
		{entityId}
		field="turningPoint"
		label="Turning point"
		kind="single-line"
		placeholder="One sentence — the moment that ends this act"
	/>
	<EditableField
		{entityId}
		field="color"
		label="Color"
		kind="swatches"
		swatchOptions={colorSwatches}
	/>
</div>

<style>
	.act-editor {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
	}
</style>
