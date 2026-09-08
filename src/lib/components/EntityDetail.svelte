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

-->

<script module lang="ts">
	// IDs of entities freshly created via a "+ New" affordance elsewhere.
	// Callers add the id BEFORE calling windowStore.open('entity-detail', id);
	// the next EntityDetail mount that matches consumes the entry and lands
	// in edit mode with the name input focused + selected. Mirrors
	// `pendingEditMode` in CharacterEditor.svelte:4 — same pattern for the
	// universal entity-detail surface.
	export const pendingEditMode = new Set<string>();
</script>

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import type { Entity } from '$lib/stores/entities.js';
	import InlineEdit from './InlineEdit.svelte';
	import ActEditor from './ActEditor.svelte';
	import EventEditor from './EventEditor.svelte';
	import SceneEditor from './SceneEditor.svelte';
	import LocationEditor from './LocationEditor.svelte';
	import CharacterWikiEditor from '$lib/features/character/CharacterWikiEditor.svelte';
	import EditableField from './EditableField.svelte';
	import NotesSection from './NotesSection.svelte';
	import StyleEditor from './StyleEditor.svelte';
	import { resolveStyle, type StyleOverride } from '$lib/features/map/style-cascade.js';
	import { resolvePaletteHex } from '$lib/entity-type-colors.js';
	import { buildCharacterIndexById } from '$lib/features/graph/view-builders.js';
	import { preferences } from '$lib/os/preferences-store.js';

	interface Props {
		entityId: string | null;
		/** Called when the user clicks Close on the side-panel chrome. */
		onClose?: () => void;
		/** True when hosted inside a popout Window (hides the
		 *  close-button chrome since the Window itself provides it). */
		isPopout?: boolean;
		/** Initial mode when (re)mounting for a new entityId. Defaults to
		 *  'view'; the Timeline passes 'edit' right after creating an Act
		 *  or Event so the user lands directly in the editor. Resets each
		 *  time entityId changes so view is the default for plain selects. */
		initialMode?: 'view' | 'edit';
	}

	const {
		entityId,
		onClose,
		isPopout = false,
		initialMode = 'view'
	}: Props = $props();

	const entity = $derived(
		entityId ? ($entities as Entity[]).find((e) => e.id === entityId) : null
	);

	// View/edit mode (Block 5). Default 'view'; resets to initialMode on entityId change.
	// Freshly-created entities flagged in `pendingEditMode` land in 'edit' so
	// the user can rename the `Untitled <Type>` placeholder immediately.
	// Initial values are intentional — the $effect below handles entityId
	// transitions after mount.
	// svelte-ignore state_referenced_locally
	const _initialPending = entityId != null && pendingEditMode.has(entityId);
	// svelte-ignore state_referenced_locally
	if (_initialPending && entityId != null) pendingEditMode.delete(entityId);
	// svelte-ignore state_referenced_locally
	let mode = $state<'view' | 'edit'>(_initialPending ? 'edit' : initialMode);
	// Only reset when entityId changes to a different value — not on every
	// prop re-evaluation. Using a plain variable (not $state) so the effect
	// doesn't track it and avoids an extra re-run cycle.
	// svelte-ignore state_referenced_locally
	let _prevEntityId = entityId;
	$effect(() => {
		if (entityId !== _prevEntityId) {
			_prevEntityId = entityId;
			if (entityId && pendingEditMode.has(entityId)) {
				pendingEditMode.delete(entityId);
				mode = 'edit';
			} else {
				mode = initialMode;
			}
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

	// Slice 4 PR-C — entity-level STYLE section (placeable types only: the
	// cascade only renders Character / Artifact / Item as map markers).
	const PLACEABLE_TYPES = ['Character', 'Artifact', 'Item'];
	const isPlaceable = $derived(!!entity && PLACEABLE_TYPES.includes(entity.type));
	const styleValue = $derived(((entity?.data?.style ?? {}) as StyleOverride));
	// The cascade baseline WITHOUT this entity's data.style override, shown as the
	// StyleEditor placeholders so a cleared style field falls back visibly. Uses
	// the resolved palette so the preview tracks a Settings recolor (Phase 2, Item 1).
	// Strip ONLY data.style — keep data.color (the Recolor flow) so the cleared-style
	// baseline matches what the sprite actually resolves to (codex P2): the cascade
	// falls back data.style.color → data.color → cycle → palette.
	const resolvedTypeHex = $derived(resolvePaletteHex($preferences.appearance));
	const inheritedStyle = $derived.by(() => {
		if (!entity) return null;
		const dataNoStyle = { ...((entity.data as Record<string, unknown>) ?? {}) };
		delete dataNoStyle.style;
		return resolveStyle(
			{ ...entity, data: dataNoStyle },
			resolvedTypeHex,
			undefined,
			buildCharacterIndexById($entities).get(entity.id)
		);
	});
	// is_asset defaults true; only an explicit `false` opts the entity out.
	const inPalette = $derived(
		entity ? (entity.data as Record<string, unknown>)?.is_asset !== false : true
	);

	async function persistStyle(next: StyleOverride) {
		if (!entity) return;
		const data = { ...(entity.data as Record<string, unknown>) };
		// Drop the key entirely when the override is empty so it inherits.
		if (Object.keys(next).length === 0) delete data.style;
		else data.style = next;
		await entities.updateEntity(entity.id, { data });
	}

	async function setInPalette(v: boolean) {
		if (!entity) return;
		const data = { ...(entity.data as Record<string, unknown>) };
		// Default is true → omit the key when shown; persist `false` to opt out.
		if (v) delete data.is_asset;
		else data.is_asset = false;
		await entities.updateEntity(entity.id, { data });
	}

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

		{#if isPlaceable && mode !== 'view' && inheritedStyle}
			<!-- Slice 4 PR-C — marker style + palette membership. Edit-mode only;
			     edits propagate to every placement of this entity (reference
			     model). Per-placement overrides live in the map marker popover. -->
			<div class="entity-detail-style" data-testid="entity-style-section">
				<hr class="body-divider" />
				<p class="body-eyebrow">Style</p>
				<StyleEditor value={styleValue} inherited={inheritedStyle} onChange={persistStyle} />
				<label class="is-asset-toggle">
					<input
						type="checkbox"
						data-testid="is-asset-toggle"
						checked={inPalette}
						onchange={(e) => setInPalette((e.currentTarget as HTMLInputElement).checked)}
					/>
					Show in placeables palette
				</label>
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
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
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
	.entity-detail-close:hover {
		color: var(--color-text, #e8e0d0);
		border-color: var(--color-text-muted, #6b7280);
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
	.entity-detail-style {
		padding: 0 18px;
	}
	.is-asset-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		font-size: 11px;
		color: var(--color-text, #e8e0d0);
		cursor: pointer;
	}
	.is-asset-toggle input {
		accent-color: var(--color-accent, #c8942a);
	}
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
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
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
		color: var(--color-danger);
		border-radius: 4px;
		padding: 6px 10px;
		font-size: 12px;
		cursor: pointer;
	}
	.btn-delete:hover {
		border-color: var(--color-danger);
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
		background: var(--color-danger-solid);
		color: var(--color-on-danger);
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
	.delete-error {
		color: var(--color-danger);
		font-size: 11px;
	}
</style>
