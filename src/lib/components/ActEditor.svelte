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
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();

	const colorSwatches = CHARACTER_COLORS.map((hex) => ({
		value: hex,
		label: hex,
		color: hex
	}));
</script>

<div class="entity-detail act-editor" data-editor-type="Act">
	<EditableField
		{readOnly}
		{entityId}
		field="synopsis"
		label="Synopsis"
		kind="textarea"
		rows={6}
		placeholder="A few sentences describing what happens in this act…"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="goal"
		label="Goal"
		kind="single-line"
		placeholder="What does the protagonist want by the end of this act?"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="stakes"
		label="Stakes"
		kind="single-line"
		placeholder="What happens if they fail?"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="turningPoint"
		label="Turning point"
		kind="single-line"
		placeholder="One sentence — the moment that ends this act"
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
	.act-editor {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		/* Consume the space between EntityDetail's header and footer and
		   scroll internally when the field list overflows. Without this,
		   the editor pushes the footer off-screen on narrow timelines. */
		flex: 1 1 0;
		overflow-y: auto;
		min-height: 0;
	}
</style>
