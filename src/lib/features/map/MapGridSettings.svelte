<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { worldMapStore, gridSettingsSaving } from './store.js';
	import type { WorldMap } from './types.js';

	let { map, onClose }: { map: WorldMap; onClose: () => void } = $props();
	// Remounting for each map/opening keeps drafts separate from saved settings.
	// svelte-ignore state_referenced_locally
	let draft = $state({
		gridType: map.gridType,
		gridCellsX: map.gridCellsX,
		gridCellsY: map.gridCellsY,
		gridScaleValue: map.gridScaleValue,
		gridScaleUnit: map.gridScaleUnit
	});
	let busy = $derived($gridSettingsSaving.has(map.id));
	let error = $state('');
	let layoutSelect: HTMLSelectElement;
	let mounted = true;
	onMount(() => layoutSelect.focus());
	onDestroy(() => { mounted = false; });

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		const fields = { ...draft, gridScaleUnit: draft.gridScaleUnit.trim() };
		if (!fields.gridScaleUnit) {
			error = 'Enter a scale unit, such as m, km, or mi.';
			return;
		}
		const mapId = map.id;
		gridSettingsSaving.update((ids) => new Set([...ids, mapId]));
		error = '';
		try {
			await worldMapStore.updateMap(mapId, fields);
		} catch (err) {
			if (mounted) error = err instanceof Error ? err.message : 'Could not save grid settings. Try again.';
			return;
		} finally {
			gridSettingsSaving.update((ids) => {
				const remaining = new Set(ids);
				remaining.delete(mapId);
				return remaining;
			});
		}
		if (mounted) onClose();
	}
</script>

<div class="grid-settings" role="dialog" tabindex="-1" aria-label="Map grid settings"
	onkeydown={(event) => {
		if (event.key === 'Escape') {
			event.stopPropagation();
			if (!busy) onClose();
		}
	}}>
	<h3>Grid settings</h3>
	<form onsubmit={save}>
		<fieldset disabled={busy}>
			<label>Layout
				<select bind:this={layoutSelect} bind:value={draft.gridType}>
					<option value="square">Square</option>
					<option value="hex">Hex</option>
				</select>
			</label>
			<div class="field-pair">
				<label>Columns<input type="number" min="4" max="128" step="1" required bind:value={draft.gridCellsX} /></label>
				<label>Rows<input type="number" min="4" max="128" step="1" required bind:value={draft.gridCellsY} /></label>
			</div>
			<div class="field-pair">
				<label>Units per cell<input type="number" min="0" step="any" required bind:value={draft.gridScaleValue} oninput={(event) => event.currentTarget.setCustomValidity(event.currentTarget.valueAsNumber > 0 ? '' : 'Enter a number greater than zero.')} /></label>
				<label>Unit<input type="text" maxlength="16" required bind:value={draft.gridScaleUnit} placeholder="m, km, mi…" /></label>
			</div>
			<p>Cell counts resize the grid over the map. Scale records distance per cell; it does not resize the canvas.</p>
			<p>Changes that would invalidate painted terrain cannot be saved. Show or hide the grid in Layers.</p>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="actions">
				<button type="button" onclick={onClose}>Cancel</button>
				<button type="submit" class="save">{busy ? 'Saving…' : 'Save grid'}</button>
			</div>
		</fieldset>
	</form>
</div>

<style>
	.grid-settings {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		width: min(320px, calc(100vw - 96px));
		max-height: 70vh;
		overflow-y: auto;
		box-sizing: border-box;
		padding: 16px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface);
		color: var(--color-text);
		font: 12px var(--font-ui, 'Inter', sans-serif);
	}
	h3 { font-size: 14px; margin: 0 0 14px; }
	fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 12px; }
	label { display: grid; gap: 5px; min-width: 0; }
	.field-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	input, select, button { font: inherit; color: inherit; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 4px; padding: 6px 8px; min-width: 0; }
	input, select { width: 100%; box-sizing: border-box; }
	p { margin: 0; line-height: 1.5; }
	.error { color: var(--color-danger); }
	.actions { display: flex; justify-content: flex-end; gap: 8px; }
	button { cursor: pointer; }
	button:hover { border-color: var(--color-accent); }
	button.save { background: var(--color-accent); color: var(--color-on-accent); border-color: var(--color-accent); font-weight: 600; }
	input:disabled, select:disabled, button:disabled { opacity: 0.6; cursor: wait; }
</style>
