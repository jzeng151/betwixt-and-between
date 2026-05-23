<script lang="ts">
	// Map editor toolbar: switcher, rename, new/delete, image upload, linked-
	// Location picker + inline new-Location creation, variant chip, duplicate.
	// Styles come from WorldMap.svelte's :global(.map-*), :global(.btn-icon)
	// rules; rename/inline-new-location share state with the orchestrator via
	// $bindable so the post-commit side effects (worldMapStore updates) stay
	// in WorldMap.svelte.

	import type { Entity } from '$lib/stores/entities.js';
	import type { WorldMap } from './types.js';

	let {
		worldMaps,
		activeMap,
		activeMapId,
		hasImage,
		locations,
		duplicating,
		renamingMapName = $bindable(),
		creatingToolbarLocation = $bindable(),
		toolbarNewLocationName = $bindable(),
		toolbarNewLocationBusy,
		variantLabel,
		onSwitchMap,
		onCreateMap,
		onOpenDeleteConfirm,
		onImageUpload,
		onChangeLinkedLocation,
		onStartRename,
		onCommitRename,
		onCancelRename,
		onStartCreateToolbarLocation,
		onCommitCreateToolbarLocation,
		onCancelCreateToolbarLocation,
		onOpenVariantForm,
		onDuplicate
	}: {
		worldMaps: WorldMap[];
		activeMap: WorldMap | null;
		activeMapId: string | null;
		hasImage: boolean;
		locations: Entity[];
		duplicating: boolean;
		renamingMapName: string | null;
		creatingToolbarLocation: boolean;
		toolbarNewLocationName: string;
		toolbarNewLocationBusy: boolean;
		variantLabel: (map: WorldMap | null) => string;
		onSwitchMap: (id: string) => void;
		onCreateMap: () => void;
		onOpenDeleteConfirm: () => void;
		onImageUpload: (e: Event) => void;
		onChangeLinkedLocation: (value: string) => void;
		onStartRename: () => void;
		onCommitRename: () => void;
		onCancelRename: () => void;
		onStartCreateToolbarLocation: () => void;
		onCommitCreateToolbarLocation: () => void;
		onCancelCreateToolbarLocation: () => void;
		onOpenVariantForm: () => void;
		onDuplicate: () => void;
	} = $props();
</script>

<div class="map-toolbar">
	<select
		class="map-switcher"
		value={activeMapId}
		onchange={(e) => onSwitchMap((e.target as HTMLSelectElement).value)}
	>
		{#each worldMaps as m}
			<option value={m.id}>{m.name}</option>
		{/each}
	</select>
	{#if renamingMapName !== null}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="map-name-input"
			type="text"
			bind:value={renamingMapName}
			autofocus
			onblur={onCommitRename}
			onkeydown={(e) => {
				if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
				if (e.key === 'Escape') onCancelRename();
			}}
		/>
	{:else}
		<button
			class="btn-icon"
			onclick={onStartRename}
			title="Rename map"
			aria-label="Rename map"
			disabled={!activeMap}
		>
			<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
				<path d="M7.5 1.5 l2 2 -6 6 -2.5 0.5 0.5-2.5 6-6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
			</svg>
		</button>
	{/if}
	<button class="btn-icon" onclick={onCreateMap} title="New map">+</button>
	<button
		class="btn-icon btn-danger"
		onclick={onOpenDeleteConfirm}
		title="Delete map"
		disabled={!activeMap}
	>×</button>
	{#if hasImage}
		<label class="btn-icon" title="Replace image">
			📁
			<input type="file" accept=".jpg,.jpeg,.png,.webp" onchange={onImageUpload} hidden />
		</label>
	{/if}
	{#if activeMap}
		{#if creatingToolbarLocation}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="map-location-new-input"
				type="text"
				placeholder="Name of new location…"
				aria-label="Name of new location"
				bind:value={toolbarNewLocationName}
				autofocus
				disabled={toolbarNewLocationBusy}
				onblur={onCommitCreateToolbarLocation}
				onkeydown={(e) => {
					if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
					if (e.key === 'Escape') onCancelCreateToolbarLocation();
				}}
			/>
		{:else}
			<select
				class="map-location-picker"
				title="Linked location — what this map depicts"
				aria-label="Linked location"
				value={activeMap.locationId ?? ''}
				onchange={(e) => onChangeLinkedLocation((e.target as HTMLSelectElement).value)}
			>
				<option value="">(no linked location)</option>
				{#each locations as loc}
					<option value={loc.id}>{loc.name}</option>
				{/each}
			</select>
			<button
				class="btn-icon"
				onclick={onStartCreateToolbarLocation}
				title="Create a new Location and link it to this map"
				aria-label="New location"
			>+</button>
		{/if}
		{#if activeMap.locationId}
			<button
				class="map-variant-chip"
				onclick={onOpenVariantForm}
				title="Edit variant scene range"
				aria-label="Edit variant scene range"
			>
				{variantLabel(activeMap)}
			</button>
		{/if}
		<button
			class="btn-icon"
			onclick={onDuplicate}
			disabled={duplicating}
			title="Duplicate this map (clones regions; clears variant range)"
			aria-label="Duplicate map"
		>
			⧉
		</button>
	{/if}
</div>
