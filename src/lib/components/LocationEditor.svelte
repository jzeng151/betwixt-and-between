<!--
  LocationEditor — declarative shell for editing a Location entity.

  Phase 1 wiki-location-branch slice. Field set is intentionally minimal;
  the wiki-rework branch layers relationship sections (located_at,
  takes_place_at) on top per docs/plans/steve-feat-timeline-qol-design-specs-*.

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
</div>

<style>
	.location-editor {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		flex: 1 1 0;
		overflow-y: auto;
		min-height: 0;
	}
</style>
