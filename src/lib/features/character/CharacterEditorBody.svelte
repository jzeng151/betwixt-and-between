<!--
  CharacterEditorBody — orchestrates the Character detail surface. Holds
  the per-field draft state (role, affiliation, motivation, notes, avatar,
  icon, color, timelineLabel) and owns the multi-field saveAll() commit.

  Renders four section children:
    - CharacterHeader (avatar + role + affiliation + icon-pick toggle)
    - CharacterIconPicker (8-col icon grid, shown when iconPickerOpen)
    - CharacterRelationshipsSection (REL_GROUPS chip rows + + picker)
    - CharacterTimelinePrefs (color + show-on-timeline + snippet)
  …plus the Motivation textarea inline.

  Mounted by two wrappers:
    - CharacterEditor.svelte's detail mode (chrome: name InlineEdit,
      mode toggle, popout/close/delete)
    - CharacterWikiEditor.svelte (used by EntityDetail, which provides
      its own header/footer chrome)

  Both wrappers control view/edit via the `readOnly` prop. When readOnly
  transitions false → true (Cancel or Done), an effect re-syncs local
  state from the entity so any unsaved drafts are discarded; saveAll()
  bails when readOnly is true so a focus-shift blur from the Cancel
  button cannot commit a draft just before the wrapper flips back to
  view mode.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { HEX_COLOR_RE, type TimelineLabelMode } from '$lib/features/timeline/timeline-helpers.js';
	import CharacterHeader from './CharacterHeader.svelte';
	import CharacterIconPicker from './CharacterIconPicker.svelte';
	import CharacterRelationshipsSection from './CharacterRelationshipsSection.svelte';
	import CharacterTimelinePrefs from './CharacterTimelinePrefs.svelte';

	interface Props {
		entityId: string;
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();

	function readData(data: Record<string, unknown> | undefined): Record<string, string> {
		return (data ?? {}) as Record<string, string>;
	}

	const entity = $derived($entities.find((e) => e.id === entityId));

	let saveError = $state('');
	let role = $state('');
	let affiliation = $state('');
	let motivation = $state('');
	let notes = $state('');
	let avatar = $state('');
	let icon = $state<string>('');
	let iconPickerOpen = $state(false);
	let color = $state<string | null>(null);
	let timelineLabel = $state<TimelineLabelMode>({ mode: 'name-and-note' });

	function syncFromEntity() {
		if (!entity) return;
		const d = readData(entity.data);
		role = d.role ?? '';
		affiliation = d.affiliation ?? '';
		motivation = d.motivation ?? '';
		notes = d.notes ?? '';
		avatar = d.avatar ?? '';
		icon = d.icon ?? '';
		iconPickerOpen = false;
		const rawColor = (d as Record<string, unknown>).color;
		color = typeof rawColor === 'string' && HEX_COLOR_RE.test(rawColor) ? rawColor : null;
		const rawLabel = (d as Record<string, unknown>).timelineLabel as TimelineLabelMode | undefined;
		if (rawLabel && typeof rawLabel === 'object' && 'mode' in rawLabel) {
			if (rawLabel.mode === 'name-only' || rawLabel.mode === 'name-and-note') {
				timelineLabel = { mode: rawLabel.mode };
			} else if (rawLabel.mode === 'custom') {
				timelineLabel = { mode: 'custom', field: typeof rawLabel.field === 'string' ? rawLabel.field : '' };
			} else {
				timelineLabel = { mode: 'name-and-note' };
			}
		} else {
			timelineLabel = { mode: 'name-and-note' };
		}
	}

	$effect(() => {
		if (entity) syncFromEntity();
	});

	// Cancel-revert + transient-state-reset on edit → view transition.
	// Tracking with a plain `let` (not $state) so the effect doesn't track
	// it and avoids a redundant re-run cycle.
	// svelte-ignore state_referenced_locally
	let _prevReadOnly = readOnly;
	$effect(() => {
		const next = readOnly;
		if (next && !_prevReadOnly) {
			// Wrapper just flipped us into view (Done or Cancel). Discard
			// any unsaved drafts and close the icon picker. The
			// relationships section closes its own picker via the same
			// readOnly transition.
			syncFromEntity();
			iconPickerOpen = false;
		}
		_prevReadOnly = next;
	});

	async function saveAll() {
		if (!entityId) return;
		// Bail when in view mode. The wrapper Cancel button flips readOnly
		// on mousedown, ahead of the focused input's blur. Without this
		// guard, saveAll would PATCH the draft just before the cancel-revert
		// $effect runs, leaving the discarded text in the entity store.
		if (readOnly) return;
		saveError = '';
		const existing = entity ? readData(entity.data) : {};
		const data: Record<string, unknown> = {
			...existing,
			role,
			affiliation,
			motivation,
			notes,
			avatar,
			timelineLabel
		};
		if (color) {
			data.color = color;
		} else {
			delete data.color;
		}
		if (icon) {
			data.icon = icon;
		} else {
			delete data.icon;
		}
		try {
			await entities.updateEntity(entityId, { data });
		} catch {
			saveError = "Couldn't save.";
		}
	}

	async function onAvatarChange(dataUrl: string) {
		avatar = dataUrl;
		icon = '';
		await saveAll();
	}

	async function pickIcon(id: string) {
		icon = id;
		avatar = '';
		iconPickerOpen = false;
		await saveAll();
	}
	async function clearIcon() {
		icon = '';
		iconPickerOpen = false;
		await saveAll();
	}
</script>

{#if entity}
	<div class="char-detail" class:view-mode={readOnly}>
		<CharacterHeader
			entityName={entity.name}
			{avatar}
			{icon}
			bind:role
			bind:affiliation
			{readOnly}
			{iconPickerOpen}
			onSaveAll={saveAll}
			onToggleIconPicker={() => (iconPickerOpen = !iconPickerOpen)}
			{onAvatarChange}
		/>

		{#if iconPickerOpen && !readOnly}
			<CharacterIconPicker
				selectedIcon={icon}
				onPick={pickIcon}
				onClear={clearIcon}
			/>
		{/if}

		{#if saveError}<p class="save-error">{saveError}</p>{/if}

		<CharacterRelationshipsSection
			{entityId}
			{readOnly}
			onError={(msg) => (saveError = msg)}
		/>

		<hr class="divider" />

		<div class="details">
			<CharacterTimelinePrefs
				{entityId}
				bind:color
				bind:timelineLabel
				bind:notes
				{readOnly}
				onSaveAll={saveAll}
			/>

			<label class="field-label" for="char-motivation">Motivation</label>
			{#if !readOnly}
				<textarea
					id="char-motivation"
					class="field-textarea"
					placeholder="What drives this character?"
					bind:value={motivation}
					onblur={saveAll}
					rows="3"
				></textarea>
			{:else}
				<p class="field-display" class:field-empty={!motivation}>
					{motivation || 'Not set.'}
				</p>
			{/if}

			{#if saveError}<p class="save-error">{saveError}</p>{/if}
		</div>
	</div>
{/if}

<style>
	.char-detail {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 14px 18px;
		/* Scroll internally when the body's natural height exceeds the
		   space the wrapping flex-column gives us. Without this, overflow
		   bubbles up to ancestors — in the Wiki app it dragged the
		   sidebar along with the character content. Matches the pattern
		   used by ActEditor / SceneEditor / LocationEditor. */
		flex: 1 1 0;
		overflow-y: auto;
		min-height: 0;
	}

	.divider {
		border: none;
		border-top: 1px solid var(--color-border, #2a2d35);
		margin: 8px 0 0;
	}

	.details {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.field-label {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	.field-display {
		font-size: 13px;
		color: var(--color-text);
		margin: 0;
		white-space: pre-wrap;
		word-wrap: break-word;
	}
	.field-empty {
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}

	.field-textarea {
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 13px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		line-height: 1.5;
		resize: vertical;
	}
	.field-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.save-error { color: var(--color-rel-rival, #ef4444); font-size: 12px; }
</style>
