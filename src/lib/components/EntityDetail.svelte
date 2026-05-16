<!--
  EntityDetail — host-agnostic router that mounts the right editor for the
  given entity. Locked 2026-04-29 in /plan-design-review (D10/Issue 9A) +
  D12 fall-through rule.

  This component is mounted inside both the Timeline's right-side panel
  (when an act/event/scene is selected) and inside a standalone Window
  (when the user clicks "↗ Move to window" or follows an entity-detail
  hyperlink from a future Wiki entry). Same content, different chrome.

  Routing (post slice 7):
    Act       → ActEditor
    Event     → EventEditor
    Scene     → SceneEditor
    Location  → LocationEditor
    Character → CharacterWikiEditor
    Note      → no editor branch — universal Body section below covers it

  After the entity-type editor branch, EntityDetail mounts a universal
  Body textarea (data.body across all entity types) and a NotesSection
  for non-Note entities. NoteWikiEditor was deleted in slice 7 because
  the universal Body field replaced its sole responsibility.

  Title is inline-editable in the panel header (single rename surface per
  D10). Footer has a Delete button with the inline-confirmation pattern
  matching ActsHeader's delete-confirm.

  External-deletion handling (D16/Issue 14A): when the entity disappears
  from $entities (e.g., act header `×` deletion fires elsewhere), the
  component captures any in-flight EditableField drafts and emits a toast
  via the host's onDraftLost callback. Production wires that to a
  draft-preview Toast with Copy-to-clipboard.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import type { Entity } from '$lib/stores/entities.js';
	import InlineEdit from './InlineEdit.svelte';
	import ActEditor from './ActEditor.svelte';
	import EventEditor from './EventEditor.svelte';
	import SceneEditor from './SceneEditor.svelte';
	import LocationEditor from './LocationEditor.svelte';
	import CharacterWikiEditor from './CharacterWikiEditor.svelte';
	import EditableField from './EditableField.svelte';
	import NotesSection from './NotesSection.svelte';

	interface Props {
		entityId: string | null;
		/** Called when the user clicks "↗ Move to window". */
		onMoveToWindow?: () => void;
		/** Called when the user clicks Close on the side-panel chrome. */
		onClose?: () => void;
		/** Called when the entity is deleted from the store while this
		 *  surface is mounted. Host shows the draft-preview toast. The
		 *  callback receives the last-known name so the toast can include
		 *  it (the store row is already gone by the time we fire). */
		onEntityVanished?: (lastName: string) => void;
		/** True when hosted inside a popout Window (hides the move-button +
		 *  close-button chrome since the Window itself provides them). */
		isPopout?: boolean;
		/** Initial mode when (re)mounting for a new entityId. Defaults to
		 *  'view'; the Timeline passes 'edit' right after creating an Act
		 *  or Event so the user lands directly in the editor. Resets each
		 *  time entityId changes so view is the default for plain selects. */
		initialMode?: 'view' | 'edit';
	}

	const {
		entityId,
		onMoveToWindow,
		onClose,
		onEntityVanished,
		isPopout = false,
		initialMode = 'view'
	}: Props = $props();

	const entity = $derived(
		entityId ? ($entities as Entity[]).find((e) => e.id === entityId) : null
	);

	// Track entity disappearance for the draft-preview toast (D16/14A).
	let lastSeenId = $state<string | null>(null);
	let lastSeenName = $state<string>('Entity');
	$effect(() => {
		if (entity) {
			lastSeenId = entity.id;
			lastSeenName = entity.name;
		} else if (lastSeenId === entityId && entityId != null && onEntityVanished) {
			// Entity vanished from store (deleted elsewhere or via act-header ×).
			onEntityVanished(lastSeenName);
			lastSeenId = null;
		}
	});

	// View/edit mode (Block 5). Default 'view'; resets to initialMode on entityId change.
	// svelte-ignore state_referenced_locally
	let mode = $state<'view' | 'edit'>(initialMode);
	// Only reset when entityId changes to a different value — not on every
	// prop re-evaluation. Using a plain variable (not $state) so the effect
	// doesn't track it and avoids an extra re-run cycle.
	// svelte-ignore state_referenced_locally
	let _prevEntityId = entityId;
	$effect(() => {
		if (entityId !== _prevEntityId) {
			_prevEntityId = entityId;
			mode = initialMode;
		}
	});

	function cancelEdit() {
		// Dispatch Escape to the currently focused EditableField so its keydown
		// handler resets draft → currentValue and blurs cleanly (no commit).
		// Must run on mousedown — before the browser's natural focus-shift fires
		// blur on the field, which would otherwise commit the draft.
		const el = document.activeElement;
		if (el instanceof HTMLElement) {
			el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		}
		mode = 'view';
	}

	// Move-to-window confirmation (2B-i inline confirm pattern).
	let confirmingMove = $state(false);

	// Body textarea row count: shrink on small viewports so NotesSection
	// stays in reach on phones (Pass 6 design decision). resize:vertical
	// in field-textarea CSS lets the user grow it manually.
	let viewportWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const onResize = () => (viewportWidth = window.innerWidth);
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});
	const bodyRows = $derived(viewportWidth < 640 ? 4 : 8);

	async function rename(newName: string) {
		if (!entity) return;
		try {
			await entities.updateEntity(entity.id, { name: newName });
		} catch {
			// store handles rollback via load()
		}
	}

	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);

	async function confirmDelete() {
		if (!entity) return;
		deleting = true;
		deleteError = null;
		try {
			await entities.deleteEntity(entity.id);
			confirmingDelete = false;
			onClose?.();
		} catch (err) {
			deleteError = (err as Error).message;
		} finally {
			deleting = false;
		}
	}

	const eyebrowFor = (e: Entity): string => {
		if (e.type === 'Act') return 'Editing Act';
		if (e.type === 'Event') return 'Editing Event';
		if (e.type === 'Scene') return 'Editing Scene';
		if (e.type === 'Location') return 'Editing Location';
		if (e.type === 'Character') return 'Editing Character';
		if (e.type === 'Note') return 'Editing Note';
		return `Editing ${e.type}`;
	};
