<script lang="ts">
	// Region form: create or edit one polygon's linked Location + color +
	// active-scene range. Form state is bindable so the parent owns the
	// values for the post-save side-effects (interval rewriting, store
	// reload). Inline "+ new Location" affordance is bindable too.
	// Styles come from WorldMap.svelte's :global(.modal-*), :global(.region-*),
	// :global(.color-*), :global(.scene-*), :global(.act-*) rules.

	import type { Entity } from '$lib/stores/entities.js';
	import { focusTrap } from '$lib/actions/focus-trap.js';
	import { MAP_PALETTE as PALETTE } from './color-palette.js';

	let {
		isEditing,
		regionFormLocations,
		acts,
		scenesByAct,
		locationId = $bindable(),
		color = $bindable(),
		sceneIds,
		creatingLocation = $bindable(),
		newLocationName = $bindable(),
		newLocationError,
		newLocationBusy,
		onSave,
		onCancel,
		onStartCreateLocation,
		onCancelCreateLocation,
		onCommitCreateLocation,
		onToggleScene
	}: {
		isEditing: boolean;
		regionFormLocations: Entity[];
		acts: Entity[];
		scenesByAct: Map<string, Entity[]>;
		locationId: string | null;
		color: string;
		sceneIds: Set<string>;
		creatingLocation: boolean;
		newLocationName: string;
		newLocationError: string;
		newLocationBusy: boolean;
		onSave: () => void;
		onCancel: () => void;
		onStartCreateLocation: () => void;
		onCancelCreateLocation: () => void;
		onCommitCreateLocation: () => void;
		onToggleScene: (sceneId: string) => void;
	} = $props();
</script>

<div
	class="modal-overlay"
	role="dialog"
	aria-modal="true"
	aria-labelledby="region-form-title"
	tabindex="-1"
	use:focusTrap={{ onEscape: onCancel }}
>
	<div class="modal-content">
		<h3 id="region-form-title">{isEditing ? 'Edit Region' : 'New Region'}</h3>

		<label>
			Linked Location
			{#if creatingLocation}
				<div class="region-new-loc-row">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="region-new-loc-input"
						type="text"
						placeholder="Name of new location…"
						aria-label="Name of new location"
						bind:value={newLocationName}
						autofocus
						disabled={newLocationBusy}
						onkeydown={(e) => {
							if (e.key === 'Enter') onCommitCreateLocation();
							if (e.key === 'Escape') onCancelCreateLocation();
						}}
					/>
					<button type="button" onclick={onCommitCreateLocation} disabled={newLocationBusy}>Add</button>
					<button type="button" onclick={onCancelCreateLocation} disabled={newLocationBusy}>Cancel</button>
				</div>
				{#if newLocationError}
					<span class="region-new-loc-error">{newLocationError}</span>
				{/if}
			{:else}
				<div class="region-loc-row">
					<select bind:value={locationId}>
						<option value={null}>None (unlinked)</option>
						{#each regionFormLocations as loc}
							<option value={loc.id}>{loc.name}</option>
						{/each}
					</select>
					<button
						type="button"
						class="btn-icon"
						onclick={onStartCreateLocation}
						title="Create a new Location and link this region to it"
						aria-label="New location"
					>+</button>
				</div>
			{/if}
		</label>

		<label>
			Color
			<div class="color-palette">
				{#each PALETTE as c}
					<button
						class="color-swatch"
						class:active={color === c}
						aria-label="Color {c}"
						style="background: {c}"
						onclick={() => (color = c)}
					></button>
				{/each}
			</div>
		</label>

		{#if locationId}
			<label>
				Active during
				<div class="scene-tree">
					{#each acts as act}
						{@const scenes = scenesByAct.get(act.id) ?? []}
						{#if scenes.length > 0}
							<div class="act-group">
								<div class="act-label">{act.name}</div>
								{#each scenes as scene}
									<label class="scene-check">
										<input
											type="checkbox"
											checked={sceneIds.has(scene.id)}
											onchange={() => onToggleScene(scene.id)}
										/>
										{scene.name}
									</label>
								{/each}
							</div>
						{/if}
					{/each}
					{#if acts.length === 0 || acts.every((a) => (scenesByAct.get(a.id) ?? []).length === 0)}
						<span class="hint">Create acts and scenes in the Timeline first.</span>
					{/if}
				</div>
			</label>
		{/if}

		<div class="modal-actions">
			<button class="btn-secondary" onclick={onCancel}>Cancel</button>
			<button class="btn-primary" onclick={onSave}>Save Region</button>
		</div>
	</div>
</div>
