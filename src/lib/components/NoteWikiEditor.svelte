<!--
  NoteWikiEditor — declarative shell for editing a Note entity inside the
  Wiki rework's EntityDetail content area.

  Phase 1 wiki-rework slice 1. Note entities are the "annotation"
  primitive that hangs off other entities via the future `note_of`
  relationship. For this slice the editor is just the body — markdown
  preview + cross-entity hyperlink rendering arrive in later slices.
-->

<script lang="ts">
	import EditableField from './EditableField.svelte';

	interface Props {
		entityId: string;
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();
</script>

<div class="entity-detail note-wiki-editor" data-editor-type="Note">
	<EditableField
		{readOnly}
		{entityId}
		field="body"
		label="Body"
		kind="textarea"
		rows={12}
		placeholder="Write the note…"
	/>
</div>

<style>
	.note-wiki-editor {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		flex: 1 1 0;
		overflow-y: auto;
		min-height: 0;
	}
</style>
