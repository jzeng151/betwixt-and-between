<script lang="ts">
	import { focusTrap } from '$lib/actions/focus-trap.js';
	// Variant editor: edits the (startAct/Scene, endAct/Scene) tuple on the
	// active world_map. Form state is bindable so the parent owns the values
	// for save/cancel symmetry with the rest of WorldMap.svelte. Styles come
	// from WorldMap.svelte's :global(.modal-*) and :global(.variant-*) rules.

	import type { Entity } from '$lib/stores/entities.js';

	let {
		acts,
		scenesByAct,
		isDefault = $bindable(),
		startActId = $bindable(),
		startSceneId = $bindable(),
		endActId = $bindable(),
		endSceneId = $bindable(),
		error,
		onSave,
		onCancel
	}: {
		acts: Entity[];
		scenesByAct: Map<string, Entity[]>;
		isDefault: boolean;
		startActId: string | null;
		startSceneId: string | null;
		endActId: string | null;
		endSceneId: string | null;
		error: string;
		onSave: () => void;
		onCancel: () => void;
	} = $props();
</script>

<div
	class="modal-overlay"
	role="dialog"
	aria-modal="true"
	aria-labelledby="variant-form-title"
	tabindex="-1"
	use:focusTrap={{ onEscape: onCancel }}
>
	<div class="modal-content">
		<h3 id="variant-form-title">Variant range</h3>
		<p class="variant-help">
			Which story-time slice does this map depict? Default variant shows whenever
			no scoped variant covers the playhead. A single-Act variant is fine — pick
			the same Act for start and end.
		</p>

		<label class="variant-default">
			<input type="checkbox" bind:checked={isDefault} />
			Default variant (no scene range — shows when nothing else covers)
		</label>

		{#if !isDefault}
			<div class="variant-grid">
				<label>
					Start act
					<select bind:value={startActId}>
						<option value={null}>—</option>
						{#each acts as act}
							<option value={act.id}>{act.name}</option>
						{/each}
					</select>
				</label>
				<label>
					Start scene (optional)
					<select bind:value={startSceneId}>
						<option value={null}>—</option>
						{#each (startActId ? scenesByAct.get(startActId) ?? [] : []) as scene}
							<option value={scene.id}>{scene.name}</option>
						{/each}
					</select>
				</label>
				<label>
					End act
					<select bind:value={endActId}>
						<option value={null}>—</option>
						{#each acts as act}
							<option value={act.id}>{act.name}</option>
						{/each}
					</select>
				</label>
				<label>
					End scene (optional)
					<select bind:value={endSceneId}>
						<option value={null}>—</option>
						{#each (endActId ? scenesByAct.get(endActId) ?? [] : []) as scene}
							<option value={scene.id}>{scene.name}</option>
						{/each}
					</select>
				</label>
			</div>
		{/if}

		{#if error}
			<p class="variant-error">{error}</p>
		{/if}

		<div class="modal-actions">
			<button class="btn-secondary" onclick={onCancel}>Cancel</button>
			<button class="btn-primary" onclick={onSave}>Save Variant</button>
		</div>
	</div>
</div>
