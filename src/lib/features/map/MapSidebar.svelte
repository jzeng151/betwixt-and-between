<script lang="ts">
	// Faction sidebar for the World Map. Right-side overlay, slides in when
	// renderer=pixi (factions don't matter under Leaflet, which has no
	// ownership-overlay rendering). Faction CRUD scope per Slice 1b
	// /plan-eng-review: Create + Delete only. Rename/recolor backend exists
	// but UI is deferred to Slice 2.
	//
	// Delete-with-dependents: clicking the trash icon fetches the faction's
	// dependent transfer_region event count first. If > 0, the confirm
	// dialog enumerates them and warns that deleting will leave those
	// events orphaned (lazy-GC under projection — they render as neutral).
	// PR 1 ships the dependent count via GET /api/factions/[id]/dependents.

	import { onDestroy } from 'svelte';
	import { factions as factionsStore, type Faction } from './factions-store.js';
	import { MAP_PALETTE, DEFAULT_FACTION_COLOR } from './color-palette.js';

	let factionList = $state<Faction[]>([]);
	const unsub = factionsStore.subscribe((list) => {
		factionList = list;
	});
	onDestroy(unsub);

	// Create form
	let creating = $state(false);
	let createName = $state('');
	let createColor = $state<string>(DEFAULT_FACTION_COLOR);
	let createError = $state('');
	let createBusy = $state(false);

	function startCreate() {
		creating = true;
		createName = '';
		createColor = DEFAULT_FACTION_COLOR;
		createError = '';
	}

	function cancelCreate() {
		creating = false;
		createName = '';
		createError = '';
	}

	async function commitCreate() {
		const name = createName.trim();
		if (!name) {
			createError = 'Name is required';
			return;
		}
		if (createBusy) return;
		createBusy = true;
		createError = '';
		try {
			await factionsStore.create({ name, color: createColor });
			creating = false;
			createName = '';
		} catch (err) {
			createError = err instanceof Error ? err.message : String(err);
		} finally {
			createBusy = false;
		}
	}

	// Delete with dependents check
	let deleteTarget = $state<{ faction: Faction; dependentCount: number } | null>(null);
	let deleteBusy = $state(false);
	let deleteError = $state('');

	async function startDelete(faction: Faction) {
		deleteError = '';
		try {
			const count = await factionsStore.countDependents(faction.id);
			deleteTarget = { faction, dependentCount: count };
		} catch (err) {
			// Fall back to confirm without count if the dependents lookup fails;
			// safer than blocking the delete on a transient error.
			deleteTarget = { faction, dependentCount: -1 };
			console.error('Failed to count dependents for', faction.id, err);
		}
	}

	function cancelDelete() {
		deleteTarget = null;
		deleteError = '';
	}

	async function confirmDelete() {
		if (!deleteTarget || deleteBusy) return;
		deleteBusy = true;
		deleteError = '';
		try {
			await factionsStore.delete(deleteTarget.faction.id);
			deleteTarget = null;
		} catch (err) {
			deleteError = err instanceof Error ? err.message : String(err);
		} finally {
			deleteBusy = false;
		}
	}
</script>

<aside class="map-sidebar" aria-label="Factions">
	<header class="sidebar-header">
		<h3>Factions</h3>
		{#if !creating}
			<button class="btn-icon" type="button" aria-label="Add faction" onclick={startCreate}>+</button>
		{/if}
	</header>

	{#if creating}
		<div class="faction-form">
			<input
				type="text"
				placeholder="Faction name"
				bind:value={createName}
				disabled={createBusy}
				onkeydown={(e) => {
					if (e.key === 'Enter') void commitCreate();
					if (e.key === 'Escape') cancelCreate();
				}}
				class="faction-name-input"
			/>
			<div class="color-palette compact">
				{#each MAP_PALETTE as c}
					<button
						class="color-swatch"
						class:active={createColor === c}
						aria-label="Color {c}"
						type="button"
						style="background: {c}"
						onclick={() => (createColor = c)}
					></button>
				{/each}
			</div>
			{#if createError}<p class="error-msg">{createError}</p>{/if}
			<div class="form-actions">
				<button type="button" class="btn-secondary" disabled={createBusy} onclick={cancelCreate}>
					Cancel
				</button>
				<button type="button" class="btn-primary" disabled={createBusy} onclick={commitCreate}>
					{createBusy ? 'Creating…' : 'Create'}
				</button>
			</div>
		</div>
	{/if}

	<ul class="faction-list" role="list">
		{#each factionList as faction (faction.id)}
			<li class="faction-row">
				<span class="faction-stripe" style="background: {faction.color}" aria-hidden="true"></span>
				<span class="faction-name" title={faction.name}>{faction.name}</span>
				<button
					type="button"
					class="btn-icon btn-danger"
					aria-label="Delete {faction.name}"
					title="Delete"
					onclick={() => void startDelete(faction)}
				>×</button>
			</li>
		{/each}
		{#if factionList.length === 0 && !creating}
			<li class="empty-row">No factions yet.</li>
		{/if}
	</ul>
</aside>

{#if deleteTarget}
	{@const dc = deleteTarget}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal-content">
			<h3>Delete faction "{dc.faction.name}"?</h3>
			{#if dc.dependentCount > 0}
				<p class="warn-text">
					This faction is referenced by <strong>{dc.dependentCount}</strong>
					{dc.dependentCount === 1 ? 'transfer_region event' : 'transfer_region events'}.
					Deleting it leaves those events ownership-unknown — affected regions
					render in neutral gray after scrub.
				</p>
			{:else if dc.dependentCount === 0}
				<p>No events reference this faction. Safe to delete.</p>
			{:else}
				<p class="warn-text">
					Couldn't check dependent events. Proceed with caution.
				</p>
			{/if}
			{#if deleteError}<p class="error-msg">{deleteError}</p>{/if}
			<div class="modal-actions">
				<button type="button" class="btn-secondary" disabled={deleteBusy} onclick={cancelDelete}>
					Cancel
				</button>
				<button type="button" class="btn-danger-solid" disabled={deleteBusy} onclick={confirmDelete}>
					{deleteBusy ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.map-sidebar {
		position: absolute;
		top: 48px;
		right: 8px;
		bottom: 8px;
		width: 200px;
		z-index: 900;
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 8px 10px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		font-size: 12px;
		overflow: hidden;
	}
	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.sidebar-header h3 {
		margin: 0;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.faction-form {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px;
		background: var(--color-bg, transparent);
		border: 1px dashed var(--color-border);
		border-radius: 4px;
	}
	.faction-name-input {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-accent);
		border-radius: 4px;
		padding: 4px 6px;
		font-size: 12px;
		font-family: inherit;
	}
	.color-palette.compact {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.faction-list {
		flex: 1;
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
	}
	.faction-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 2px;
		border-radius: 3px;
	}
	.faction-row:hover {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
	.faction-stripe {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.faction-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text);
	}
	.empty-row {
		color: var(--color-text-muted);
		font-style: italic;
		padding: 4px 2px;
	}

	.form-actions,
	.modal-actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}
	.warn-text {
		font-size: 13px;
		color: var(--color-text);
		margin: 0;
	}
	.error-msg {
		color: var(--color-rel-rival, #ef4444);
		font-size: 11px;
		margin: 0;
	}
	.btn-danger-solid {
		background: #b91c1c;
		color: #fee2e2;
		border: 1px solid #b91c1c;
		border-radius: 4px;
		padding: 4px 12px;
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
	}
	.btn-danger-solid:hover:not(:disabled) {
		background: #c0392b;
	}
	.btn-danger-solid:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
