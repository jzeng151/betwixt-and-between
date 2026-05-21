<!--
  CharacterWikiEditor — thin EntityDetail-side wrapper around
  CharacterEditorBody. Phase 1 wiki-rework slice 5.5 reaches feature
  parity with CharacterEditor by mounting the same body component
  CharacterEditor uses for its detail mode.

  EntityDetail provides the chrome (header eyebrow, name InlineEdit,
  Edit/Done toggle, popout/close, footer Delete). This shell only
  forwards entityId + readOnly to the shared body.
-->

<script lang="ts">
	import CharacterEditorBody from './CharacterEditorBody.svelte';

	interface Props {
		entityId: string;
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();
</script>

<CharacterEditorBody {entityId} {readOnly} />
