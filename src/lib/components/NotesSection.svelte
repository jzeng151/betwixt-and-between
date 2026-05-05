<!--
  NotesSection — collapsible disclosures listing every Note entity
  attached to the host entity via the `note_of` relationship.

  Phase 1 wiki-rework slice 5. Mounted by EntityDetail under every
  non-Note entity's editor. Notes themselves don't get a Notes section
  (recursive attachment is intentionally not supported).

  Each note renders as `<details>` with the title in the `<summary>`
  (inline-renamable) and an EditableField textarea for the body. The
  `[+ Add note]` chip creates a Note entity + a note_of relationship
  in one shot; the new disclosure auto-opens so the user can type.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { relationships } from '$lib/stores/relationships.js';
	import EditableField from './EditableField.svelte';
	import InlineEdit from './InlineEdit.svelte';

	interface Props {
		entityId: string;
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();

	const attachedNotes = $derived.by(() => {
		const noteIds = new Set<string>();
		for (const r of $relationships) {
			if (r.type !== 'note_of') continue;
			if (r.toId === entityId) noteIds.add(r.fromId);
		}
		return $entities
			.filter((e) => e.type === 'Note' && noteIds.has(e.id))
			.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
	});

	let openSet = $state<Set<string>>(new Set());
	let createError = $state('');
	let busy = $state(false);

	function toggle(id: string) {
		const next = new Set(openSet);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		openSet = next;
	}

	async function addNote() {
		if (busy || readOnly) return;
		busy = true;
		createError = '';
		try {
			const created = await entities.createEntity('Note', 'Untitled Note');
			await relationships.createRelationship(created.id, entityId, 'note_of');
			openSet = new Set([...openSet, created.id]);
		} catch {
			createError = "Couldn't add note.";
		} finally {
			busy = false;
		}
	}

	async function renameNote(id: string, name: string) {
		try {
			await entities.updateEntity(id, { name });
		} catch {
			// store handles its own optimistic rollback via load()
		}
	}

	async function detachNote(id: string) {
		// Detach = delete the Note entity. Cascades the note_of row.
		// Spec defers a softer "unlink-but-keep" affordance to a later
		// slice; deleting matches what users currently expect from
		// CharacterEditor's relationship × button (also a hard delete
		// of the relationship, not the linked entity — but for Notes
		// the entity is the note, so deleting it is the only meaningful
		// "remove this note" action).
		try {
			await entities.deleteEntity(id);
		} catch {
			// Surface via the inline create-error slot since failure is rare.
			createError = "Couldn't remove note.";
		}
	}
</script>

<section class="notes-section" aria-label="Notes">
	<div class="notes-heading">Notes</div>

	{#if attachedNotes.length === 0}
		<p class="notes-empty">No notes yet.</p>
	{:else}
		<div class="notes-list">
			{#each attachedNotes as note (note.id)}
				{@const isOpen = openSet.has(note.id)}
				<details class="note" open={isOpen}>
					<summary
						class="note-summary"
						onclick={(e) => {
							e.preventDefault();
							toggle(note.id);
						}}
					>
						<span class="caret">{isOpen ? '▼' : '▶'}</span>
						<span class="note-title" onclick={(e) => e.stopPropagation()}>
							<InlineEdit value={note.name} onSave={(name) => renameNote(note.id, name)} />
						</span>
						{#if !readOnly}
							<button
								type="button"
								class="note-detach"
								aria-label="Remove note"
								title="Remove note"
								onclick={(e) => {
									e.stopPropagation();
									detachNote(note.id);
								}}
							>×</button>
						{/if}
					</summary>
					<div class="note-body">
						<EditableField
							entityId={note.id}
							field="body"
							label="Body"
							kind="textarea"
							rows={4}
							{readOnly}
							placeholder="Write the note…"
						/>
					</div>
				</details>
			{/each}
		</div>
	{/if}

	{#if !readOnly}
		<button type="button" class="add-note" onclick={addNote} disabled={busy}>
			{busy ? '…' : '+ Add note'}
		</button>
	{/if}
	{#if createError}<p class="notes-error">{createError}</p>{/if}
</section>

<style>
	.notes-section {
		padding: 14px 18px;
		border-top: 1px solid var(--color-border, #2a2d35);
	}

	.notes-heading {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin-bottom: 8px;
	}

	.notes-empty {
		font-size: 12px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
		margin: 0 0 8px;
	}

	.notes-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.note {
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 6px;
		background: var(--color-surface, #161920);
	}

	.note-summary {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		cursor: pointer;
		list-style: none;
		font-size: 12px;
	}
	.note-summary::-webkit-details-marker {
		display: none;
	}

	.caret {
		font-size: 10px;
		color: var(--color-text-muted, #6b7280);
		flex: 0 0 auto;
	}

	.note-title {
		flex: 1 1 auto;
		min-width: 0;
		color: var(--color-text);
	}

	.note-detach {
		flex: 0 0 auto;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 14px;
		line-height: 1;
		padding: 0 4px;
		cursor: pointer;
	}
	.note-detach:hover {
		color: #ef4444;
	}

	.note-body {
		padding: 4px 10px 10px;
	}

	.add-note {
		display: inline-block;
		margin-top: 8px;
		background: transparent;
		border: 1px dashed var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		border-radius: 999px;
		padding: 3px 12px;
		font-size: 11px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		cursor: pointer;
	}
	.add-note:hover {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}
	.add-note:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.notes-error {
		margin-top: 6px;
		color: #ef4444;
		font-size: 11px;
	}
</style>
