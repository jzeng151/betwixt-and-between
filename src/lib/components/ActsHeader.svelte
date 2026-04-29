<!--
  ActsHeader — acts header row + scenes row for TimelineV2.

  Renders act names, scene counts, and scene cells.
  Per-act affordances:
    - "Break into scenes" inline form (when act has no scenes yet)
    - "×" delete button with inline confirmation listing interval cascade impact
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { intervals as intervalsStore } from '$lib/stores/intervals.js';
	import type { Entity } from '$lib/stores/entities.js';

	interface Props {
		acts: Entity[];
		scenesByActId: Map<string, Entity[]>;
	}
	let { acts, scenesByActId }: Props = $props();

	// ── Break into scenes state ───────────────────────────────────────────────
	let expandingActId: string | null = $state(null);
	let sceneNamesInput = $state('');
	let savingScenes = $state(false);
	let sceneError: string | null = $state(null);

	function openSceneForm(actId: string) {
		expandingActId = actId;
		sceneNamesInput = '';
		sceneError = null;
	}

	function cancelSceneForm() {
		expandingActId = null;
		sceneNamesInput = '';
		sceneError = null;
	}

	async function saveScenes() {
		if (!expandingActId) return;
		const actId = expandingActId;
		const names = sceneNamesInput
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		if (names.length === 0) {
			sceneError = 'Enter at least one scene name.';
			return;
		}

		savingScenes = true;
		sceneError = null;
		try {
			// Create scenes sequentially so positions are stable.
			for (let i = 0; i < names.length; i++) {
				await fetch('/api/entities', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: 'Scene', name: names[i], parentId: actId, position: i })
				}).then(async (res) => {
					if (!res.ok) throw new Error(await res.text());
				});
			}
			// Reload entities to reflect new scenes in the store.
			await entities.load();
			expandingActId = null;
			sceneNamesInput = '';
		} catch (err) {
			sceneError = (err as Error).message;
		} finally {
			savingScenes = false;
		}
	}

	// ── Act-delete state ──────────────────────────────────────────────────────
	let deletingActId: string | null = $state(null);
	let deletingAct: Entity | null = $state(null);
	let deleteCount = $state(0);
	let deletingInProgress = $state(false);

	function openDeleteConfirm(act: Entity) {
		deletingAct = act;
		deletingActId = act.id;
		// Count intervals that reference this act (either endpoint).
		deleteCount = $intervalsStore.filter(
			(iv) => iv.startActId === act.id || iv.endActId === act.id
		).length;
	}

	function cancelDelete() {
		deletingActId = null;
		deletingAct = null;
	}

	async function confirmDelete() {
		if (!deletingActId) return;
		deletingInProgress = true;
		try {
			const res = await fetch(`/api/entities/${deletingActId}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(await res.text());
			// Reload both stores; interval CASCADE happens server-side.
			await Promise.all([entities.load(), intervalsStore.load()]);
			deletingActId = null;
			deletingAct = null;
		} catch (err) {
			console.error('[ActsHeader] delete act failed:', err);
		} finally {
			deletingInProgress = false;
		}
	}

	// ── Add-act state (trailing tile) ─────────────────────────────────────────
	let addingAct = $state(false);
	let newActName = $state('');
	let savingAct = $state(false);
	let addActError: string | null = $state(null);

	function openAddAct() {
		addingAct = true;
		newActName = '';
		addActError = null;
	}
	function cancelAddAct() {
		addingAct = false;
		newActName = '';
		addActError = null;
	}
	async function commitAddAct() {
		const name = newActName.trim();
		if (!name || savingAct) return;
		savingAct = true;
		addActError = null;
		try {
			// Position = current count so the new act sorts last. Same raw-fetch
			// pattern as break-into-scenes — entities.createEntity doesn't expose
			// `position` (see CONSIDERATIONS.md → entities store gap).
			const res = await fetch('/api/entities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'Act', name, position: acts.length })
			});
			if (!res.ok) throw new Error(await res.text());
			await entities.load();
			addingAct = false;
			newActName = '';
		} catch (err) {
			addActError = (err as Error).message;
		} finally {
			savingAct = false;
		}
	}
	function handleAddActKey(e: KeyboardEvent) {
		if (e.key === 'Enter') commitAddAct();
		if (e.key === 'Escape') cancelAddAct();
	}
</script>

<!-- Acts header -->
<div class="acts-header">
	{#each acts as act (act.id)}
		{@const sceneCount = scenesByActId.get(act.id)?.length ?? 0}
		<div class="act-col-header" style="flex: 1;">
			<div class="act-name-row">
				<div class="act-name">{act.name}</div>
				<button
					class="act-delete-btn"
					aria-label="Delete {act.name}"
					title="Delete act"
					onclick={() => openDeleteConfirm(act)}
				>×</button>
			</div>

			{#if deletingActId === act.id && deletingAct}
				<div class="delete-confirm">
					<span class="delete-confirm-msg">
						Delete <strong>{deletingAct.name}</strong>?
						{#if deleteCount > 0}
							This removes {deleteCount} interval{deleteCount === 1 ? '' : 's'}.
						{/if}
					</span>
					<div class="delete-confirm-btns">
						<button
							class="btn-danger"
							onclick={confirmDelete}
							disabled={deletingInProgress}
						>{deletingInProgress ? '…' : 'Delete'}</button>
						<button class="btn-cancel" onclick={cancelDelete} disabled={deletingInProgress}>Cancel</button>
					</div>
				</div>
			{:else if expandingActId === act.id}
				<div class="scene-form">
					<textarea
						class="scene-textarea"
						bind:value={sceneNamesInput}
						placeholder="One scene name per line"
						rows="3"
						disabled={savingScenes}
					></textarea>
					{#if sceneError}<div class="scene-error">{sceneError}</div>{/if}
					<div class="scene-form-btns">
						<button class="btn-save" onclick={saveScenes} disabled={savingScenes}>
							{savingScenes ? 'Saving…' : 'Save scenes'}
						</button>
						<button class="btn-cancel" onclick={cancelSceneForm} disabled={savingScenes}>Cancel</button>
					</div>
				</div>
			{:else}
				<div class="act-meta">
					{#if sceneCount > 0}
						{sceneCount} scene{sceneCount === 1 ? '' : 's'}
					{:else}
						<button class="break-btn" onclick={() => openSceneForm(act.id)}>
							Break into scenes
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

	<!-- Trailing "+ Act" tile -->
	<div class="act-add-tile">
		{#if addingAct}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="act-add-input"
				type="text"
				placeholder="Act name"
				bind:value={newActName}
				onkeydown={handleAddActKey}
				onblur={() => { if (!savingAct && !newActName.trim()) cancelAddAct(); }}
				disabled={savingAct}
				autofocus
				aria-label="New act name"
			/>
			{#if addActError}<div class="act-add-error">{addActError}</div>{/if}
		{:else}
			<button
				class="act-add-btn"
				aria-label="Add act"
				onclick={openAddAct}
			>+ Act</button>
		{/if}
	</div>

	{#if acts.length === 0}
		<div class="acts-empty">No acts yet. Click + Act to begin your story.</div>
	{/if}
</div>

<!-- Scenes row -->
{#if acts.length > 0}
	<div class="scenes-row">
		{#each acts as act (act.id)}
			<div class="scenes-act">
				{#if (scenesByActId.get(act.id)?.length ?? 0) > 0}
					{#each scenesByActId.get(act.id)! as scene, k (scene.id)}
						<div class="scene-cell" title={scene.name}>s{k}</div>
					{/each}
				{:else}
					<div class="scenes-act-empty">· · · · ·</div>
				{/if}
			</div>
		{/each}
		<!-- Spacer column to align with the trailing + Act tile -->
		<div class="scenes-act-spacer"></div>
	</div>
{/if}

<style>
	.acts-header {
		display: flex;
		min-height: 56px;
		background: var(--color-surface-2, #1c1f28);
		border-bottom: 1px solid var(--color-border, #2a2d35);
		align-items: stretch;
	}
	.act-col-header {
		border-right: 1px solid var(--color-border, #2a2d35);
		padding: 8px 14px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
	}
	.act-col-header:last-child {
		border-right: none;
	}

	.act-name-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.act-name {
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 16px;
		font-weight: 500;
		color: var(--color-text, #e8e0d0);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.act-delete-btn {
		background: none;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 2px 4px;
		border-radius: 3px;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 0.15s, color 0.15s;
	}
	.act-col-header:hover .act-delete-btn {
		opacity: 1;
	}
	.act-delete-btn:hover {
		color: #ef4444;
	}

	.act-meta {
		font-size: 10px;
		color: var(--color-text-muted, #6b7280);
	}

	/* Break-into-scenes button */
	.break-btn {
		background: none;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		font-size: 10px;
		padding: 0;
		font-family: inherit;
		text-decoration: underline dotted;
		transition: color 0.15s;
	}
	.break-btn:hover {
		color: var(--color-accent, #c8942a);
	}

	/* Scene name form */
	.scene-form {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.scene-textarea {
		background: var(--color-desktop, #0d0f14);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		color: var(--color-text, #e8e0d0);
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		padding: 4px 6px;
		resize: none;
		width: 100%;
		box-sizing: border-box;
	}
	.scene-textarea:focus {
		outline: 2px solid var(--color-accent, #c8942a);
	}
	.scene-error {
		font-size: 10px;
		color: #ef4444;
	}
	.scene-form-btns {
		display: flex;
		gap: 6px;
	}

	/* Delete confirmation */
	.delete-confirm {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 0;
	}
	.delete-confirm-msg {
		font-size: 10px;
		color: var(--color-text, #e8e0d0);
	}
	.delete-confirm-btns {
		display: flex;
		gap: 6px;
	}

	/* Shared button styles */
	.btn-save,
	.btn-danger {
		background: var(--color-accent, #c8942a);
		border: none;
		border-radius: 4px;
		color: #0d0f14;
		cursor: pointer;
		font-size: 10px;
		font-family: inherit;
		font-weight: 600;
		padding: 3px 8px;
		transition: opacity 0.15s;
	}
	.btn-danger {
		background: #ef4444;
		color: #fff;
	}
	.btn-save:disabled,
	.btn-danger:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn-cancel {
		background: none;
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		font-size: 10px;
		font-family: inherit;
		padding: 3px 8px;
	}
	.btn-cancel:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.acts-empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}

	.scenes-row {
		display: flex;
		height: 24px;
		background: var(--color-desktop, #0d0f14);
		border-bottom: 1px solid var(--color-border, #2a2d35);
	}
	.scenes-act {
		flex: 1;
		border-right: 1px solid var(--color-border, #2a2d35);
		display: flex;
	}
	.scenes-act:last-child {
		border-right: none;
	}
	.scene-cell {
		flex: 1;
		border-right: 1px dashed rgba(42, 45, 53, 0.6);
		font-size: 9px;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.scene-cell:last-child {
		border-right: none;
	}
	.scenes-act-empty {
		flex: 1;
		font-size: 9px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
		opacity: 0.5;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Trailing add-act tile and matching scenes-row spacer */
	.act-add-tile {
		flex: 0 0 100px;
		border-left: 1px dashed var(--color-border, #2a2d35);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6px;
	}
	.act-add-btn {
		background: transparent;
		border: 1px dashed var(--color-text-muted, #6b7280);
		color: var(--color-text-muted, #6b7280);
		border-radius: 4px;
		padding: 6px 10px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s, background 0.12s;
	}
	.act-add-btn:hover {
		color: var(--color-accent, #c8942a);
		border-color: var(--color-accent, #c8942a);
		background: rgba(200, 148, 42, 0.06);
	}
	.act-add-input {
		width: 100%;
		background: var(--color-surface, #161920);
		color: var(--color-text, #e8e0d0);
		border: 1px solid var(--color-accent, #c8942a);
		border-radius: 4px;
		padding: 5px 8px;
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 13px;
		outline: none;
	}
	.act-add-error {
		font-size: 9px;
		color: #ef4444;
		margin-top: 4px;
	}
	.scenes-act-spacer {
		flex: 0 0 100px;
		border-left: 1px dashed var(--color-border, #2a2d35);
	}
</style>
