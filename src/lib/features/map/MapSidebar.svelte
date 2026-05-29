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
	import { layerPrefs } from './layer-prefs-store.js';
	import { LAYER_KEYS, LAYER_LABELS, type LayerKey } from './layers.js';

	// Slice 3 E3 — Layers pane. Per-user-per-map visibility toggles for
	// the WM3 layer stack (background/grid/terrain/regions/placements).
	// Mounts above the factions section; the active map id flows in as
	// a prop so toggling can PATCH the correct row.
	let { activeMapId = null }: { activeMapId?: string | null } = $props();

	function isVisible(key: LayerKey): boolean {
		const v = $layerPrefs.prefs.get(key);
		return v === undefined ? true : v;
	}

	let layersBusy = $state<Set<string>>(new Set());
	let layersError = $state('');

	async function toggleLayer(key: LayerKey): Promise<void> {
		if (!activeMapId) return;
		if (layersBusy.has(key)) return;
		// codex P2: ignore toggles while prefs are still loading. During load the
		// store is in 'loading' with mapId:null, so toggle()'s optimistic update
		// is skipped (mapId mismatch) and the in-flight GET would overwrite the
		// PATCH locally — the change persists server-side but the canvas/sidebar
		// stay stale until another load. The checkbox is also disabled in markup.
		if ($layerPrefs.status === 'loading') return;
		layersBusy = new Set([...layersBusy, key]);
		layersError = '';
		try {
			await layerPrefs.toggle(activeMapId, key);
		} catch (err) {
			layersError = err instanceof Error ? err.message : String(err);
		} finally {
			const next = new Set(layersBusy);
			next.delete(key);
			layersBusy = next;
		}
	}

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

	// Faction rename + recolor. The ✎ button next to delete (or the name)
	// opens an inline edit form: a name field + the color swatches (always
	// visible) + Save/Cancel. Swatches just SELECT a color (preview); Save
	// commits name + color together, which sidesteps the blur/focus races the
	// old click-stripe-then-swatch flow needed showColorPicker to manage.
	// is_system factions can be renamed/recolored too — only DELETE is blocked.
	let editingFactionId = $state<string | null>(null);
	let editName = $state('');
	let editColor = $state('');
	let editBusy = $state(false);
	let editError = $state('');

	function startEdit(f: Faction) {
		editingFactionId = f.id;
		editName = f.name;
		editColor = f.color;
		editError = '';
	}

	function cancelEdit() {
		editingFactionId = null;
		editName = '';
		editColor = '';
		editError = '';
	}

	async function commitEdit(f: Faction) {
		if (editBusy) return;
		const name = editName.trim();
		if (!name) {
			editError = 'Name is required';
			return;
		}
		// No-op if nothing changed.
		if (name === f.name && editColor === f.color) {
			cancelEdit();
			return;
		}
		editBusy = true;
		editError = '';
		try {
			await factionsStore.update(f.id, { name, color: editColor });
			cancelEdit();
		} catch (err) {
			editError = err instanceof Error ? err.message : String(err);
		} finally {
			editBusy = false;
		}
	}
</script>

