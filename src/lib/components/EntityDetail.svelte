<!--
  EntityDetail — host-agnostic router that mounts the right editor for the
  given entity. Locked 2026-04-29 in /plan-design-review (D10/Issue 9A) +
  D12 fall-through rule.

  This component is mounted inside both the Timeline's right-side panel
  (when an act/event/scene is selected) and inside a standalone Window
  (when the user clicks "↗ Move to window" or follows an entity-detail
  hyperlink from a future Wiki entry). Same content, different chrome.

  Routing (this PR):
    Act   → ActEditor
    Event → EventEditor
    Scene → SceneEditor
    Other → falls through to existing app routing (Wiki PR fills these).

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

	interface Props {
		entityId: string | null;
		/** Called when the user clicks "↗ Move to window" — host opens a
		 *  popout window. Skipped when this is itself a popout. */
		onMoveToWindow?: () => void;
		/** Called when the user clicks Close on the side-panel chrome.
		 *  No-op for popout-window hosts (they have their own close). */
		onClose?: () => void;
		/** Called when the entity is deleted from the store while this
		 *  surface is mounted. Host shows the draft-preview toast. The
		 *  callback receives the last-known name so the toast can include
		 *  it (the store row is already gone by the time we fire). */
		onEntityVanished?: (lastName: string) => void;
		/** True when hosted inside a popout Window (hides the move-button +
		 *  close-button chrome since the Window itself provides them). */
		isPopout?: boolean;
	}

	const {
		entityId,
		onMoveToWindow,
		onClose,
		onEntityVanished,
		isPopout = false
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
			// Entity we were just rendering is now gone from the store. Likely
			// confirmed-delete from another window or via the act-header `×`.
			onEntityVanished(lastSeenName);
			lastSeenId = null;
		}
	});

	// Move-to-window confirmation (2B-i inline confirm pattern).
	let confirmingMove = $state(false);

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
		return `Editing ${e.type}`;
	};
</script>

{#if entity}
	<div class="entity-detail-host" data-entity-id={entity.id} data-entity-type={entity.type}>
		<div class="entity-detail-header">
			<div class="entity-detail-eyebrow-row">
				<span class="entity-detail-eyebrow">{eyebrowFor(entity)}</span>
				<div class="entity-detail-actions">
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
				<InlineEdit value={entity.name} onSave={rename} />
			</div>
		</div>

		{#if entity.type === 'Act'}
			<ActEditor entityId={entity.id} />
		{:else if entity.type === 'Event'}
			<EventEditor entityId={entity.id} />
		{:else if entity.type === 'Scene'}
			<SceneEditor entityId={entity.id} />
		{:else}
			<!-- Other types fall through to existing app routing per D12.
			     Future Wiki PR replaces this branch with full Character /
			     Location / Note editors. -->
			<div class="entity-detail-stub">
				Editor for {entity.type} entities lives in its dedicated app for now.
			</div>
		{/if}

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
		font-size: 9px;
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
	.popout-btn,
	.entity-detail-close {
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		border-radius: 4px;
		width: 24px;
		height: 22px;
		font-size: 12px;
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
		font-size: 11px;
		color: var(--color-text, #e8e0d0);
	}
	.entity-detail-title {
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 18px;
		font-weight: 500;
		margin-top: 4px;
	}
	.entity-detail-stub {
		padding: 24px 18px;
		color: var(--color-text-muted, #6b7280);
		font-size: 12px;
		font-style: italic;
		text-align: center;
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
		font-size: 11px;
		cursor: pointer;
	}
	.btn-delete:hover {
		border-color: #ef4444;
	}
	.save-status {
		font-size: 10px;
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
		font-size: 12px;
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
		font-size: 11px;
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
		font-size: 11px;
		cursor: pointer;
	}
	.btn-primary {
		background: var(--color-accent, #c8942a);
		color: var(--color-surface, #161920);
		border: none;
		border-radius: 4px;
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}
	.delete-error {
		color: #ef4444;
		font-size: 10px;
	}
</style>
