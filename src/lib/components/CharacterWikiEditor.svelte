<!--
  CharacterWikiEditor — declarative shell for editing a Character entity
  inside the Wiki rework's EntityDetail content area.

  Phase 1 wiki-rework slice 1. Field set is intentionally a basic subset of
  the existing CharacterEditor (description, color, role). The parity slice
  adds icon picker + relationship sections; once parity exists,
  ENTITY_APP[Character] flips from 'character-editor' → 'entity-detail'.

  Title is rendered by EntityDetail's header InlineEdit. This shell only
  declares the body field list, matching ActEditor's shape.
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

	const roleOptions = [
		{ value: '', label: '— None —' },
		{ value: 'Protagonist', label: 'Protagonist' },
		{ value: 'Antagonist', label: 'Antagonist' },
		{ value: 'Ally', label: 'Ally' },
		{ value: 'Rival', label: 'Rival' },
		{ value: 'Mentor', label: 'Mentor' },
		{ value: 'Supporting', label: 'Supporting' }
	];
</script>

<div class="entity-detail character-wiki-editor" data-editor-type="Character">
	<EditableField
		{readOnly}
		{entityId}
		field="description"
		label="Description"
		kind="textarea"
		rows={6}
		placeholder="A few sentences describing this character…"
	/>
	<EditableField
		{readOnly}
		{entityId}
		field="role"
		label="Role"
		kind="picklist"
		picklistOptions={roleOptions}
		placeholder="Pick a role…"
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
	.character-wiki-editor {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		flex: 1 1 0;
		overflow-y: auto;
		min-height: 0;
	}
</style>