</script>

{#if entity}
	<div class="entity-detail-host" data-entity-id={entity.id} data-entity-type={entity.type}>
		<div class="entity-detail-header">
			<div class="entity-detail-eyebrow-row">
				<span class="entity-detail-eyebrow">{eyebrowFor(entity)}</span>
				<div class="entity-detail-actions">
					{#if mode === 'edit'}
						<button
							type="button"
							class="mode-cancel"
							onmousedown={cancelEdit}
						>Cancel</button>
					{/if}
					<button
						type="button"
						class="mode-toggle"
						aria-label={mode === 'view' ? 'Edit' : 'Done editing'}
						title={mode === 'view' ? 'Edit' : 'Done editing'}
						onclick={() => (mode = mode === 'view' ? 'edit' : 'view')}
					>
						{mode === 'view' ? 'Edit' : 'Done'}
					</button>
					{#if !isPopout && onMoveToWindow}
						{#if confirmingMove}
							<span class="popout-confirm">
								Move to standalone window?
								<button
									type="button"
									class="btn-cancel"
									onclick={() => (confirmingMove = false)}
								>Cancel</button>
								<button
									type="button"
									class="btn-primary popout-confirm-go"
									onclick={() => {
										confirmingMove = false;
										onMoveToWindow();
									}}
								>Move</button>
							</span>
						{:else}
							<button
								type="button"
								class="popout-btn"
								aria-label="Move to standalone window"
								title="Move to standalone window"
								onclick={() => (confirmingMove = true)}
							>↗</button>
						{/if}
					{/if}
					{#if !isPopout && onClose}
						<button
							type="button"
							class="entity-detail-close"
							aria-label="Close panel"
							onclick={onClose}
						>×</button>
					{/if}
				</div>
			</div>
			<div class="entity-detail-title">
				{#if mode === 'edit'}
					<InlineEdit value={entity.name} onSave={rename} forceEditing />
				{:else}
					<span class="entity-detail-title-text">{entity.name}</span>
				{/if}
			</div>
		</div>

		{#if entity.type === 'Act'}
			<ActEditor entityId={entity.id} readOnly={mode === 'view'} />
		{:else if entity.type === 'Event'}
			<EventEditor entityId={entity.id} readOnly={mode === 'view'} />
		{:else if entity.type === 'Scene'}
			<SceneEditor entityId={entity.id} readOnly={mode === 'view'} />
		{:else if entity.type === 'Location'}
			<LocationEditor entityId={entity.id} readOnly={mode === 'view'} />
		{:else if entity.type === 'Character'}
			<CharacterWikiEditor entityId={entity.id} readOnly={mode === 'view'} />
		{:else if entity.type === 'Note'}
			<!-- Note has no structured-fields editor branch — the universal
			     Body section below covers Note's editing surface entirely
			     (slice 7 unified data.body across all entity types). -->
		{:else}
			<!-- Defensive fall-through for any future EntityType added to
			     the schema before its editor lands. -->
			<div class="entity-detail-stub">
				Editor for {entity.type} entities lives in its dedicated app for now.
			</div>
		{/if}

		<!-- Universal Body field. Wikipedia convention: structured fields
		     (infobox) above, prose body, then notes. Note skips the divider
		     + 'BODY' eyebrow since it has nothing above to separate from
		     (Pass 7b design decision). -->
		<div class="entity-detail-body" class:no-divider={entity.type === 'Note'}>
			{#if entity.type !== 'Note'}
				<hr class="body-divider" />
				<p class="body-eyebrow">Body</p>
			{/if}
			<EditableField
				readOnly={mode === 'view'}
				entityId={entity.id}
				field="body"
				label=""
				kind="textarea"
				rows={bodyRows}
				placeholder={entity.type === 'Note'
					? 'Write the note…'
					: `Tell ${entity.name}'s story. You can link to other entries with [[Name]].`}
			/>
		</div>

		{#if entity.type !== 'Note'}
			<NotesSection entityId={entity.id} readOnly={mode === 'view'} />
		{/if}

		{#if mode !== 'view'}
		<div class="entity-detail-footer">
			{#if confirmingDelete}
				<div class="delete-confirm">
					<span class="delete-confirm-msg">
						Delete <strong>{entity.name}</strong>?
					</span>
					<div class="delete-confirm-btns">
						<button
							type="button"
							class="btn-cancel"
							disabled={deleting}
							onclick={() => (confirmingDelete = false)}
						>Cancel</button>
						<button
							type="button"
							class="btn-danger"
							disabled={deleting}
							onclick={confirmDelete}
						>{deleting ? '…' : 'Delete'}</button>
					</div>
					{#if deleteError}<div class="delete-error">{deleteError}</div>{/if}
				</div>
			{:else}
				<button
					type="button"
					class="btn-delete"
					onclick={() => (confirmingDelete = true)}
				>Delete {entity.type.toLowerCase()}</button>
				<span class="save-status">Saved · just now</span>
			{/if}
		</div>
		{/if}
	</div>
{/if}

<style>
	.entity-detail-host {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text, #e8e0d0);
	}
	.entity-detail-header {
		padding: 14px 18px 10px;
		border-bottom: 1px solid var(--color-border, #2a2d35);
	}
	.entity-detail-eyebrow-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.entity-detail-eyebrow {
		font-size: 10px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.entity-detail-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.mode-toggle {
		background: var(--color-accent, #c8942a);
		color: var(--color-surface, #161920);
		border: none;
		border-radius: 4px;
		padding: 3px 10px;
		font-size: 11px;
		font-weight: 600;
		font-family: var(--font-ui, 'Inter', sans-serif);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.mode-toggle:hover {
		filter: brightness(1.1);
	}
	.mode-cancel {
		background: transparent;
		color: var(--color-text-muted, #6b7280);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 3px 10px;
		font-size: 11px;
		font-weight: 600;
		font-family: var(--font-ui, 'Inter', sans-serif);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.mode-cancel:hover {
		color: var(--color-text, #e8e0d0);
		border-color: var(--color-text, #e8e0d0);
	}
	.entity-detail-title-text {
		display: inline-block;
		padding: 2px 0;
	}
	.popout-btn,
	.entity-detail-close {
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		border-radius: 4px;
		width: 24px;
		height: 22px;
		font-size: 13px;
		cursor: pointer;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.popout-btn:hover,
	.entity-detail-close:hover {
		color: var(--color-text, #e8e0d0);
		border-color: var(--color-text-muted, #6b7280);
	}
	.popout-confirm {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-text, #e8e0d0);
	}
	.entity-detail-title {
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 19px;
		font-weight: 500;
		margin-top: 4px;
	}
	.entity-detail-stub {
		padding: 24px 18px;
		color: var(--color-text-muted, #6b7280);
		font-size: 13px;
		font-style: italic;
		text-align: center;
	}

	/* Universal Body section. For non-Note entities, sits below the
	   structured-fields editor branch with a hairline divider + 'BODY'
	   eyebrow. Note skips both (no structured fields above). Locked
	   in /plan-design-review Pass 1 + Pass 7b. */
	.entity-detail-body {
		padding: 14px 18px;
	}
	.entity-detail-body.no-divider {
		padding-top: 0; /* Note: textarea is the entire editor surface; remove top padding so it hugs the header */
	}
	.body-divider {
		border: none;
		border-top: 1px solid var(--color-border, #2a2d35);
		margin: 0 0 10px;
	}
	.body-eyebrow {
		margin: 0 0 8px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.entity-detail-footer {
		margin-top: auto;
		padding: 12px 18px;
		border-top: 1px solid var(--color-border, #2a2d35);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.btn-delete {
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: #ef4444;
		border-radius: 4px;
		padding: 6px 10px;
		font-size: 12px;
		cursor: pointer;
	}
	.btn-delete:hover {
		border-color: #ef4444;
	}
	.save-status {
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}
	.delete-confirm {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.delete-confirm-msg {
		font-size: 13px;
	}
	.delete-confirm-btns {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.btn-danger {
		background: #ef4444;
		color: #fff;
		border: none;
		border-radius: 4px;
		padding: 6px 12px;
		font-size: 12px;
		cursor: pointer;
	}
	.btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-cancel {
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		border-radius: 4px;
		padding: 6px 12px;
		font-size: 12px;
		cursor: pointer;
	}
	.btn-primary {
		background: var(--color-accent, #c8942a);
		color: var(--color-surface, #161920);
		border: none;
		border-radius: 4px;
		padding: 4px 10px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.delete-error {
		color: #ef4444;
		font-size: 11px;
	}
</style>
