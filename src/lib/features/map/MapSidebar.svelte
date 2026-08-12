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
	import { focusTrap } from '$lib/actions/focus-trap.js';
	import { factions as factionsStore, type Faction } from './factions-store.js';
	import { MAP_PALETTE, DEFAULT_FACTION_COLOR } from './color-palette.js';
	import { layerPrefs } from './layer-prefs-store.js';
	import { LAYER_KEYS, LAYER_LABELS, artLayerPrefKey, type LayerKey } from './layers.js';
	import { worldMapStore } from './store.js';
	import {
		ART_BLEND_MODES,
		MAX_ART_LAYERS,
		type ArtBlendMode,
		type MapArtLayer
	} from './projection.js';
	import type { WorldMap } from './types.js';

	// Slice 3 E3 — Layers pane. Per-user-per-map visibility toggles for
	// the WM3 layer stack (background/grid/terrain/regions/placements).
	// Mounts above the factions section; the active map id flows in as
	// a prop so toggling can PATCH the correct row.
	// WM3 Slice B: the full active map row flows in too — the art-layer
	// defs (artLayersJsonb) live on it and edits PATCH through
	// worldMapStore.updateMap.
	let {
		activeMapId = null,
		activeMap = null
	}: { activeMapId?: string | null; activeMap?: WorldMap | null } = $props();

	function isVisible(key: LayerKey | string): boolean {
		const v = $layerPrefs.prefs.get(key);
		return v === undefined ? true : v;
	}

	let layersBusy = $state<Set<string>>(new Set());
	let layersError = $state('');

	async function toggleLayer(key: LayerKey | string): Promise<void> {
		if (!activeMapId) return;
		if (layersBusy.has(key)) return;
		// codex P2: ignore toggles while prefs are 'loading' OR 'error'. In both
		// states the store has mapId:null, so toggle()'s optimistic update is
		// skipped (mapId mismatch) and the success path never applies the result
		// — the PATCH persists server-side but the canvas/sidebar stay stale
		// until another load. The checkbox is also disabled in markup for these
		// states; the user can reload to retry after a failed pref load.
		if ($layerPrefs.status === 'loading' || $layerPrefs.status === 'error') return;
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

	// ── WM3 Slice B — art layer defs (ordered; index 0 = bottom) ────────────
	let artLayers = $derived<MapArtLayer[]>(activeMap?.artLayersJsonb ?? []);
	let artBusy = $state(false);
	let artError = $state('');

	// Edits arriving while a PATCH is in flight are queued (latest wins) and
	// flushed when it settles, instead of being silently dropped. Callers pass
	// a thunk, not an array: updateMap writes the PATCH response back into the
	// store, so a queued thunk re-evaluates against the refreshed artLayers and
	// stacks on top of the edit that just landed rather than clobbering it.
	let artPending: (() => MapArtLayer[]) | null = null;

	async function patchArtLayers(make: () => MapArtLayer[]): Promise<void> {
		if (!activeMapId) return;
		if (artBusy) {
			artPending = make;
			return;
		}
		// codex P2: pin the target map for the whole flush. activeMapId can change
		// (map switch) while a PATCH is in flight; without this the queued edit —
		// and even the in-flight loop's later iterations — would be sent to the
		// newly-active map, e.g. adding the previous map's queued layer to it.
		const mapId = activeMapId;
		artBusy = true;
		artError = '';
		try {
			await worldMapStore.updateMap(mapId, { artLayersJsonb: make() });
			while (artPending) {
				if (activeMapId !== mapId) {
					// Switched maps mid-flight — drop edits queued for the old map.
					artPending = null;
					break;
				}
				const queued = artPending;
				artPending = null;
				await worldMapStore.updateMap(mapId, { artLayersJsonb: queued() });
			}
		} catch (err) {
			artPending = null;
			artError = err instanceof Error ? err.message : String(err);
		} finally {
			artBusy = false;
		}
	}

	function addArtLayer(): void {
		if (artLayers.length >= MAX_ART_LAYERS) {
			artError = `At most ${MAX_ART_LAYERS} layers`;
			return;
		}
		void patchArtLayers(() => [
			...artLayers,
			{ id: crypto.randomUUID(), name: `Layer ${artLayers.length + 1}`, blendMode: 'normal', opacity: 1 }
		]);
	}

	function updateArtLayer(id: string, patch: Partial<MapArtLayer>): void {
		void patchArtLayers(() => artLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	}

	// F15 — confirm art-layer delete (mirrors the faction delete modal). The
	// layer's identity (name/blend/opacity) is unrecoverable, and per F5 not all
	// strokes survive the delete, so don't fire on a single ✕ click.
	let artDeleteTarget = $state<MapArtLayer | null>(null);

	function removeArtLayer(id: string): void {
		const layer = artLayers.find((l) => l.id === id);
		if (layer) artDeleteTarget = layer;
	}

	function confirmRemoveArtLayer(): void {
		if (!artDeleteTarget) return;
		const id = artDeleteTarget.id;
		artDeleteTarget = null;
		// F5/F37: fill/stamp strokes on the removed layer fall back to the base art
		// layer at render (lazy GC); ERASE strokes are dropped (an eraser with no
		// surviving layer to mask would otherwise eat base art). NOT "nothing is
		// lost" — the old comment here was wrong for erase strokes.
		// F29: the layer's `art:<id>` visibility prefs in world_map_layer_prefs are
		// NOT deleted here, but the prefs reader lazy-GCs unknown keys, so a deleted
		// layer's pref is inert. Re-add mints a fresh UUID, so a stale pref can't be
		// resurrected by the UI (only an API client reusing the exact id could).
		void patchArtLayers(() => artLayers.filter((l) => l.id !== id));
	}

	function moveArtLayer(id: string, dir: -1 | 1): void {
		if (!canMoveArtLayer(id, dir)) return;
		void patchArtLayers(() => {
			// Re-check at flush time — a queued move may target indices that the
			// just-landed edit changed; degrade to a no-op write rather than throw.
			if (!canMoveArtLayer(id, dir)) return artLayers;
			const i = artLayers.findIndex((l) => l.id === id);
			const next = [...artLayers];
			[next[i], next[i + dir]] = [next[i + dir], next[i]];
			return next;
		});
	}

	function canMoveArtLayer(id: string, dir: -1 | 1): boolean {
		const i = artLayers.findIndex((l) => l.id === id);
		const j = i + dir;
		return i >= 0 && j >= 0 && j < artLayers.length;
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

	// A11y: confirm dialogs are dismissible with Escape (DESIGN.md "Escape —
	// Dismiss any open inline form or modal"). The faction-delete modal stays
	// open while a delete is in flight so Escape can't strand a half-done op.
	function onModalKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (artDeleteTarget) {
			e.stopPropagation();
			artDeleteTarget = null;
		} else if (deleteTarget && !deleteBusy) {
			e.stopPropagation();
			cancelDelete();
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
								disabled={layersBusy.has(key) ||
									$layerPrefs.status === 'loading' ||
									$layerPrefs.status === 'error'}
								onchange={() => void toggleLayer(key)}
							/>
							<span class="layer-name">{LAYER_LABELS[key]}</span>
						</label>
					</li>
				{/each}
			</ul>
			{#if layersError}<p class="error-msg">{layersError}</p>{/if}

			<!-- WM3 Slice B — art layers (ordered; listed top-most first, the way
			     paint programs do; the array stores bottom-first). -->
			<header class="sidebar-header art-layers-header">
				<h4>Art layers</h4>
				<button
					class="btn-icon"
					type="button"
					aria-label="Add art layer"
					disabled={artBusy || artLayers.length >= MAX_ART_LAYERS}
					onclick={addArtLayer}>+</button
				>
			</header>
			{#if artLayers.length > 0}
				<ul class="layer-list art-layer-list" role="list">
					{#each [...artLayers].reverse() as l (l.id)}
						<li class="layer-row art-layer-row" data-testid="art-layer-row">
							<div class="art-layer-main">
								<input
									type="checkbox"
									aria-label="Show {l.name}"
									checked={isVisible(artLayerPrefKey(l.id))}
									disabled={layersBusy.has(artLayerPrefKey(l.id)) ||
										$layerPrefs.status === 'loading' ||
										$layerPrefs.status === 'error'}
									onchange={() => void toggleLayer(artLayerPrefKey(l.id))}
								/>
								<input
									class="art-layer-name"
									type="text"
									aria-label="Layer name"
									value={l.name}
									disabled={artBusy}
									onchange={(e) => {
										const input = e.currentTarget as HTMLInputElement;
										const name = input.value.trim();
										// F39: a blank rename used to no-op and leave the stale
										// (empty) text in the field. Reset to the current name so
										// the input always reflects the persisted value.
										if (name) updateArtLayer(l.id, { name });
										else input.value = l.name;
									}}
								/>
								<button
									class="btn-icon"
									type="button"
									aria-label="Move {l.name} up"
									disabled={artBusy}
									onclick={() => moveArtLayer(l.id, 1)}>↑</button
								>
								<button
									class="btn-icon"
									type="button"
									aria-label="Move {l.name} down"
									disabled={artBusy}
									onclick={() => moveArtLayer(l.id, -1)}>↓</button
								>
								<button
									class="btn-icon"
									type="button"
									aria-label="Delete {l.name}"
									disabled={artBusy}
									onclick={() => removeArtLayer(l.id)}>×</button
								>
							</div>
							<div class="art-layer-controls">
								<select
									aria-label="Blend mode for {l.name}"
									value={l.blendMode}
									disabled={artBusy}
									onchange={(e) =>
										updateArtLayer(l.id, {
											blendMode: (e.currentTarget as HTMLSelectElement).value as ArtBlendMode
										})}
								>
									{#each ART_BLEND_MODES as bm (bm)}
										<option value={bm}>{bm}</option>
									{/each}
								</select>
								<input
									type="range"
									aria-label="Opacity for {l.name}"
									aria-valuetext="{Math.round(l.opacity * 100)}%"
									min="0"
									max="1"
									step="0.05"
									value={l.opacity}
									disabled={artBusy}
									onchange={(e) =>
										updateArtLayer(l.id, {
											opacity: parseFloat((e.currentTarget as HTMLInputElement).value)
										})}
								/>
								<!-- F39: visible numeric readout so the slider value is legible
								     (not just an opaque track) for sighted + AT users. -->
								<span class="art-layer-opacity-readout" aria-hidden="true"
									>{Math.round(l.opacity * 100)}%</span
								>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="art-layers-empty">Strokes paint to the base layer. Add a layer to blend.</p>
			{/if}
			{#if artError}<p class="error-msg">{artError}</p>{/if}
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

<svelte:window onkeydown={onModalKeydown} />

{#if deleteTarget}
	{@const dc = deleteTarget}
	<div
		class="modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby="faction-del-title"
		tabindex="-1"
		use:focusTrap={{ onEscape: () => !deleteBusy && cancelDelete() }}
	>
		<div class="modal-content">
			<h3 id="faction-del-title">Delete faction "{dc.faction.name}"?</h3>
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

{#if artDeleteTarget}
	{@const al = artDeleteTarget}
	<div
		class="modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby="art-del-title"
		tabindex="-1"
		use:focusTrap={{ onEscape: () => (artDeleteTarget = null) }}
	>
		<div class="modal-content">
			<h3 id="art-del-title">Delete layer "{al.name}"?</h3>
			<p class="warn-text">
				Fill and stamp strokes on this layer move to the base art layer; erase
				strokes on it are removed. The layer's blend mode and opacity can't be
				recovered.
			</p>
			<div class="modal-actions">
				<button type="button" class="btn-secondary" onclick={() => (artDeleteTarget = null)}>
					Cancel
				</button>
				<button type="button" class="btn-danger-solid" onclick={confirmRemoveArtLayer}>
					Delete
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

	/* WM3 Slice B — art layers sub-pane. */
	.art-layers-header {
		margin-top: 4px;
	}
	.art-layers-header h4 {
		margin: 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted, #aaa);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.art-layer-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 3px 0;
		border-bottom: 1px dashed color-mix(in srgb, var(--color-border) 50%, transparent);
	}
	.art-layer-main {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.art-layer-name {
		flex: 1;
		min-width: 0;
		background: transparent;
		color: var(--color-text);
		border: 1px solid transparent;
		border-radius: 4px;
		font-size: 11px;
		padding: 1px 3px;
	}
	.art-layer-name:focus {
		border-color: var(--color-border);
		background: var(--color-bg, #1a1a1a);
	}
	/* F16: DESIGN.md forbids `outline: none` without a visible replacement. Keep a
	   real focus ring for keyboard users (the border alone is ~1.3:1 — too faint). */
	.art-layer-name:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.art-layer-controls {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-left: 20px;
	}
	.art-layer-controls select {
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		font-size: 11px;
		padding: 1px 2px;
	}
	.art-layer-controls input[type='range'] {
		flex: 1;
		min-width: 0;
	}
	.art-layer-opacity-readout {
		font-size: 11px;
		color: var(--color-text-muted, #888);
		min-width: 32px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.art-layers-empty {
		margin: 0;
		font-size: 11px;
		font-style: italic;
		color: var(--color-text-muted, #888);
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
		color: var(--color-danger);
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