<aside class="map-sidebar" aria-label="Map controls">
	{#if activeMapId}
		<section class="layers-pane" aria-label="Layers">
			<header class="sidebar-header">
				<h3>Layers</h3>
			</header>
			<ul class="layer-list" role="list">
				{#each LAYER_KEYS as key (key)}
					<li class="layer-row">
						<label>
							<input
								type="checkbox"
								checked={isVisible(key)}
								disabled={layersBusy.has(key) || $layerPrefs.status === 'loading'}
								onchange={() => void toggleLayer(key)}
							/>
							<span class="layer-name">{LAYER_LABELS[key]}</span>
						</label>
					</li>
				{/each}
			</ul>
			{#if layersError}<p class="error-msg">{layersError}</p>{/if}
		</section>
	{/if}

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
			<li class="faction-row" class:editing={editingFactionId === faction.id}>
				{#if editingFactionId === faction.id}
					<!-- Inline edit form: name field + color swatches (always
					     shown) + Save/Cancel. Swatches select a color (preview on
					     the live stripe); Save commits name + color together. -->
					<div class="faction-edit">
						<div class="faction-edit-row">
							<span
								class="faction-stripe"
								style="background: {editColor}"
								aria-hidden="true"
							></span>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								class="faction-name-input"
								bind:value={editName}
								autofocus
								disabled={editBusy}
								onkeydown={(e) => {
									if (e.key === 'Enter') void commitEdit(faction);
									if (e.key === 'Escape') cancelEdit();
								}}
							/>
						</div>
						<div class="color-swatches" aria-label="Faction color">
							{#each MAP_PALETTE as c (c)}
								<button
									type="button"
									class="color-swatch"
									class:selected={editColor === c}
									style="background: {c}"
									aria-label={`Color ${c}`}
									onclick={() => (editColor = c)}
									disabled={editBusy}
								></button>
							{/each}
						</div>
						{#if editError}<p class="error-msg">{editError}</p>{/if}
						<div class="edit-actions">
							<button
								type="button"
								class="btn-secondary"
								onclick={cancelEdit}
								disabled={editBusy}>Cancel</button
							>
							<button
								type="button"
								class="btn-primary"
								onclick={() => void commitEdit(faction)}
								disabled={editBusy}>{editBusy ? 'Saving…' : 'Save'}</button
							>
						</div>
					</div>
				{:else}
					<span
						class="faction-stripe"
						style="background: {faction.color}"
						aria-hidden="true"
					></span>
					<button
						type="button"
						class="faction-name faction-name-button"
						title={`Edit "${faction.name}"`}
						onclick={() => startEdit(faction)}
					>{faction.name}</button>
					<button
						type="button"
						class="btn-icon"
						aria-label="Edit {faction.name}"
						title="Rename / recolor"
						onclick={() => startEdit(faction)}
					>✎</button>
					{#if faction.isSystem}
						<!-- Slice 2 D1: system Neutral faction is the fallback ownership
						     target for un-faction-ed regions. Delete would orphan every
						     region resolving through it. UI hides the affordance; server
						     also returns 422 on DELETE attempts (defense in depth). -->
						<span class="system-badge" title="System faction — cannot be deleted">SYSTEM</span>
					{:else}
						<button
							type="button"
							class="btn-icon btn-danger"
							aria-label="Delete {faction.name}"
							title="Delete"
							onclick={() => void startDelete(faction)}
						>×</button>
					{/if}
				{/if}
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
	/* Slice 3 E3 — Layers pane. Sits above factions in the sidebar. */
	.layers-pane {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 4px;
	}
	.layer-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.layer-row label {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		padding: 2px 0;
		color: var(--color-text);
	}
	.layer-row input[type='checkbox'] {
		cursor: pointer;
	}
	.layer-row .layer-name {
		font-size: 11px;
	}

	.map-sidebar {
		position: absolute;
		top: 48px;
		right: 8px;
		bottom: 8px;
		width: 200px;
		/* Below the bottom palettes (placeables/asset/brush) so it doesn't
		   cover them, but still above the Pixi canvas. The toolbar stays at
		   1000. */
		z-index: 100;
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
		/* Scroll the whole sidebar when Layers + Factions exceed the height
		   between top:48px and bottom:8px (the faction list already scrolls
		   internally; this catches the combined overflow). */
		overflow-y: auto;
		overflow-x: hidden;
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
	/* Slice 3 F2 — name turns into a click target in display mode. Looks
	   identical to the span until hover. */
	.faction-name-button {
		background: transparent;
		border: none;
		padding: 0;
		text-align: left;
		cursor: text;
		font: inherit;
	}
	.faction-name-button:hover {
		color: var(--color-accent, #c8942a);
	}
	.faction-row.editing {
		/* The edit form stacks (name row → swatches → actions), so the row
		   becomes a full-width block instead of a single horizontal line. */
		align-items: stretch;
		flex-direction: column;
		gap: 6px;
		padding: 6px;
		border: 1px dashed var(--color-border);
	}
	.faction-edit {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.faction-edit-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.faction-edit-row .faction-name-input {
		flex: 1;
		min-width: 0;
	}
	.edit-actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}
	.empty-row {
		color: var(--color-text-muted);
		font-style: italic;
		padding: 4px 2px;
	}
	.system-badge {
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.12em;
		color: var(--color-text-muted);
		padding: 2px 6px;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		text-transform: uppercase;
		cursor: help;
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
